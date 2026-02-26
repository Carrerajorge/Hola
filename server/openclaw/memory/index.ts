/**
 * Advanced Memory Module — re-exports + initialization.
 *
 * Provides PostgreSQL-backed hybrid vector+FTS search with:
 * - Markdown chunking with line tracking
 * - Multi-lingual query expansion (EN/ES/PT/AR/KO/JA/ZH)
 * - Hybrid vector + keyword scoring with configurable weights
 * - MMR (Maximal Marginal Relevance) diversity re-ranking
 * - Temporal decay scoring (evergreen files exempt)
 */

import type { OpenClawConfig } from '../config';
import { AdvancedMemoryService } from './service';
import { Logger } from '../../lib/logger';

export { AdvancedMemoryService } from './service';
export { chunkMarkdown, hashText, extractSnippet } from './chunking';
export { extractKeywords, buildTsQuery, expandQueryForFts } from './queryExpansion';
export { mergeHybridResults, tsRankToScore } from './hybrid';
export { mmrRerank, applyMMRToSearchResults, tokenize, jaccardSimilarity } from './mmr';
export {
  applyTemporalDecay,
  calculateDecayMultiplier,
  toDecayLambda,
  estimateAgeDays,
} from './temporalDecay';
export {
  getMemoryPersistence,
  resetMemoryPersistence,
  InMemoryMemoryPersistence,
  PostgresMemoryPersistence,
} from './persistence';

export type {
  MemorySource,
  MemoryChunk,
  MemorySearchResult,
  MemorySearchOptions,
  MemoryIndexResult,
  MemoryStats,
  HybridVectorResult,
  HybridKeywordResult,
} from './types';

/** Module singleton */
let _service: AdvancedMemoryService | null = null;

export function getAdvancedMemoryService(): AdvancedMemoryService | null {
  return _service;
}

/**
 * Initialize the advanced memory module.
 * Called from index.ts when advancedMemory.enabled=true.
 */
export async function initAdvancedMemory(config: OpenClawConfig): Promise<void> {
  _service = new AdvancedMemoryService(config);
  const stats = await _service.getStats();
  Logger.info(
    `[OpenClaw:AdvancedMemory] Initialized — ` +
    `${stats.totalChunks} chunks, ${stats.totalFiles} files, ` +
    `vectorWeight=${config.advancedMemory.vectorWeight}, ` +
    `textWeight=${config.advancedMemory.textWeight}, ` +
    `mmrLambda=${config.advancedMemory.mmrLambda}`,
  );
}
