import { describe, it, expect } from 'vitest';
import { mergeHybridResults, bm25RankToScore } from '../memory/hybridSearch';

describe('bm25RankToScore', () => {
  it('should convert rank 0 to score 1', () => {
    expect(bm25RankToScore(0)).toBe(1);
  });
  it('should convert rank 1 to score 0.5', () => {
    expect(bm25RankToScore(1)).toBe(0.5);
  });
});

describe('mergeHybridResults', () => {
  it('should merge vector and keyword results by score', () => {
    const vectorResults = [
      { id: 'a', path: 'a.md', snippet: 'alpha', vectorScore: 0.9, startLine: 0, endLine: 10, source: 'memory' as const },
    ];
    const keywordResults = [
      { id: 'a', path: 'a.md', snippet: 'alpha', textScore: 0.7, startLine: 0, endLine: 10, source: 'memory' as const },
      { id: 'b', path: 'b.md', snippet: 'beta', textScore: 0.8, startLine: 0, endLine: 5, source: 'memory' as const },
    ];
    const merged = mergeHybridResults(vectorResults, keywordResults, { vectorWeight: 0.7, textWeight: 0.3 });
    expect(merged[0].id).toBe('a'); // 0.7*0.9 + 0.3*0.7 = 0.84
    expect(merged[1].id).toBe('b'); // 0.7*0 + 0.3*0.8 = 0.24
    expect(merged[0].score).toBeCloseTo(0.84);
  });

  it('should deduplicate by ID keeping highest scores', () => {
    const vectorResults = [{ id: 'x', path: 'x.md', snippet: 'x', vectorScore: 0.5, startLine: 0, endLine: 1, source: 'memory' as const }];
    const keywordResults = [{ id: 'x', path: 'x.md', snippet: 'x', textScore: 0.6, startLine: 0, endLine: 1, source: 'memory' as const }];
    const merged = mergeHybridResults(vectorResults, keywordResults, { vectorWeight: 0.5, textWeight: 0.5 });
    expect(merged).toHaveLength(1);
    expect(merged[0].score).toBeCloseTo(0.55);
  });
});
