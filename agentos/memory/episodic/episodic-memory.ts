import { EventEmitter } from "events";
import { Episode, MemoryEntry, MemoryQuery, MemoryQueryResult } from "../types";

export class EpisodicMemory extends EventEmitter {
  private episodes = new Map<string, Episode>();
  private entries = new Map<string, MemoryEntry>();
  private temporalIndex: Array<{ id: string; timestamp: Date }> = [];
  private idCounter = 0;

  /** Start a new episode (interaction / task record). */
  startEpisode(taskId: string, agentId: string, tags: string[] = []): Episode {
    const id = this.nextId("ep");
    const episode: Episode = {
      id,
      taskId,
      agentId,
      summary: "",
      entries: [],
      outcome: "unknown",
      importance: 0.5,
      startedAt: new Date(),
      tags,
      relatedEpisodeIds: [],
    };
    this.episodes.set(id, episode);
    this.emit("episode:started", episode);
    return episode;
  }

  /** Record a memory entry within an episode. */
  record(episodeId: string, entry: MemoryEntry): void {
    const episode = this.episodes.get(episodeId);
    if (!episode) throw new Error(`Episode not found: ${episodeId}`);

    this.entries.set(entry.id, entry);
    episode.entries.push(entry);

    // Maintain temporal index (sorted by timestamp)
    this.insertTemporal(entry.id, entry.createdAt);
    this.emit("episode:recorded", { episodeId, entryId: entry.id });
  }

  /** Complete an episode with outcome and summary. */
  completeEpisode(
    episodeId: string,
    outcome: Episode["outcome"],
    summary: string,
    importance?: number
  ): void {
    const episode = this.episodes.get(episodeId);
    if (!episode) throw new Error(`Episode not found: ${episodeId}`);

    episode.outcome = outcome;
    episode.summary = summary;
    episode.endedAt = new Date();
    if (importance !== undefined) episode.importance = importance;

    // Auto-compute importance if not provided
    if (importance === undefined) {
      episode.importance = this.computeImportance(episode);
    }

    this.emit("episode:completed", episode);
  }

  /** Link related episodes for cross-referencing. */
  linkEpisodes(episodeId1: string, episodeId2: string): void {
    const ep1 = this.episodes.get(episodeId1);
    const ep2 = this.episodes.get(episodeId2);
    if (!ep1 || !ep2) throw new Error("One or both episodes not found");
    if (!ep1.relatedEpisodeIds.includes(episodeId2)) ep1.relatedEpisodeIds.push(episodeId2);
    if (!ep2.relatedEpisodeIds.includes(episodeId1)) ep2.relatedEpisodeIds.push(episodeId1);
  }

  /** Search episodic memories using similarity, text, and temporal filters. */
  async query(q: MemoryQuery): Promise<MemoryQueryResult> {
    const start = Date.now();
    let candidates = Array.from(this.entries.values());

    // Filter by time range
    if (q.timeRange) {
      candidates = candidates.filter(
        (e) => e.createdAt >= q.timeRange!.start && e.createdAt <= q.timeRange!.end
      );
    }

    // Filter expired
    if (!q.includeExpired) {
      const now = new Date();
      candidates = candidates.filter((e) => !e.expiresAt || e.expiresAt > now);
    }

    // Scope filter
    if (q.scope) {
      const scopes = Array.isArray(q.scope) ? q.scope : [q.scope];
      candidates = candidates.filter((e) => scopes.includes(e.scope));
    }

    // Tag filter
    if (q.tags && q.tags.length > 0) {
      candidates = candidates.filter((e) => q.tags!.some((t) => e.tags.includes(t)));
    }

    // Text search
    if (q.text) {
      const terms = q.text.toLowerCase().split(/\s+/);
      candidates = candidates.filter((e) =>
        terms.some((t) => e.content.toLowerCase().includes(t))
      );
    }

    // Importance filter
    if (q.importanceMin !== undefined) {
      candidates = candidates.filter((e) => e.importance >= q.importanceMin!);
    }

    // Vector similarity scoring
    const scores = new Map<string, number>();
    if (q.embedding) {
      for (const entry of candidates) {
        if (entry.embedding) {
          const sim = cosineSim(q.embedding, entry.embedding);
          if (!q.threshold || sim >= q.threshold) {
            scores.set(entry.id, sim);
          }
        }
      }
      // Remove entries below threshold
      if (q.threshold) {
        candidates = candidates.filter((e) => scores.has(e.id));
      }
      candidates.sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0));
    }

    const topK = q.topK ?? 20;
    const results = candidates.slice(0, topK);

    // Bump access counts
    for (const entry of results) {
      entry.accessCount++;
    }

    return {
      entries: results,
      total: candidates.length,
      scores,
      queryTimeMs: Date.now() - start,
    };
  }

  /** Find similar past episodes by comparing episode summaries/tags. */
  findSimilarEpisodes(
    tags: string[],
    limit = 5
  ): Episode[] {
    const scored: Array<[Episode, number]> = [];
    for (const ep of this.episodes.values()) {
      if (!ep.endedAt) continue; // only completed episodes
      const overlap = tags.filter((t) => ep.tags.includes(t)).length;
      if (overlap > 0) scored.push([ep, overlap + ep.importance]);
    }
    scored.sort((a, b) => b[1] - a[1]);
    return scored.slice(0, limit).map(([ep]) => ep);
  }

  /** Get temporal neighbors: entries recorded close in time. */
  getTemporalNeighbors(entryId: string, windowMs = 60_000): MemoryEntry[] {
    const entry = this.entries.get(entryId);
    if (!entry) return [];
    const t = entry.createdAt.getTime();
    return this.temporalIndex
      .filter((idx) => {
        const diff = Math.abs(idx.timestamp.getTime() - t);
        return diff <= windowMs && idx.id !== entryId;
      })
      .map((idx) => this.entries.get(idx.id))
      .filter(Boolean) as MemoryEntry[];
  }

  getEpisode(id: string): Episode | undefined {
    return this.episodes.get(id);
  }

  getEntry(id: string): MemoryEntry | undefined {
    return this.entries.get(id);
  }

  get episodeCount(): number {
    return this.episodes.size;
  }

  get entryCount(): number {
    return this.entries.size;
  }

  // ── Internal ────────────────────────────────────────────────────────

  private computeImportance(episode: Episode): number {
    let score = 0.3;
    if (episode.outcome === "success") score += 0.2;
    if (episode.outcome === "failure") score += 0.3; // failures are memorable
    score += Math.min(0.2, episode.entries.length * 0.02);
    if (episode.tags.length > 0) score += 0.1;
    return Math.min(1, score);
  }

  private insertTemporal(id: string, timestamp: Date): void {
    const entry = { id, timestamp };
    // Binary insert to keep sorted
    let lo = 0, hi = this.temporalIndex.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.temporalIndex[mid].timestamp.getTime() < timestamp.getTime()) lo = mid + 1;
      else hi = mid;
    }
    this.temporalIndex.splice(lo, 0, entry);
  }

  private nextId(prefix: string): string {
    return `${prefix}-${Date.now()}-${++this.idCounter}`;
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
