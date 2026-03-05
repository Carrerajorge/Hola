import { EventEmitter } from "events";
import { DomainEvent, Projection, Query, QueryHandler } from "../types";

interface CacheEntry<T = unknown> {
  result: T;
  expiresAt: number;
}

export class QueryBus extends EventEmitter {
  private handlers = new Map<string, QueryHandler>();
  private cache = new Map<string, CacheEntry>();
  private projections = new Map<string, ManagedProjection>();
  private defaultCacheTtlMs: number;

  constructor(opts: { defaultCacheTtlMs?: number } = {}) {
    super();
    this.defaultCacheTtlMs = opts.defaultCacheTtlMs ?? 5_000;
  }

  /** Register a query handler. */
  register<TParams = unknown, TResult = unknown>(
    queryType: string,
    handler: QueryHandler<TParams, TResult>
  ): void {
    if (this.handlers.has(queryType)) {
      throw new Error(`Handler already registered for query type: ${queryType}`);
    }
    this.handlers.set(queryType, handler as QueryHandler);
  }

  unregister(queryType: string): boolean {
    return this.handlers.delete(queryType);
  }

  /** Execute a query, returning a cached result if available. */
  async execute<TParams = unknown, TResult = unknown>(
    query: Query<TParams, TResult>
  ): Promise<TResult> {
    const cacheKey = this.buildCacheKey(query);
    const ttl = query.cacheTtlMs ?? this.defaultCacheTtlMs;

    // Check cache
    if (ttl > 0) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        this.emit("query:cache-hit", query);
        return cached.result as TResult;
      }
    }

    const handler = this.handlers.get(query.type);
    if (!handler) {
      throw new QueryNotFoundError(`No handler registered for query type: ${query.type}`);
    }

    this.emit("query:executing", query);
    const start = Date.now();
    const result = (await handler(query)) as TResult;
    const durationMs = Date.now() - start;

    // Store in cache
    if (ttl > 0) {
      this.cache.set(cacheKey, { result, expiresAt: Date.now() + ttl });
    }

    this.emit("query:completed", { query, durationMs });
    return result;
  }

  /** Invalidate cache entries matching a prefix. */
  invalidate(queryTypePrefix: string): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(queryTypePrefix)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  // ── Projection management ───────────────────────────────────────────

  /** Register a projection that auto-updates on domain events. */
  registerProjection<TState>(projection: Projection<TState>): void {
    const managed = new ManagedProjection(projection);
    this.projections.set(projection.name, managed);
  }

  /** Apply a domain event to all matching projections. */
  applyEvent(event: DomainEvent): void {
    for (const [, managed] of this.projections) {
      managed.apply(event);
    }
    // Invalidate any cached queries that depend on this event type
    this.invalidate(event.aggregateType);
  }

  /** Get the current state of a registered projection. */
  getProjectionState<TState>(name: string): TState | undefined {
    const managed = this.projections.get(name);
    return managed?.getState() as TState | undefined;
  }

  get registeredTypes(): string[] {
    return Array.from(this.handlers.keys());
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  /** Prune expired cache entries. */
  pruneCache(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
        pruned++;
      }
    }
    return pruned;
  }

  private buildCacheKey(query: Query): string {
    return `${query.type}:${JSON.stringify(query.params)}`;
  }
}

// ── Managed Projection wrapper ────────────────────────────────────────
class ManagedProjection<TState = unknown> {
  private state: TState;
  private projection: Projection<TState>;
  private appliedCount = 0;

  constructor(projection: Projection<TState>) {
    this.projection = projection;
    this.state = structuredClone(projection.initialState);
  }

  apply(event: DomainEvent): void {
    const handler = this.projection.handlers[event.type];
    if (handler) {
      this.state = handler(this.state, event);
      this.appliedCount++;
    }
  }

  getState(): TState {
    return this.state;
  }

  get eventCount(): number {
    return this.appliedCount;
  }
}

export class QueryNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryNotFoundError";
  }
}
