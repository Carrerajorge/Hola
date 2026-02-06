import { and, desc, eq, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";

import { dbRead } from "../../db";
import { fileChunks, files } from "@shared/schema";
import { ragPipeline } from "../../services/ragPipeline";
import { storage } from "../../storage";
import type { IngestedChunk } from "../ingestion2026/ingestionTypes";
import type { RetrievalCandidate, RetrievalResult } from "./hybridRetrieval";

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

function calculateBM25Score(query: string, document: string): number {
  const k1 = 1.5;
  const b = 0.75;
  const avgDocLength = 500;

  const qTerms = query
    .toLowerCase()
    .split(/\s+/)
    .map(t => t.replace(/[^\p{L}\p{N}_-]+/gu, ""))
    .filter(t => t.length > 2);

  const dTerms = (document || "").toLowerCase().split(/\s+/);
  const docLen = dTerms.length || 1;

  const tf = new Map<string, number>();
  for (const t of dTerms) tf.set(t, (tf.get(t) || 0) + 1);

  let score = 0;
  for (const term of qTerms) {
    const freq = tf.get(term) || 0;
    if (freq === 0) continue;
    const denom = freq + k1 * (1 - b + b * (docLen / avgDocLength));
    score += (freq * (k1 + 1)) / (denom || 1);
  }
  return score;
}

function extractQueryTerms(query: string): string[] {
  const parts = query
    .toLowerCase()
    .split(/\s+/)
    .map(t => t.replace(/[^\p{L}\p{N}_-]+/gu, ""))
    .filter(t => t.length > 2);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
    if (out.length >= 6) break;
  }
  return out;
}

function buildFallbackSourceId(fileName: string, pageNumber?: number | null): string {
  const base = `doc:${fileName || "document"}`;
  if (pageNumber && Number.isFinite(pageNumber)) return `${base} p${pageNumber}`;
  return base;
}

function chunkFromDbRow(row: any): IngestedChunk {
  const meta = (row.metadata && typeof row.metadata === "object") ? row.metadata : {};
  const fileName = row.fileName || meta.filename || "document";
  const pageNumber = typeof row.pageNumber === "number" ? row.pageNumber : null;

  const sourceId = typeof meta.sourceId === "string"
    ? meta.sourceId
    : buildFallbackSourceId(fileName, pageNumber);

  const headingPath = Array.isArray(meta.headingPath) ? meta.headingPath.filter((x: any) => typeof x === "string") : [];
  const location = (meta.location && typeof meta.location === "object") ? meta.location : (pageNumber ? { page: pageNumber } : {});

  return {
    id: `db_${row.id}`,
    kind: "document",
    filename: fileName,
    sourceId,
    location,
    headingPath,
    content: row.content,
    rawContent: typeof meta.rawContent === "string" ? meta.rawContent : undefined,
    metadata: {
      ...(typeof meta === "object" && meta ? meta : {}),
      kindLabel: meta.kindLabel || "db_chunk",
    },
    embedding: Array.isArray(row.embedding) ? row.embedding : undefined,
  };
}

async function selectKeywordCandidates(args: {
  fileIds: string[];
  terms: string[];
  userId?: string;
  ingestionVersion?: string;
  limit: number;
}): Promise<any[]> {
  const { fileIds, terms, userId, ingestionVersion, limit } = args;
  if (fileIds.length === 0 || terms.length === 0) return [];

  const termOr = or(...terms.map(t => ilike(fileChunks.content, `%${t}%`)));
  const base = [
    inArray(fileChunks.fileId, fileIds),
    termOr,
  ];
  if (userId) base.push(eq(files.userId, userId));
  if (ingestionVersion) base.push(sql`${fileChunks.metadata} ->> 'ingestionVersion' = ${ingestionVersion}`);

  return dbRead
    .select({
      id: fileChunks.id,
      fileId: fileChunks.fileId,
      content: fileChunks.content,
      embedding: fileChunks.embedding,
      pageNumber: fileChunks.pageNumber,
      chunkIndex: fileChunks.chunkIndex,
      metadata: fileChunks.metadata,
      fileName: files.name,
    })
    .from(fileChunks)
    .innerJoin(files, eq(fileChunks.fileId, files.id))
    .where(and(...base))
    .orderBy(desc(fileChunks.chunkIndex))
    .limit(limit);
}

async function selectVectorCandidates(args: {
  fileIds: string[];
  queryEmbedding: number[];
  userId?: string;
  ingestionVersion?: string;
  limit: number;
}): Promise<any[]> {
  const { fileIds, queryEmbedding, userId, ingestionVersion, limit } = args;
  if (fileIds.length === 0) return [];

  const embeddingStr = `[${queryEmbedding.join(",")}]`;
  const base = [
    inArray(fileChunks.fileId, fileIds),
    isNotNull(fileChunks.embedding),
  ];
  if (userId) base.push(eq(files.userId, userId));
  if (ingestionVersion) base.push(sql`${fileChunks.metadata} ->> 'ingestionVersion' = ${ingestionVersion}`);

  return dbRead
    .select({
      id: fileChunks.id,
      fileId: fileChunks.fileId,
      content: fileChunks.content,
      embedding: fileChunks.embedding,
      pageNumber: fileChunks.pageNumber,
      chunkIndex: fileChunks.chunkIndex,
      metadata: fileChunks.metadata,
      fileName: files.name,
      distance: sql<number>`${fileChunks.embedding} <=> ${embeddingStr}::vector`.as("distance"),
    })
    .from(fileChunks)
    .innerJoin(files, eq(fileChunks.fileId, files.id))
    .where(and(...base))
    .orderBy(sql`${fileChunks.embedding} <=> ${embeddingStr}::vector`)
    .limit(limit);
}

function mapDistanceToScore(distance: number): number {
  if (!Number.isFinite(distance)) return 0;
  // For cosine distance: distance = 1 - cosineSimilarity, range [0..2]
  // Map to [0..1] where 1 is best.
  return Math.max(0, 1 - (distance / 2));
}

export async function hybridRetrieveFromDb(args: {
  query: string;
  fileIds: string[];
  userId?: string;
  topK?: number;
  keywordLimit?: number;
  vectorLimit?: number;
  vectorWeight?: number;
  keywordWeight?: number;
  embedOnQueryMax?: number;
}): Promise<RetrievalResult> {
  const start = Date.now();
  const {
    query,
    fileIds,
    userId,
    topK = 10,
    keywordLimit = Number.parseInt(process.env.ENCARGO_DB_KEYWORD_LIMIT || "160", 10),
    vectorLimit = Number.parseInt(process.env.ENCARGO_DB_VECTOR_LIMIT || "120", 10),
    vectorWeight = 0.7,
    keywordWeight = 0.3,
    embedOnQueryMax = Number.parseInt(process.env.ENCARGO_DB_EMBED_ON_QUERY_MAX || "40", 10),
  } = args;

  const cleanFileIds = fileIds.map(f => f.trim()).filter(Boolean);
  if (cleanFileIds.length === 0) {
    return {
      query,
      selected: [],
      stats: {
        totalChunks: 0,
        keywordCandidates: 0,
        embeddedCandidates: 0,
        graphExpanded: false,
        durationMs: Date.now() - start,
      },
    };
  }

  const terms = extractQueryTerms(query);

  // Prefer ingestion2026 chunks when present, fall back to any chunks.
  const ingestionVersion = "ingestion2026";

  const queryEmbedding = await ragPipeline.generateEmbeddingGemini(query);

  const [kwPreferred, vecPreferred] = await Promise.all([
    selectKeywordCandidates({ fileIds: cleanFileIds, terms, userId, ingestionVersion, limit: keywordLimit }),
    selectVectorCandidates({ fileIds: cleanFileIds, queryEmbedding, userId, ingestionVersion, limit: vectorLimit }),
  ]);

  const keywordRows = kwPreferred.length > 0
    ? kwPreferred
    : await selectKeywordCandidates({ fileIds: cleanFileIds, terms, userId, ingestionVersion: undefined, limit: keywordLimit });

  const vectorRows = vecPreferred.length > 0
    ? vecPreferred
    : await selectVectorCandidates({ fileIds: cleanFileIds, queryEmbedding, userId, ingestionVersion: undefined, limit: vectorLimit });

  const byId = new Map<string, any>();
  for (const r of [...vectorRows, ...keywordRows]) {
    if (!r || !r.id) continue;
    if (!byId.has(r.id)) byId.set(r.id, r);
  }

  const combined = [...byId.values()];

  // Lazy-embed a small number of missing-embedding candidates to strengthen hybrid scoring and warm the DB.
  let embeddedNow = 0;
  if (embedOnQueryMax > 0) {
    // Rank by keyword score first (cheap) and prioritize structurally important chunks.
    const scoredForEmbedding = combined
      .filter(r => !Array.isArray(r.embedding))
      .map(r => {
        const meta = (r.metadata && typeof r.metadata === "object") ? r.metadata : {};
        const kindLabel = String(meta.kindLabel || "");
        const boost = kindLabel === "table" ? 0.3 : kindLabel === "heading" ? 0.15 : 0;
        const bm25 = calculateBM25Score(query, r.content || "");
        return { r, score: bm25 + boost };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, embedOnQueryMax);

    for (const it of scoredForEmbedding) {
      try {
        const emb = await ragPipeline.generateEmbeddingGemini((it.r.content || "").slice(0, 8000));
        it.r.embedding = emb;
        embeddedNow++;
        // Best-effort DB warm-up.
        storage.updateFileChunkEmbeddingById(it.r.id, emb).catch(() => { });
      } catch {
        // Ignore; retrieval will degrade for that chunk.
      }
    }
  }

  const candidates: RetrievalCandidate[] = [];
  for (const row of combined) {
    const chunk = chunkFromDbRow(row);
    const body = chunk.rawContent || chunk.content;
    const bm25 = calculateBM25Score(query, body);
    const keywordScore = Math.min(bm25 / 10, 1);

    let vectorScore = 0;
    if (Array.isArray(row.embedding) && row.embedding.length === queryEmbedding.length) {
      vectorScore = cosineSimilarity(queryEmbedding, row.embedding);
    } else if (typeof row.distance === "number") {
      vectorScore = mapDistanceToScore(row.distance);
    }

    const reasons: string[] = [];
    reasons.push(`bm25=${bm25.toFixed(2)}`);
    reasons.push(`vec=${vectorScore.toFixed(2)}`);

    let hybrid = vectorScore * vectorWeight + keywordScore * keywordWeight;
    const kindLabel = String(chunk.metadata?.kindLabel || "");
    if (kindLabel === "heading") hybrid += 0.05;
    if (kindLabel === "table" && /\b(tabla|table|dataset|datos|data|columns?|columnas?)\b/i.test(query)) hybrid += 0.08;

    candidates.push({
      chunk,
      vectorScore,
      keywordScore,
      hybridScore: hybrid,
      reasons,
    });
  }

  candidates.sort((a, b) => b.hybridScore - a.hybridScore);

  // Diversity guards (same intent as in-memory retrieval).
  const selected: RetrievalCandidate[] = [];
  const sourceCounts = new Map<string, number>();
  const pageCounts = new Map<string, number>();

  for (const cand of candidates) {
    if (selected.length >= topK) break;
    const src = cand.chunk.sourceId;
    const srcCount = sourceCounts.get(src) || 0;
    if (srcCount >= 2) continue;

    const pageKey = `${cand.chunk.filename || "document"}:${(cand.chunk.location as any)?.page || "-"}`;
    const pageCount = pageCounts.get(pageKey) || 0;
    if (pageCount >= 3) continue;

    selected.push(cand);
    sourceCounts.set(src, srcCount + 1);
    pageCounts.set(pageKey, pageCount + 1);
  }

  const embeddedCandidates = combined.filter(r => Array.isArray(r.embedding)).length;

  return {
    query,
    selected,
    stats: {
      totalChunks: combined.length,
      keywordCandidates: keywordRows.length,
      embeddedCandidates,
      graphExpanded: false,
      durationMs: Date.now() - start,
      // Extra debug stat (ignored by callers that don't care)
      embeddedNow,
    } as any,
  };
}
