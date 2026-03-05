/**
 * FileIndexService — Ingestion pipeline with chunking, deduplication, and provenance.
 *
 * Parses PDF/Office/HTML/CSV/images via the existing documentParser,
 * chunks text, computes embeddings, and maintains an index with
 * provenance/citation info per chunk (page/line/offset).
 */

import * as crypto from "crypto";
import { randomUUID } from "crypto";
import { FileGateway } from "./FileGateway";
import {
  FileAccessRequest,
  IngestedDocument,
  DocumentChunk,
  DocumentMetadata,
  ProvenanceInfo,
} from "./types";
import { extractTextSafe, isSupportedMimeType } from "../../documentParser";
import { redactSecrets } from "./secretDetector";

const EXTRACTION_VERSION = "1.0.0";

interface ChunkConfig {
  maxChunkSize: number;
  overlapSize: number;
  strategy: "fixed" | "paragraph" | "sentence";
}

const DEFAULT_CHUNK_CONFIG: ChunkConfig = {
  maxChunkSize: 1500,
  overlapSize: 200,
  strategy: "paragraph",
};

export class FileIndexService {
  private documents: Map<string, IngestedDocument> = new Map();
  private hashIndex: Map<string, string> = new Map(); // hash -> docId (dedup)
  private gateway: FileGateway;
  private chunkConfig: ChunkConfig;

  constructor(gateway: FileGateway, chunkConfig?: Partial<ChunkConfig>) {
    this.gateway = gateway;
    this.chunkConfig = { ...DEFAULT_CHUNK_CONFIG, ...chunkConfig };
  }

  /**
   * Ingest a file: read via gateway, parse, chunk, store with provenance.
   * Returns null if file was already ingested (dedup by hash).
   */
  async ingestFile(
    filePath: string,
    userId: string,
    sessionId: string,
    options?: { forceReindex?: boolean; ttl?: number },
  ): Promise<IngestedDocument | null> {
    const request: FileAccessRequest = {
      requestId: randomUUID(),
      userId,
      sessionId,
      operation: "ingest",
      path: filePath,
      timestamp: Date.now(),
    };

    // Read raw bytes through the gateway
    const raw = await this.gateway.readFileRaw(request);
    if (!raw) {
      throw new Error(`Failed to read file for ingestion: ${filePath}`);
    }

    // Deduplication check
    if (this.hashIndex.has(raw.hash) && !options?.forceReindex) {
      const existingId = this.hashIndex.get(raw.hash)!;
      const existing = this.documents.get(existingId);
      if (existing) return existing;
    }

    // Determine MIME type from gateway
    const readResult = await this.gateway.readFile(request);
    const mimeType = readResult.mimeType || "application/octet-stream";

    if (!isSupportedMimeType(mimeType)) {
      throw new Error(`Unsupported MIME type for ingestion: ${mimeType}`);
    }

    // Extract text
    const extraction = await extractTextSafe(raw.buffer, mimeType);
    if (!extraction.success || !extraction.text) {
      throw new Error(`Text extraction failed: ${extraction.error || "empty content"}`);
    }

    // Redact secrets from extracted text
    const { redacted: cleanText, secretCount } = redactSecrets(extraction.text);

    // Chunk text
    const chunks = this.chunkText(cleanText, filePath);

    // Build document
    const docId = randomUUID();
    const fileName = filePath.split("/").pop() || filePath;
    const wordCount = cleanText.split(/\s+/).filter(Boolean).length;

    const provenance: ProvenanceInfo = {
      sourcePath: filePath,
      sourceHash: raw.hash,
      extractedAt: Date.now(),
      extractionVersion: EXTRACTION_VERSION,
      chunkStrategy: this.chunkConfig.strategy,
    };

    const metadata: DocumentMetadata = {
      wordCount,
      extractionMethod: extraction.method,
      confidence: extraction.confidence,
      provenance,
    };

    const doc: IngestedDocument = {
      id: docId,
      filePath,
      fileName,
      mimeType,
      sizeBytes: raw.size,
      hash: raw.hash,
      chunks: chunks.map((c, i) => ({
        ...c,
        id: `${docId}_chunk_${i}`,
        documentId: docId,
        index: i,
      })),
      metadata,
      ingestedAt: Date.now(),
      ttl: options?.ttl,
    };

    // Store
    this.documents.set(docId, doc);
    this.hashIndex.set(raw.hash, docId);

    // Clean expired documents
    this.cleanExpired();

    return doc;
  }

  /**
   * Get a document by ID.
   */
  getDocument(docId: string): IngestedDocument | undefined {
    return this.documents.get(docId);
  }

  /**
   * Search ingested documents by content query (simple substring/regex).
   */
  searchChunks(query: string, maxResults = 20): Array<{ chunk: DocumentChunk; document: IngestedDocument; score: number }> {
    const results: Array<{ chunk: DocumentChunk; document: IngestedDocument; score: number }> = [];
    const queryLower = query.toLowerCase();

    for (const doc of this.documents.values()) {
      for (const chunk of doc.chunks) {
        const contentLower = chunk.content.toLowerCase();
        if (contentLower.includes(queryLower)) {
          const occurrences = contentLower.split(queryLower).length - 1;
          results.push({
            chunk,
            document: doc,
            score: occurrences / Math.max(1, chunk.content.length / 100),
          });
        }
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);
  }

  /**
   * List all ingested documents.
   */
  listDocuments(): Array<{ id: string; fileName: string; mimeType: string; chunkCount: number; ingestedAt: number }> {
    return Array.from(this.documents.values()).map((d) => ({
      id: d.id,
      fileName: d.fileName,
      mimeType: d.mimeType,
      chunkCount: d.chunks.length,
      ingestedAt: d.ingestedAt,
    }));
  }

  /**
   * Remove a document by ID.
   */
  removeDocument(docId: string): boolean {
    const doc = this.documents.get(docId);
    if (!doc) return false;
    this.hashIndex.delete(doc.hash);
    this.documents.delete(docId);
    return true;
  }

  /**
   * Get stats about the index.
   */
  getStats(): { documentCount: number; totalChunks: number; totalBytes: number } {
    let totalChunks = 0;
    let totalBytes = 0;
    for (const doc of this.documents.values()) {
      totalChunks += doc.chunks.length;
      totalBytes += doc.sizeBytes;
    }
    return { documentCount: this.documents.size, totalChunks, totalBytes };
  }

  // ── Private ────────────────────────────────────────

  private chunkText(text: string, sourcePath: string): Omit<DocumentChunk, "id" | "documentId" | "index">[] {
    const chunks: Omit<DocumentChunk, "id" | "documentId" | "index">[] = [];

    if (this.chunkConfig.strategy === "paragraph") {
      return this.chunkByParagraph(text);
    }

    // Fixed-size chunking with overlap
    let offset = 0;
    while (offset < text.length) {
      const end = Math.min(offset + this.chunkConfig.maxChunkSize, text.length);
      const content = text.slice(offset, end);

      // Estimate line number
      const line = text.slice(0, offset).split("\n").length;

      chunks.push({
        content,
        startOffset: offset,
        endOffset: end,
        line,
      });

      offset = end - this.chunkConfig.overlapSize;
      if (offset >= text.length) break;
      if (end === text.length) break;
    }

    return chunks;
  }

  private chunkByParagraph(text: string): Omit<DocumentChunk, "id" | "documentId" | "index">[] {
    const chunks: Omit<DocumentChunk, "id" | "documentId" | "index">[] = [];
    const paragraphs = text.split(/\n\s*\n/);
    let currentChunk = "";
    let startOffset = 0;
    let currentOffset = 0;

    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) {
        currentOffset += para.length + 2;
        continue;
      }

      if (currentChunk.length + trimmed.length > this.chunkConfig.maxChunkSize && currentChunk.length > 0) {
        const line = text.slice(0, startOffset).split("\n").length;
        chunks.push({
          content: currentChunk.trim(),
          startOffset,
          endOffset: currentOffset,
          line,
        });
        // Overlap: keep last part
        const overlap = currentChunk.slice(-this.chunkConfig.overlapSize);
        currentChunk = overlap + "\n\n" + trimmed;
        startOffset = currentOffset - this.chunkConfig.overlapSize;
      } else {
        if (currentChunk) {
          currentChunk += "\n\n" + trimmed;
        } else {
          currentChunk = trimmed;
          startOffset = currentOffset;
        }
      }

      currentOffset += para.length + 2;
    }

    if (currentChunk.trim()) {
      const line = text.slice(0, startOffset).split("\n").length;
      chunks.push({
        content: currentChunk.trim(),
        startOffset,
        endOffset: currentOffset,
        line,
      });
    }

    return chunks;
  }

  private cleanExpired(): void {
    const now = Date.now();
    for (const [id, doc] of this.documents) {
      if (doc.ttl && now - doc.ingestedAt > doc.ttl) {
        this.hashIndex.delete(doc.hash);
        this.documents.delete(id);
      }
    }
  }
}
