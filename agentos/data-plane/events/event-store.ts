import { EventEmitter } from "events";
import { DomainEvent, EventStore, Snapshot } from "../types";

interface StreamState {
  events: DomainEvent[];
  version: number;
}

export class InMemoryEventStore extends EventEmitter implements EventStore {
  private streams = new Map<string, StreamState>();
  private globalLog: DomainEvent[] = [];
  private snapshots = new Map<string, Snapshot>();
  private subscriptions = new Map<string, Set<(event: DomainEvent) => Promise<void>>>();

  async append(
    streamId: string,
    events: DomainEvent[],
    expectedVersion?: number
  ): Promise<void> {
    const stream = this.streams.get(streamId) ?? { events: [], version: 0 };

    if (expectedVersion !== undefined && stream.version !== expectedVersion) {
      throw new ConcurrencyError(
        `Expected version ${expectedVersion} but got ${stream.version} for stream ${streamId}`
      );
    }

    let version = stream.version;
    const stamped: DomainEvent[] = events.map((e) => ({
      ...e,
      version: ++version,
      timestamp: e.timestamp ?? new Date(),
    }));

    stream.events.push(...stamped);
    stream.version = version;
    this.streams.set(streamId, stream);
    this.globalLog.push(...stamped);

    for (const event of stamped) {
      await this.notifySubscribers(streamId, event);
      await this.notifySubscribers("*", event);
      this.emit("event", event);
    }
  }

  async read(streamId: string, fromVersion = 0): Promise<DomainEvent[]> {
    const stream = this.streams.get(streamId);
    if (!stream) return [];
    return stream.events.filter((e) => e.version > fromVersion);
  }

  async readAll(fromPosition = 0, limit = 1000): Promise<DomainEvent[]> {
    return this.globalLog.slice(fromPosition, fromPosition + limit);
  }

  subscribe(
    streamId: string | "*",
    handler: (event: DomainEvent) => Promise<void>
  ): () => void {
    if (!this.subscriptions.has(streamId)) {
      this.subscriptions.set(streamId, new Set());
    }
    this.subscriptions.get(streamId)!.add(handler);

    return () => {
      this.subscriptions.get(streamId)?.delete(handler);
    };
  }

  async saveSnapshot(snapshot: Snapshot): Promise<void> {
    this.snapshots.set(snapshot.aggregateId, {
      ...snapshot,
      createdAt: new Date(),
    });
  }

  async getSnapshot(aggregateId: string): Promise<Snapshot | null> {
    return this.snapshots.get(aggregateId) ?? null;
  }

  /** Rebuild aggregate state from snapshot + subsequent events. */
  async rehydrate<TState>(
    aggregateId: string,
    reducer: (state: TState, event: DomainEvent) => TState,
    initialState: TState
  ): Promise<{ state: TState; version: number }> {
    const snapshot = await this.getSnapshot(aggregateId);
    const fromVersion = snapshot?.version ?? 0;
    const events = await this.read(aggregateId, fromVersion);

    let state: TState = snapshot ? (snapshot.state as TState) : initialState;
    for (const event of events) {
      state = reducer(state, event);
    }

    const version = events.length > 0 ? events[events.length - 1].version : fromVersion;
    return { state, version };
  }

  /** Auto-snapshot after N events since last snapshot. */
  async maybeSnapshot<TState>(
    aggregateId: string,
    reducer: (state: TState, event: DomainEvent) => TState,
    initialState: TState,
    snapshotEvery = 50
  ): Promise<void> {
    const snapshot = await this.getSnapshot(aggregateId);
    const fromVersion = snapshot?.version ?? 0;
    const events = await this.read(aggregateId, fromVersion);

    if (events.length >= snapshotEvery) {
      const { state, version } = await this.rehydrate(aggregateId, reducer, initialState);
      await this.saveSnapshot({
        aggregateId,
        aggregateType: events[0]?.aggregateType ?? "unknown",
        version,
        state,
        createdAt: new Date(),
      });
    }
  }

  getStreamVersion(streamId: string): number {
    return this.streams.get(streamId)?.version ?? 0;
  }

  getGlobalPosition(): number {
    return this.globalLog.length;
  }

  private async notifySubscribers(key: string, event: DomainEvent): Promise<void> {
    const handlers = this.subscriptions.get(key);
    if (!handlers) return;
    const promises = Array.from(handlers).map((h) =>
      h(event).catch((err) => this.emit("error", err))
    );
    await Promise.allSettled(promises);
  }
}

export class ConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConcurrencyError";
  }
}

/** Factory: returns InMemory for dev, placeholder for Postgres in prod. */
export function createEventStore(backend: "memory" | "postgres" = "memory"): EventStore {
  if (backend === "postgres") {
    throw new Error("Postgres EventStore backend not yet implemented — use 'memory' for development.");
  }
  return new InMemoryEventStore();
}
