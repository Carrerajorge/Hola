import { EventEmitter } from "events";
import { MemoryEntry, MemoryQuery, MemoryQueryResult, WorkingMemoryConfig } from "../types";

interface SlotEntry {
  entry: MemoryEntry;
  tokenEstimate: number;
  lastAccessedAt: Date;
  priority: number;
}

const DEFAULT_CONFIG: WorkingMemoryConfig = {
  maxTokens: 8192,
  summarizationThreshold: 0.8,
  evictionStrategy: "priority",
};

export class WorkingMemory extends EventEmitter {
  private slots: SlotEntry[] = [];
  private config: WorkingMemoryConfig;
  private currentTokens = 0;
  private summaries: string[] = [];

  constructor(config?: Partial<WorkingMemoryConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Add an entry to working memory. Triggers eviction/summarization if needed. */
  async add(entry: MemoryEntry, priority = 0.5): Promise<void> {
    const tokenEstimate = this.estimateTokens(entry.content);

    // Evict before adding if necessary
    while (this.currentTokens + tokenEstimate > this.config.maxTokens && this.slots.length > 0) {
      await this.evictOne();
    }

    const slot: SlotEntry = {
      entry,
      tokenEstimate,
      lastAccessedAt: new Date(),
      priority,
    };

    this.slots.push(slot);
    this.currentTokens += tokenEstimate;
    this.emit("working:added", { id: entry.id, tokens: this.currentTokens });

    // Check if summarization threshold is reached
    if (this.currentTokens >= this.config.maxTokens * this.config.summarizationThreshold) {
      await this.maybeSummarize();
    }
  }

  /** Retrieve entries from working memory matching a query. */
  async query(q: MemoryQuery): Promise<MemoryQueryResult> {
    const start = Date.now();
    let candidates = this.slots.map((s) => s);

    // Text match
    if (q.text) {
      const terms = q.text.toLowerCase().split(/\s+/);
      candidates = candidates.filter((s) => {
        const content = s.entry.content.toLowerCase();
        return terms.some((t) => content.includes(t));
      });
    }

    // Tag filter
    if (q.tags && q.tags.length > 0) {
      candidates = candidates.filter((s) =>
        q.tags!.some((t) => s.entry.tags.includes(t))
      );
    }

    // Importance filter
    if (q.importanceMin !== undefined) {
      candidates = candidates.filter((s) => s.entry.importance >= q.importanceMin!);
    }

    // Vector similarity
    const scores = new Map<string, number>();
    if (q.embedding && q.embedding.length > 0) {
      for (const c of candidates) {
        if (c.entry.embedding) {
          const sim = cosineSim(q.embedding, c.entry.embedding);
          scores.set(c.entry.id, sim);
        }
      }
      candidates.sort((a, b) => (scores.get(b.entry.id) ?? 0) - (scores.get(a.entry.id) ?? 0));
    }

    // Mark accessed
    for (const c of candidates) {
      c.lastAccessedAt = new Date();
      c.entry.accessCount++;
    }

    const topK = q.topK ?? 10;
    const results = candidates.slice(0, topK);

    return {
      entries: results.map((r) => r.entry),
      total: candidates.length,
      scores,
      queryTimeMs: Date.now() - start,
    };
  }

  /** Remove a specific entry by ID. */
  remove(entryId: string): boolean {
    const idx = this.slots.findIndex((s) => s.entry.id === entryId);
    if (idx < 0) return false;
    this.currentTokens -= this.slots[idx].tokenEstimate;
    this.slots.splice(idx, 1);
    this.emit("working:removed", { id: entryId, tokens: this.currentTokens });
    return true;
  }

  /** Clear all working memory. */
  clear(): void {
    this.slots = [];
    this.currentTokens = 0;
    this.summaries = [];
    this.emit("working:cleared");
  }

  /** Get a context window snapshot: all entries concatenated with summaries. */
  getContext(): { entries: MemoryEntry[]; summaries: string[]; totalTokens: number } {
    return {
      entries: this.slots.map((s) => s.entry),
      summaries: [...this.summaries],
      totalTokens: this.currentTokens,
    };
  }

  get size(): number {
    return this.slots.length;
  }

  get tokenUsage(): { current: number; max: number; ratio: number } {
    return {
      current: this.currentTokens,
      max: this.config.maxTokens,
      ratio: this.currentTokens / this.config.maxTokens,
    };
  }

  // ── Internal ────────────────────────────────────────────────────────

  private async evictOne(): Promise<void> {
    if (this.slots.length === 0) return;

    let idx: number;
    switch (this.config.evictionStrategy) {
      case "lru":
        idx = this.findLruIndex();
        break;
      case "fifo":
        idx = 0;
        break;
      case "priority":
      default:
        idx = this.findLowestPriorityIndex();
        break;
    }

    const evicted = this.slots[idx];
    this.currentTokens -= evicted.tokenEstimate;
    this.slots.splice(idx, 1);
    this.emit("working:evicted", { id: evicted.entry.id, strategy: this.config.evictionStrategy });
  }

  private async maybeSummarize(): Promise<void> {
    if (!this.config.summarizer) return;
    if (this.slots.length < 4) return;

    // Summarize the oldest half
    const halfLen = Math.floor(this.slots.length / 2);
    const toSummarize = this.slots.slice(0, halfLen);

    try {
      const summary = await this.config.summarizer(toSummarize.map((s) => s.entry));
      this.summaries.push(summary);

      // Remove summarized entries
      const removedTokens = toSummarize.reduce((acc, s) => acc + s.tokenEstimate, 0);
      this.slots = this.slots.slice(halfLen);
      this.currentTokens -= removedTokens;

      // Add summary token cost
      const summaryTokens = this.estimateTokens(summary);
      this.currentTokens += summaryTokens;

      this.emit("working:summarized", { entriesRemoved: halfLen, summaryTokens });
    } catch (err) {
      this.emit("error", err);
    }
  }

  private findLruIndex(): number {
    let oldest = 0;
    for (let i = 1; i < this.slots.length; i++) {
      if (this.slots[i].lastAccessedAt < this.slots[oldest].lastAccessedAt) {
        oldest = i;
      }
    }
    return oldest;
  }

  private findLowestPriorityIndex(): number {
    let lowest = 0;
    for (let i = 1; i < this.slots.length; i++) {
      if (this.slots[i].priority < this.slots[lowest].priority) {
        lowest = i;
      }
    }
    return lowest;
  }

  private estimateTokens(text: string): number {
    // Rough estimate: ~4 chars per token
    return Math.ceil(text.length / 4);
  }
}

function cosineSim(a: number[], b: number[]): number {
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
