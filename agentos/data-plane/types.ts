import { EventEmitter } from "events";

// ── Domain Event ──────────────────────────────────────────────────────
export interface DomainEvent<T = unknown> {
  id: string;
  type: string;
  aggregateId: string;
  aggregateType: string;
  version: number;
  timestamp: Date;
  payload: T;
  metadata: Record<string, unknown>;
  correlationId?: string;
  causationId?: string;
}

export interface Snapshot<T = unknown> {
  aggregateId: string;
  aggregateType: string;
  version: number;
  state: T;
  createdAt: Date;
}

// ── Event Store ───────────────────────────────────────────────────────
export interface EventStore {
  append(streamId: string, events: DomainEvent[], expectedVersion?: number): Promise<void>;
  read(streamId: string, fromVersion?: number): Promise<DomainEvent[]>;
  readAll(fromPosition?: number, limit?: number): Promise<DomainEvent[]>;
  subscribe(streamId: string | "*", handler: (event: DomainEvent) => Promise<void>): () => void;
  saveSnapshot(snapshot: Snapshot): Promise<void>;
  getSnapshot(aggregateId: string): Promise<Snapshot | null>;
}

// ── CQRS ──────────────────────────────────────────────────────────────
export interface Command<T = unknown> {
  type: string;
  payload: T;
  metadata: CommandMeta;
}

export interface CommandMeta {
  correlationId: string;
  userId?: string;
  timestamp: Date;
  retryCount?: number;
}

export type CommandHandler<T = unknown> = (command: Command<T>) => Promise<void>;
export type CommandMiddleware = (
  command: Command,
  next: () => Promise<void>
) => Promise<void>;
export type CommandValidator<T = unknown> = (payload: T) => string[] | null;

export interface Query<TParams = unknown, TResult = unknown> {
  type: string;
  params: TParams;
  cacheTtlMs?: number;
}

export type QueryHandler<TParams = unknown, TResult = unknown> = (
  query: Query<TParams, TResult>
) => Promise<TResult>;

export interface Projection<TState = unknown> {
  name: string;
  initialState: TState;
  handlers: Record<string, (state: TState, event: DomainEvent) => TState>;
  getState(): TState;
  apply(event: DomainEvent): void;
}

// ── Workflows ─────────────────────────────────────────────────────────
export type ActivityFn<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  context: ActivityContext
) => Promise<TOutput>;

export interface ActivityContext {
  workflowId: string;
  runId: string;
  attempt: number;
}

export interface RetryPolicy {
  maxAttempts: number;
  initialIntervalMs: number;
  backoffMultiplier: number;
  maxIntervalMs: number;
}

export interface WorkflowDef<TInput = unknown, TOutput = unknown> {
  name: string;
  version: string;
  activities: Record<string, ActivityFn>;
  execute: (ctx: WorkflowContext, input: TInput) => Promise<TOutput>;
  retryPolicy?: RetryPolicy;
  timeoutMs?: number;
}

export interface WorkflowContext {
  workflowId: string;
  runId: string;
  executeActivity<TIn, TOut>(name: string, input: TIn, opts?: Partial<RetryPolicy>): Promise<TOut>;
  sleep(ms: number): Promise<void>;
  waitForSignal(signalName: string, timeoutMs?: number): Promise<unknown>;
  emitSignal(signalName: string, payload: unknown): void;
}

export type WorkflowStatus = "pending" | "running" | "completed" | "failed" | "cancelled" | "paused";

export interface WorkflowRun {
  workflowId: string;
  runId: string;
  workflowName: string;
  status: WorkflowStatus;
  input: unknown;
  output?: unknown;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
  history: WorkflowHistoryEvent[];
}

export interface WorkflowHistoryEvent {
  id: number;
  type: "ActivityScheduled" | "ActivityCompleted" | "ActivityFailed" | "TimerStarted" | "TimerFired" | "SignalReceived" | "WorkflowCompleted" | "WorkflowFailed";
  timestamp: Date;
  payload: unknown;
}

// ── Streaming ─────────────────────────────────────────────────────────
export interface StreamConfig {
  name: string;
  maxInFlight: number;
  maxRetries: number;
  ackWaitMs: number;
  maxBytes?: number;
  maxAge?: number;
  deduplicationWindowMs?: number;
}

export interface StreamMessage<T = unknown> {
  id: string;
  subject: string;
  data: T;
  timestamp: Date;
  headers: Record<string, string>;
  ack(): void;
  nack(): void;
}

export type StreamSubscription = { unsubscribe(): void };

// ── Hybrid Storage ────────────────────────────────────────────────────
export type StorageBackend = "vector" | "fulltext" | "relational" | "object";

export interface StorageRecord {
  id: string;
  collection: string;
  data: Record<string, unknown>;
  embedding?: number[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface HybridQuery {
  collection: string;
  backends?: StorageBackend[];
  filter?: Record<string, unknown>;
  vectorQuery?: { embedding: number[]; topK: number; threshold?: number };
  textQuery?: { query: string; fields: string[] };
  sort?: { field: string; order: "asc" | "desc" }[];
  limit?: number;
  offset?: number;
}

export interface HybridQueryResult {
  records: StorageRecord[];
  total: number;
  scores?: Map<string, number>;
  timing: { backend: StorageBackend; durationMs: number }[];
}
