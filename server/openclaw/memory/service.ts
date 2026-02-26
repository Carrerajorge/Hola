/**
 * Advanced Memory Service — orchestrator.
 * Ported from upstream OpenClaw v2026.2.24: src/memory/manager.ts
 *
 * Pipeline: index → chunk → hash → embed → upsert
 * Pipeline: search → expand → vector+FTS → merge → decay → MMR
 */

import { Logger } from '../../lib/logger';
import type { OpenClawConfig } from '../config';
import type {
  MemoryChunk,
  MemorySource,
  MemorySearchResult,
  MemorySearchOptions,
  MemoryIndexResult,
  MemoryStats,
} from './types';
import { chunkMarkdown, hashText } from './chunking';
import { expandQueryForFts } from './queryExpansion';
import { mergeHybridResults } from './hybrid';
import { getMemoryPersistence, type IMemoryPersistence } from './persistence';

export class AdvancedMemoryService {
  private persistence: IMemoryPersistence;
  private config: OpenClawConfig;
  private getEmbeddingFn: ((text: string) => Promise<number[]>) | null = null;

  constructor(config: OpenClawConfig, persistence?: IMemoryPersistence) {
    this.config = config;
    this.persistence = persistence ?? getMemoryPersistence();
  }

  /**
   * Lazily resolve the embedding function from our embeddings service.
   * Uses server/services/embeddings.ts → getEmbedding().
   */
  private async getEmbedding(text: string): Promise<number[] | null> {
    if (!this.getEmbeddingFn) {
      try {
        const { getEmbedding } = await import('../../services/embeddings');
        this.getEmbeddingFn = getEmbedding;
      } catch {
        Logger.warn('[AdvancedMemory] Embedding service not available — vector search disabled');
        return null;
      }
    }

    try {
      return await this.getEmbeddingFn(text);
    } catch (err) {
      Logger.warn(`[AdvancedMemory] Embedding failed: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Index a document: chunk → hash → embed → upsert.
   * Only re-embeds chunks whose hash has changed (change detection).
   */
  async indexDocument(params: {
    filePath: string;
    content: string;
    source: MemorySource;
  }): Promise<MemoryIndexResult> {
    const result: MemoryIndexResult = {
      chunksIndexed: 0,
      chunksUpdated: 0,
      chunksDeleted: 0,
      embeddingsGenerated: 0,
      errors: [],
    };

    try {
      // 1. Chunk the content
      const rawChunks = chunkMarkdown(params.content);
      if (rawChunks.length === 0) return result;

      // 2. Get existing chunks for this file (change detection)
      const existingChunks = await this.persistence.getChunksByFile(params.filePath);
      const existingByHash = new Map(existingChunks.map(c => [c.textHash, c]));
      const newHashes = new Set(rawChunks.map(c => c.hash));

      // 3. Delete chunks that no longer exist
      for (const existing of existingChunks) {
        if (!newHashes.has(existing.textHash)) {
          // This chunk was removed/changed
          result.chunksDeleted++;
        }
      }
      if (result.chunksDeleted > 0) {
        await this.persistence.deleteChunksForFile(params.filePath, params.source);
      }

      // 4. Upsert new/changed chunks with embeddings
      const now = Date.now();
      const chunksToUpsert: MemoryChunk[] = [];

      for (const rawChunk of rawChunks) {
        const existing = existingByHash.get(rawChunk.hash);

        if (existing) {
          // Hash unchanged — reuse existing embedding
          chunksToUpsert.push(existing);
          result.chunksIndexed++;
          continue;
        }

        // New/changed chunk — generate embedding
        const embedding = await this.getEmbedding(rawChunk.text);
        if (embedding) result.embeddingsGenerated++;

        const chunk: MemoryChunk = {
          id: `${params.source}:${params.filePath}:${rawChunk.startLine}-${rawChunk.endLine}`,
          source: params.source,
          filePath: params.filePath,
          startLine: rawChunk.startLine,
          endLine: rawChunk.endLine,
          text: rawChunk.text,
          textHash: rawChunk.hash,
          embedding: embedding ?? undefined,
          createdAt: now,
          updatedAt: now,
        };

        chunksToUpsert.push(chunk);
        result.chunksUpdated++;
        result.chunksIndexed++;
      }

      await this.persistence.upsertChunks(chunksToUpsert);

    } catch (err) {
      result.errors.push((err as Error).message);
      Logger.error(`[AdvancedMemory] Index error: ${(err as Error).message}`);
    }

    return result;
  }

  /**
   * Search: expand → vector+FTS → merge → decay → MMR.
   */
  async search(query: string, options?: MemorySearchOptions): Promise<MemorySearchResult[]> {
    const maxResults = options?.maxResults ?? 10;
    const minScore = options?.minScore ?? 0.1;
    const vectorWeight = options?.vectorWeight ?? this.config.advancedMemory.vectorWeight;
    const textWeight = options?.textWeight ?? this.config.advancedMemory.textWeight;
    const mmrLambda = options?.mmrLambda ?? this.config.advancedMemory.mmrLambda;
    const decayHalfLife = options?.temporalDecayHalfLifeDays ?? this.config.advancedMemory.temporalDecayHalfLifeDays;

    // 1. Expand query for FTS
    const { tsQuery, keywords } = expandQueryForFts(query);

    // 2. Vector search (if embedding available)
    const fetchLimit = maxResults * 3; // over-fetch for merge/MMR
    const embedding = await this.getEmbedding(query);
    const vectorResults = embedding
      ? await this.persistence.searchByVector(embedding, fetchLimit, options?.sources)
      : [];

    // 3. Keyword search
    const keywordResults = tsQuery
      ? await this.persistence.searchByKeyword(tsQuery, fetchLimit, options?.sources)
      : [];

    if (vectorResults.length === 0 && keywordResults.length === 0) {
      return [];
    }

    // 4. Get timestamps for temporal decay
    const allIds = [
      ...vectorResults.map(r => r.id),
      ...keywordResults.map(r => r.id),
    ];
    const chunkTimestamps = await this.persistence.getChunkTimestamps([...new Set(allIds)]);

    // 5. Merge hybrid results with decay + MMR
    const merged = mergeHybridResults({
      vector: vectorResults,
      keyword: keywordResults,
      options: {
        vectorWeight,
        textWeight,
        mmr: options?.enableMMR !== false ? { enabled: true, lambda: mmrLambda, maxResults } : undefined,
        temporalDecay: options?.enableTemporalDecay !== false
          ? { enabled: true, halfLifeDays: decayHalfLife }
          : undefined,
        chunkTimestamps,
      },
    });

    // 6. Filter by min score and limit
    return merged
      .filter(r => r.score >= minScore)
      .slice(0, maxResults);
  }

  /**
   * Get memory index statistics.
   */
  async getStats(): Promise<MemoryStats> {
    return this.persistence.getStats();
  }

  /**
   * Delete all chunks for a specific source.
   */
  async deleteSource(filePath: string, source: MemorySource): Promise<number> {
    return this.persistence.deleteChunksForFile(filePath, source);
  }
}
