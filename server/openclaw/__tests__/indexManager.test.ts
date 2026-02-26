import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryIndexManager } from '../memory/indexManager';

describe('MemoryIndexManager', () => {
  it('should create instance via factory', async () => {
    const mgr = await MemoryIndexManager.create({
      embeddingProvider: null, // FTS-only mode
      config: { chunkSize: 20, chunkOverlap: 5, maxResults: 10, minScore: 0,
        vectorWeight: 0.7, textWeight: 0.3, mmrEnabled: false, mmrLambda: 0.5,
        temporalDecayEnabled: false, temporalDecayHalfLifeDays: 30 },
    });
    expect(mgr).toBeDefined();
    expect(mgr.status().vectorAvailable).toBe(false);
    expect(mgr.status().ftsAvailable).toBe(true);
  });

  it('should index and search documents (FTS mode)', async () => {
    const mgr = await MemoryIndexManager.create({
      embeddingProvider: null,
      config: { chunkSize: 100, chunkOverlap: 10, maxResults: 10, minScore: 0,
        vectorWeight: 0.7, textWeight: 0.3, mmrEnabled: false, mmrLambda: 0.5,
        temporalDecayEnabled: false, temporalDecayHalfLifeDays: 30 },
    });
    await mgr.index([
      { path: 'auth.md', content: 'Authentication uses JWT tokens for secure access control' },
      { path: 'db.md', content: 'Database schema uses PostgreSQL with Drizzle ORM' },
    ]);
    const results = await mgr.search('authentication JWT');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toBe('auth.md');
  });

  it('should return empty results for unmatched query', async () => {
    const mgr = await MemoryIndexManager.create({
      embeddingProvider: null,
      config: { chunkSize: 100, chunkOverlap: 10, maxResults: 10, minScore: 0,
        vectorWeight: 0.7, textWeight: 0.3, mmrEnabled: false, mmrLambda: 0.5,
        temporalDecayEnabled: false, temporalDecayHalfLifeDays: 30 },
    });
    await mgr.index([{ path: 'test.md', content: 'Hello world' }]);
    const results = await mgr.search('xyznonexistent');
    expect(results).toHaveLength(0);
  });

  it('should report correct document count', async () => {
    const mgr = await MemoryIndexManager.create({
      embeddingProvider: null,
      config: { chunkSize: 100, chunkOverlap: 10, maxResults: 10, minScore: 0,
        vectorWeight: 0.7, textWeight: 0.3, mmrEnabled: false, mmrLambda: 0.5,
        temporalDecayEnabled: false, temporalDecayHalfLifeDays: 30 },
    });
    expect(mgr.status().documentCount).toBe(0);
    await mgr.index([
      { path: 'a.md', content: 'First document' },
      { path: 'b.md', content: 'Second document' },
    ]);
    expect(mgr.status().documentCount).toBe(2);
  });
});
