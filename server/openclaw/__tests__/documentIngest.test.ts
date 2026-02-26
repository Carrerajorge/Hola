import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDocumentIngestTool, createDocumentBatchIngestTool } from '../tools/documentIngestTool';

// Mock heavy dependencies
vi.mock('../../services/documentProcessing', () => ({
  processDocument: vi.fn().mockResolvedValue({ text: 'Extracted document content for testing purposes.' }),
}));

vi.mock('../../embeddingService', () => ({
  chunkText: vi.fn().mockImplementation((text: string) => {
    // Simple chunking: split into 100-char chunks
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += 100) {
      chunks.push(text.slice(i, i + 100));
    }
    return chunks.length > 0 ? chunks : [text];
  }),
  generateEmbeddingsBatch: vi.fn().mockImplementation((chunks: string[]) => {
    return Promise.resolve(chunks.map(() => new Array(384).fill(0.1)));
  }),
}));

// Use a real class so `new RAGService()` works with dynamic imports
vi.mock('../../services/ragService', () => {
  return {
    RAGService: class MockRAGService {
      indexChunk = vi.fn().mockResolvedValue(undefined);
    },
  };
});

vi.mock('../../lib/logger', () => ({
  Logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('OpenClaw Document Ingest Tool', () => {
  const mockContext = {
    userId: 'test-user',
    chatId: 'test-chat',
    runId: 'test-run',
  };

  describe('createDocumentIngestTool', () => {
    const tool = createDocumentIngestTool();

    it('has correct name and description', () => {
      expect(tool.name).toBe('openclaw_document_ingest');
      expect(tool.description).toContain('Ingest a document');
    });

    it('ingests raw text content', async () => {
      const result = await tool.execute(
        { source: 'text', value: 'This is a test document with enough content to be processed properly.' },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.output).toHaveProperty('fileName');
      expect(result.output).toHaveProperty('chunksCreated');
      expect(result.output).toHaveProperty('chunksStored');
      expect((result.output as any).textLength).toBeGreaterThan(0);
    });

    it('rejects empty text', async () => {
      const result = await tool.execute(
        { source: 'text', value: '' },
        mockContext,
      );

      // Empty text hits EMPTY_CONTENT check (length < 10)
      expect(result.success).toBe(false);
    });

    it('handles file source with missing file', async () => {
      const result = await tool.execute(
        { source: 'file', value: '/nonexistent/file.pdf' },
        mockContext,
      );

      expect(result.success).toBe(false);
      expect((result as any).error?.code).toBe('INGEST_ERROR');
    });

    it('supports optional tags and chatId', async () => {
      const result = await tool.execute(
        {
          source: 'text',
          value: 'Document with tags and metadata for proper categorization and retrieval.',
          tags: ['research', 'ai'],
          chatId: 'custom-chat',
          title: 'AI Research Notes',
        },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect((result.output as any).fileName).toBe('AI Research Notes');
      expect((result.output as any).tags).toEqual(['research', 'ai']);
    });
  });

  describe('createDocumentBatchIngestTool', () => {
    const batchTool = createDocumentBatchIngestTool();

    it('has correct name', () => {
      expect(batchTool.name).toBe('openclaw_document_batch_ingest');
    });

    it('reports results for batch of files', async () => {
      const result = await batchTool.execute(
        { files: ['/nonexistent/a.txt', '/nonexistent/b.txt'] },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect((result.output as any).total).toBe(2);
      // Both should fail since files don't exist
      expect((result.output as any).failed).toBe(2);
    });
  });
});
