/**
 * Advanced Memory PostgreSQL persistence.
 * Adapted from upstream OpenClaw v2026.2.24: src/memory/memory-schema.ts + manager-search.ts
 *
 * Key adaptation: SQLite FTS5 + sqlite-vec → PostgreSQL to_tsvector + GIN index + in-app cosine.
 * Uses the same ensureTable() lazy init pattern as statePersistence.ts.
 */

import { Logger } from '../../lib/logger';
import type { MemoryChunk, MemorySource, MemoryStats, HybridVectorResult, HybridKeywordResult } from './types';
import { tsRankToScore } from './hybrid';

// ── Interface ──────────────────────────────────────────────────────────

export interface IMemoryPersistence {
  upsertChunk(chunk: MemoryChunk): Promise<void>;
  upsertChunks(chunks: MemoryChunk[]): Promise<void>;
  deleteChunksForFile(filePath: string, source: MemorySource): Promise<number>;
  getChunksByFile(filePath: string): Promise<MemoryChunk[]>;
  searchByVector(embedding: number[], limit: number, sources?: MemorySource[]): Promise<HybridVectorResult[]>;
  searchByKeyword(tsQuery: string, limit: number, sources?: MemorySource[]): Promise<HybridKeywordResult[]>;
  getStats(): Promise<MemoryStats>;
  getChunkTimestamps(ids: string[]): Promise<Map<string, number>>;
}

// ── In-Memory Implementation (for tests / when no DB) ──────────────────

export class InMemoryMemoryPersistence implements IMemoryPersistence {
  private chunks = new Map<string, MemoryChunk>();
  private cosineSimilarity: (a: number[], b: number[]) => number;

  constructor() {
    // Inline cosine similarity (same formula as embeddings.ts)
    this.cosineSimilarity = (a: number[], b: number[]): number => {
      if (a.length !== b.length || a.length === 0) return 0;
      let dot = 0, normA = 0, normB = 0;
      for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
      }
      const denom = Math.sqrt(normA) * Math.sqrt(normB);
      return denom === 0 ? 0 : dot / denom;
    };
  }

  async upsertChunk(chunk: MemoryChunk): Promise<void> {
    this.chunks.set(chunk.id, { ...chunk });
  }

  async upsertChunks(chunks: MemoryChunk[]): Promise<void> {
    for (const chunk of chunks) {
      this.chunks.set(chunk.id, { ...chunk });
    }
  }

  async deleteChunksForFile(filePath: string, source: MemorySource): Promise<number> {
    let deleted = 0;
    for (const [id, chunk] of this.chunks) {
      if (chunk.filePath === filePath && chunk.source === source) {
        this.chunks.delete(id);
        deleted++;
      }
    }
    return deleted;
  }

  async getChunksByFile(filePath: string): Promise<MemoryChunk[]> {
    return Array.from(this.chunks.values()).filter(c => c.filePath === filePath);
  }

  async searchByVector(embedding: number[], limit: number, sources?: MemorySource[]): Promise<HybridVectorResult[]> {
    const results: HybridVectorResult[] = [];

    for (const chunk of this.chunks.values()) {
      if (sources && !sources.includes(chunk.source)) continue;
      if (!chunk.embedding) continue;

      const score = this.cosineSimilarity(embedding, chunk.embedding);
      results.push({
        id: chunk.id,
        path: chunk.filePath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        source: chunk.source,
        snippet: chunk.text.slice(0, 200),
        vectorScore: score,
      });
    }

    return results
      .sort((a, b) => b.vectorScore - a.vectorScore)
      .slice(0, limit);
  }

  async searchByKeyword(tsQuery: string, limit: number, sources?: MemorySource[]): Promise<HybridKeywordResult[]> {
    // Simple keyword matching for in-memory (no real FTS)
    const keywords = tsQuery
      .replace(/:\*/g, '')
      .split(/\s*&\s*/)
      .filter(Boolean)
      .map(k => k.toLowerCase());

    if (keywords.length === 0) return [];

    const results: HybridKeywordResult[] = [];

    for (const chunk of this.chunks.values()) {
      if (sources && !sources.includes(chunk.source)) continue;

      const text = chunk.text.toLowerCase();
      const matchCount = keywords.filter(k => text.includes(k)).length;

      if (matchCount > 0) {
        results.push({
          id: chunk.id,
          path: chunk.filePath,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          source: chunk.source,
          snippet: chunk.text.slice(0, 200),
          textScore: matchCount / keywords.length, // simple proportional score
        });
      }
    }

    return results
      .sort((a, b) => b.textScore - a.textScore)
      .slice(0, limit);
  }

  async getStats(): Promise<MemoryStats> {
    const files = new Set<string>();
    const sourceCounts = new Map<MemorySource, { files: Set<string>; chunks: number }>();
    let withEmbedding = 0;

    for (const chunk of this.chunks.values()) {
      files.add(chunk.filePath);
      if (chunk.embedding) withEmbedding++;

      const sc = sourceCounts.get(chunk.source) ?? { files: new Set<string>(), chunks: 0 };
      sc.files.add(chunk.filePath);
      sc.chunks++;
      sourceCounts.set(chunk.source, sc);
    }

    return {
      totalChunks: this.chunks.size,
      totalFiles: files.size,
      sourceCounts: Array.from(sourceCounts.entries()).map(([source, data]) => ({
        source,
        files: data.files.size,
        chunks: data.chunks,
      })),
      embeddingCoverage: this.chunks.size > 0 ? withEmbedding / this.chunks.size : 0,
    };
  }

  async getChunkTimestamps(ids: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    for (const id of ids) {
      const chunk = this.chunks.get(id);
      if (chunk) result.set(id, chunk.updatedAt);
    }
    return result;
  }
}

// ── PostgreSQL Implementation ──────────────────────────────────────────

export class PostgresMemoryPersistence implements IMemoryPersistence {
  private db: any;
  private initialized = false;

  constructor(db: any) {
    this.db = db;
  }

  private async ensureTable(): Promise<void> {
    if (this.initialized) return;
    try {
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS openclaw_memory_chunks (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          file_path TEXT NOT NULL,
          start_line INTEGER NOT NULL,
          end_line INTEGER NOT NULL,
          text_content TEXT NOT NULL,
          text_hash TEXT NOT NULL,
          embedding JSONB,
          created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
          updated_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
        )
      `);

      // GIN index for full-text search
      await this.db.execute(`
        CREATE INDEX IF NOT EXISTS idx_memory_chunks_fts
        ON openclaw_memory_chunks
        USING GIN (to_tsvector('english', text_content))
      `);

      // Index for file lookups
      await this.db.execute(`
        CREATE INDEX IF NOT EXISTS idx_memory_chunks_file
        ON openclaw_memory_chunks (file_path, source)
      `);

      this.initialized = true;
      Logger.info('[AdvancedMemory:Persistence] Tables ensured');
    } catch (err) {
      Logger.warn(`[AdvancedMemory:Persistence] Table creation failed: ${(err as Error).message}`);
    }
  }

  async upsertChunk(chunk: MemoryChunk): Promise<void> {
    await this.ensureTable();
    await this.db.execute({
      text: `
        INSERT INTO openclaw_memory_chunks (id, source, file_path, start_line, end_line, text_content, text_hash, embedding, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE SET
          text_content = EXCLUDED.text_content,
          text_hash = EXCLUDED.text_hash,
          embedding = EXCLUDED.embedding,
          updated_at = EXCLUDED.updated_at
      `,
      values: [
        chunk.id, chunk.source, chunk.filePath, chunk.startLine, chunk.endLine,
        chunk.text, chunk.textHash,
        chunk.embedding ? JSON.stringify(chunk.embedding) : null,
        chunk.createdAt, chunk.updatedAt,
      ],
    });
  }

  async upsertChunks(chunks: MemoryChunk[]): Promise<void> {
    for (const chunk of chunks) {
      await this.upsertChunk(chunk);
    }
  }

  async deleteChunksForFile(filePath: string, source: MemorySource): Promise<number> {
    await this.ensureTable();
    const result = await this.db.execute({
      text: `DELETE FROM openclaw_memory_chunks WHERE file_path = $1 AND source = $2`,
      values: [filePath, source],
    });
    return result?.rowCount ?? 0;
  }

  async getChunksByFile(filePath: string): Promise<MemoryChunk[]> {
    await this.ensureTable();
    const result = await this.db.execute({
      text: `SELECT * FROM openclaw_memory_chunks WHERE file_path = $1 ORDER BY start_line`,
      values: [filePath],
    });
    return (result?.rows ?? []).map(rowToChunk);
  }

  async searchByVector(embedding: number[], limit: number, sources?: MemorySource[]): Promise<HybridVectorResult[]> {
    await this.ensureTable();

    // Fetch all chunks with embeddings (we compute cosine in-app like ragService.ts)
    let query = `SELECT id, file_path, start_line, end_line, source, LEFT(text_content, 200) as snippet, embedding
                 FROM openclaw_memory_chunks WHERE embedding IS NOT NULL`;
    const values: any[] = [];

    if (sources && sources.length > 0) {
      query += ` AND source = ANY($1)`;
      values.push(sources);
    }

    const result = await this.db.execute({ text: query, values });
    const rows = result?.rows ?? [];

    // Compute cosine similarity in-app
    const scored: HybridVectorResult[] = rows
      .map((row: any) => {
        const chunkEmb = typeof row.embedding === 'string' ? JSON.parse(row.embedding) : row.embedding;
        if (!chunkEmb || !Array.isArray(chunkEmb)) return null;
        const score = cosineSimilarity(embedding, chunkEmb);
        return {
          id: row.id,
          path: row.file_path,
          startLine: row.start_line,
          endLine: row.end_line,
          source: row.source,
          snippet: row.snippet,
          vectorScore: score,
        };
      })
      .filter(Boolean) as HybridVectorResult[];

    return scored
      .sort((a, b) => b.vectorScore - a.vectorScore)
      .slice(0, limit);
  }

  async searchByKeyword(tsQuery: string, limit: number, sources?: MemorySource[]): Promise<HybridKeywordResult[]> {
    await this.ensureTable();

    if (!tsQuery.trim()) return [];

    let query = `
      SELECT id, file_path, start_line, end_line, source, LEFT(text_content, 200) as snippet,
             ts_rank(to_tsvector('english', text_content), to_tsquery('english', $1)) as rank
      FROM openclaw_memory_chunks
      WHERE to_tsvector('english', text_content) @@ to_tsquery('english', $1)
    `;
    const values: any[] = [tsQuery];

    if (sources && sources.length > 0) {
      query += ` AND source = ANY($2)`;
      values.push(sources);
    }

    query += ` ORDER BY rank DESC LIMIT $${values.length + 1}`;
    values.push(limit);

    const result = await this.db.execute({ text: query, values });
    return (result?.rows ?? []).map((row: any) => ({
      id: row.id,
      path: row.file_path,
      startLine: row.start_line,
      endLine: row.end_line,
      source: row.source,
      snippet: row.snippet,
      textScore: tsRankToScore(Number(row.rank)),
    }));
  }

  async getStats(): Promise<MemoryStats> {
    await this.ensureTable();

    const statsResult = await this.db.execute(`
      SELECT
        COUNT(*) as total_chunks,
        COUNT(DISTINCT file_path) as total_files,
        COUNT(embedding) FILTER (WHERE embedding IS NOT NULL) as with_embedding,
        MAX(updated_at) as last_indexed_at
      FROM openclaw_memory_chunks
    `);

    const sourceResult = await this.db.execute(`
      SELECT source, COUNT(DISTINCT file_path) as files, COUNT(*) as chunks
      FROM openclaw_memory_chunks
      GROUP BY source
    `);

    const stats = statsResult?.rows?.[0];
    const totalChunks = Number(stats?.total_chunks ?? 0);

    return {
      totalChunks,
      totalFiles: Number(stats?.total_files ?? 0),
      sourceCounts: (sourceResult?.rows ?? []).map((row: any) => ({
        source: row.source as MemorySource,
        files: Number(row.files),
        chunks: Number(row.chunks),
      })),
      embeddingCoverage: totalChunks > 0 ? Number(stats?.with_embedding ?? 0) / totalChunks : 0,
      lastIndexedAt: stats?.last_indexed_at ? Number(stats.last_indexed_at) : undefined,
    };
  }

  async getChunkTimestamps(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    await this.ensureTable();

    const result = await this.db.execute({
      text: `SELECT id, updated_at FROM openclaw_memory_chunks WHERE id = ANY($1)`,
      values: [ids],
    });

    const map = new Map<string, number>();
    for (const row of result?.rows ?? []) {
      map.set(row.id, Number(row.updated_at));
    }
    return map;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function rowToChunk(row: any): MemoryChunk {
  return {
    id: row.id,
    source: row.source as MemorySource,
    filePath: row.file_path,
    startLine: row.start_line,
    endLine: row.end_line,
    text: row.text_content,
    textHash: row.text_hash,
    embedding: row.embedding ? (typeof row.embedding === 'string' ? JSON.parse(row.embedding) : row.embedding) : undefined,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Factory ────────────────────────────────────────────────────────────

let _instance: IMemoryPersistence | null = null;

export function getMemoryPersistence(): IMemoryPersistence {
  if (_instance) return _instance;

  try {
    // Try to get PostgreSQL connection from our db module
    const { db } = require('../../db');
    if (db) {
      _instance = new PostgresMemoryPersistence(db);
      Logger.info('[AdvancedMemory:Persistence] Using PostgreSQL backend');
      return _instance;
    }
  } catch {
    // DB not available
  }

  _instance = new InMemoryMemoryPersistence();
  Logger.info('[AdvancedMemory:Persistence] Using in-memory backend (no DB)');
  return _instance;
}

/** Reset singleton (for testing) */
export function resetMemoryPersistence(): void {
  _instance = null;
}
