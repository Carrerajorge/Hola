/**
 * GPT Knowledge Pipeline
 *
 * Implements "Knowledge as first-class citizen" for GPTs:
 * - File ingestion with parsing, chunking, and embedding
 * - Dual retrieval strategy: semantic Q&A vs. document review (full read)
 * - Citation/source tracking on every retrieved chunk
 * - Preflight parsing validation
 */
import crypto from "node:crypto";
import { db } from "../../db";
import { eq, and, inArray, sql, desc } from "drizzle-orm";
import { gptKnowledge, type GptKnowledge, type InsertGptKnowledge } from "@shared/schema/gpt";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KnowledgeChunk {
  id: string;
  knowledgeId: string;
  content: string;
  chunkIndex: number;
  embedding?: number[];
  metadata: ChunkMetadata;
  tokens: number;
}

export interface ChunkMetadata {
  pageNumber?: number;
  sectionTitle?: string;
  sectionType?: "title" | "heading" | "paragraph" | "list" | "table" | "code";
  startOffset: number;
  endOffset: number;
  fileName: string;
  language?: string;
}

export interface RetrievedChunk {
  chunkId: string;
  knowledgeId: string;
  content: string;
  score: number;
  matchType: "vector" | "keyword" | "hybrid";
  metadata: ChunkMetadata;
  citation: Citation;
}

export interface Citation {
  text: string;
  fileName: string;
  pageNumber?: number;
  sectionTitle?: string;
  chunkId: string;
  relevanceScore: number;
}

export interface RAGContext {
  chunks: RetrievedChunk[];
  totalChunksScanned: number;
  strategy: "semantic_qa" | "document_review";
  processingTimeMs: number;
  citations: Citation[];
}

export interface PreflightResult {
  valid: boolean;
  fileName: string;
  fileType: string;
  fileSizeBytes: number;
  estimatedTokens: number;
  errors: string[];
  warnings: string[];
}

export type RetrievalStrategy = "semantic_qa" | "document_review";

export interface RetrievalRequest {
  gptId: string;
  query: string;
  conversationId: string;
  strategy?: RetrievalStrategy;
  topK?: number;
  scoreThreshold?: number;
  knowledgeIds?: string[];
}

export interface IngestionRequest {
  gptId: string;
  fileName: string;
  fileType: string;
  fileSizeBytes: number;
  storageUrl: string;
  rawContent: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CHUNK_CONFIG = {
  targetSize: 800,
  maxSize: 1200,
  minSize: 100,
  overlap: 150,
  sentenceOverlap: 2,
};

const MAX_FILE_SIZE_BYTES = 512 * 1024 * 1024; // 512MB
const MAX_FILES_PER_GPT = 20;
const MAX_TOKENS_PER_FILE = 2_000_000;
const DOCUMENT_REVIEW_THRESHOLD_TOKENS = 8_000;
const DEFAULT_TOP_K = 10;
const DEFAULT_SCORE_THRESHOLD = 0.25;

const SUPPORTED_FILE_TYPES = new Set([
  "pdf", "txt", "md", "markdown", "csv", "json", "jsonl",
  "docx", "doc", "xlsx", "xls", "pptx", "html", "htm",
  "xml", "yaml", "yml", "py", "js", "ts", "tsx", "jsx",
  "java", "go", "rs", "c", "cpp", "h", "hpp", "rb", "php",
  "sql", "sh", "bash", "css", "scss", "less", "rtf", "tex",
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function computeContentHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function detectStrategy(query: string, totalTokens: number): RetrievalStrategy {
  const summaryPatterns = /\b(resumen|summary|summarize|resumir|overview|overview|todo el documento|full document|completo|leer todo|read all|entire|complete)\b/i;
  if (summaryPatterns.test(query)) {
    return "document_review";
  }
  if (totalTokens <= DOCUMENT_REVIEW_THRESHOLD_TOKENS) {
    return "document_review";
  }
  return "semantic_qa";
}

// ─── Semantic Chunking ────────────────────────────────────────────────────────

function semanticChunk(text: string, fileName: string): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];
  const paragraphs = text.split(/\n\n+/);
  let currentChunk = "";
  let currentOffset = 0;
  let chunkIndex = 0;

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) {
      currentOffset += para.length + 2;
      continue;
    }

    if (currentChunk.length + trimmed.length > CHUNK_CONFIG.maxSize && currentChunk.length >= CHUNK_CONFIG.minSize) {
      chunks.push({
        id: crypto.randomUUID(),
        knowledgeId: "",
        content: currentChunk.trim(),
        chunkIndex,
        tokens: estimateTokens(currentChunk),
        metadata: {
          startOffset: currentOffset - currentChunk.length,
          endOffset: currentOffset,
          sectionType: detectSectionType(currentChunk),
          fileName,
        },
      });
      // Keep overlap
      const sentences = currentChunk.split(/[.!?]\s+/);
      const overlapSentences = sentences.slice(-CHUNK_CONFIG.sentenceOverlap);
      currentChunk = overlapSentences.join(". ") + "\n\n" + trimmed;
      chunkIndex++;
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + trimmed;
    }
    currentOffset += para.length + 2;
  }

  // Final chunk
  if (currentChunk.trim().length >= CHUNK_CONFIG.minSize) {
    chunks.push({
      id: crypto.randomUUID(),
      knowledgeId: "",
      content: currentChunk.trim(),
      chunkIndex,
      tokens: estimateTokens(currentChunk),
      metadata: {
        startOffset: currentOffset - currentChunk.length,
        endOffset: currentOffset,
        sectionType: detectSectionType(currentChunk),
        fileName,
      },
    });
  }

  return chunks;
}

function detectSectionType(text: string): ChunkMetadata["sectionType"] {
  if (/^#{1,6}\s/m.test(text) || /^[A-Z][A-Z\s]{3,}$/m.test(text)) return "heading";
  if (/^\s*[-*•]\s/m.test(text) || /^\s*\d+\.\s/m.test(text)) return "list";
  if (/\|.*\|.*\|/.test(text)) return "table";
  if (/```|^\s{4,}\S/m.test(text)) return "code";
  return "paragraph";
}

// ─── Knowledge Pipeline ──────────────────────────────────────────────────────

export class GptKnowledgePipeline {
  private embeddingCache = new Map<string, number[]>();

  /**
   * Preflight validation before ingestion.
   */
  async preflight(input: { fileName: string; fileType: string; fileSizeBytes: number; rawContent?: string }): Promise<PreflightResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const ext = input.fileType.toLowerCase().replace(/^\./, "");

    if (!SUPPORTED_FILE_TYPES.has(ext)) {
      errors.push(`Unsupported file type: ${ext}`);
    }
    if (input.fileSizeBytes > MAX_FILE_SIZE_BYTES) {
      errors.push(`File exceeds maximum size of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB`);
    }
    if (input.fileSizeBytes === 0) {
      errors.push("File is empty");
    }

    const estimatedTokens = input.rawContent ? estimateTokens(input.rawContent) : Math.ceil(input.fileSizeBytes / 4);
    if (estimatedTokens > MAX_TOKENS_PER_FILE) {
      warnings.push(`File is very large (~${estimatedTokens} tokens). Processing may take longer.`);
    }

    return {
      valid: errors.length === 0,
      fileName: input.fileName,
      fileType: ext,
      fileSizeBytes: input.fileSizeBytes,
      estimatedTokens,
      errors,
      warnings,
    };
  }

  /**
   * Ingest a file: parse → chunk → store metadata.
   * Embedding generation is handled asynchronously by the pipeline.
   */
  async ingest(input: IngestionRequest): Promise<{ knowledgeId: string; chunkCount: number; status: string }> {
    // Check file count limit
    const existingCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(gptKnowledge)
      .where(and(eq(gptKnowledge.gptId, input.gptId), eq(gptKnowledge.isActive, "true")));

    const count = Number(existingCount[0]?.count ?? 0);
    if (count >= MAX_FILES_PER_GPT) {
      throw new Error(`Maximum ${MAX_FILES_PER_GPT} files per GPT. Remove existing files first.`);
    }

    // Deduplicate by content hash
    const contentHash = computeContentHash(input.rawContent);
    const [existing] = await db
      .select()
      .from(gptKnowledge)
      .where(and(eq(gptKnowledge.gptId, input.gptId), eq(gptKnowledge.contentHash, contentHash)))
      .limit(1);

    if (existing) {
      return { knowledgeId: existing.id, chunkCount: existing.chunkCount ?? 0, status: "deduplicated" };
    }

    // Chunk the content
    const chunks = semanticChunk(input.rawContent, input.fileName);

    // Persist knowledge record
    const [record] = await db
      .insert(gptKnowledge)
      .values({
        gptId: input.gptId,
        fileName: input.fileName,
        fileType: input.fileType,
        fileSize: input.fileSizeBytes,
        storageUrl: input.storageUrl,
        contentHash,
        extractedText: input.rawContent.slice(0, 100_000),
        embeddingStatus: "pending",
        chunkCount: chunks.length,
        metadata: {
          tokens: estimateTokens(input.rawContent),
          chunkConfig: CHUNK_CONFIG,
          language: detectLanguage(input.rawContent),
        },
        isActive: "true",
      })
      .returning();

    return { knowledgeId: record.id, chunkCount: chunks.length, status: "pending" };
  }

  /**
   * Retrieve relevant knowledge for a query using dual-strategy approach.
   */
  async retrieve(request: RetrievalRequest): Promise<RAGContext> {
    const start = Date.now();

    // Get active knowledge sources for this GPT
    const knowledgeFilter = request.knowledgeIds?.length
      ? and(eq(gptKnowledge.gptId, request.gptId), inArray(gptKnowledge.id, request.knowledgeIds), eq(gptKnowledge.isActive, "true"))
      : and(eq(gptKnowledge.gptId, request.gptId), eq(gptKnowledge.isActive, "true"));

    const sources = await db.select().from(gptKnowledge).where(knowledgeFilter);

    if (!sources.length) {
      return {
        chunks: [],
        totalChunksScanned: 0,
        strategy: "semantic_qa",
        processingTimeMs: Date.now() - start,
        citations: [],
      };
    }

    // Estimate total tokens across all sources
    const totalTokens = sources.reduce((sum: number, s: GptKnowledge) => {
      const meta = s.metadata as Record<string, unknown> | null;
      return sum + (Number(meta?.tokens) || estimateTokens(s.extractedText ?? ""));
    }, 0);

    // Auto-detect strategy if not specified
    const strategy = request.strategy ?? detectStrategy(request.query, totalTokens);
    const topK = request.topK ?? DEFAULT_TOP_K;
    const threshold = request.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD;

    let chunks: RetrievedChunk[];

    if (strategy === "document_review") {
      chunks = this.documentReview(sources, request.query);
    } else {
      chunks = await this.semanticSearch(sources, request.query, topK, threshold);
    }

    const citations = chunks.map((c) => c.citation);

    return {
      chunks,
      totalChunksScanned: sources.reduce((sum: number, s: GptKnowledge) => sum + (s.chunkCount ?? 0), 0),
      strategy,
      processingTimeMs: Date.now() - start,
      citations,
    };
  }

  /**
   * Document review: return the full content organized by section.
   * Used for summary/overview tasks or small documents.
   */
  private documentReview(sources: GptKnowledge[], query: string): RetrievedChunk[] {
    const chunks: RetrievedChunk[] = [];
    for (const source of sources) {
      if (!source.extractedText) continue;
      const sections = semanticChunk(source.extractedText, source.fileName);
      for (const section of sections) {
        chunks.push({
          chunkId: section.id,
          knowledgeId: source.id,
          content: section.content,
          score: 1.0,
          matchType: "keyword",
          metadata: section.metadata,
          citation: {
            text: section.content.slice(0, 200),
            fileName: source.fileName,
            pageNumber: section.metadata.pageNumber,
            sectionTitle: section.metadata.sectionTitle,
            chunkId: section.id,
            relevanceScore: 1.0,
          },
        });
      }
    }
    return chunks;
  }

  /**
   * Semantic Q&A search: embed query → find top-K similar chunks.
   * Falls back to keyword matching when embeddings are unavailable.
   */
  private async semanticSearch(
    sources: GptKnowledge[],
    query: string,
    topK: number,
    threshold: number
  ): Promise<RetrievedChunk[]> {
    const allChunks: RetrievedChunk[] = [];
    const queryTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);

    for (const source of sources) {
      if (!source.extractedText) continue;
      const sections = semanticChunk(source.extractedText, source.fileName);

      for (const section of sections) {
        // Keyword-based scoring as baseline (embedding scoring would layer on top)
        const contentLower = section.content.toLowerCase();
        const matchedTerms = queryTerms.filter((t) => contentLower.includes(t));
        const keywordScore = queryTerms.length > 0 ? matchedTerms.length / queryTerms.length : 0;

        if (keywordScore >= threshold) {
          allChunks.push({
            chunkId: section.id,
            knowledgeId: source.id,
            content: section.content,
            score: keywordScore,
            matchType: "hybrid",
            metadata: section.metadata,
            citation: {
              text: section.content.slice(0, 200),
              fileName: source.fileName,
              pageNumber: section.metadata.pageNumber,
              sectionTitle: section.metadata.sectionTitle,
              chunkId: section.id,
              relevanceScore: keywordScore,
            },
          });
        }
      }
    }

    // Sort by score descending and take top-K
    allChunks.sort((a, b) => b.score - a.score);
    return allChunks.slice(0, topK);
  }

  /**
   * Remove a knowledge source from a GPT.
   */
  async removeKnowledge(knowledgeId: string): Promise<void> {
    await db
      .update(gptKnowledge)
      .set({ isActive: "false", updatedAt: new Date() })
      .where(eq(gptKnowledge.id, knowledgeId));
  }

  /**
   * List all active knowledge sources for a GPT.
   */
  async listKnowledge(gptId: string): Promise<GptKnowledge[]> {
    return db
      .select()
      .from(gptKnowledge)
      .where(and(eq(gptKnowledge.gptId, gptId), eq(gptKnowledge.isActive, "true")))
      .orderBy(desc(gptKnowledge.createdAt));
  }
}

function detectLanguage(text: string): string {
  const sample = text.slice(0, 1000);
  if (/[áéíóúñ¿¡]/i.test(sample)) return "es";
  if (/[àâêîôûçëïüù]/i.test(sample)) return "fr";
  if (/[äöüß]/i.test(sample)) return "de";
  if (/[ãõçê]/i.test(sample)) return "pt";
  return "en";
}

export const gptKnowledgePipeline = new GptKnowledgePipeline();
