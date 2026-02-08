/**
 * Hybrid Attachment Retrieval Service
 *
 * Implements BM25 (full-text search) + vector similarity + re-rank
 * for retrieving relevant attachment content when the user asks questions.
 *
 * The retrieval pipeline:
 *  1. BM25 via PostgreSQL tsvector (Spanish-configured)
 *  2. Vector similarity via pgvector cosine distance
 *  3. Reciprocal Rank Fusion (RRF) to merge both result sets
 *  4. Token-budget aware context assembly with citation metadata
 */

import { db } from "../db";
import { attachments, attachmentChunks, messageAttachments } from "../../shared/schema";
import { eq, sql, and, inArray } from "drizzle-orm";
import { generateEmbedding } from "../embeddingService";
import { traceAttachmentOp } from "../lib/attachmentTracing";

export interface RetrievalResult {
  attachmentId: string;
  chunkId: string;
  content: string;
  score: number;
  fileName: string;
  mimeType: string;
  pageNumber: number | null;
  sourceType: string | null;
  chunkIndex: number;
}

export interface RetrievalContext {
  formattedContext: string;
  citations: { attachmentId: string; fileName: string; page?: number }[];
  totalChunks: number;
  tokenEstimate: number;
}

interface RetrievalOptions {
  query: string;
  chatId?: string;
  userId?: string;
  attachmentIds?: string[];
  limit?: number;
  tokenBudget?: number;
}

const RRF_K = 60; // Reciprocal Rank Fusion constant
const DEFAULT_LIMIT = 10;
const DEFAULT_TOKEN_BUDGET = 6000;
const CHARS_PER_TOKEN = 4; // rough estimate

export async function hybridRetrieve(options: RetrievalOptions): Promise<RetrievalContext> {
  const span = traceAttachmentOp("attachment.retrieval.hybrid");
  const {
    query,
    chatId,
    userId,
    attachmentIds,
    limit = DEFAULT_LIMIT,
    tokenBudget = DEFAULT_TOKEN_BUDGET,
  } = options;

  try {
    // Determine which attachments to search
    let targetAttachmentIds = attachmentIds;

    if (!targetAttachmentIds && chatId) {
      // Get all attachment IDs linked to messages in this chat
      const linkedAttachments = await db
        .select({ attachmentId: messageAttachments.attachmentId })
        .from(messageAttachments)
        .innerJoin(
          sql`chat_messages`,
          sql`chat_messages.id = ${messageAttachments.messageId}`
        )
        .where(sql`chat_messages.chat_id = ${chatId}`);

      targetAttachmentIds = linkedAttachments.map(r => r.attachmentId);
    }

    if (!targetAttachmentIds || targetAttachmentIds.length === 0) {
      span?.setStatus({ code: 0 });
      return { formattedContext: "", citations: [], totalChunks: 0, tokenEstimate: 0 };
    }

    // Run BM25 and vector search in parallel
    const [bm25Results, vectorResults] = await Promise.all([
      searchBM25(query, targetAttachmentIds, limit * 2),
      searchVector(query, targetAttachmentIds, limit * 2),
    ]);

    // Reciprocal Rank Fusion
    const fused = reciprocalRankFusion(bm25Results, vectorResults);

    // Take top results within token budget
    const selected: RetrievalResult[] = [];
    let tokenCount = 0;
    const maxTokens = tokenBudget;

    for (const result of fused) {
      const chunkTokens = Math.ceil(result.content.length / CHARS_PER_TOKEN);
      if (tokenCount + chunkTokens > maxTokens && selected.length > 0) break;
      if (selected.length >= limit) break;

      selected.push(result);
      tokenCount += chunkTokens;
    }

    // Format context with citation markers
    const citations: RetrievalContext["citations"] = [];
    const seenAttachments = new Set<string>();
    const contextParts: string[] = [];

    if (selected.length > 0) {
      contextParts.push("\n=== DOCUMENTOS ADJUNTOS (recuperación automática) ===\n");

      for (const result of selected) {
        if (!seenAttachments.has(result.attachmentId)) {
          seenAttachments.add(result.attachmentId);
          citations.push({
            attachmentId: result.attachmentId,
            fileName: result.fileName,
            page: result.pageNumber ?? undefined,
          });
        }

        const sourceLabel = result.sourceType === "table" ? "Tabla" :
          result.sourceType === "caption" ? "Imagen" :
            result.sourceType === "ocr" ? "OCR" : "Texto";
        const pageLabel = result.pageNumber ? ` (pág. ${result.pageNumber})` : "";

        contextParts.push(`\n[${result.fileName}${pageLabel} — ${sourceLabel}]`);
        contextParts.push(result.content);
      }

      contextParts.push("\n=== FIN DOCUMENTOS ADJUNTOS ===\n");
      contextParts.push("INSTRUCCIÓN: Cuando uses información de los documentos adjuntos, cita el archivo fuente.");
    }

    const formattedContext = contextParts.join("\n");

    span?.setAttribute("retrieval.chunks", selected.length);
    span?.setAttribute("retrieval.tokens", tokenCount);
    span?.setStatus({ code: 0 });

    return {
      formattedContext,
      citations,
      totalChunks: selected.length,
      tokenEstimate: tokenCount,
    };
  } catch (error: any) {
    span?.setStatus({ code: 2, message: error.message });
    console.error("[AttachmentRetrieval] Error:", error.message);
    return { formattedContext: "", citations: [], totalChunks: 0, tokenEstimate: 0 };
  } finally {
    span?.end();
  }
}

async function searchBM25(
  query: string,
  attachmentIds: string[],
  limit: number
): Promise<RetrievalResult[]> {
  const span = traceAttachmentOp("attachment.retrieval.bm25");
  try {
    // Use PostgreSQL ts_rank with Spanish configuration
    const results = await db.execute(sql`
      SELECT
        ac.id as chunk_id,
        ac.attachment_id,
        ac.content,
        ac.chunk_index,
        ac.page_number,
        ac.source_type,
        a.file_name,
        a.mime_type,
        ts_rank(
          to_tsvector('spanish', coalesce(ac.content, '')),
          websearch_to_tsquery('spanish', ${query})
        ) as rank
      FROM attachment_chunks ac
      JOIN attachments a ON a.id = ac.attachment_id
      WHERE ac.attachment_id = ANY(${attachmentIds})
        AND to_tsvector('spanish', coalesce(ac.content, ''))
            @@ websearch_to_tsquery('spanish', ${query})
      ORDER BY rank DESC
      LIMIT ${limit}
    `);

    span?.setStatus({ code: 0 });
    return (results.rows as any[]).map(row => ({
      attachmentId: row.attachment_id,
      chunkId: row.chunk_id,
      content: row.content,
      score: parseFloat(row.rank) || 0,
      fileName: row.file_name,
      mimeType: row.mime_type,
      pageNumber: row.page_number,
      sourceType: row.source_type,
      chunkIndex: row.chunk_index,
    }));
  } catch (error: any) {
    span?.setStatus({ code: 2, message: error.message });
    console.error("[BM25 Search] Error:", error.message);
    return [];
  } finally {
    span?.end();
  }
}

async function searchVector(
  query: string,
  attachmentIds: string[],
  limit: number
): Promise<RetrievalResult[]> {
  const span = traceAttachmentOp("attachment.retrieval.vector");
  try {
    const queryEmbedding = await generateEmbedding(query);
    const embeddingStr = `[${queryEmbedding.join(",")}]`;

    const results = await db.execute(sql`
      SELECT
        ac.id as chunk_id,
        ac.attachment_id,
        ac.content,
        ac.chunk_index,
        ac.page_number,
        ac.source_type,
        a.file_name,
        a.mime_type,
        1 - (ac.embedding <=> ${embeddingStr}::vector) as similarity
      FROM attachment_chunks ac
      JOIN attachments a ON a.id = ac.attachment_id
      WHERE ac.attachment_id = ANY(${attachmentIds})
        AND ac.embedding IS NOT NULL
      ORDER BY ac.embedding <=> ${embeddingStr}::vector
      LIMIT ${limit}
    `);

    span?.setStatus({ code: 0 });
    return (results.rows as any[]).map(row => ({
      attachmentId: row.attachment_id,
      chunkId: row.chunk_id,
      content: row.content,
      score: parseFloat(row.similarity) || 0,
      fileName: row.file_name,
      mimeType: row.mime_type,
      pageNumber: row.page_number,
      sourceType: row.source_type,
      chunkIndex: row.chunk_index,
    }));
  } catch (error: any) {
    span?.setStatus({ code: 2, message: error.message });
    console.error("[Vector Search] Error:", error.message);
    return [];
  } finally {
    span?.end();
  }
}

/**
 * Reciprocal Rank Fusion (RRF) — merges two ranked lists
 * score = sum over all lists of 1 / (k + rank_in_list)
 */
function reciprocalRankFusion(
  bm25: RetrievalResult[],
  vector: RetrievalResult[]
): RetrievalResult[] {
  const scoreMap = new Map<string, { result: RetrievalResult; score: number }>();

  // Score BM25 results
  bm25.forEach((result, rank) => {
    const key = result.chunkId;
    const existing = scoreMap.get(key);
    const rrfScore = 1 / (RRF_K + rank + 1);
    if (existing) {
      existing.score += rrfScore;
    } else {
      scoreMap.set(key, { result, score: rrfScore });
    }
  });

  // Score vector results
  vector.forEach((result, rank) => {
    const key = result.chunkId;
    const existing = scoreMap.get(key);
    const rrfScore = 1 / (RRF_K + rank + 1);
    if (existing) {
      existing.score += rrfScore;
    } else {
      scoreMap.set(key, { result, score: rrfScore });
    }
  });

  // Sort by fused score descending
  return Array.from(scoreMap.values())
    .sort((a, b) => b.score - a.score)
    .map(entry => ({ ...entry.result, score: entry.score }));
}

/**
 * Get attachment context for a chat message
 * Used by the chat flow to augment LLM context with relevant attachment content
 */
export async function getAttachmentContextForChat(
  chatId: string,
  userMessage: string,
  tokenBudget: number = 6000
): Promise<RetrievalContext> {
  return hybridRetrieve({
    query: userMessage,
    chatId,
    tokenBudget,
  });
}
