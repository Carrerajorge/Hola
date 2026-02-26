/**
 * RAG Ingestion Pipeline
 *
 * Normalizes sources, performs semantic chunking, computes embeddings,
 * and persists chunks to the unified vector store with mandatory metadata.
 */

import crypto from "crypto";
import { db } from "../../db";
import { ragChunks, type InsertRagChunk } from "@shared/schema/rag";
import { eq, and, sql } from "drizzle-orm";
import { getEmbedding } from "../embeddings";
import { chunkDocument, type SemanticChunk, type ChunkingOptions } from "../semanticChunker";
import { deepParse } from "./deepParsing";
import { hierarchicalChunk } from "./chunking";
import { EmbeddingProviderFactory } from "./embeddings/embeddingProvider";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IngestionSource {
    content: string;
    source: string;           // 'document' | 'message' | 'web' | 'email' | 'manual'
    sourceId?: string;
    title?: string;
    mimeType?: string;
    language?: string;
    pageMap?: Map<number, { start: number; end: number }>;
    metadata?: Record<string, unknown>;
}

export interface IngestionOptions {
    tenantId: string;
    userId: string;
    conversationId?: string;
    threadId?: string;
    aclTags?: string[];
    tags?: string[];
    chunking?: ChunkingOptions;
    skipDuplicates?: boolean;
    batchSize?: number;
}

export interface IngestionResult {
    chunksCreated: number;
    chunksSkipped: number;        // deduped
    totalTokensEstimated: number;
    processingTimeMs: number;
    chunkIds: string[];
}

export interface DocumentIngestionInput {
    buffer: Buffer;
    mimeType: string;
    fileName: string;
}

// ---------------------------------------------------------------------------
// Source normalizer
// ---------------------------------------------------------------------------

function normalizeText(text: string): string {
    return text
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/\t/g, "    ")
        .replace(/\u00A0/g, " ")        // non-breaking space
        .replace(/\u200B/g, "")          // zero-width space
        .replace(/\uFEFF/g, "")          // BOM
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "") // control chars
        .replace(/\n{4,}/g, "\n\n\n")   // excessive newlines
        .trim();
}

function contentHash(text: string): string {
    return crypto.createHash("sha256").update(text).digest("hex");
}

function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Chunking adapter — wraps the existing semantic chunker
// ---------------------------------------------------------------------------

interface EnrichedChunk {
    content: string;
    chunkIndex: number;
    chunkType: string;
    pageNumber?: number;
    sectionTitle?: string;
    importance: number;
    metadata: Record<string, unknown>;
}

function adaptChunks(raw: SemanticChunk[], source: IngestionSource): EnrichedChunk[] {
    return raw.map((chunk, idx) => {
        const importanceMap: Record<string, number> = { high: 0.9, medium: 0.5, low: 0.2 };
        return {
            content: chunk.content,
            chunkIndex: idx,
            chunkType: chunk.type,
            pageNumber: chunk.pageNumber,
            sectionTitle: chunk.headingHierarchy?.join(" > ") || undefined,
            importance: importanceMap[chunk.metadata.importance] ?? 0.5,
            metadata: {
                wordCount: chunk.metadata.wordCount,
                charCount: chunk.metadata.charCount,
                hasCode: chunk.metadata.hasCode,
                hasTable: chunk.metadata.hasTable,
                hasList: chunk.metadata.hasList,
                startOffset: chunk.startOffset,
                endOffset: chunk.endOffset,
                language: source.language,
            },
        };
    });
}

// ---------------------------------------------------------------------------
// Embedding batch generator
// ---------------------------------------------------------------------------

async function generateEmbeddingsBatch(
    texts: string[],
    batchSize: number = 10,
): Promise<(number[] | null)[]> {
    const results: (number[] | null)[] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const embeddings = await Promise.all(
            batch.map(async (text) => {
                try {
                    return await getEmbedding(text);
                } catch {
                    return null;
                }
            }),
        );
        results.push(...embeddings);
    }

    return results;
}

// ---------------------------------------------------------------------------
// Main ingestion function
// ---------------------------------------------------------------------------

export async function ingest(
    source: IngestionSource,
    options: IngestionOptions,
): Promise<IngestionResult> {
    const startTime = Date.now();
    const normalized = normalizeText(source.content);

    if (normalized.length < 20) {
        return { chunksCreated: 0, chunksSkipped: 0, totalTokensEstimated: 0, processingTimeMs: 0, chunkIds: [] };
    }

    // 1. Semantic chunking
    const chunkResult = chunkDocument(normalized, {
        maxChunkSize: options.chunking?.maxChunkSize ?? 1200,
        minChunkSize: options.chunking?.minChunkSize ?? 100,
        overlapSize: options.chunking?.overlapSize ?? 150,
        respectHeadings: true,
        respectParagraphs: true,
        preserveCodeBlocks: true,
        preserveTables: true,
    });

    const enriched = adaptChunks(chunkResult.chunks, source);

    // 2. Compute embeddings in batches
    const embeddings = await generateEmbeddingsBatch(
        enriched.map((c) => c.content),
        options.batchSize ?? 10,
    );

    // 3. Persist — skip duplicates by content hash
    let created = 0;
    let skipped = 0;
    let totalTokens = 0;
    const chunkIds: string[] = [];

    for (let i = 0; i < enriched.length; i++) {
        const chunk = enriched[i];
        const hash = contentHash(chunk.content);
        totalTokens += estimateTokens(chunk.content);

        if (options.skipDuplicates !== false) {
            const existing = await db
                .select({ id: ragChunks.id })
                .from(ragChunks)
                .where(and(eq(ragChunks.userId, options.userId), eq(ragChunks.contentHash, hash)))
                .limit(1);

            if (existing.length > 0) {
                skipped++;
                chunkIds.push(existing[0].id);
                continue;
            }
        }

        const row: InsertRagChunk = {
            tenantId: options.tenantId,
            userId: options.userId,
            conversationId: options.conversationId,
            threadId: options.threadId,
            source: source.source,
            sourceId: source.sourceId,
            content: chunk.content,
            contentHash: hash,
            embedding: embeddings[i] ?? undefined,
            chunkIndex: chunk.chunkIndex,
            totalChunks: enriched.length,
            title: source.title,
            mimeType: source.mimeType,
            language: source.language,
            pageNumber: chunk.pageNumber,
            sectionTitle: chunk.sectionTitle,
            chunkType: chunk.chunkType,
            importance: chunk.importance,
            aclTags: options.aclTags ?? [],
            tags: options.tags ?? [],
            metadata: chunk.metadata,
            isActive: true,
        };

        const [inserted] = await db.insert(ragChunks).values(row).returning({ id: ragChunks.id });
        chunkIds.push(inserted.id);
        created++;
    }

    // 4. Update tsvector via raw SQL (drizzle doesn't support generated tsvectors easily)
    if (chunkIds.length > 0) {
        await db.execute(sql`
            UPDATE rag_chunks
            SET search_vector = to_tsvector('spanish', coalesce(title,'') || ' ' || content)
            WHERE id = ANY(${chunkIds})
              AND search_vector IS NULL
        `);
    }

    return {
        chunksCreated: created,
        chunksSkipped: skipped,
        totalTokensEstimated: totalTokens,
        processingTimeMs: Date.now() - startTime,
        chunkIds,
    };
}

// ---------------------------------------------------------------------------
// Document ingestion — deep parsing + hierarchical chunking pipeline
// ---------------------------------------------------------------------------

export async function ingestDocument(
    input: DocumentIngestionInput,
    options: IngestionOptions,
): Promise<IngestionResult> {
    const startTime = Date.now();

    // 1. Deep parse the document buffer
    let parsedStructure;
    try {
        parsedStructure = await deepParse(input.buffer, input.mimeType, input.fileName);
    } catch (err) {
        throw new Error(
            `Deep parsing failed for "${input.fileName}" (${input.mimeType}): ${err instanceof Error ? err.message : String(err)}`,
        );
    }

    // 2. Hierarchical chunking
    const enhancedChunks = hierarchicalChunk(parsedStructure);

    // Early return for empty documents
    if (enhancedChunks.length === 0) {
        return {
            chunksCreated: 0,
            chunksSkipped: 0,
            totalTokensEstimated: 0,
            processingTimeMs: Date.now() - startTime,
            chunkIds: [],
        };
    }

    // 3. Generate embeddings via the new provider system
    const provider = EmbeddingProviderFactory.getProvider();
    let embeddings: number[][];
    try {
        embeddings = await provider.embedBatch(enhancedChunks.map((c) => c.content));
    } catch (err) {
        throw new Error(
            `Embedding generation failed for "${input.fileName}" (${enhancedChunks.length} chunks): ${err instanceof Error ? err.message : String(err)}`,
        );
    }

    // 4. Persist — skip duplicates by content hash
    let created = 0;
    let skipped = 0;
    let totalTokens = 0;
    const chunkIds: string[] = [];

    const docTitle = parsedStructure.metadata.title || input.fileName;
    const docLanguage = parsedStructure.metadata.language;

    for (let i = 0; i < enhancedChunks.length; i++) {
        const chunk = enhancedChunks[i];
        const hash = contentHash(chunk.content);
        totalTokens += estimateTokens(chunk.content);

        // Dedup check
        if (options.skipDuplicates !== false) {
            const existing = await db
                .select({ id: ragChunks.id })
                .from(ragChunks)
                .where(and(eq(ragChunks.userId, options.userId), eq(ragChunks.contentHash, hash)))
                .limit(1);

            if (existing.length > 0) {
                skipped++;
                chunkIds.push(existing[0].id);
                continue;
            }
        }

        // Map EnhancedChunk → InsertRagChunk
        // Earlier content (position 0) → importance 1.0; end (position 1) → 0.5
        const importance = 1 - chunk.metadata.documentPosition * 0.5;

        const row: InsertRagChunk = {
            tenantId: options.tenantId,
            userId: options.userId,
            conversationId: options.conversationId,
            threadId: options.threadId,
            source: "document",
            content: chunk.content,
            contentHash: hash,
            embedding: embeddings[i] ?? undefined,
            chunkIndex: i,
            totalChunks: enhancedChunks.length,
            title: docTitle,
            mimeType: input.mimeType,
            language: docLanguage,
            pageNumber: chunk.metadata.pageNumber,
            sectionTitle: chunk.metadata.headerChain.join(" > "),
            chunkType: chunk.metadata.sectionType,
            importance,
            aclTags: options.aclTags ?? [],
            tags: [...chunk.metadata.extractedKeywords, ...(options.tags ?? [])],
            metadata: {
                documentType: chunk.metadata.documentType,
                chunkStrategy: chunk.metadata.chunkStrategy,
                headerChain: chunk.metadata.headerChain,
                documentPosition: chunk.metadata.documentPosition,
            },
            isActive: true,
        };

        const [inserted] = await db.insert(ragChunks).values(row).returning({ id: ragChunks.id });
        chunkIds.push(inserted.id);
        created++;
    }

    // 5. Update tsvector via raw SQL
    if (chunkIds.length > 0) {
        await db.execute(sql`
            UPDATE rag_chunks
            SET search_vector = to_tsvector('spanish', coalesce(title,'') || ' ' || content)
            WHERE id = ANY(${chunkIds})
              AND search_vector IS NULL
        `);
    }

    return {
        chunksCreated: created,
        chunksSkipped: skipped,
        totalTokensEstimated: totalTokens,
        processingTimeMs: Date.now() - startTime,
        chunkIds,
    };
}

// ---------------------------------------------------------------------------
// Bulk delete by source
// ---------------------------------------------------------------------------

export async function deleteBySource(
    userId: string,
    source: string,
    sourceId?: string,
): Promise<number> {
    const conditions = [eq(ragChunks.userId, userId), eq(ragChunks.source, source)];
    if (sourceId) conditions.push(eq(ragChunks.sourceId, sourceId));

    const deleted = await db
        .delete(ragChunks)
        .where(and(...conditions))
        .returning({ id: ragChunks.id });

    return deleted.length;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const ingestionPipeline = {
    ingest,
    ingestDocument,
    deleteBySource,
    normalizeText,
    contentHash,
    estimateTokens,
};
