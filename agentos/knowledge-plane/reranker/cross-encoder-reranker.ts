/**
 * AgentOS Knowledge-Plane — Cross-Encoder Reranker
 *
 * Re-scores retrieved chunks using a cross-encoder model (or pluggable
 * scoring backend) for higher relevance precision.  Supports batching,
 * score normalisation, and configurable threshold filtering.
 */

import { RerankerConfig, SearchResult } from "../types";

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const log = {
  info: (msg: string, ctx?: Record<string, unknown>) =>
    console.log(`[RERANKER][INFO] ${msg}`, ctx ?? ""),
  warn: (msg: string, ctx?: Record<string, unknown>) =>
    console.warn(`[RERANKER][WARN] ${msg}`, ctx ?? ""),
  error: (msg: string, ctx?: Record<string, unknown>) =>
    console.error(`[RERANKER][ERROR] ${msg}`, ctx ?? ""),
};

// ---------------------------------------------------------------------------
// Scoring backend interface (pluggable)
// ---------------------------------------------------------------------------

/**
 * A ScoringBackend receives (query, passage) pairs and returns relevance
 * scores in the same order.  Implementations may call a local ONNX model,
 * a remote API, or a heuristic scorer.
 */
export interface ScoringBackend {
  score(pairs: Array<{ query: string; passage: string }>): Promise<number[]>;
}

// ---------------------------------------------------------------------------
// Built-in heuristic scorer (used when no model backend is wired)
// ---------------------------------------------------------------------------

export class HeuristicScorer implements ScoringBackend {
  async score(pairs: Array<{ query: string; passage: string }>): Promise<number[]> {
    return pairs.map(({ query, passage }) => {
      const qTokens = new Set(query.toLowerCase().split(/\W+/).filter(Boolean));
      const pTokens = passage.toLowerCase().split(/\W+/).filter(Boolean);
      if (qTokens.size === 0) return 0;
      let overlap = 0;
      for (const t of pTokens) {
        if (qTokens.has(t)) overlap++;
      }
      return overlap / (qTokens.size + pTokens.length - overlap + 1);
    });
  }
}

// ---------------------------------------------------------------------------
// Cross-Encoder Reranker
// ---------------------------------------------------------------------------

export class CrossEncoderReranker {
  private backend: ScoringBackend;

  constructor(backend?: ScoringBackend) {
    this.backend = backend ?? new HeuristicScorer();
    log.info("CrossEncoderReranker initialised", {
      backend: backend ? "custom" : "heuristic",
    });
  }

  /**
   * Rerank a list of search results using the cross-encoder backend.
   *
   * Steps:
   *  1. Truncate passages to `config.maxInputTokens` characters.
   *  2. Batch-score all (query, passage) pairs.
   *  3. Optionally normalise scores to [0, 1].
   *  4. Filter by `config.scoreThreshold`.
   *  5. Sort descending by rerank score.
   */
  async rerank(
    query: string,
    results: SearchResult[],
    config: RerankerConfig,
  ): Promise<SearchResult[]> {
    if (results.length === 0) return [];

    log.info("Reranking", { query, candidates: results.length, model: config.modelName });

    // 1. Build (query, passage) pairs respecting max token budget
    const pairs = results.map((r) => ({
      query,
      passage: r.chunk.content.slice(0, config.maxInputTokens),
    }));

    // 2. Score in batches
    const scores = await this.scoreBatched(pairs, config.batchSize);

    // 3. Normalise if requested
    const finalScores = config.normalize ? this.normalise(scores) : scores;

    // 4. Attach rerank score and filter
    const scored: SearchResult[] = [];
    for (let i = 0; i < results.length; i++) {
      const s = finalScores[i];
      if (s >= config.scoreThreshold) {
        scored.push({ ...results[i], rerankScore: s });
      } else {
        log.warn("Dropping below threshold", {
          chunkId: results[i].chunk.id,
          score: s,
          threshold: config.scoreThreshold,
        });
      }
    }

    // 5. Sort descending
    scored.sort((a, b) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0));

    log.info("Reranking complete", { kept: scored.length, dropped: results.length - scored.length });
    return scored;
  }

  // ---- internal helpers --------------------------------------------------

  private async scoreBatched(
    pairs: Array<{ query: string; passage: string }>,
    batchSize: number,
  ): Promise<number[]> {
    const allScores: number[] = [];
    for (let i = 0; i < pairs.length; i += batchSize) {
      const batch = pairs.slice(i, i + batchSize);
      try {
        const batchScores = await this.backend.score(batch);
        allScores.push(...batchScores);
      } catch (err) {
        log.error("Batch scoring failed, assigning zeros", { offset: i, error: String(err) });
        allScores.push(...new Array(batch.length).fill(0));
      }
    }
    return allScores;
  }

  private normalise(scores: number[]): number[] {
    if (scores.length === 0) return [];
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const range = max - min;
    if (range === 0) return scores.map(() => 1);
    return scores.map((s) => (s - min) / range);
  }
}
