/**
 * @file laneQueue.ts
 * @description Lane-based parallel task queue with work-stealing for the ILIAGPT × OpenClaw
 * fusion bridge. Organises concurrent tasks into named "lanes" (one worker
 * coroutine per lane) while allowing idle workers to steal pending work from
 * busy siblings.
 *
 * Design goals
 * ─────────────
 * • Predictable ordering within a lane (FIFO).
 * • Maximum utilisation via work-stealing across lanes.
 * • Back-pressure: configurable per-lane capacity limits.
 * • Observability: emits lifecycle events and exposes a snapshot API.
 *
 * @module laneQueue
 */

import { EventEmitter } from 'node:events';
import { Logger } from '../lib/logger';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TaskFn<T = unknown> = () => Promise<T>;

export interface TaskDescriptor<T = unknown> {
  /** Unique identifier assigned when the task is enqueued. */
  id: string;
  /** The lane this task belongs to. */
  lane: string;
  /** Callable that performs the actual work. */
  fn: TaskFn<T>;
  /** Wall-clock time the task was submitted. */
  enqueuedAt: Date;
  /** Optional human-readable label for logging / events. */
  label?: string;
  /** Resolve / reject handles for the caller-facing promise. */
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export interface LaneSnapshot {
  name: string;
  pending: number;
  capacity: number;
  busy: boolean;
  processed: number;
  stolen: number;
  errors: number;
}

export interface LaneQueueOptions {
  /** Lane definitions. Each entry creates one named lane with its own worker. */
  lanes: Array<{
    name: string;
    /** Max tasks held in the queue at once (0 = unlimited). Default: 100. */
    capacity?: number;
  }>;
  /** Enable work-stealing across lanes when a lane finishes early. Default: true. */
  workStealing?: boolean;
  /** Milliseconds a worker waits before polling after an empty queue. Default: 50. */
  pollIntervalMs?: number;
}

// ---------------------------------------------------------------------------
// Internal lane state
// ---------------------------------------------------------------------------

interface LaneState {
  name: string;
  capacity: number;
  queue: TaskDescriptor[];
  busy: boolean;
  stats: { processed: number; stolen: number; errors: number };
}

// ---------------------------------------------------------------------------
// LaneQueue
// ---------------------------------------------------------------------------

/**
 * Parallel task scheduler with named lanes and optional work-stealing.
 *
 * @example
 * ```typescript
 * const lq = new LaneQueue({
 *   lanes: [{ name: 'llm', capacity: 20 }, { name: 'io' }, { name: 'cpu' }],
 *   workStealing: true,
 * });
 * lq.start();
 *
 * const result = await lq.enqueue('llm', () => callOpenAI(prompt), 'gpt-query');
 * console.log(result);
 *
 * await lq.shutdown();
 * ```
 */
export class LaneQueue extends EventEmitter {
  private readonly logger: Logger;
  private readonly lanes: Map<string, LaneState> = new Map();
  private readonly workStealing: boolean;
  private readonly pollIntervalMs: number;
  private running = false;
  private workerTimers: NodeJS.Timeout[] = [];
  private taskCounter = 0;

  constructor(options: LaneQueueOptions) {
    super();
    this.logger = new Logger('LaneQueue');
    this.workStealing = options.workStealing ?? true;
    this.pollIntervalMs = options.pollIntervalMs ?? 50;

    for (const def of options.lanes) {
      this.lanes.set(def.name, {
        name: def.name,
        capacity: def.capacity ?? 100,
        queue: [],
        busy: false,
        stats: { processed: 0, stolen: 0, errors: 0 },
      });
    }

    this.logger.info(
      `LaneQueue created with lanes: [${[...this.lanes.keys()].join(', ')}]` +
      ` (workStealing=${this.workStealing})`,
    );
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Start lane workers. Must be called before enqueueing tasks. */
  start(): void {
    if (this.running) return;
    this.running = true;

    for (const lane of this.lanes.values()) {
      this._spawnWorker(lane);
    }

    this.logger.info('LaneQueue started.');
  }

  /**
   * Drain all lanes and stop workers.
   * @param timeoutMs Maximum milliseconds to wait for drain. Default: 30 000.
   */
  async shutdown(timeoutMs = 30_000): Promise<void> {
    this.logger.info('Shutting down LaneQueue…');
    this.running = false;

    // Clear polling timers
    for (const t of this.workerTimers) clearTimeout(t);
    this.workerTimers = [];

    // Wait for all lanes to become idle
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const allIdle = [...this.lanes.values()].every((l) => !l.busy && l.queue.length === 0);
      if (allIdle) break;
      await sleep(100);
    }

    // Reject any remaining tasks
    for (const lane of this.lanes.values()) {
      for (const task of lane.queue) {
        task.reject(new Error('LaneQueue shut down before task could run'));
      }
      lane.queue = [];
    }

    this.logger.info('LaneQueue shut down.');
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Enqueue a task in the named lane.
   *
   * @param laneName  Target lane (must be declared in options.lanes).
   * @param fn        Async function that performs the work.
   * @param label     Optional label for observability.
   * @returns A promise that resolves / rejects with the task's outcome.
   */
  enqueue<T>(laneName: string, fn: TaskFn<T>, label?: string): Promise<T> {
    const lane = this.lanes.get(laneName);
    if (!lane) throw new Error(`Unknown lane: "${laneName}"`);
    if (!this.running) throw new Error('LaneQueue is not running – call start() first');

    if (lane.capacity > 0 && lane.queue.length >= lane.capacity) {
      return Promise.reject(
        new Error(`Lane "${laneName}" is at capacity (${lane.capacity})`),
      );
    }

    return new Promise<T>((resolve, reject) => {
      const descriptor: TaskDescriptor<T> = {
        id: `task-${++this.taskCounter}`,
        lane: laneName,
        fn,
        enqueuedAt: new Date(),
        label,
        resolve,
        reject,
      };

      lane.queue.push(descriptor as TaskDescriptor);
      this.emit('task:enqueued', { id: descriptor.id, lane: laneName, label });
      this.logger.debug(`Enqueued task ${descriptor.id} in lane "${laneName}"${label ? ` (${label})` : ''}`);
    });
  }

  /** Return a snapshot of every lane's current state. */
  getSnapshots(): LaneSnapshot[] {
    return [...this.lanes.values()].map((lane) => ({
      name: lane.name,
      pending: lane.queue.length,
      capacity: lane.capacity,
      busy: lane.busy,
      processed: lane.stats.processed,
      stolen: lane.stats.stolen,
      errors: lane.stats.errors,
    }));
  }

  /** Total number of tasks currently waiting across all lanes. */
  get pendingCount(): number {
    return [...this.lanes.values()].reduce((sum, l) => sum + l.queue.length, 0);
  }

  // -------------------------------------------------------------------------
  // Worker loop
  // -------------------------------------------------------------------------

  private _spawnWorker(lane: LaneState): void {
    const tick = async () => {
      if (!this.running) return;

      const task = this._nextTask(lane);
      if (task) {
        await this._runTask(lane, task);
        // Immediately look for the next task without polling delay
        setImmediate(() => tick());
      } else {
        // Nothing to do – sleep before polling again
        const timer = setTimeout(() => tick(), this.pollIntervalMs);
        this.workerTimers.push(timer);
      }
    };

    // Kick off the worker
    setImmediate(() => tick());
  }

  /**
   * Pick the next task: own queue first, then steal from the busiest sibling.
   */
  private _nextTask(lane: LaneState): TaskDescriptor | undefined {
    if (lane.queue.length > 0) {
      return lane.queue.shift();
    }

    if (this.workStealing) {
      return this._steal(lane);
    }

    return undefined;
  }

  /**
   * Work-stealing: take the first task from the sibling lane with the most
   * pending work.
   */
  private _steal(thief: LaneState): TaskDescriptor | undefined {
    let victim: LaneState | undefined;
    let maxPending = 1; // Only steal if there is at least 1 task to steal

    for (const lane of this.lanes.values()) {
      if (lane === thief) continue;
      if (lane.queue.length > maxPending) {
        maxPending = lane.queue.length;
        victim = lane;
      }
    }

    if (!victim) return undefined;

    const stolen = victim.queue.shift();
    if (stolen) {
      thief.stats.stolen++;
      victim.stats.stolen++; // Track that a task was stolen *from* victim too
      this.logger.debug(
        `Work-steal: lane "${thief.name}" stole task ${stolen.id} from lane "${victim.name}"`,
      );
      this.emit('task:stolen', { taskId: stolen.id, from: victim.name, to: thief.name });
    }
    return stolen;
  }

  /** Execute a task and emit lifecycle events. */
  private async _runTask(lane: LaneState, task: TaskDescriptor): Promise<void> {
    lane.busy = true;
    this.emit('task:start', { id: task.id, lane: task.lane, label: task.label });

    const startMs = Date.now();
    try {
      const result = await task.fn();
      task.resolve(result);
      lane.stats.processed++;
      this.emit('task:done', {
        id: task.id,
        lane: task.lane,
        label: task.label,
        durationMs: Date.now() - startMs,
      });
    } catch (err) {
      task.reject(err);
      lane.stats.errors++;
      this.emit('task:error', { id: task.id, lane: task.lane, label: task.label, error: err });
      this.logger.error(`Task ${task.id} in lane "${task.lane}" failed: ${(err as Error).message}`);
    } finally {
      lane.busy = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
