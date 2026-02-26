/**
 * Hybrid search result merging.
 * Ported from upstream OpenClaw v2026.2.24: src/memory/hybrid.ts
 *
 * Combines vector similarity scores + FTS keyword scores into a unified
 * ranking, then optionally applies temporal decay and MMR diversification.
 */

import type {
  MemorySearchResult,
  HybridVectorResult,
  HybridKeywordResult,
} from './types';
import { applyMMRToSearchResults } from './mmr';
import { applyTemporalDecay, type TemporalDecayConfig } from './temporalDecay';

export interface HybridMergeOptions {
  vectorWeight?: number;
  textWeight?: number;
  mmr?: { enabled: boolean; lambda?: number; maxResults?: number };
  temporalDecay?: TemporalDecayConfig;
  chunkTimestamps?: Map<string, number>;
  nowMs?: number;
}

/**
 * Convert a PostgreSQL ts_rank score to a [0, 1] range.
 * Upstream used BM25: `1 / (1 + rank)` — ts_rank is already positive,
 * so we normalize similarly.
 */
export function tsRankToScore(rank: number): number {
  if (!Number.isFinite(rank) || rank <= 0) return 0;
  return rank / (1 + rank); // maps (0, ∞) → (0, 1)
}

/**
 * Merge vector search results and keyword search results into a unified ranking.
 *
 * Each result gets a combined score:
 *   combined = vectorWeight * vectorScore + textWeight * textScore
 *
 * Results appearing in both sets get scores from both; results in only one set
 * get 0 for the missing component.
 */
export function mergeHybridResults(params: {
  vector: HybridVectorResult[];
  keyword: HybridKeywordResult[];
  options?: HybridMergeOptions;
}): MemorySearchResult[] {
  const vectorWeight = params.options?.vectorWeight ?? 0.7;
  const textWeight = params.options?.textWeight ?? 0.3;

  // Build a map of all unique results by ID
  const merged = new Map<string, {
    id: string;
    path: string;
    startLine: number;
    endLine: number;
    source: string;
    snippet: string;
    vectorScore: number;
    textScore: number;
  }>();

  // Add vector results
  for (const v of params.vector) {
    merged.set(v.id, {
      id: v.id,
      path: v.path,
      startLine: v.startLine,
      endLine: v.endLine,
      source: v.source,
      snippet: v.snippet,
      vectorScore: v.vectorScore,
      textScore: 0,
    });
  }

  // Merge keyword results
  for (const k of params.keyword) {
    const existing = merged.get(k.id);
    if (existing) {
      existing.textScore = k.textScore;
    } else {
      merged.set(k.id, {
        id: k.id,
        path: k.path,
        startLine: k.startLine,
        endLine: k.endLine,
        source: k.source,
        snippet: k.snippet,
        vectorScore: 0,
        textScore: k.textScore,
      });
    }
  }

  // Compute combined scores
  let results: MemorySearchResult[] = Array.from(merged.values()).map(entry => ({
    id: entry.id,
    path: entry.path,
    startLine: entry.startLine,
    endLine: entry.endLine,
    score: vectorWeight * entry.vectorScore + textWeight * entry.textScore,
    snippet: entry.snippet,
    source: entry.source as any,
    scoreBreakdown: {
      vectorScore: entry.vectorScore,
      textScore: entry.textScore,
    },
  }));

  // Sort by combined score descending
  results.sort((a, b) => b.score - a.score);

  // Apply temporal decay if configured
  if (params.options?.temporalDecay?.enabled) {
    results = applyTemporalDecay(
      results,
      params.options.temporalDecay,
      params.options.chunkTimestamps,
      params.options.nowMs,
    );
    // Re-sort after decay
    results.sort((a, b) => b.score - a.score);
  }

  // Apply MMR diversification if configured
  if (params.options?.mmr?.enabled) {
    results = applyMMRToSearchResults(results, {
      lambda: params.options.mmr.lambda,
      maxResults: params.options.mmr.maxResults,
    });
  }

  return results;
}
