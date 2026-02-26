/**
 * Maximal Marginal Relevance (MMR) re-ranking.
 * Ported from upstream OpenClaw v2026.2.24: src/memory/mmr.ts
 *
 * Diversifies search results by penalizing items similar to already-selected items.
 * Formula: score_i = λ * relevance_i - (1-λ) * max_j(similarity(i, already_selected_j))
 */

import type { MemorySearchResult } from './types';

/**
 * Tokenize text into a set of lowercase alphanumeric tokens.
 * Used for Jaccard similarity computation.
 */
export function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9\u00C0-\u024F]+/)
    .filter(t => t.length >= 2);
  return new Set(tokens);
}

/**
 * Jaccard similarity: |A ∩ B| / |A ∪ B|
 * Returns 0 if both sets are empty.
 */
export function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 0;

  let intersection = 0;
  const smaller = setA.size <= setB.size ? setA : setB;
  const larger = setA.size <= setB.size ? setB : setA;

  for (const item of smaller) {
    if (larger.has(item)) {
      intersection++;
    }
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface MMRConfig {
  /** λ ∈ [0, 1]: balance between relevance (1) and diversity (0). Default: 0.7 */
  lambda?: number;
  /** Maximum number of results to return */
  maxResults?: number;
}

/**
 * MMR re-ranking on items with score + text snippet.
 *
 * Iteratively selects items that maximize:
 *   λ * normalized_relevance - (1-λ) * max_similarity_to_selected
 *
 * Pre-tokenizes all items for efficient pairwise comparison.
 */
export function mmrRerank<T extends { score: number; snippet: string }>(
  items: T[],
  config?: MMRConfig,
): T[] {
  const lambda = config?.lambda ?? 0.7;
  const maxResults = config?.maxResults ?? items.length;

  if (items.length <= 1) return [...items];

  // Pre-tokenize all snippets
  const tokenSets = items.map(item => tokenize(item.snippet));

  // Normalize scores to [0, 1]
  const maxScore = Math.max(...items.map(i => i.score));
  const minScore = Math.min(...items.map(i => i.score));
  const scoreRange = maxScore - minScore || 1;
  const normalizedScores = items.map(i => (i.score - minScore) / scoreRange);

  const selected: number[] = [];
  const remaining = new Set(items.map((_, i) => i));
  const result: T[] = [];

  while (selected.length < maxResults && remaining.size > 0) {
    let bestIdx = -1;
    let bestMMRScore = -Infinity;

    for (const candidateIdx of remaining) {
      const relevance = normalizedScores[candidateIdx];

      // Max similarity to any already-selected item
      let maxSim = 0;
      for (const selectedIdx of selected) {
        const sim = jaccardSimilarity(tokenSets[candidateIdx], tokenSets[selectedIdx]);
        if (sim > maxSim) maxSim = sim;
      }

      const mmrScore = lambda * relevance - (1 - lambda) * maxSim;

      if (mmrScore > bestMMRScore) {
        bestMMRScore = mmrScore;
        bestIdx = candidateIdx;
      }
    }

    if (bestIdx === -1) break;

    selected.push(bestIdx);
    remaining.delete(bestIdx);
    result.push(items[bestIdx]);
  }

  return result;
}

/**
 * Apply MMR to MemorySearchResult array.
 */
export function applyMMRToSearchResults(
  results: MemorySearchResult[],
  config?: MMRConfig,
): MemorySearchResult[] {
  return mmrRerank(results, config);
}
