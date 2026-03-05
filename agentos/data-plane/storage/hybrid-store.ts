import { EventEmitter } from "events";
import {
  HybridQuery,
  HybridQueryResult,
  StorageBackend,
  StorageRecord,
} from "../types";

/** Backend adapter interface — each storage backend implements this. */
export interface BackendAdapter {
  type: StorageBackend;
  put(record: StorageRecord): Promise<void>;
  get(collection: string, id: string): Promise<StorageRecord | null>;
  delete(collection: string, id: string): Promise<boolean>;
  query(q: HybridQuery): Promise<{ records: StorageRecord[]; total: number; scores?: Map<string, number> }>;
}

// ── In-memory adapters ────────────────────────────────────────────────

class InMemoryRelationalAdapter implements BackendAdapter {
  type: StorageBackend = "relational";
  private store = new Map<string, Map<string, StorageRecord>>();

  async put(record: StorageRecord): Promise<void> {
    if (!this.store.has(record.collection)) this.store.set(record.collection, new Map());
    this.store.get(record.collection)!.set(record.id, record);
  }

  async get(collection: string, id: string): Promise<StorageRecord | null> {
    return this.store.get(collection)?.get(id) ?? null;
  }

  async delete(collection: string, id: string): Promise<boolean> {
    return this.store.get(collection)?.delete(id) ?? false;
  }

  async query(q: HybridQuery): Promise<{ records: StorageRecord[]; total: number }> {
    const coll = this.store.get(q.collection);
    if (!coll) return { records: [], total: 0 };

    let records = Array.from(coll.values());
    records = this.applyFilter(records, q.filter);

    if (q.sort) {
      for (const s of [...q.sort].reverse()) {
        records.sort((a, b) => {
          const av = (a.data[s.field] as any) ?? 0;
          const bv = (b.data[s.field] as any) ?? 0;
          return s.order === "asc" ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
        });
      }
    }

    const total = records.length;
    const offset = q.offset ?? 0;
    const limit = q.limit ?? 100;
    records = records.slice(offset, offset + limit);

    return { records, total };
  }

  private applyFilter(records: StorageRecord[], filter?: Record<string, unknown>): StorageRecord[] {
    if (!filter) return records;
    return records.filter((r) =>
      Object.entries(filter).every(([key, value]) => r.data[key] === value || r.metadata[key] === value)
    );
  }
}

class InMemoryVectorAdapter implements BackendAdapter {
  type: StorageBackend = "vector";
  private store = new Map<string, Map<string, StorageRecord>>();

  async put(record: StorageRecord): Promise<void> {
    if (!this.store.has(record.collection)) this.store.set(record.collection, new Map());
    this.store.get(record.collection)!.set(record.id, record);
  }

  async get(collection: string, id: string): Promise<StorageRecord | null> {
    return this.store.get(collection)?.get(id) ?? null;
  }

  async delete(collection: string, id: string): Promise<boolean> {
    return this.store.get(collection)?.delete(id) ?? false;
  }

  async query(q: HybridQuery): Promise<{ records: StorageRecord[]; total: number; scores: Map<string, number> }> {
    const coll = this.store.get(q.collection);
    if (!coll || !q.vectorQuery) return { records: [], total: 0, scores: new Map() };

    const scored: Array<[StorageRecord, number]> = [];
    for (const record of coll.values()) {
      if (!record.embedding) continue;
      const sim = cosineSimilarity(q.vectorQuery.embedding, record.embedding);
      if (!q.vectorQuery.threshold || sim >= q.vectorQuery.threshold) {
        scored.push([record, sim]);
      }
    }

    scored.sort((a, b) => b[1] - a[1]);
    const topK = scored.slice(0, q.vectorQuery.topK);
    const scores = new Map(topK.map(([r, s]) => [r.id, s]));

    return { records: topK.map(([r]) => r), total: topK.length, scores };
  }
}

class InMemoryFullTextAdapter implements BackendAdapter {
  type: StorageBackend = "fulltext";
  private store = new Map<string, Map<string, StorageRecord>>();

  async put(record: StorageRecord): Promise<void> {
    if (!this.store.has(record.collection)) this.store.set(record.collection, new Map());
    this.store.get(record.collection)!.set(record.id, record);
  }

  async get(collection: string, id: string): Promise<StorageRecord | null> {
    return this.store.get(collection)?.get(id) ?? null;
  }

  async delete(collection: string, id: string): Promise<boolean> {
    return this.store.get(collection)?.delete(id) ?? false;
  }

  async query(q: HybridQuery): Promise<{ records: StorageRecord[]; total: number; scores: Map<string, number> }> {
    const coll = this.store.get(q.collection);
    if (!coll || !q.textQuery) return { records: [], total: 0, scores: new Map() };

    const terms = q.textQuery.query.toLowerCase().split(/\s+/);
    const scored: Array<[StorageRecord, number]> = [];

    for (const record of coll.values()) {
      let score = 0;
      for (const field of q.textQuery.fields) {
        const value = String(record.data[field] ?? "").toLowerCase();
        for (const term of terms) {
          if (value.includes(term)) score++;
        }
      }
      if (score > 0) scored.push([record, score]);
    }

    scored.sort((a, b) => b[1] - a[1]);
    const limited = scored.slice(q.offset ?? 0, (q.offset ?? 0) + (q.limit ?? 100));
    const scores = new Map(limited.map(([r, s]) => [r.id, s]));

    return { records: limited.map(([r]) => r), total: scored.length, scores };
  }
}

// ── Hybrid Store ──────────────────────────────────────────────────────

export class HybridStore extends EventEmitter {
  private adapters = new Map<StorageBackend, BackendAdapter>();

  constructor(adapters?: BackendAdapter[]) {
    super();
    if (adapters) {
      for (const a of adapters) this.adapters.set(a.type, a);
    } else {
      // Default: all in-memory
      this.adapters.set("relational", new InMemoryRelationalAdapter());
      this.adapters.set("vector", new InMemoryVectorAdapter());
      this.adapters.set("fulltext", new InMemoryFullTextAdapter());
    }
  }

  /** Write a record to one or more backends. */
  async put(record: StorageRecord, backends?: StorageBackend[]): Promise<void> {
    const targets = backends ?? Array.from(this.adapters.keys());
    const now = new Date();
    const stamped = { ...record, updatedAt: now, createdAt: record.createdAt ?? now };

    await Promise.all(
      targets
        .map((b) => this.adapters.get(b))
        .filter(Boolean)
        .map((a) => a!.put(stamped))
    );
    this.emit("store:put", { id: record.id, collection: record.collection, backends: targets });
  }

  async get(collection: string, id: string, backend: StorageBackend = "relational"): Promise<StorageRecord | null> {
    const adapter = this.adapters.get(backend);
    if (!adapter) throw new Error(`Backend not available: ${backend}`);
    return adapter.get(collection, id);
  }

  async delete(collection: string, id: string, backends?: StorageBackend[]): Promise<void> {
    const targets = backends ?? Array.from(this.adapters.keys());
    await Promise.all(
      targets.map((b) => this.adapters.get(b)?.delete(collection, id))
    );
    this.emit("store:delete", { id, collection });
  }

  /** Execute a unified query across specified (or all) backends, merging results. */
  async query(q: HybridQuery): Promise<HybridQueryResult> {
    const backends = q.backends ?? this.inferBackends(q);
    const timing: HybridQueryResult["timing"] = [];
    const allRecords: StorageRecord[] = [];
    const allScores = new Map<string, number>();

    await Promise.all(
      backends.map(async (b) => {
        const adapter = this.adapters.get(b);
        if (!adapter) return;
        const start = Date.now();
        const result = await adapter.query(q);
        timing.push({ backend: b, durationMs: Date.now() - start });
        for (const r of result.records) {
          if (!allScores.has(r.id)) {
            allRecords.push(r);
            allScores.set(r.id, result.scores?.get(r.id) ?? 0);
          } else {
            // Merge scores from multiple backends
            allScores.set(r.id, (allScores.get(r.id) ?? 0) + (result.scores?.get(r.id) ?? 0));
          }
        }
      })
    );

    // Sort by combined score descending
    allRecords.sort((a, b) => (allScores.get(b.id) ?? 0) - (allScores.get(a.id) ?? 0));

    return {
      records: allRecords.slice(0, q.limit ?? 100),
      total: allRecords.length,
      scores: allScores,
      timing,
    };
  }

  private inferBackends(q: HybridQuery): StorageBackend[] {
    const backends: StorageBackend[] = [];
    if (q.vectorQuery) backends.push("vector");
    if (q.textQuery) backends.push("fulltext");
    if (backends.length === 0) backends.push("relational");
    return backends;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
