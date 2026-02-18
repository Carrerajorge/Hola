/**
 * RequestStateMachine - Formal state machine for every LLM request.
 *
 * States: created -> queued -> started -> first_token -> streaming -> completed | failed | cancelled
 *
 * Guarantees:
 * - Every request MUST reach a terminal state (completed, failed, cancelled).
 * - Transitions are validated; invalid transitions throw.
 * - A safety-net timeout auto-transitions to "failed" if no terminal state is reached.
 * - All transitions are timestamped and logged for observability.
 */

import { EventEmitter } from "events";

// ===== State Definitions =====
export enum RequestState {
  CREATED = "created",
  QUEUED = "queued",
  STARTED = "started",
  FIRST_TOKEN = "first_token",
  STREAMING = "streaming",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
}

const TERMINAL_STATES = new Set<RequestState>([
  RequestState.COMPLETED,
  RequestState.FAILED,
  RequestState.CANCELLED,
]);

/**
 * Valid transitions map. Key = from state, Value = set of allowed target states.
 * "failed" and "cancelled" are reachable from ANY non-terminal state.
 */
const VALID_TRANSITIONS: Record<RequestState, Set<RequestState>> = {
  [RequestState.CREATED]: new Set([RequestState.QUEUED, RequestState.STARTED, RequestState.FAILED, RequestState.CANCELLED]),
  [RequestState.QUEUED]: new Set([RequestState.STARTED, RequestState.FAILED, RequestState.CANCELLED]),
  [RequestState.STARTED]: new Set([RequestState.FIRST_TOKEN, RequestState.STREAMING, RequestState.COMPLETED, RequestState.FAILED, RequestState.CANCELLED]),
  [RequestState.FIRST_TOKEN]: new Set([RequestState.STREAMING, RequestState.COMPLETED, RequestState.FAILED, RequestState.CANCELLED]),
  [RequestState.STREAMING]: new Set([RequestState.COMPLETED, RequestState.FAILED, RequestState.CANCELLED]),
  [RequestState.COMPLETED]: new Set(),
  [RequestState.FAILED]: new Set(),
  [RequestState.CANCELLED]: new Set(),
};

// ===== Transition Record =====
export interface StateTransition {
  from: RequestState;
  to: RequestState;
  timestamp: number;
  reason?: string;
  metadata?: Record<string, unknown>;
}

// ===== Events =====
export interface RequestStateMachineEvents {
  transition: StateTransition;
  terminal: { state: RequestState; requestId: string; reason?: string };
  timeout: { requestId: string; lastState: RequestState; elapsedMs: number };
}

// ===== Configuration =====
export interface RequestStateMachineConfig {
  requestId: string;
  /** Max time (ms) before auto-failing. Default: 300_000 (5 min). */
  overallTimeoutMs?: number;
  /** Max time (ms) waiting for first token after STARTED. Default: 30_000 (30s). */
  firstTokenTimeoutMs?: number;
  /** Max idle time (ms) between tokens during streaming. Default: 60_000 (60s). */
  streamIdleTimeoutMs?: number;
  /** Metadata carried through the lifecycle. */
  metadata?: Record<string, unknown>;
}

const DEFAULT_OVERALL_TIMEOUT_MS = 300_000; // 5 min
const DEFAULT_FIRST_TOKEN_TIMEOUT_MS = 30_000; // 30s
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 60_000; // 60s

// ===== State Machine =====
export class RequestStateMachine extends EventEmitter {
  readonly requestId: string;
  private _state: RequestState = RequestState.CREATED;
  private _transitions: StateTransition[] = [];
  private _createdAt: number = Date.now();
  private _metadata: Record<string, unknown>;

  // Timeouts
  private _overallTimeoutMs: number;
  private _firstTokenTimeoutMs: number;
  private _streamIdleTimeoutMs: number;

  private _overallTimer: ReturnType<typeof setTimeout> | null = null;
  private _firstTokenTimer: ReturnType<typeof setTimeout> | null = null;
  private _streamIdleTimer: ReturnType<typeof setTimeout> | null = null;

  // Timing data
  private _startedAt: number | null = null;
  private _firstTokenAt: number | null = null;
  private _completedAt: number | null = null;
  private _lastTokenAt: number | null = null;
  private _tokenCount: number = 0;

  constructor(config: RequestStateMachineConfig) {
    super();
    this.requestId = config.requestId;
    this._overallTimeoutMs = config.overallTimeoutMs ?? DEFAULT_OVERALL_TIMEOUT_MS;
    this._firstTokenTimeoutMs = config.firstTokenTimeoutMs ?? DEFAULT_FIRST_TOKEN_TIMEOUT_MS;
    this._streamIdleTimeoutMs = config.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS;
    this._metadata = config.metadata ?? {};

    // Start the overall safety-net timer
    this._overallTimer = setTimeout(() => {
      if (!this.isTerminal()) {
        const elapsed = Date.now() - this._createdAt;
        this.emit("timeout", { requestId: this.requestId, lastState: this._state, elapsedMs: elapsed });
        this.fail(`Overall timeout after ${elapsed}ms (last state: ${this._state})`);
      }
    }, this._overallTimeoutMs);

    // Record the initial "created" transition
    this._transitions.push({
      from: RequestState.CREATED,
      to: RequestState.CREATED,
      timestamp: this._createdAt,
      reason: "initialized",
    });
  }

  // ===== Getters =====
  get state(): RequestState {
    return this._state;
  }

  get transitions(): ReadonlyArray<StateTransition> {
    return this._transitions;
  }

  get createdAt(): number {
    return this._createdAt;
  }

  get startedAt(): number | null {
    return this._startedAt;
  }

  get firstTokenAt(): number | null {
    return this._firstTokenAt;
  }

  get completedAt(): number | null {
    return this._completedAt;
  }

  get tokenCount(): number {
    return this._tokenCount;
  }

  get metadata(): Record<string, unknown> {
    return { ...this._metadata };
  }

  get timeToFirstTokenMs(): number | null {
    if (this._startedAt && this._firstTokenAt) {
      return this._firstTokenAt - this._startedAt;
    }
    return null;
  }

  get totalDurationMs(): number {
    const end = this._completedAt ?? Date.now();
    return end - this._createdAt;
  }

  isTerminal(): boolean {
    return TERMINAL_STATES.has(this._state);
  }

  // ===== Transition Methods =====

  /** Transition to QUEUED state (request accepted, waiting for capacity). */
  queue(reason?: string): void {
    this._transition(RequestState.QUEUED, reason ?? "enqueued");
  }

  /** Transition to STARTED (provider call initiated). */
  start(reason?: string): void {
    this._transition(RequestState.STARTED, reason ?? "provider call started");
    this._startedAt = Date.now();

    // Start first-token timeout
    this._firstTokenTimer = setTimeout(() => {
      if (this._state === RequestState.STARTED) {
        this.fail(`First-token timeout: no token received within ${this._firstTokenTimeoutMs}ms`);
      }
    }, this._firstTokenTimeoutMs);
  }

  /** Transition to FIRST_TOKEN (first chunk received from provider). */
  firstToken(reason?: string): void {
    this._transition(RequestState.FIRST_TOKEN, reason ?? "first token received");
    this._firstTokenAt = Date.now();
    this._lastTokenAt = Date.now();
    this._tokenCount = 1;

    // Clear first-token timer, start idle timer
    this._clearTimer("firstToken");
    this._startIdleTimer();
  }

  /** Transition to STREAMING (subsequent tokens flowing). */
  streaming(reason?: string): void {
    // If already streaming, just reset the idle timer (no state change needed)
    if (this._state === RequestState.STREAMING) {
      this._lastTokenAt = Date.now();
      this._tokenCount++;
      this._resetIdleTimer();
      return;
    }
    this._transition(RequestState.STREAMING, reason ?? "streaming");
    this._lastTokenAt = Date.now();
    this._tokenCount++;
    this._resetIdleTimer();
  }

  /** Record a token without forcing a state transition (for use during STREAMING). */
  recordToken(): void {
    this._lastTokenAt = Date.now();
    this._tokenCount++;
    if (this._state === RequestState.STREAMING || this._state === RequestState.FIRST_TOKEN) {
      this._resetIdleTimer();
    }
  }

  /** Transition to COMPLETED (success). */
  complete(reason?: string): void {
    this._transition(RequestState.COMPLETED, reason ?? "completed successfully");
    this._completedAt = Date.now();
    this._clearAllTimers();
  }

  /** Transition to FAILED (error). */
  fail(reason?: string): void {
    if (this.isTerminal()) return; // Idempotent: don't fail twice
    this._transition(RequestState.FAILED, reason ?? "failed");
    this._completedAt = Date.now();
    this._clearAllTimers();
  }

  /** Transition to CANCELLED (client disconnected or explicit cancel). */
  cancel(reason?: string): void {
    if (this.isTerminal()) return; // Idempotent
    this._transition(RequestState.CANCELLED, reason ?? "cancelled");
    this._completedAt = Date.now();
    this._clearAllTimers();
  }

  /** Set arbitrary metadata. */
  setMetadata(key: string, value: unknown): void {
    this._metadata[key] = value;
  }

  /** Get a snapshot of the current state for logging/tracing. */
  snapshot(): {
    requestId: string;
    state: RequestState;
    createdAt: number;
    startedAt: number | null;
    firstTokenAt: number | null;
    completedAt: number | null;
    tokenCount: number;
    timeToFirstTokenMs: number | null;
    totalDurationMs: number;
    transitions: ReadonlyArray<StateTransition>;
    metadata: Record<string, unknown>;
  } {
    return {
      requestId: this.requestId,
      state: this._state,
      createdAt: this._createdAt,
      startedAt: this._startedAt,
      firstTokenAt: this._firstTokenAt,
      completedAt: this._completedAt,
      tokenCount: this._tokenCount,
      timeToFirstTokenMs: this.timeToFirstTokenMs,
      totalDurationMs: this.totalDurationMs,
      transitions: [...this._transitions],
      metadata: { ...this._metadata },
    };
  }

  /**
   * Dispose of all timers. MUST be called if the state machine is discarded
   * before reaching a terminal state (e.g. in error-recovery paths).
   */
  dispose(): void {
    this._clearAllTimers();
  }

  // ===== Internal =====

  private _transition(to: RequestState, reason?: string): void {
    const from = this._state;

    if (TERMINAL_STATES.has(from)) {
      // Already terminal - ignore silently for idempotent fail/cancel
      return;
    }

    const allowed = VALID_TRANSITIONS[from];
    if (!allowed.has(to)) {
      throw new Error(
        `[RequestStateMachine] Invalid transition: ${from} -> ${to} for request ${this.requestId}` +
        (reason ? ` (reason: ${reason})` : "")
      );
    }

    this._state = to;
    const transition: StateTransition = {
      from,
      to,
      timestamp: Date.now(),
      reason,
    };
    this._transitions.push(transition);

    this.emit("transition", transition);

    if (TERMINAL_STATES.has(to)) {
      this.emit("terminal", { state: to, requestId: this.requestId, reason });
    }
  }

  private _startIdleTimer(): void {
    this._clearTimer("idle");
    this._streamIdleTimer = setTimeout(() => {
      if (!this.isTerminal()) {
        const idleMs = Date.now() - (this._lastTokenAt ?? this._createdAt);
        this.fail(`Stream idle timeout: no token for ${idleMs}ms`);
      }
    }, this._streamIdleTimeoutMs);
  }

  private _resetIdleTimer(): void {
    this._startIdleTimer();
  }

  private _clearTimer(which: "overall" | "firstToken" | "idle"): void {
    switch (which) {
      case "overall":
        if (this._overallTimer) { clearTimeout(this._overallTimer); this._overallTimer = null; }
        break;
      case "firstToken":
        if (this._firstTokenTimer) { clearTimeout(this._firstTokenTimer); this._firstTokenTimer = null; }
        break;
      case "idle":
        if (this._streamIdleTimer) { clearTimeout(this._streamIdleTimer); this._streamIdleTimer = null; }
        break;
    }
  }

  private _clearAllTimers(): void {
    this._clearTimer("overall");
    this._clearTimer("firstToken");
    this._clearTimer("idle");
  }
}

// ===== Active Request Tracker =====

/**
 * Tracks all in-flight request state machines. Provides visibility into
 * stuck requests and enables forced cleanup.
 */
export class RequestTracker {
  private _machines: Map<string, RequestStateMachine> = new Map();
  private _cleanupInterval: ReturnType<typeof setInterval>;

  constructor(cleanupIntervalMs: number = 60_000) {
    this._cleanupInterval = setInterval(() => this._cleanup(), cleanupIntervalMs);
    if (this._cleanupInterval.unref) {
      this._cleanupInterval.unref();
    }
  }

  /** Create and track a new state machine. */
  create(config: RequestStateMachineConfig): RequestStateMachine {
    const machine = new RequestStateMachine(config);

    // Auto-remove on terminal state
    machine.on("terminal", () => {
      // Keep briefly for observability, then remove
      setTimeout(() => {
        this._machines.delete(config.requestId);
      }, 30_000);
    });

    this._machines.set(config.requestId, machine);
    return machine;
  }

  /** Get a machine by request ID. */
  get(requestId: string): RequestStateMachine | undefined {
    return this._machines.get(requestId);
  }

  /** Get all active (non-terminal) machines. */
  getActive(): RequestStateMachine[] {
    return Array.from(this._machines.values()).filter(m => !m.isTerminal());
  }

  /** Get all machines stuck in a specific state for longer than the given duration. */
  getStuck(maxDurationMs: number): RequestStateMachine[] {
    const now = Date.now();
    return this.getActive().filter(m => (now - m.createdAt) > maxDurationMs);
  }

  /** Force-fail all stuck machines older than the given duration. */
  forceFailStuck(maxDurationMs: number): number {
    const stuck = this.getStuck(maxDurationMs);
    for (const machine of stuck) {
      machine.fail(`Force-failed: stuck for ${Date.now() - machine.createdAt}ms`);
    }
    return stuck.length;
  }

  /** Get counts by state for monitoring. */
  getCounts(): Record<RequestState, number> {
    const counts: Record<string, number> = {};
    for (const state of Object.values(RequestState)) {
      counts[state] = 0;
    }
    for (const machine of this._machines.values()) {
      counts[machine.state]++;
    }
    return counts as Record<RequestState, number>;
  }

  /** Total tracked machines. */
  get size(): number {
    return this._machines.size;
  }

  /** Cleanup terminated machines that have been around for more than 5 minutes. */
  private _cleanup(): void {
    const now = Date.now();
    for (const [id, machine] of this._machines.entries()) {
      if (machine.isTerminal() && machine.completedAt && (now - machine.completedAt) > 300_000) {
        this._machines.delete(id);
      }
    }
  }

  destroy(): void {
    clearInterval(this._cleanupInterval);
    for (const machine of this._machines.values()) {
      machine.dispose();
    }
    this._machines.clear();
  }
}

// ===== Global Instance =====
export const requestTracker = new RequestTracker();
