import { randomUUID } from 'crypto';
import { AgentRunner } from '../../services/agentRunner';
import { getStatePersistence } from '../persistence/statePersistence';
import { hookSystem } from '../plugins/hookSystem';
import { openclawEventBus } from '../events';
import { Logger } from '../../lib/logger';

export type SubagentRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface SubagentRunRecord {
  id: string;
  requesterUserId: string;
  objective: string;
  planHint: string[];
  parentRunId?: string;
  status: SubagentRunStatus;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  result?: unknown;
  error?: string;
  stepsCompleted?: number;
  toolsUsed?: string[];
}

type SpawnSubagentParams = {
  requesterUserId: string;
  objective: string;
  planHint?: string[];
  parentRunId?: string;
};

type ListRunsParams = {
  requesterUserId?: string;
  parentRunId?: string;
  status?: SubagentRunStatus;
  limit?: number;
};

const MAX_RETENTION_RUNS = 500;
const MAX_DEPTH = 3;
const CONTEXT_CLEANUP_DELAY_MS = 60_000;

/**
 * Scoped KV store per root parent run tree.
 * All subagents under the same root share this store,
 * enabling inter-sibling communication.
 */
class SharedContext {
  private stores = new Map<string, Map<string, unknown>>();
  private cleanupTimers = new Map<string, NodeJS.Timeout>();

  getStore(rootRunId: string): Map<string, unknown> {
    let store = this.stores.get(rootRunId);
    if (!store) {
      store = new Map();
      this.stores.set(rootRunId, store);
    }
    return store;
  }

  set(rootRunId: string, key: string, value: unknown): void {
    this.getStore(rootRunId).set(key, value);
  }

  get(rootRunId: string, key: string): unknown {
    return this.stores.get(rootRunId)?.get(key);
  }

  entries(rootRunId: string): Record<string, unknown> {
    const store = this.stores.get(rootRunId);
    if (!store) return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of store) {
      out[k] = v;
    }
    return out;
  }

  /** Schedule cleanup after root run completes. */
  scheduleCleanup(rootRunId: string, delayMs = CONTEXT_CLEANUP_DELAY_MS): void {
    const existing = this.cleanupTimers.get(rootRunId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.stores.delete(rootRunId);
      this.cleanupTimers.delete(rootRunId);
      Logger.debug(`[OpenClaw:SharedContext] Cleaned up context for root: ${rootRunId}`);
    }, delayMs);
    // Don't hold the process open for cleanup timers
    if (timer.unref) timer.unref();
    this.cleanupTimers.set(rootRunId, timer);
  }

  /** Immediate cleanup (for testing). */
  cleanup(rootRunId: string): void {
    const timer = this.cleanupTimers.get(rootRunId);
    if (timer) clearTimeout(timer);
    this.stores.delete(rootRunId);
    this.cleanupTimers.delete(rootRunId);
  }

  /** Clear all (for testing). */
  clearAll(): void {
    for (const timer of this.cleanupTimers.values()) clearTimeout(timer);
    this.stores.clear();
    this.cleanupTimers.clear();
  }
}

/**
 * OpenClaw Subagent Service — manages spawning, tracking, and lifecycle
 * of delegated sub-agent runs.
 *
 * Capabilities:
 * - Persistence-backed: runs survive server restarts via PostgreSQL
 * - Hook integration: dispatches lifecycle hooks (session_start/end, agent_end)
 * - Richer state: tracks stepsCompleted, toolsUsed
 * - Concurrent run limits to prevent resource exhaustion
 * - Depth enforcement: prevents infinite nesting (MAX_DEPTH = 3)
 * - SharedContext: scoped KV store for inter-subagent communication
 * - awaitChildren: wait for all children to complete, aggregate results
 */
class OpenClawSubagentService {
  private runs = new Map<string, SubagentRunRecord>();
  private runners = new Map<string, AgentRunner>();
  private sharedContext = new SharedContext();
  private maxConcurrent = parseInt(process.env.OPENCLAW_MAX_CONCURRENT_SUBAGENTS || '5', 10);

  // ── Depth Enforcement ─────────────────────────────────────────────────

  /**
   * Walk the parentRunId chain to compute depth.
   * Root run = depth 0, first child = depth 1, etc.
   */
  getDepth(runId: string, maxIter = 10): number {
    let depth = 0;
    let current = this.runs.get(runId);
    while (current?.parentRunId && depth < maxIter) {
      depth++;
      current = this.runs.get(current.parentRunId);
    }
    return depth;
  }

  /**
   * Walk the parentRunId chain to find the root ancestor.
   * Returns the runId itself if it has no parent.
   */
  getRootParentId(runId: string, maxIter = 10): string {
    let currentId = runId;
    let current = this.runs.get(runId);
    let iter = 0;
    while (current?.parentRunId && iter < maxIter) {
      currentId = current.parentRunId;
      current = this.runs.get(currentId);
      iter++;
    }
    return currentId;
  }

  // ── Core CRUD ─────────────────────────────────────────────────────────

  spawn(params: SpawnSubagentParams): SubagentRunRecord {
    // Depth enforcement: check if parent is too deep
    if (params.parentRunId) {
      const parentDepth = this.getDepth(params.parentRunId);
      if (parentDepth >= MAX_DEPTH) {
        Logger.warn(`[OpenClaw:Subagent] Depth limit reached (${parentDepth} >= ${MAX_DEPTH})`);
        const run: SubagentRunRecord = {
          id: `subagent_${randomUUID()}`,
          requesterUserId: params.requesterUserId,
          objective: params.objective,
          planHint: params.planHint || [],
          parentRunId: params.parentRunId,
          status: 'failed',
          createdAt: Date.now(),
          endedAt: Date.now(),
          error: `Maximum subagent nesting depth (${MAX_DEPTH}) exceeded. Consider restructuring into parallel sibling tasks.`,
        };
        this.runs.set(run.id, run);
        return run;
      }
    }

    // Enforce concurrent run limit
    const activeCount = Array.from(this.runs.values()).filter(
      r => r.status === 'running' || r.status === 'queued',
    ).length;

    if (activeCount >= this.maxConcurrent) {
      Logger.warn(`[OpenClaw:Subagent] Concurrent limit reached (${this.maxConcurrent})`);
      const run: SubagentRunRecord = {
        id: `subagent_${randomUUID()}`,
        requesterUserId: params.requesterUserId,
        objective: params.objective,
        planHint: params.planHint || [],
        parentRunId: params.parentRunId,
        status: 'failed',
        createdAt: Date.now(),
        endedAt: Date.now(),
        error: `Maximum concurrent subagent limit (${this.maxConcurrent}) reached.`,
      };
      this.runs.set(run.id, run);
      return run;
    }

    const runId = `subagent_${randomUUID()}`;
    const run: SubagentRunRecord = {
      id: runId,
      requesterUserId: params.requesterUserId,
      objective: params.objective,
      planHint: params.planHint || [],
      parentRunId: params.parentRunId,
      status: 'queued',
      createdAt: Date.now(),
      stepsCompleted: 0,
      toolsUsed: [],
    };

    this.runs.set(runId, run);
    this.trimRetention();

    // Persist to DB (fire-and-forget)
    void this.persistRun(run);

    // Launch execution asynchronously
    void this.execute(runId);

    return run;
  }

  get(runId: string): SubagentRunRecord | undefined {
    return this.runs.get(runId);
  }

  list(params: ListRunsParams = {}): SubagentRunRecord[] {
    const { requesterUserId, parentRunId, status, limit = 100 } = params;

    return Array.from(this.runs.values())
      .filter(run => !requesterUserId || run.requesterUserId === requesterUserId)
      .filter(run => !parentRunId || run.parentRunId === parentRunId)
      .filter(run => !status || run.status === status)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.max(1, limit));
  }

  cancel(runId: string): boolean {
    const run = this.runs.get(runId);
    if (!run) return false;
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      return false;
    }

    const runner = this.runners.get(runId);
    if (runner) {
      runner.cancel();
    }

    run.status = 'cancelled';
    run.endedAt = Date.now();
    this.runs.set(runId, run);

    void this.persistRun(run);
    void hookSystem.dispatch('session_end', { runId, metadata: { reason: 'cancelled' } });
    Logger.info(`[OpenClaw:Subagent] Cancelled: ${runId}`);
    return true;
  }

  // ── SharedContext ──────────────────────────────────────────────────────

  setSharedValue(runId: string, key: string, value: unknown): void {
    const rootId = this.getRootParentId(runId);
    this.sharedContext.set(rootId, key, value);
  }

  getSharedValue(runId: string, key: string): unknown {
    const rootId = this.getRootParentId(runId);
    return this.sharedContext.get(rootId, key);
  }

  getSharedEntries(runId: string): Record<string, unknown> {
    const rootId = this.getRootParentId(runId);
    return this.sharedContext.entries(rootId);
  }

  // ── awaitChildren + Aggregation ───────────────────────────────────────

  /**
   * Wait for all children of a parent run to reach terminal status.
   * Returns summary of completed/failed children plus shared context.
   */
  async awaitChildren(
    parentRunId: string,
    options: { timeoutMs?: number; pollIntervalMs?: number } = {},
  ): Promise<{
    completed: SubagentRunRecord[];
    failed: SubagentRunRecord[];
    allDone: boolean;
    aggregatedResults: Record<string, unknown>;
    sharedContext: Record<string, unknown>;
  }> {
    const { timeoutMs = 120_000, pollIntervalMs = 500 } = options;
    const deadline = Date.now() + timeoutMs;
    const terminal: Set<SubagentRunStatus> = new Set(['completed', 'failed', 'cancelled']);

    while (Date.now() < deadline) {
      const children = this.list({ parentRunId });

      // If no children, return immediately
      if (children.length === 0) {
        return {
          completed: [],
          failed: [],
          allDone: true,
          aggregatedResults: {},
          sharedContext: this.getSharedEntries(parentRunId),
        };
      }

      const allTerminal = children.every(c => terminal.has(c.status));
      if (allTerminal) {
        const completed = children.filter(c => c.status === 'completed');
        const failed = children.filter(c => c.status === 'failed' || c.status === 'cancelled');
        return {
          completed,
          failed,
          allDone: true,
          aggregatedResults: this.getAggregatedResults(parentRunId),
          sharedContext: this.getSharedEntries(parentRunId),
        };
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    // Timeout reached — return partial state
    const children = this.list({ parentRunId });
    const completed = children.filter(c => c.status === 'completed');
    const failed = children.filter(c => c.status === 'failed' || c.status === 'cancelled');
    return {
      completed,
      failed,
      allDone: false,
      aggregatedResults: this.getAggregatedResults(parentRunId),
      sharedContext: this.getSharedEntries(parentRunId),
    };
  }

  /**
   * Collect results from completed children into a keyed map.
   */
  getAggregatedResults(parentRunId: string): Record<string, unknown> {
    const children = this.list({ parentRunId });
    const results: Record<string, unknown> = {};
    for (const child of children) {
      if (child.status === 'completed' && child.result !== undefined) {
        results[child.id] = child.result;
      }
    }
    return results;
  }

  // ── Persistence Restore ───────────────────────────────────────────────

  /** Restore runs from persistence on startup. */
  async restoreFromPersistence(userId?: string): Promise<number> {
    try {
      const persistence = getStatePersistence();
      const persisted = await persistence.listRuns({ userId, limit: MAX_RETENTION_RUNS });

      let restored = 0;
      for (const p of persisted) {
        if (!this.runs.has(p.id)) {
          this.runs.set(p.id, {
            id: p.id,
            requesterUserId: p.userId,
            objective: p.objective,
            planHint: p.planHint,
            parentRunId: p.parentRunId,
            status: p.status,
            createdAt: p.createdAt,
            startedAt: p.startedAt,
            endedAt: p.endedAt,
            result: p.result,
            error: p.error,
          });
          restored++;
        }
      }

      if (restored > 0) {
        Logger.info(`[OpenClaw:Subagent] Restored ${restored} runs from persistence`);
      }
      return restored;
    } catch (err) {
      Logger.warn(`[OpenClaw:Subagent] Persistence restore failed: ${(err as Error).message}`);
      return 0;
    }
  }

  // ── Execution ─────────────────────────────────────────────────────────

  private async execute(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run || run.status === 'cancelled') return;

    const runner = new AgentRunner();
    this.runners.set(runId, runner);
    run.status = 'running';
    run.startedAt = Date.now();
    this.runs.set(runId, run);

    void this.persistRun(run);
    void hookSystem.dispatch('session_start', {
      runId,
      userId: run.requesterUserId,
      metadata: { objective: run.objective, parentRunId: run.parentRunId },
    });

    // ── Bridge runner lifecycle → openclawEventBus → streaming adapter ──
    // This is what makes agent activity visible to WebSocket clients.

    runner.on('started', (event: any) => {
      const plan = event?.plan || run.planHint || [];
      openclawEventBus.emit('stream:delta', {
        runId,
        content: `Agent started: ${run.objective}\nPlan: ${plan.join(' → ')}\n\n`,
      });
      openclawEventBus.emit('agent:status', {
        runId,
        status: 'running',
        step: 0,
        totalSteps: plan.length,
        toolsUsed: [],
      });
    });

    runner.on('step_started', (event: any) => {
      const toolName = event?.action?.tool || 'unknown';
      const stepIndex = event?.stepIndex ?? 0;
      openclawEventBus.emit('tool:start', { runId, toolName });
      openclawEventBus.emit('stream:delta', {
        runId,
        content: `Step ${stepIndex + 1}: Using ${toolName}...\n`,
      });
    });

    runner.on('step_completed', (event: any) => {
      const current = this.runs.get(runId);
      if (current) {
        current.stepsCompleted = (current.stepsCompleted || 0) + 1;
        if (event?.step?.tool && !current.toolsUsed?.includes(event.step.tool)) {
          current.toolsUsed = [...(current.toolsUsed || []), event.step.tool];
        }
      }

      const toolName = event?.step?.tool || 'unknown';
      const success = event?.step?.success ?? false;
      openclawEventBus.emit('tool:end', { runId, toolName, success });

      if (event?.step?.output) {
        const result = typeof event.step.output === 'string'
          ? event.step.output
          : JSON.stringify(event.step.output);
        openclawEventBus.emit('tool:result', { runId, toolName, result });
      }

      const icon = success ? '[OK]' : '[FAIL]';
      openclawEventBus.emit('stream:delta', {
        runId,
        content: `${icon} ${toolName} (${event?.step?.duration || 0}ms)\n`,
      });

      openclawEventBus.emit('agent:status', {
        runId,
        status: 'running',
        step: current?.stepsCompleted || 0,
        totalSteps: run.planHint.length || 8,
        toolsUsed: current?.toolsUsed || [],
      });
    });

    try {
      const result = await runner.run(run.objective, run.planHint);
      const next = this.runs.get(runId);
      if (!next) return;

      if (result.state.status === 'cancelled') {
        next.status = 'cancelled';
      } else if (result.success) {
        next.status = 'completed';
      } else {
        next.status = 'failed';
      }

      next.result = result.result;
      next.error = result.success ? undefined : (result.result as any)?.error;
      next.endedAt = Date.now();
      next.stepsCompleted = result.state.history.length;
      next.toolsUsed = result.state.toolsUsed;
      this.runs.set(runId, next);

      // Auto-store completed result in shared context
      if (next.status === 'completed') {
        const rootId = this.getRootParentId(runId);
        this.sharedContext.set(rootId, `result:${runId}`, next.result);

        // If this is a root run completing, schedule context cleanup
        if (rootId === runId) {
          this.sharedContext.scheduleCleanup(rootId);
        }
      }

      void this.persistRun(next);
      void hookSystem.dispatch('agent_end', {
        runId,
        userId: next.requesterUserId,
        metadata: {
          status: next.status,
          stepsCompleted: next.stepsCompleted,
          durationMs: (next.endedAt || Date.now()) - (next.startedAt || next.createdAt),
        },
      });

      // Emit completion/failure to event bus for streaming clients
      if (next.status === 'completed') {
        const resultStr = typeof next.result === 'string'
          ? next.result
          : JSON.stringify(next.result);
        openclawEventBus.emit('stream:delta', {
          runId,
          content: `\nAgent completed (${next.stepsCompleted} steps, ${(next.endedAt! - next.startedAt!)}ms).\nResult: ${resultStr?.slice(0, 2000)}\n`,
        });
        openclawEventBus.emit('stream:end', { runId });
      } else {
        openclawEventBus.emit('stream:error', {
          runId,
          error: next.error || `Agent ${next.status}`,
        });
      }

      openclawEventBus.emit('agent:status', {
        runId,
        status: next.status,
        step: next.stepsCompleted || 0,
        totalSteps: next.stepsCompleted || 0,
        toolsUsed: next.toolsUsed || [],
      });

      Logger.info(
        `[OpenClaw:Subagent] ${runId} → ${next.status} (${next.stepsCompleted} steps, ` +
        `${(next.endedAt! - next.startedAt!)}ms)`,
      );
    } catch (error: any) {
      const next = this.runs.get(runId);
      if (!next) return;

      next.status = 'failed';
      next.error = error?.message || 'Subagent execution failed';
      next.endedAt = Date.now();
      this.runs.set(runId, next);

      void this.persistRun(next);
      void hookSystem.dispatch('error', { runId, error, metadata: { phase: 'subagent_execution' } });

      openclawEventBus.emit('stream:error', {
        runId,
        error: next.error || 'Subagent execution failed',
      });

      Logger.error(`[OpenClaw:Subagent] ${runId} failed: ${next.error}`);
    } finally {
      this.runners.delete(runId);
      this.trimRetention();
    }
  }

  private async persistRun(run: SubagentRunRecord): Promise<void> {
    try {
      const persistence = getStatePersistence();
      await persistence.saveRun({
        id: run.id,
        userId: run.requesterUserId,
        objective: run.objective,
        planHint: run.planHint,
        parentRunId: run.parentRunId,
        status: run.status,
        result: run.result,
        error: run.error,
        createdAt: run.createdAt,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        metadata: { stepsCompleted: run.stepsCompleted, toolsUsed: run.toolsUsed },
      });
    } catch {
      // Non-blocking; in-memory is authoritative
    }
  }

  private trimRetention(): void {
    if (this.runs.size <= MAX_RETENTION_RUNS) return;
    const ordered = Array.from(this.runs.values()).sort((a, b) => a.createdAt - b.createdAt);
    const overflow = this.runs.size - MAX_RETENTION_RUNS;
    for (let i = 0; i < overflow; i++) {
      this.runs.delete(ordered[i].id);
    }
  }
}

export const openclawSubagentService = new OpenClawSubagentService();
