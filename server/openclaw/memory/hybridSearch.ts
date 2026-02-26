// server/openclaw/memory/hybridSearch.ts
import type { MemorySearchResult } from '../types';

export function bm25RankToScore(rank: number): number {
  const normalized = Number.isFinite(rank) ? Math.max(0, rank) : 999;
  return 1 / (1 + normalized);
}

interface VectorResult {
  id: string; path: string; snippet: string; vectorScore: number;
  startLine: number; endLine: number; source: 'memory' | 'sessions';
}

interface KeywordResult {
  id: string; path: string; snippet: string; textScore: number;
  startLine: number; endLine: number; source: 'memory' | 'sessions';
}

interface MergeOptions {
  vectorWeight: number;
  textWeight: number;
}

export function mergeHybridResults(
  vectorResults: VectorResult[],
  keywordResults: KeywordResult[],
  opts: MergeOptions,
): MemorySearchResult[] {
  const byId = new Map<string, {
    id: string; path: string; snippet: string;
    vectorScore: number; textScore: number;
    startLine: number; endLine: number; source: 'memory' | 'sessions';
  }>();

  for (const vr of vectorResults) {
    byId.set(vr.id, { ...vr, textScore: 0 });
  }

  for (const kr of keywordResults) {
    const existing = byId.get(kr.id);
    if (existing) {
      existing.textScore = Math.max(existing.textScore, kr.textScore);
    } else {
      byId.set(kr.id, { ...kr, vectorScore: 0 });
    }
  }

  const results: MemorySearchResult[] = [];
  for (const entry of byId.values()) {
    const score = opts.vectorWeight * entry.vectorScore + opts.textWeight * entry.textScore;
    results.push({
      id: entry.id,
      path: entry.path,
      snippet: entry.snippet,
      score,
      vectorScore: entry.vectorScore,
      textScore: entry.textScore,
      startLine: entry.startLine,
      endLine: entry.endLine,
      source: entry.source,
    });
  }

  return results.sort((a, b) => b.score - a.score);
}

export function applyMMR(
  results: MemorySearchResult[],
  queryVec: number[],
  docVecs: Map<string, number[]>,
  lambda: number,
  topK: number,
): MemorySearchResult[] {
  if (results.length <= 1) return results;
  const selected: MemorySearchResult[] = [results[0]];
  const remaining = results.slice(1);

  while (selected.length < topK && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      const candVec = docVecs.get(candidate.id);
      const relevance = candidate.score;
      let maxSim = 0;

      for (const sel of selected) {
        const selVec = docVecs.get(sel.id);
        if (candVec && selVec) {
          maxSim = Math.max(maxSim, cosineSimilarity(candVec, selVec));
        }
      }

      const mmrScore = lambda * relevance - (1 - lambda) * maxSim;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }

    selected.push(remaining.splice(bestIdx, 1)[0]);
  }

  return selected;
}

export function applyTemporalDecay(
  results: MemorySearchResult[],
  halfLifeDays: number,
  _now: number = Date.now(),
): MemorySearchResult[] {
  const _halfLifeMs = halfLifeDays * 86400000;
  return results.map(r => {
    // Default: no decay without file stats -- placeholder for mtime integration
    const decay = 1;
    return { ...r, score: r.score * decay };
  }).sort((a, b) => b.score - a.score);
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
  return denom < 1e-10 ? 0 : dot / denom;
}
