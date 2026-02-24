// server/openclaw/memory/indexManager.ts
import type { EmbeddingProvider, MemorySearchResult, MemorySearchManager } from '../types';
import { chunkDocument, type DocumentChunk } from './chunker';
import { extractKeywords } from './queryExpansion';
import { mergeHybridResults, applyMMR, applyTemporalDecay } from './hybridSearch';

interface IndexManagerConfig {
  chunkSize: number;
  chunkOverlap: number;
  maxResults: number;
  minScore: number;
  vectorWeight: number;
  textWeight: number;
  mmrEnabled: boolean;
  mmrLambda: number;
  temporalDecayEnabled: boolean;
  temporalDecayHalfLifeDays: number;
}

interface CreateOptions {
  embeddingProvider: EmbeddingProvider | null;
  config: IndexManagerConfig;
}

interface StoredChunk extends DocumentChunk {
  keywords: string[];
  vector?: number[];
}

export class MemoryIndexManager implements MemorySearchManager {
  private chunks: StoredChunk[] = [];
  private embeddingProvider: EmbeddingProvider | null;
  private config: IndexManagerConfig;

  private constructor(embeddingProvider: EmbeddingProvider | null, config: IndexManagerConfig) {
    this.embeddingProvider = embeddingProvider;
    this.config = config;
  }

  static async create(opts: CreateOptions): Promise<MemoryIndexManager> {
    return new MemoryIndexManager(opts.embeddingProvider, opts.config);
  }

  async search(query: string, opts?: { maxResults?: number; minScore?: number }): Promise<MemorySearchResult[]> {
    const maxResults = opts?.maxResults ?? this.config.maxResults;
    const minScore = opts?.minScore ?? this.config.minScore;

    if (this.chunks.length === 0) return [];

    const queryKeywords = extractKeywords(query);
    if (queryKeywords.length === 0) return [];

    // FTS search: keyword matching with simple scoring
    const keywordResults = this.ftsSearch(queryKeywords);

    // Embed query once (reused for vector search and MMR)
    let queryVec: number[] | null = null;
    let vectorResults: Array<{
      id: string; path: string; snippet: string; vectorScore: number;
      startLine: number; endLine: number; source: 'memory' | 'sessions';
    }> = [];

    if (this.embeddingProvider) {
      queryVec = await this.embeddingProvider.embedQuery(query);
      vectorResults = this.vectorSearch(queryVec);
    }

    // Merge results
    const merged = mergeHybridResults(vectorResults, keywordResults, {
      vectorWeight: this.embeddingProvider ? this.config.vectorWeight : 0,
      textWeight: this.embeddingProvider ? this.config.textWeight : 1,
    });

    // Apply MMR if enabled and we have vectors
    let results = merged;
    if (this.config.mmrEnabled && queryVec && vectorResults.length > 0) {
      const docVecs = new Map<string, number[]>();
      for (const chunk of this.chunks) {
        if (chunk.vector) docVecs.set(chunk.id, chunk.vector);
      }
      results = applyMMR(results, queryVec, docVecs, this.config.mmrLambda, maxResults * 2);
    }

    // Apply temporal decay if enabled
    if (this.config.temporalDecayEnabled) {
      results = applyTemporalDecay(results, this.config.temporalDecayHalfLifeDays);
    }

    // Filter by minimum score and limit
    return results
      .filter(r => r.score >= minScore)
      .slice(0, maxResults);
  }

  async index(docs: { path: string; content: string }[]): Promise<void> {
    for (const doc of docs) {
      const docChunks = chunkDocument(doc.content, doc.path, {
        chunkSize: this.config.chunkSize,
        chunkOverlap: this.config.chunkOverlap,
      });

      for (const chunk of docChunks) {
        const keywords = extractKeywords(chunk.content);
        let vector: number[] | undefined;

        if (this.embeddingProvider) {
          try {
            vector = await this.embeddingProvider.embedQuery(chunk.content);
          } catch {
            // Skip vector for this chunk on error
          }
        }

        this.chunks.push({ ...chunk, keywords, vector });
      }
    }
  }

  status(): { vectorAvailable: boolean; ftsAvailable: boolean; documentCount: number } {
    // Count unique paths as document count
    const uniquePaths = new Set(this.chunks.map(c => c.path));
    return {
      vectorAvailable: this.embeddingProvider !== null,
      ftsAvailable: true,
      documentCount: uniquePaths.size,
    };
  }

  private ftsSearch(queryKeywords: string[]): Array<{
    id: string; path: string; snippet: string; textScore: number;
    startLine: number; endLine: number; source: 'memory' | 'sessions';
  }> {
    const results: Array<{
      id: string; path: string; snippet: string; textScore: number;
      startLine: number; endLine: number; source: 'memory' | 'sessions';
    }> = [];

    for (const chunk of this.chunks) {
      // Score by keyword overlap
      let matchCount = 0;
      for (const kw of queryKeywords) {
        if (chunk.keywords.includes(kw) || chunk.content.toLowerCase().includes(kw)) {
          matchCount++;
        }
      }

      if (matchCount > 0) {
        const textScore = matchCount / queryKeywords.length;
        results.push({
          id: chunk.id,
          path: chunk.path,
          snippet: chunk.content.slice(0, 200),
          textScore,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          source: 'memory',
        });
      }
    }

    return results.sort((a, b) => b.textScore - a.textScore);
  }

  private vectorSearch(queryVec: number[]): Array<{
    id: string; path: string; snippet: string; vectorScore: number;
    startLine: number; endLine: number; source: 'memory' | 'sessions';
  }> {
    const results: Array<{
      id: string; path: string; snippet: string; vectorScore: number;
      startLine: number; endLine: number; source: 'memory' | 'sessions';
    }> = [];

    for (const chunk of this.chunks) {
      if (!chunk.vector) continue;
      const sim = cosineSim(queryVec, chunk.vector);
      if (sim > 0) {
        results.push({
          id: chunk.id,
          path: chunk.path,
          snippet: chunk.content.slice(0, 200),
          vectorScore: sim,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          source: 'memory',
        });
      }
    }

    return results.sort((a, b) => b.vectorScore - a.vectorScore);
  }
}

function cosineSim(a: number[], b: number[]): number {
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
