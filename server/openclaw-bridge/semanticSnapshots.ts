/**
 * @file semanticSnapshots.ts
 * @description Semantic conversation snapshots for the ILIAGPT × OpenClaw fusion bridge.
 *
 * Provides compressed, semantically-indexed conversation state that survives
 * context-window limits. Each snapshot captures the essential meaning of a
 * conversation segment and can be retrieved by semantic similarity when
 * rebuilding context for subsequent turns.
 *
 * Architecture
 * ────────────
 * • SnapshotStore   – persists and indexes snapshot records.
 * • SnapshotBuilder – extracts and compresses conversation segments.
 * • SemanticIndex   – lightweight in-memory cosine-similarity index over
 *                     snapshot embedding vectors.
 *
 * @module semanticSnapshots
 */

import { Logger } from '../lib/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single message turn within a conversation. */
export interface ConversationTurn {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp?: Date;
  toolName?: string;
  metadata?: Record<string, unknown>;
}

/** A compressed, semantically-indexed snapshot of a conversation segment. */
export interface ConversationSnapshot {
  id: string;
  conversationId: string;
  /** Human-readable summary of the segment. */
  summary: string;
  /** Original turns included in this snapshot. */
  turns: ConversationTurn[];
  /** Approximate token count of the original turns. */
  originalTokens: number;
  /** Approximate token count of the summary. */
  compressedTokens: number;
  /** Embedding vector (if available). */
  embedding?: number[];
  createdAt: Date;
  /** Index of the first turn (within the full conversation) captured here. */
  startIndex: number;
  /** Index of the last turn captured here. */
  endIndex: number;
  /** Key topics / entities extracted from the segment. */
  topics: string[];
}

/** Options for the SemanticSnapshots subsystem. */
export interface SemanticSnapshotsOptions {
  /** Number of turns to include in each snapshot segment. Default: 10. */
  segmentSize?: number;
  /** Minimum tokens in a segment before snapshotting is triggered. Default: 500. */
  minTokensForSnapshot?: number;
  /** Maximum snapshots retained per conversation. 0 = unlimited. Default: 50. */
  maxSnapshotsPerConversation?: number;
  /** Function that generates an embedding vector for a text string. */
  embedFn?: (text: string) => Promise<number[]>;
  /** Function that generates a concise summary of a set of turns. */
  summariseFn?: (turns: ConversationTurn[]) => Promise<string>;
}

// ---------------------------------------------------------------------------
// Semantic Index (cosine similarity)
// ---------------------------------------------------------------------------

class SemanticIndex {
  private entries: Array<{ id: string; vector: number[] }> = [];

  add(id: string, vector: number[]): void {
    this.entries.push({ id, vector });
  }

  remove(id: string): void {
    this.entries = this.entries.filter((e) => e.id !== id);
  }

  /**
   * Return the `topK` entries most similar to `query`, sorted descending.
   */
  search(query: number[], topK: number): Array<{ id: string; score: number }> {
    const scored = this.entries.map((entry) => ({
      id: entry.id,
      score: cosineSimilarity(query, entry.vector),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  clear(): void {
    this.entries = [];
  }

  get size(): number {
    return this.entries.length;
  }
}

// ---------------------------------------------------------------------------
// Snapshot Store
// ---------------------------------------------------------------------------

class SnapshotStore {
  /** conversationId → ordered list of snapshots */
  private store: Map<string, ConversationSnapshot[]> = new Map();
  private maxPerConversation: number;

  constructor(maxPerConversation: number) {
    this.maxPerConversation = maxPerConversation;
  }

  save(snapshot: ConversationSnapshot): void {
    let list = this.store.get(snapshot.conversationId);
    if (!list) {
      list = [];
      this.store.set(snapshot.conversationId, list);
    }
    list.push(snapshot);

    if (this.maxPerConversation > 0 && list.length > this.maxPerConversation) {
      list.shift(); // Evict oldest
    }
  }

  getAll(conversationId: string): ConversationSnapshot[] {
    return this.store.get(conversationId) ?? [];
  }

  getById(id: string): ConversationSnapshot | undefined {
    for (const list of this.store.values()) {
      const found = list.find((s) => s.id === id);
      if (found) return found;
    }
    return undefined;
  }

  delete(conversationId: string): void {
    this.store.delete(conversationId);
  }

  totalCount(): number {
    let n = 0;
    for (const list of this.store.values()) n += list.length;
    return n;
  }
}

// ---------------------------------------------------------------------------
// SemanticSnapshots
// ---------------------------------------------------------------------------

/**
 * Manages compressed, semantically-indexed conversation state.
 *
 * @example
 * ```typescript
 * const ss = new SemanticSnapshots({
 *   embedFn: async (text) => await openai.embeddings.create({ input: text }),
 *   summariseFn: async (turns) => await gpt4Mini.summarise(turns),
 * });
 *
 * // After every N turns, compress the oldest segment:
 * await ss.createSnapshot(conversationId, turns.slice(0, 10), 0, 9);
 *
 * // When building context for a new turn, retrieve relevant snapshots:
 * const relevant = await ss.retrieveRelevant(conversationId, currentQuery, 3);
 * ```
 */
export class SemanticSnapshots {
  private readonly logger: Logger;
  private readonly store: SnapshotStore;
  private readonly index: SemanticIndex;
  private readonly options: Required<SemanticSnapshotsOptions>;
  private snapshotCounter = 0;

  constructor(options: SemanticSnapshotsOptions = {}) {
    this.logger = new Logger('SemanticSnapshots');
    this.options = {
      segmentSize: options.segmentSize ?? 10,
      minTokensForSnapshot: options.minTokensForSnapshot ?? 500,
      maxSnapshotsPerConversation: options.maxSnapshotsPerConversation ?? 50,
      embedFn: options.embedFn ?? defaultEmbedFn,
      summariseFn: options.summariseFn ?? defaultSummariseFn,
    };
    this.store = new SnapshotStore(this.options.maxSnapshotsPerConversation);
    this.index = new SemanticIndex();
  }

  // -------------------------------------------------------------------------
  // Core API
  // -------------------------------------------------------------------------

  /**
   * Compress a segment of conversation turns into a snapshot.
   *
   * @param conversationId  Owning conversation identifier.
   * @param turns           The turns to compress (ordered oldest → newest).
   * @param startIndex      Position of turns[0] in the full conversation.
   * @param endIndex        Position of turns[turns.length - 1] in the full conversation.
   */
  async createSnapshot(
    conversationId: string,
    turns: ConversationTurn[],
    startIndex: number,
    endIndex: number,
  ): Promise<ConversationSnapshot> {
    if (turns.length === 0) throw new Error('Cannot snapshot an empty turns array');

    const originalTokens = estimateTokens(turns);

    // Generate summary
    let summary: string;
    try {
      summary = await this.options.summariseFn(turns);
    } catch (err) {
      this.logger.warn('summariseFn failed, falling back to naive summary', { err });
      summary = naiveSummary(turns);
    }

    // Generate embedding
    let embedding: number[] | undefined;
    try {
      embedding = await this.options.embedFn(summary);
    } catch (err) {
      this.logger.warn('embedFn failed, snapshot will not be semantically indexed', { err });
    }

    const snapshot: ConversationSnapshot = {
      id: `snap-${++this.snapshotCounter}-${Date.now()}`,
      conversationId,
      summary,
      turns,
      originalTokens,
      compressedTokens: estimateTokens([{ role: 'assistant', content: summary }]),
      embedding,
      createdAt: new Date(),
      startIndex,
      endIndex,
      topics: extractTopics(summary),
    };

    this.store.save(snapshot);

    if (embedding) {
      this.index.add(snapshot.id, embedding);
    }

    this.logger.info(
      `Snapshot ${snapshot.id} created for conversation "${conversationId}" ` +
      `(turns ${startIndex}-${endIndex}, ${originalTokens}→${snapshot.compressedTokens} tokens, ` +
      `topics: ${snapshot.topics.join(', ')})`,
    );

    return snapshot;
  }

  /**
   * Retrieve snapshots most relevant to `query` for a given conversation.
   *
   * Falls back to chronological order when no embedding is available.
   *
   * @param conversationId  Target conversation.
   * @param query           Text to match against (e.g. the latest user message).
   * @param topK            Number of snapshots to return. Default: 3.
   */
  async retrieveRelevant(
    conversationId: string,
    query: string,
    topK = 3,
  ): Promise<ConversationSnapshot[]> {
    const all = this.store.getAll(conversationId);
    if (all.length === 0) return [];

    // Try semantic search first
    let queryEmbedding: number[] | undefined;
    try {
      queryEmbedding = await this.options.embedFn(query);
    } catch {
      // Fall through to chronological fallback
    }

    if (queryEmbedding) {
      const ids = new Set(all.map((s) => s.id));
      const hits = this.index
        .search(queryEmbedding, topK * 2)
        .filter((h) => ids.has(h.id))
        .slice(0, topK);

      if (hits.length > 0) {
        return hits.map((h) => this.store.getById(h.id)!).filter(Boolean);
      }
    }

    // Chronological fallback: return the most recent topK snapshots
    return all.slice(-topK);
  }

  /**
   * Return all snapshots for a conversation, ordered chronologically.
   */
  getAll(conversationId: string): ConversationSnapshot[] {
    return this.store.getAll(conversationId);
  }

  /**
   * Determine whether the provided turns should be snapshotted.
   * Useful for deciding when to call createSnapshot.
   */
  shouldSnapshot(turns: ConversationTurn[]): boolean {
    return (
      turns.length >= this.options.segmentSize ||
      estimateTokens(turns) >= this.options.minTokensForSnapshot
    );
  }

  /**
   * Delete all snapshots for a conversation (e.g. on session end).
   */
  clearConversation(conversationId: string): void {
    const snapshots = this.store.getAll(conversationId);
    for (const s of snapshots) {
      if (s.embedding) this.index.remove(s.id);
    }
    this.store.delete(conversationId);
    this.logger.debug(`Cleared snapshots for conversation "${conversationId}"`);
  }

  /** Aggregate statistics across all conversations. */
  getStats(): { totalSnapshots: number; indexedSnapshots: number } {
    return {
      totalSnapshots: this.store.totalCount(),
      indexedSnapshots: this.index.size,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Rough token estimator: ~4 characters per token. */
function estimateTokens(turns: ConversationTurn[]): number {
  return Math.ceil(turns.reduce((sum, t) => sum + t.content.length, 0) / 4);
}

/** Cosine similarity between two equal-length vectors. */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** Extract capitalised tokens as a rough proxy for named entities / topics. */
function extractTopics(text: string): string[] {
  const matches = text.match(/\b[A-Z][a-z]{2,}(?:\s[A-Z][a-z]{2,}){0,2}\b/g) ?? [];
  return [...new Set(matches)].slice(0, 10);
}

/** Naive summary when the LLM summariser is unavailable. */
function naiveSummary(turns: ConversationTurn[]): string {
  return turns
    .map((t) => `${t.role}: ${t.content.slice(0, 120)}${t.content.length > 120 ? '…' : ''}`)
    .join('\n');
}

/** No-op embed function used when no external embedder is configured. */
async function defaultEmbedFn(_text: string): Promise<number[]> {
  // Returns an empty vector; callers will fall back to chronological ordering
  return [];
}

/** No-op summarise function used when no LLM summariser is configured. */
async function defaultSummariseFn(turns: ConversationTurn[]): Promise<string> {
  return naiveSummary(turns);
}
