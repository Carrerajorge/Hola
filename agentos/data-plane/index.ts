// AgentOS Data-Plane — public API surface

export type {
  DomainEvent,
  Snapshot,
  EventStore,
  Command,
  CommandMeta,
  CommandHandler,
  CommandMiddleware,
  CommandValidator,
  Query,
  QueryHandler,
  Projection,
  ActivityFn,
  ActivityContext,
  RetryPolicy,
  WorkflowDef,
  WorkflowContext,
  WorkflowRun,
  WorkflowStatus,
  WorkflowHistoryEvent,
  StreamConfig,
  StreamMessage,
  StreamSubscription,
  StorageBackend,
  StorageRecord,
  HybridQuery,
  HybridQueryResult,
} from "./types";

export { InMemoryEventStore, ConcurrencyError, createEventStore } from "./events/event-store";
export { CommandBus, CommandNotFoundError, CommandValidationError, loggingMiddleware, retryMiddleware } from "./cqrs/command-bus";
export { QueryBus, QueryNotFoundError } from "./cqrs/query-bus";
export { WorkflowEngine } from "./workflows/workflow-engine";
export { StreamManager } from "./streaming/stream-manager";
export { HybridStore } from "./storage/hybrid-store";
export type { BackendAdapter } from "./storage/hybrid-store";
