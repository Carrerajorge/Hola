import { describe, it, expect, beforeEach } from 'vitest';
import { chunkMarkdown, hashText, extractSnippet } from '../memory/chunking';
import { extractKeywords, buildTsQuery, expandQueryForFts } from '../memory/queryExpansion';
import { tokenize, jaccardSimilarity, mmrRerank } from '../memory/mmr';
import {
  toDecayLambda,
  calculateDecayMultiplier,
  applyDecayToScore,
  estimateAgeDays,
  applyTemporalDecay,
} from '../memory/temporalDecay';
import { mergeHybridResults, tsRankToScore } from '../memory/hybrid';
import { InMemoryMemoryPersistence } from '../memory/persistence';
import { AdvancedMemoryService } from '../memory/service';
import type { OpenClawConfig } from '../config';
import type { MemorySearchResult, HybridVectorResult, HybridKeywordResult } from '../memory/types';

// ── Chunking ────────────────────────────────────────────────────────────

describe('chunkMarkdown', () => {
  it('returns empty for empty content', () => {
    expect(chunkMarkdown('')).toEqual([]);
    expect(chunkMarkdown('   ')).toEqual([]);
  });

  it('creates single chunk for small content', () => {
    const chunks = chunkMarkdown('Hello world\nThis is a test');
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].startLine).toBe(0);
    expect(chunks[0].text).toContain('Hello world');
  });

  it('creates multiple chunks for large content', () => {
    const content = Array.from({ length: 100 }, (_, i) => `Line ${i}: ${'x'.repeat(20)}`).join('\n\n');
    const chunks = chunkMarkdown(content, { chunkSize: 200 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('tracks line numbers correctly', () => {
    const chunks = chunkMarkdown('Line 0\n\nLine 2\nLine 3\n\nLine 5', { chunkSize: 20 });
    expect(chunks[0].startLine).toBe(0);
    expect(chunks.every(c => c.startLine >= 0 && c.endLine >= c.startLine)).toBe(true);
  });

  it('generates consistent hashes', () => {
    const chunks1 = chunkMarkdown('Test content');
    const chunks2 = chunkMarkdown('Test content');
    expect(chunks1[0].hash).toBe(chunks2[0].hash);
  });
});

describe('hashText', () => {
  it('produces consistent SHA-256 hex', () => {
    expect(hashText('hello')).toBe(hashText('hello'));
    expect(hashText('hello')).not.toBe(hashText('world'));
    expect(hashText('test')).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('extractSnippet', () => {
  it('extracts correct line range', () => {
    const content = 'L0\nL1\nL2\nL3\nL4';
    expect(extractSnippet(content, 1, 3)).toBe('L1\nL2\nL3');
  });
});

// ── Query Expansion ─────────────────────────────────────────────────────

describe('extractKeywords', () => {
  it('removes English stop words', () => {
    const kw = extractKeywords('the quick brown fox jumps over the lazy dog');
    expect(kw).toContain('quick');
    expect(kw).toContain('brown');
    expect(kw).not.toContain('the');
    expect(kw).not.toContain('over');
  });

  it('removes Spanish stop words', () => {
    const kw = extractKeywords('el gato en la casa');
    expect(kw).toContain('gato');
    expect(kw).toContain('casa');
    expect(kw).not.toContain('el');
    expect(kw).not.toContain('en');
  });

  it('handles empty input', () => {
    expect(extractKeywords('')).toEqual([]);
  });

  it('deduplicates keywords', () => {
    const kw = extractKeywords('test test test');
    expect(kw).toEqual(['test']);
  });

  it('filters short tokens (< 2 chars)', () => {
    const kw = extractKeywords('I a x hello');
    expect(kw).toContain('hello');
    expect(kw).not.toContain('x');
  });
});

describe('buildTsQuery', () => {
  it('joins keywords with AND and prefix matching', () => {
    expect(buildTsQuery(['hello', 'world'])).toBe('hello:* & world:*');
  });

  it('returns empty for no keywords', () => {
    expect(buildTsQuery([])).toBe('');
  });

  it('filters non-latin keywords for FTS', () => {
    const result = buildTsQuery(['hello', '你好', 'world']);
    expect(result).toBe('hello:* & world:*'); // CJK filtered out
  });
});

describe('expandQueryForFts', () => {
  it('returns original, keywords, and tsQuery', () => {
    const result = expandQueryForFts('find the authentication module');
    expect(result.original).toBe('find the authentication module');
    expect(result.keywords).toContain('authentication');
    expect(result.keywords).toContain('module');
    expect(result.tsQuery).toContain('authentication:*');
  });
});

// ── MMR ─────────────────────────────────────────────────────────────────

describe('tokenize', () => {
  it('produces lowercase alphanumeric tokens', () => {
    const tokens = tokenize('Hello World! Test-123');
    expect(tokens.has('hello')).toBe(true);
    expect(tokens.has('world')).toBe(true);
    expect(tokens.has('test')).toBe(true);
    expect(tokens.has('123')).toBe(true);
  });

  it('filters single-char tokens', () => {
    const tokens = tokenize('a b cd');
    expect(tokens.has('a')).toBe(false);
    expect(tokens.has('cd')).toBe(true);
  });
});

describe('jaccardSimilarity', () => {
  it('returns 1 for identical sets', () => {
    const s = new Set(['a', 'b', 'c']);
    expect(jaccardSimilarity(s, s)).toBe(1);
  });

  it('returns 0 for disjoint sets', () => {
    expect(jaccardSimilarity(new Set(['a']), new Set(['b']))).toBe(0);
  });

  it('returns 0 for two empty sets', () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0);
  });

  it('computes correct overlap', () => {
    const a = new Set(['a', 'b', 'c']);
    const b = new Set(['b', 'c', 'd']);
    // intersection = {b, c} = 2, union = {a, b, c, d} = 4
    expect(jaccardSimilarity(a, b)).toBeCloseTo(0.5);
  });
});

describe('mmrRerank', () => {
  it('returns empty for empty input', () => {
    expect(mmrRerank([])).toEqual([]);
  });

  it('returns single item unchanged', () => {
    const items = [{ score: 1, snippet: 'hello world' }];
    expect(mmrRerank(items)).toEqual(items);
  });

  it('diversifies results with similar snippets', () => {
    const items = [
      { score: 1.0, snippet: 'authentication login system security' },
      { score: 0.95, snippet: 'authentication login system module' },
      { score: 0.5, snippet: 'database schema migration tables' },
    ];

    const reranked = mmrRerank(items, { lambda: 0.5 });
    // With λ=0.5, the diverse item should be promoted over the similar one
    expect(reranked.length).toBe(3);
    // First should still be highest score
    expect(reranked[0].snippet).toContain('authentication');
  });

  it('respects maxResults', () => {
    const items = [
      { score: 1.0, snippet: 'one' },
      { score: 0.9, snippet: 'two' },
      { score: 0.8, snippet: 'three' },
    ];
    expect(mmrRerank(items, { maxResults: 2 }).length).toBe(2);
  });
});

// ── Temporal Decay ──────────────────────────────────────────────────────

describe('toDecayLambda', () => {
  it('computes ln(2)/halfLife', () => {
    expect(toDecayLambda(14)).toBeCloseTo(Math.LN2 / 14);
  });

  it('returns 0 for invalid halfLife', () => {
    expect(toDecayLambda(0)).toBe(0);
    expect(toDecayLambda(-1)).toBe(0);
    expect(toDecayLambda(Infinity)).toBe(0);
  });
});

describe('calculateDecayMultiplier', () => {
  it('returns 1 for age=0', () => {
    expect(calculateDecayMultiplier(0, 14)).toBe(1);
  });

  it('returns ~0.5 at half-life', () => {
    expect(calculateDecayMultiplier(14, 14)).toBeCloseTo(0.5, 5);
  });

  it('returns ~0.25 at 2x half-life', () => {
    expect(calculateDecayMultiplier(28, 14)).toBeCloseTo(0.25, 5);
  });

  it('approaches 0 for very old items', () => {
    expect(calculateDecayMultiplier(365, 14)).toBeLessThan(0.001);
  });
});

describe('estimateAgeDays', () => {
  const nowMs = Date.UTC(2025, 0, 15); // Jan 15, 2025

  it('parses dated memory paths', () => {
    const age = estimateAgeDays({ path: 'memory/2025-01-01.md', source: 'memory' }, undefined, nowMs);
    expect(age).toBeCloseTo(14, 0);
  });

  it('returns null for evergreen MEMORY.md', () => {
    expect(estimateAgeDays({ path: 'MEMORY.md', source: 'memory' }, undefined, nowMs)).toBeNull();
  });

  it('returns null for evergreen topic files', () => {
    expect(estimateAgeDays({ path: 'memory/debugging.md', source: 'memory' }, undefined, nowMs)).toBeNull();
  });

  it('falls back to chunkUpdatedAt', () => {
    const age = estimateAgeDays(
      { path: 'some/file.ts', source: 'documents' },
      nowMs - 7 * 24 * 60 * 60 * 1000, // 7 days ago
      nowMs,
    );
    expect(age).toBeCloseTo(7, 0);
  });
});

describe('applyTemporalDecay', () => {
  it('returns unchanged results when disabled', () => {
    const results: MemorySearchResult[] = [
      { id: '1', path: 'test.md', startLine: 0, endLine: 5, score: 1.0, snippet: 'test', source: 'documents' },
    ];
    const decayed = applyTemporalDecay(results, { enabled: false, halfLifeDays: 14 });
    expect(decayed[0].score).toBe(1.0);
  });

  it('reduces scores for old items', () => {
    const results: MemorySearchResult[] = [
      { id: '1', path: 'test.md', startLine: 0, endLine: 5, score: 1.0, snippet: 'test', source: 'documents' },
    ];
    const timestamps = new Map([['1', Date.now() - 14 * 24 * 60 * 60 * 1000]]);
    const decayed = applyTemporalDecay(results, { enabled: true, halfLifeDays: 14 }, timestamps);
    expect(decayed[0].score).toBeCloseTo(0.5, 1);
  });
});

// ── Hybrid Merge ────────────────────────────────────────────────────────

describe('tsRankToScore', () => {
  it('maps 0 to 0', () => expect(tsRankToScore(0)).toBe(0));
  it('maps 1 to 0.5', () => expect(tsRankToScore(1)).toBeCloseTo(0.5));
  it('maps large values close to 1', () => expect(tsRankToScore(100)).toBeGreaterThan(0.9));
});

describe('mergeHybridResults', () => {
  it('merges vector and keyword results', () => {
    const vector: HybridVectorResult[] = [
      { id: 'a', path: 'f1.md', startLine: 0, endLine: 5, source: 'memory', snippet: 'vector hit', vectorScore: 0.9 },
    ];
    const keyword: HybridKeywordResult[] = [
      { id: 'a', path: 'f1.md', startLine: 0, endLine: 5, source: 'memory', snippet: 'keyword hit', textScore: 0.8 },
      { id: 'b', path: 'f2.md', startLine: 0, endLine: 3, source: 'documents', snippet: 'only keyword', textScore: 0.6 },
    ];

    const merged = mergeHybridResults({ vector, keyword, options: { vectorWeight: 0.7, textWeight: 0.3 } });

    // 'a' appears in both: 0.7*0.9 + 0.3*0.8 = 0.63+0.24 = 0.87
    expect(merged[0].id).toBe('a');
    expect(merged[0].score).toBeCloseTo(0.87, 2);
    expect(merged[0].scoreBreakdown?.vectorScore).toBe(0.9);
    expect(merged[0].scoreBreakdown?.textScore).toBe(0.8);

    // 'b' only in keyword: 0.7*0 + 0.3*0.6 = 0.18
    expect(merged[1].id).toBe('b');
    expect(merged[1].score).toBeCloseTo(0.18, 2);
  });

  it('handles empty inputs', () => {
    expect(mergeHybridResults({ vector: [], keyword: [] })).toEqual([]);
  });

  it('sorts by combined score descending', () => {
    const vector: HybridVectorResult[] = [
      { id: 'low', path: 'f1.md', startLine: 0, endLine: 1, source: 'memory', snippet: 'low', vectorScore: 0.3 },
      { id: 'high', path: 'f2.md', startLine: 0, endLine: 1, source: 'memory', snippet: 'high', vectorScore: 0.9 },
    ];

    const merged = mergeHybridResults({ vector, keyword: [] });
    expect(merged[0].id).toBe('high');
    expect(merged[1].id).toBe('low');
  });
});

// ── Persistence (InMemory) ──────────────────────────────────────────────

describe('InMemoryMemoryPersistence', () => {
  let persistence: InMemoryMemoryPersistence;

  beforeEach(() => {
    persistence = new InMemoryMemoryPersistence();
  });

  it('upserts and retrieves chunks', async () => {
    await persistence.upsertChunk({
      id: 'c1',
      source: 'memory',
      filePath: 'test.md',
      startLine: 0,
      endLine: 5,
      text: 'Hello world',
      textHash: 'h1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const chunks = await persistence.getChunksByFile('test.md');
    expect(chunks.length).toBe(1);
    expect(chunks[0].id).toBe('c1');
  });

  it('deletes chunks for a file', async () => {
    await persistence.upsertChunks([
      { id: 'c1', source: 'memory', filePath: 'a.md', startLine: 0, endLine: 1, text: 'a', textHash: 'h1', createdAt: 0, updatedAt: 0 },
      { id: 'c2', source: 'memory', filePath: 'a.md', startLine: 2, endLine: 3, text: 'b', textHash: 'h2', createdAt: 0, updatedAt: 0 },
      { id: 'c3', source: 'memory', filePath: 'b.md', startLine: 0, endLine: 1, text: 'c', textHash: 'h3', createdAt: 0, updatedAt: 0 },
    ]);

    const deleted = await persistence.deleteChunksForFile('a.md', 'memory');
    expect(deleted).toBe(2);

    const remaining = await persistence.getChunksByFile('b.md');
    expect(remaining.length).toBe(1);
  });

  it('searches by keyword', async () => {
    await persistence.upsertChunks([
      { id: 'c1', source: 'memory', filePath: 'auth.md', startLine: 0, endLine: 1, text: 'authentication login module', textHash: 'h1', createdAt: 0, updatedAt: 0 },
      { id: 'c2', source: 'memory', filePath: 'db.md', startLine: 0, endLine: 1, text: 'database schema migration', textHash: 'h2', createdAt: 0, updatedAt: 0 },
    ]);

    const results = await persistence.searchByKeyword('authentication:*', 10);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('c1');
  });

  it('searches by vector similarity', async () => {
    await persistence.upsertChunks([
      { id: 'c1', source: 'memory', filePath: 'a.md', startLine: 0, endLine: 1, text: 'a', textHash: 'h1', embedding: [1, 0, 0], createdAt: 0, updatedAt: 0 },
      { id: 'c2', source: 'memory', filePath: 'b.md', startLine: 0, endLine: 1, text: 'b', textHash: 'h2', embedding: [0, 1, 0], createdAt: 0, updatedAt: 0 },
      { id: 'c3', source: 'memory', filePath: 'c.md', startLine: 0, endLine: 1, text: 'c', textHash: 'h3', createdAt: 0, updatedAt: 0 }, // no embedding
    ]);

    const results = await persistence.searchByVector([1, 0, 0], 10);
    expect(results.length).toBe(2); // only chunks with embeddings
    expect(results[0].id).toBe('c1'); // highest similarity
    expect(results[0].vectorScore).toBeCloseTo(1.0);
  });

  it('returns stats', async () => {
    await persistence.upsertChunks([
      { id: 'c1', source: 'memory', filePath: 'a.md', startLine: 0, endLine: 1, text: 'a', textHash: 'h1', embedding: [1], createdAt: 0, updatedAt: 0 },
      { id: 'c2', source: 'documents', filePath: 'b.md', startLine: 0, endLine: 1, text: 'b', textHash: 'h2', createdAt: 0, updatedAt: 0 },
    ]);

    const stats = await persistence.getStats();
    expect(stats.totalChunks).toBe(2);
    expect(stats.totalFiles).toBe(2);
    expect(stats.embeddingCoverage).toBe(0.5);
    expect(stats.sourceCounts.length).toBe(2);
  });
});

// ── AdvancedMemoryService (integration) ─────────────────────────────────

describe('AdvancedMemoryService', () => {
  let service: AdvancedMemoryService;
  let persistence: InMemoryMemoryPersistence;

  const mockConfig = {
    advancedMemory: {
      enabled: true,
      vectorWeight: 0.7,
      textWeight: 0.3,
      temporalDecayHalfLifeDays: 14,
      mmrLambda: 0.7,
    },
  } as OpenClawConfig;

  beforeEach(() => {
    persistence = new InMemoryMemoryPersistence();
    service = new AdvancedMemoryService(mockConfig, persistence);
  });

  it('indexes a document and creates chunks', async () => {
    const result = await service.indexDocument({
      filePath: 'test.md',
      content: 'Line 1\nLine 2\nLine 3\n\nParagraph two is here.',
      source: 'memory',
    });

    expect(result.chunksIndexed).toBeGreaterThan(0);
    expect(result.errors).toEqual([]);
  });

  it('detects unchanged chunks on re-index', async () => {
    const content = 'Hello world\n\nThis is a test document.';

    const first = await service.indexDocument({ filePath: 'test.md', content, source: 'memory' });
    const second = await service.indexDocument({ filePath: 'test.md', content, source: 'memory' });

    expect(second.chunksUpdated).toBe(0); // nothing changed
    expect(second.chunksIndexed).toBe(first.chunksIndexed);
  });

  it('searches indexed content by keyword', async () => {
    await service.indexDocument({
      filePath: 'auth.md',
      content: 'Authentication module handles login and OAuth flows.',
      source: 'documents',
    });

    await service.indexDocument({
      filePath: 'db.md',
      content: 'Database schema migration system for PostgreSQL.',
      source: 'documents',
    });

    const results = await service.search('authentication login', {
      enableMMR: false,
      enableTemporalDecay: false,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toBe('auth.md');
  });

  it('returns stats', async () => {
    await service.indexDocument({
      filePath: 'test.md',
      content: 'Test content for stats.',
      source: 'memory',
    });

    const stats = await service.getStats();
    expect(stats.totalChunks).toBeGreaterThan(0);
    expect(stats.totalFiles).toBe(1);
  });

  it('deletes source chunks', async () => {
    await service.indexDocument({ filePath: 'test.md', content: 'Hello', source: 'memory' });
    const deleted = await service.deleteSource('test.md', 'memory');
    expect(deleted).toBeGreaterThan(0);

    const stats = await service.getStats();
    expect(stats.totalChunks).toBe(0);
  });
});
