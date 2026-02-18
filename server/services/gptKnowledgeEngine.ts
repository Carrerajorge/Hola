/**
 * GPT Knowledge Engine — Dual-Route RAG
 *
 * Implements ChatGPT-style knowledge processing with two retrieval strategies:
 *
 * 1. **Q&A Route (semantic search)**: For questions about specific facts or topics.
 *    Uses embeddings + vector similarity to find relevant chunks.
 *
 * 2. **Document Review Route**: For summarization, analysis, or full-document tasks.
 *    Reads larger sections or entire documents rather than isolated chunks.
 *
 * Also includes:
 *  - Preflight parsing pipeline (normalize input before chunking)
 *  - Citation extraction and attachment to messages
 *  - Ingestion pipeline: parse → chunk → embed → index
 */

import crypto from "node:crypto";
import { db } from "../db";
import { eq, and, inArray, desc, sql } from "drizzle-orm";
import { gptKnowledge, type GptKnowledge } from "@shared/schema/gpt";
import {
  gptKnowledgeChunks,
  type InsertGptKnowledgeChunk,
  type GptKnowledgeChunk,
} from "@shared/schema/gptProduct";
import { createLogger } from "../lib/structuredLogger";

const logger = createLogger("gpt-knowledge-engine");

// ─── Configuration ────────────────────────────────────────────────────────────

const CHUNK_CONFIG = {
  targetSize: 800,
  maxSize: 1200,
  minSize: 100,
  overlap: 150,
  sentenceOverlap: 2,
};

const RETRIEVAL_CONFIG = {
  maxChunksQA: 10,
  maxChunksReview: 30,
  minScoreQA: 0.3,
  minScoreReview: 0.1,
  maxFileSize: 512 * 1024 * 1024, // 512MB
  maxFilesPerGpt: 20,
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type RetrievalMode = "qa" | "review" | "auto";

export interface RetrievalQuery {
  query: string;
  gptId: string;
  knowledgeIds?: string[];
  mode?: RetrievalMode;
  maxChunks?: number;
  minScore?: number;
}

export interface RetrievedSnippet {
  content: string;
  source: string;
  pageNumber?: number;
  sectionTitle?: string;
  score: number;
  chunkId: string;
  matchType: "vector" | "keyword" | "hybrid";
}

export interface Citation {
  text: string;
  source: string;
  pageNumber?: number;
  chunkId: string;
  relevanceScore: number;
}

export interface IngestionResult {
  knowledgeId: string;
  fileName: string;
  totalChunks: number;
  totalTokens: number;
  status: "completed" | "failed";
  error?: string;
  durationMs: number;
}

export interface PreflightResult {
  normalizedText: string;
  language: string;
  wordCount: number;
  hasStructuredData: boolean;
  detectedFormat: "prose" | "tabular" | "code" | "mixed";
  warnings: string[];
}

// ─── Preflight Parsing ───────────────────────────────────────────────────────

/**
 * Normalizes raw document text before chunking to ensure consistent input.
 * Handles encoding issues, whitespace normalization, control chars, etc.
 */
export function preflightParse(rawText: string): PreflightResult {
  const warnings: string[] = [];

  // Normalize Unicode
  let text = rawText.normalize("NFKC");

  // Remove control characters (keep newlines and tabs)
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "");

  // Normalize line endings
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Collapse excessive whitespace (preserve paragraph breaks)
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{4,}/g, "\n\n\n");

  // Trim each line
  text = text
    .split("\n")
    .map((line) => line.trim())
    .join("\n");

  // Detect language (basic heuristic)
  const spanishIndicators = /\b(el|la|los|las|de|en|que|es|por|con|para|del|una|un)\b/gi;
  const englishIndicators = /\b(the|is|are|was|were|have|has|had|this|that|with|for)\b/gi;
  const spanishCount = (text.match(spanishIndicators) || []).length;
  const englishCount = (text.match(englishIndicators) || []).length;
  const language = spanishCount > englishCount * 1.5 ? "es" : "en";

  // Detect format
  const tablePattern = /\|.*\|.*\|/g;
  const codePattern = /```[\s\S]*?```|^\s{4,}\S/gm;
  const tableMatches = (text.match(tablePattern) || []).length;
  const codeMatches = (text.match(codePattern) || []).length;
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  let detectedFormat: PreflightResult["detectedFormat"] = "prose";
  if (tableMatches > 5 && codeMatches > 5) {
    detectedFormat = "mixed";
  } else if (tableMatches > 5) {
    detectedFormat = "tabular";
  } else if (codeMatches > 5) {
    detectedFormat = "code";
  }

  if (wordCount < 10) {
    warnings.push("Very short document — may not produce useful embeddings");
  }

  return {
    normalizedText: text.trim(),
    language,
    wordCount,
    hasStructuredData: tableMatches > 0 || codeMatches > 0,
    detectedFormat,
    warnings,
  };
}

// ─── Semantic Chunking ───────────────────────────────────────────────────────

export interface SemanticChunk {
  content: string;
  index: number;
  tokenEstimate: number;
  pageNumber?: number;
  sectionTitle?: string;
  sectionType: "heading" | "paragraph" | "list" | "table" | "code" | "title";
}

/**
 * Splits normalized text into semantic chunks with overlap.
 * Respects paragraph boundaries and section headers.
 */
export function semanticChunk(text: string): SemanticChunk[] {
  const chunks: SemanticChunk[] = [];
  const paragraphs = text.split(/\n\n+/);

  let currentContent = "";
  let chunkIndex = 0;
  let currentSectionTitle: string | undefined;
  let currentPageNumber = 1;

  const detectSectionType = (
    t: string
  ): SemanticChunk["sectionType"] => {
    if (/^#{1,6}\s/.test(t) || /^[A-Z][A-Z\s]{3,}$/.test(t)) return "heading";
    if (/^\s*[-*•]\s/m.test(t) || /^\s*\d+\.\s/m.test(t)) return "list";
    if (/\|.*\|.*\|/.test(t)) return "table";
    if (/```/.test(t) || /^\s{4,}\S/m.test(t)) return "code";
    return "paragraph";
  };

  const flushChunk = (sectionType: SemanticChunk["sectionType"]) => {
    const trimmed = currentContent.trim();
    if (trimmed.length < CHUNK_CONFIG.minSize) return;

    chunks.push({
      content: trimmed,
      index: chunkIndex++,
      tokenEstimate: Math.ceil(trimmed.length / 4),
      pageNumber: currentPageNumber,
      sectionTitle: currentSectionTitle,
      sectionType,
    });
    // Keep overlap
    const words = trimmed.split(/\s+/);
    const overlapWords = words.slice(-Math.ceil(CHUNK_CONFIG.overlap / 5));
    currentContent = overlapWords.join(" ") + " ";
  };

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    // Detect page breaks
    const pageMatch = trimmed.match(/^(?:---\s*)?(?:Page|Página)\s+(\d+)/i);
    if (pageMatch) {
      currentPageNumber = parseInt(pageMatch[1], 10);
      continue;
    }

    // Detect section headers
    const headingMatch = trimmed.match(/^#{1,6}\s+(.+)$/m);
    if (headingMatch) {
      // Flush current chunk before new section
      if (currentContent.trim().length >= CHUNK_CONFIG.minSize) {
        flushChunk("paragraph");
      }
      currentSectionTitle = headingMatch[1].trim();
    }

    const sectionType = detectSectionType(trimmed);

    // Would adding this paragraph exceed max size?
    if (currentContent.length + trimmed.length > CHUNK_CONFIG.maxSize) {
      flushChunk(sectionType);
    }

    currentContent += trimmed + "\n\n";

    // Flush if at target size
    if (currentContent.length >= CHUNK_CONFIG.targetSize) {
      flushChunk(sectionType);
    }
  }

  // Final flush
  if (currentContent.trim().length >= CHUNK_CONFIG.minSize) {
    flushChunk("paragraph");
  }

  return chunks;
}

// ─── Route Detection (Q&A vs. Review) ─────────────────────────────────────────

/**
 * Determines whether a query should use Q&A (semantic search) or
 * Document Review (full-section reading) based on query intent.
 */
export function detectRetrievalRoute(query: string): RetrievalMode {
  const lowerQuery = query.toLowerCase();

  // Review indicators (summaries, analysis, full-document tasks)
  const reviewPatterns = [
    /\b(resum|summar|overview|sintetiz|analiz|analy[sz])/i,
    /\b(todo el documento|full document|entire|completo|all of)/i,
    /\b(compar[ae]|contrast|diferencia|difference)/i,
    /\b(estructura|structure|outline|esquema)/i,
    /\b(principal|main\s+(?:points?|ideas?|themes?))/i,
    /\b(conclusi[oó]n|conclusion)/i,
  ];

  // Q&A indicators (specific questions, fact lookup)
  const qaPatterns = [
    /^(qu[eé]|what|who|where|when|how|which|cu[aá]l|d[oó]nde|cu[aá]ndo|c[oó]mo)\b/i,
    /\b(espec[ií]fic|specific|particular|exactly|exactamente)\b/i,
    /\b(defin[ie]|define|significa|means?)\b/i,
    /\b(dato|data|n[uú]mero|number|cifra|figure|estad[ií]stic)/i,
  ];

  const reviewScore = reviewPatterns.reduce(
    (score, p) => score + (p.test(lowerQuery) ? 1 : 0),
    0
  );
  const qaScore = qaPatterns.reduce(
    (score, p) => score + (p.test(lowerQuery) ? 1 : 0),
    0
  );

  if (reviewScore > qaScore) return "review";
  if (qaScore > reviewScore) return "qa";

  // Default: shorter queries tend to be Q&A, longer tend to be review
  return lowerQuery.split(/\s+/).length > 15 ? "review" : "qa";
}

// ─── Embedding Generation ─────────────────────────────────────────────────────

/**
 * Generate embeddings using the configured provider.
 * Returns a float array for vector similarity search.
 */
async function generateEmbedding(text: string): Promise<number[]> {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  if (!GEMINI_API_KEY) {
    logger.warn("No embedding API key configured, using fallback hash-based embedding");
    return hashBasedEmbedding(text);
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "models/text-embedding-004",
          content: { parts: [{ text: text.slice(0, 8000) }] },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Embedding API error: ${response.status}`);
    }

    const data = (await response.json()) as any;
    return data?.embedding?.values ?? hashBasedEmbedding(text);
  } catch (err) {
    logger.error("Embedding generation failed, using fallback", { err });
    return hashBasedEmbedding(text);
  }
}

/** Fallback: deterministic hash-based pseudo-embedding for when no API is available */
function hashBasedEmbedding(text: string, dim = 256): number[] {
  const hash = crypto.createHash("sha256").update(text).digest();
  const embedding: number[] = [];
  for (let i = 0; i < dim; i++) {
    embedding.push((hash[i % hash.length] / 255) * 2 - 1);
  }
  return embedding;
}

/** Cosine similarity between two vectors */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

// ─── Ingestion Pipeline ──────────────────────────────────────────────────────

export class GptKnowledgeIngestionPipeline {
  /**
   * Full ingestion pipeline: parse → preflight → chunk → embed → store
   */
  async ingest(
    gptId: string,
    knowledgeId: string,
    rawText: string,
    fileName: string
  ): Promise<IngestionResult> {
    const start = Date.now();

    try {
      // 1. Preflight parse
      const preflight = preflightParse(rawText);
      if (preflight.warnings.length > 0) {
        logger.info(
          "Preflight warnings during ingestion",
          { gptId, fileName, warnings: preflight.warnings }
        );
      }

      // 2. Chunk
      const chunks = semanticChunk(preflight.normalizedText);
      if (chunks.length === 0) {
        return {
          knowledgeId,
          fileName,
          totalChunks: 0,
          totalTokens: 0,
          status: "failed",
          error: "No viable chunks produced from document",
          durationMs: Date.now() - start,
        };
      }

      // 3. Generate embeddings for each chunk
      const chunkRecords: InsertGptKnowledgeChunk[] = [];
      let totalTokens = 0;

      for (const chunk of chunks) {
        const embedding = await generateEmbedding(chunk.content);
        totalTokens += chunk.tokenEstimate;

        chunkRecords.push({
          knowledgeId,
          gptId,
          content: chunk.content,
          chunkIndex: chunk.index,
          tokenCount: chunk.tokenEstimate,
          embedding,
          pageNumber: chunk.pageNumber,
          sectionTitle: chunk.sectionTitle,
          sectionType: chunk.sectionType,
          metadata: {
            language: preflight.language,
            format: preflight.detectedFormat,
          },
        });
      }

      // 4. Store chunks in batches
      const BATCH_SIZE = 50;
      for (let i = 0; i < chunkRecords.length; i += BATCH_SIZE) {
        const batch = chunkRecords.slice(i, i + BATCH_SIZE);
        await db.insert(gptKnowledgeChunks).values(batch);
      }

      // 5. Update knowledge entry status
      await db
        .update(gptKnowledge)
        .set({
          embeddingStatus: "completed",
          chunkCount: chunks.length,
          updatedAt: new Date(),
        })
        .where(eq(gptKnowledge.id, knowledgeId));

      logger.info(
        "Knowledge ingestion completed",
        { gptId, knowledgeId, fileName, chunks: chunks.length, tokens: totalTokens }
      );

      return {
        knowledgeId,
        fileName,
        totalChunks: chunks.length,
        totalTokens,
        status: "completed",
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      logger.error("Knowledge ingestion failed", { err, gptId, knowledgeId });

      await db
        .update(gptKnowledge)
        .set({ embeddingStatus: "failed", updatedAt: new Date() })
        .where(eq(gptKnowledge.id, knowledgeId));

      return {
        knowledgeId,
        fileName,
        totalChunks: 0,
        totalTokens: 0,
        status: "failed",
        error: err?.message ?? "Unknown ingestion error",
        durationMs: Date.now() - start,
      };
    }
  }
}

// ─── Retrieval Engine ─────────────────────────────────────────────────────────

export class GptKnowledgeRetrievalEngine {
  /**
   * Retrieve relevant knowledge snippets for a query.
   * Automatically selects Q&A vs Review route based on query intent.
   */
  async retrieve(query: RetrievalQuery): Promise<RetrievedSnippet[]> {
    const mode = query.mode === "auto" || !query.mode
      ? detectRetrievalRoute(query.query)
      : query.mode;

    logger.debug(
      `Retrieval route: ${mode}`,
      { gptId: query.gptId, mode, query: query.query.slice(0, 100) }
    );

    if (mode === "review") {
      return this.documentReviewRetrieve(query);
    }
    return this.semanticSearchRetrieve(query);
  }

  /**
   * Q&A Route: semantic vector search for specific information.
   */
  private async semanticSearchRetrieve(query: RetrievalQuery): Promise<RetrievedSnippet[]> {
    const maxChunks = query.maxChunks ?? RETRIEVAL_CONFIG.maxChunksQA;
    const minScore = query.minScore ?? RETRIEVAL_CONFIG.minScoreQA;

    // Generate query embedding
    const queryEmbedding = await generateEmbedding(query.query);

    // Fetch all chunks for this GPT
    const conditions = [eq(gptKnowledgeChunks.gptId, query.gptId)];
    if (query.knowledgeIds && query.knowledgeIds.length > 0) {
      conditions.push(inArray(gptKnowledgeChunks.knowledgeId, query.knowledgeIds));
    }

    const allChunks = await db
      .select()
      .from(gptKnowledgeChunks)
      .where(and(...conditions));

    if (allChunks.length === 0) {
      return [];
    }

    // Calculate similarity scores
    const scored = allChunks
      .map((chunk) => {
        const chunkEmbedding = chunk.embedding as number[] | null;
        const score = chunkEmbedding
          ? cosineSimilarity(queryEmbedding, chunkEmbedding)
          : 0;
        return { chunk, score };
      })
      .filter((s) => s.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxChunks);

    // Keyword boost: re-rank if query terms appear literally
    const queryTerms = query.query.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    for (const item of scored) {
      const lowerContent = item.chunk.content.toLowerCase();
      const keywordHits = queryTerms.filter((term) => lowerContent.includes(term)).length;
      if (keywordHits > 0) {
        item.score = Math.min(1, item.score + keywordHits * 0.05);
      }
    }

    // Re-sort after boost
    scored.sort((a, b) => b.score - a.score);

    return scored.map((s) => ({
      content: s.chunk.content,
      source: s.chunk.sectionTitle || `Chunk ${s.chunk.chunkIndex}`,
      pageNumber: s.chunk.pageNumber ?? undefined,
      sectionTitle: s.chunk.sectionTitle ?? undefined,
      score: s.score,
      chunkId: s.chunk.id,
      matchType: "hybrid" as const,
    }));
  }

  /**
   * Document Review Route: retrieves broader sections for summarization/analysis.
   * Instead of isolated chunks, returns contiguous sections.
   */
  private async documentReviewRetrieve(query: RetrievalQuery): Promise<RetrievedSnippet[]> {
    const maxChunks = query.maxChunks ?? RETRIEVAL_CONFIG.maxChunksReview;

    const conditions = [eq(gptKnowledgeChunks.gptId, query.gptId)];
    if (query.knowledgeIds && query.knowledgeIds.length > 0) {
      conditions.push(inArray(gptKnowledgeChunks.knowledgeId, query.knowledgeIds));
    }

    // For review mode, fetch chunks ordered by position to preserve document structure
    const allChunks = await db
      .select()
      .from(gptKnowledgeChunks)
      .where(and(...conditions))
      .orderBy(gptKnowledgeChunks.knowledgeId, gptKnowledgeChunks.chunkIndex);

    if (allChunks.length === 0) {
      return [];
    }

    // Group by knowledge source
    const bySource = new Map<string, GptKnowledgeChunk[]>();
    for (const chunk of allChunks) {
      const key = chunk.knowledgeId;
      if (!bySource.has(key)) bySource.set(key, []);
      bySource.get(key)!.push(chunk);
    }

    const results: RetrievedSnippet[] = [];

    // For each source, merge contiguous chunks into larger sections
    for (const [sourceId, chunks] of bySource) {
      let currentSection = "";
      let currentTitle = chunks[0]?.sectionTitle ?? undefined;
      let currentPage = chunks[0]?.pageNumber ?? undefined;
      let sectionChunkIds: string[] = [];

      for (const chunk of chunks) {
        // New section if title changes or accumulated content is large enough
        if (
          (chunk.sectionTitle && chunk.sectionTitle !== currentTitle) ||
          currentSection.length > CHUNK_CONFIG.maxSize * 3
        ) {
          if (currentSection.trim().length > 0) {
            results.push({
              content: currentSection.trim(),
              source: currentTitle || `Section from ${sourceId}`,
              pageNumber: currentPage,
              sectionTitle: currentTitle,
              score: 0.5, // Default score for review mode
              chunkId: sectionChunkIds[0] || chunk.id,
              matchType: "keyword",
            });
          }
          currentSection = "";
          currentTitle = chunk.sectionTitle ?? currentTitle;
          currentPage = chunk.pageNumber ?? currentPage;
          sectionChunkIds = [];
        }

        currentSection += chunk.content + "\n\n";
        sectionChunkIds.push(chunk.id);
      }

      // Flush remaining
      if (currentSection.trim().length > 0) {
        results.push({
          content: currentSection.trim(),
          source: currentTitle || `Section from ${sourceId}`,
          pageNumber: currentPage,
          sectionTitle: currentTitle,
          score: 0.5,
          chunkId: sectionChunkIds[0] || "",
          matchType: "keyword",
        });
      }
    }

    return results.slice(0, maxChunks);
  }

  /**
   * Extract citations from a response based on retrieved snippets.
   */
  extractCitations(
    response: string,
    snippets: RetrievedSnippet[]
  ): Citation[] {
    const citations: Citation[] = [];
    const lowerResponse = response.toLowerCase();

    for (const snippet of snippets) {
      // Check if any substantial portion of the snippet content appears in the response
      const snippetWords = snippet.content.split(/\s+/);
      const windowSize = Math.min(6, snippetWords.length);

      let matched = false;
      for (let i = 0; i <= snippetWords.length - windowSize; i++) {
        const window = snippetWords.slice(i, i + windowSize).join(" ").toLowerCase();
        if (window.length > 15 && lowerResponse.includes(window)) {
          matched = true;
          break;
        }
      }

      if (matched || snippet.score > 0.8) {
        citations.push({
          text: snippet.content.slice(0, 300),
          source: snippet.source,
          pageNumber: snippet.pageNumber,
          chunkId: snippet.chunkId,
          relevanceScore: snippet.score,
        });
      }
    }

    // Deduplicate by chunkId
    const seen = new Set<string>();
    return citations.filter((c) => {
      if (seen.has(c.chunkId)) return false;
      seen.add(c.chunkId);
      return true;
    });
  }
}

// ─── Singleton exports ────────────────────────────────────────────────────────

export const knowledgeIngestionPipeline = new GptKnowledgeIngestionPipeline();
export const knowledgeRetrievalEngine = new GptKnowledgeRetrievalEngine();
