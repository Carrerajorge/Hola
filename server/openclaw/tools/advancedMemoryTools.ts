/**
 * Advanced Memory tools — search, index, stats.
 * Registers 3 new tools for the hybrid vector+FTS memory system.
 */

import { z } from 'zod';
import type { ToolDefinition } from '../../agent/toolRegistry';

export function createAdvancedMemoryTools(): ToolDefinition[] {
  return [
    {
      name: 'openclaw_memory_search_advanced',
      description:
        'Search the advanced memory index using hybrid vector+keyword matching with MMR diversity and temporal decay. ' +
        'Returns ranked results with score breakdowns.',
      inputSchema: z.object({
        query: z.string().min(1).describe('Natural language search query'),
        maxResults: z.number().int().min(1).max(100).optional().default(10).describe('Max results to return'),
        minScore: z.number().min(0).max(1).optional().default(0.1).describe('Minimum score threshold'),
        sources: z.array(z.enum(['memory', 'sessions', 'documents', 'chat'])).optional().describe('Filter by memory source types'),
        vectorWeight: z.number().min(0).max(1).optional().describe('Weight for vector similarity (0-1, default: 0.7)'),
        textWeight: z.number().min(0).max(1).optional().describe('Weight for text/keyword match (0-1, default: 0.3)'),
        enableMMR: z.boolean().optional().default(true).describe('Enable MMR diversity re-ranking'),
        enableTemporalDecay: z.boolean().optional().default(true).describe('Enable temporal decay scoring'),
      }),
      execute: async (params: any) => {
        const { getAdvancedMemoryService } = await import('../memory/index');
        const service = getAdvancedMemoryService();
        if (!service) {
          return { error: 'Advanced memory module is not enabled' };
        }

        const results = await service.search(params.query, {
          maxResults: params.maxResults,
          minScore: params.minScore,
          sources: params.sources,
          vectorWeight: params.vectorWeight,
          textWeight: params.textWeight,
          enableMMR: params.enableMMR,
          enableTemporalDecay: params.enableTemporalDecay,
        });

        return {
          query: params.query,
          resultCount: results.length,
          results: results.map((r: any) => ({
            path: r.path,
            startLine: r.startLine,
            endLine: r.endLine,
            score: Math.round(r.score * 1000) / 1000,
            snippet: r.snippet,
            source: r.source,
            scoreBreakdown: r.scoreBreakdown,
          })),
        };
      },
    },
    {
      name: 'openclaw_memory_index_document',
      description:
        'Index a document into the advanced memory system. Chunks the content, generates embeddings, ' +
        'and stores for hybrid search. Uses change detection to skip unchanged chunks.',
      inputSchema: z.object({
        filePath: z.string().min(1).describe('Path of the document (used as identifier)'),
        content: z.string().min(1).describe('Full text content to index'),
        source: z.enum(['memory', 'sessions', 'documents', 'chat']).describe('Source type for this content'),
      }),
      execute: async (params: any) => {
        const { getAdvancedMemoryService } = await import('../memory/index');
        const service = getAdvancedMemoryService();
        if (!service) {
          return { error: 'Advanced memory module is not enabled' };
        }

        const result = await service.indexDocument({
          filePath: params.filePath,
          content: params.content,
          source: params.source,
        });

        return {
          filePath: params.filePath,
          source: params.source,
          ...result,
        };
      },
    },
    {
      name: 'openclaw_memory_stats',
      description: 'Get statistics about the advanced memory index — chunk count, file count, embedding coverage, source breakdown.',
      inputSchema: z.object({}),
      execute: async () => {
        const { getAdvancedMemoryService } = await import('../memory/index');
        const service = getAdvancedMemoryService();
        if (!service) {
          return { error: 'Advanced memory module is not enabled' };
        }

        return service.getStats();
      },
    },
  ];
}
