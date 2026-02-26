/**
 * Advanced Memory types.
 * Ported from upstream OpenClaw v2026.2.24: src/memory/types.ts
 *
 * Adapted for PostgreSQL backend (no SQLite references).
 */

export type MemorySource = 'memory' | 'sessions' | 'documents' | 'chat';

export interface MemoryChunk {
  id: string;
  source: MemorySource;
  filePath: string;
  startLine: number;
  endLine: number;
  text: string;
  textHash: string;
  embedding?: number[];
  createdAt: number;
  updatedAt: number;
}

export interface MemorySearchResult {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: MemorySource;
  scoreBreakdown?: {
    vectorScore?: number;
    textScore?: number;
    temporalMultiplier?: number;
    mmrPenalty?: number;
  };
}

export interface MemorySearchOptions {
  maxResults?: number;
  minScore?: number;
  sources?: MemorySource[];
  vectorWeight?: number;
  textWeight?: number;
  enableMMR?: boolean;
  mmrLambda?: number;
  enableTemporalDecay?: boolean;
  temporalDecayHalfLifeDays?: number;
}

export interface MemoryIndexResult {
  chunksIndexed: number;
  chunksUpdated: number;
  chunksDeleted: number;
  embeddingsGenerated: number;
  errors: string[];
}

export interface MemoryStats {
  totalChunks: number;
  totalFiles: number;
  sourceCounts: Array<{ source: MemorySource; files: number; chunks: number }>;
  embeddingCoverage: number;
  lastIndexedAt?: number;
}

export interface HybridVectorResult {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  source: MemorySource;
  snippet: string;
  vectorScore: number;
}

export interface HybridKeywordResult {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  source: MemorySource;
  snippet: string;
  textScore: number;
}
