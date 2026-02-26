import { z } from 'zod';
import path from 'path';
import fs from 'fs/promises';
import type { ToolContext, ToolDefinition, ToolResult } from '../../agent/toolRegistry';
import { Logger } from '../../lib/logger';

/**
 * OpenClaw Document Ingest Tool
 *
 * Allows agents to programmatically ingest documents into the RAG pipeline.
 * Supports: local file paths, raw text content, and URL imports.
 * Pipeline: read → parse → chunk → embed → store (vector DB).
 */

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const SUPPORTED_EXTENSIONS = new Set([
  '.pdf', '.docx', '.doc', '.txt', '.md', '.csv', '.xlsx', '.xls',
  '.json', '.html', '.htm', '.rtf', '.pptx', '.ppt', '.odt',
]);

function ok(output: unknown): ToolResult {
  return { success: true, output };
}

function fail(code: string, message: string, retryable = false): ToolResult {
  return { success: false, output: null, error: { code, message, retryable } };
}

async function readFileBuffer(filePath: string): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
  const resolved = path.resolve(filePath);
  const stat = await fs.stat(resolved);
  if (stat.size > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${stat.size} bytes (max ${MAX_FILE_SIZE})`);
  }

  const ext = path.extname(resolved).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported file extension: ${ext}. Supported: ${[...SUPPORTED_EXTENSIONS].join(', ')}`);
  }

  const buffer = await fs.readFile(resolved);
  const fileName = path.basename(resolved);

  const mimeMap: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.csv': 'text/csv',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.json': 'application/json',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.rtf': 'application/rtf',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.odt': 'application/vnd.oasis.opendocument.text',
  };

  return { buffer, fileName, mimeType: mimeMap[ext] || 'application/octet-stream' };
}

export function createDocumentIngestTool(): ToolDefinition {
  return {
    name: 'openclaw_document_ingest',
    description:
      'Ingest a document into the RAG knowledge base. Accepts a local file path, raw text content, or a URL. ' +
      'The document is parsed, chunked, embedded, and stored for semantic search retrieval.',
    inputSchema: z.object({
      source: z.enum(['file', 'text', 'url']).describe('Source type: file path, raw text, or URL'),
      value: z.string().min(1).describe('File path, text content, or URL depending on source'),
      title: z.string().optional().describe('Optional title/label for the document'),
      chatId: z.string().optional().describe('Optional chat ID to associate the document with'),
      tags: z.array(z.string()).optional().describe('Optional tags for categorization'),
    }),
    capabilities: ['reads_files', 'accesses_external_api', 'long_running'],
    execute: async (input: any, context: ToolContext): Promise<ToolResult> => {
      const { source, value, title, chatId, tags } = input;

      try {
        // Lazy-import heavy dependencies so they don't slow down tool registration
        const { processDocument } = await import('../../services/documentProcessing');
        const { chunkText, generateEmbeddingsBatch } = await import('../../embeddingService');

        let rawText = '';
        let fileName = title || 'untitled';

        // ── Stage 1: Acquire content ──────────────────────────────────────
        if (source === 'file') {
          const { buffer, fileName: fName, mimeType } = await readFileBuffer(value);
          fileName = title || fName;
          const processed = await processDocument(buffer, mimeType, fName);
          rawText = processed.text || processed.content || '';
        } else if (source === 'text') {
          rawText = value;
          fileName = title || `text-${Date.now()}`;
        } else if (source === 'url') {
          // Download URL and extract text
          const resp = await fetch(value, {
            signal: AbortSignal.timeout(15_000),
            headers: { 'User-Agent': 'IliaGPT-OpenClaw/1.0' },
          });
          if (!resp.ok) {
            return fail('URL_FETCH_FAILED', `HTTP ${resp.status}: ${resp.statusText}`, true);
          }
          const contentType = resp.headers.get('content-type') || '';
          if (contentType.includes('text/html') || contentType.includes('text/plain')) {
            rawText = await resp.text();
            // Basic HTML → text
            rawText = rawText.replace(/<script[\s\S]*?<\/script>/gi, '')
              .replace(/<style[\s\S]*?<\/style>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
          } else {
            // Binary document (PDF, DOCX, etc.)
            const buffer = Buffer.from(await resp.arrayBuffer());
            const urlFileName = path.basename(new URL(value).pathname) || 'download';
            const processed = await processDocument(buffer, undefined, urlFileName);
            rawText = processed.text || processed.content || '';
          }
          fileName = title || new URL(value).hostname;
        }

        if (!rawText || rawText.length < 10) {
          return fail('EMPTY_CONTENT', 'Document contained no extractable text', false);
        }

        // ── Stage 2: Chunk ────────────────────────────────────────────────
        const textChunks = chunkText(rawText, 1000, 200);
        if (textChunks.length === 0) {
          return fail('NO_CHUNKS', 'Text too short to produce meaningful chunks', false);
        }
        // Extract plain strings from TextChunk objects for embedding
        const chunks = textChunks.map(tc => tc.content);

        // ── Stage 3: Embed ────────────────────────────────────────────────
        const embeddings = await generateEmbeddingsBatch(chunks);

        // ── Stage 4: Store (via RAG service) ──────────────────────────────
        const { RAGService } = await import('../../services/ragService');
        const ragService = new RAGService();

        let storedCount = 0;
        for (let i = 0; i < chunks.length; i++) {
          try {
            await ragService.indexChunk(context.userId, {
              content: chunks[i],
              embedding: embeddings[i],
              metadata: {
                fileName,
                chunkIndex: i,
                totalChunks: chunks.length,
                chatId: chatId || context.chatId,
                tags: tags || [],
                ingestedAt: new Date().toISOString(),
                source,
              },
            });
            storedCount++;
          } catch (err) {
            Logger.warn(`[OpenClaw:DocumentIngest] Failed to store chunk ${i}: ${(err as Error).message}`);
          }
        }

        Logger.info(
          `[OpenClaw:DocumentIngest] Ingested "${fileName}": ${rawText.length} chars → ${chunks.length} chunks → ${storedCount} stored`,
        );

        return ok({
          fileName,
          source,
          textLength: rawText.length,
          chunksCreated: chunks.length,
          chunksStored: storedCount,
          tags: tags || [],
        });
      } catch (error: any) {
        Logger.error(`[OpenClaw:DocumentIngest] Error: ${error.message}`);
        return fail('INGEST_ERROR', error.message || 'Document ingestion failed', true);
      }
    },
  };
}

/**
 * Batch ingest multiple documents at once.
 */
export function createDocumentBatchIngestTool(): ToolDefinition {
  return {
    name: 'openclaw_document_batch_ingest',
    description:
      'Batch-ingest multiple documents into the RAG knowledge base. ' +
      'Accepts an array of file paths. Each file is processed in parallel.',
    inputSchema: z.object({
      files: z.array(z.string().min(1)).min(1).max(20).describe('Array of file paths to ingest'),
      chatId: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }),
    capabilities: ['reads_files', 'accesses_external_api', 'long_running'],
    execute: async (input: any, context: ToolContext): Promise<ToolResult> => {
      const { files, chatId, tags } = input;
      const ingestTool = createDocumentIngestTool();

      const results = await Promise.allSettled(
        files.map((filePath: string) =>
          ingestTool.execute(
            { source: 'file', value: filePath, chatId, tags },
            context,
          ),
        ),
      );

      const summary = results.map((r, i) => ({
        file: files[i],
        status: r.status === 'fulfilled' && (r.value as ToolResult).success ? 'ok' : 'failed',
        detail:
          r.status === 'fulfilled'
            ? (r.value as ToolResult).output
            : (r as PromiseRejectedResult).reason?.message,
      }));

      const successCount = summary.filter(s => s.status === 'ok').length;

      return ok({
        total: files.length,
        succeeded: successCount,
        failed: files.length - successCount,
        results: summary,
      });
    },
  };
}
