import crypto from "crypto";

import { ragPipeline } from "../../services/ragPipeline";
import type { IngestedChunk } from "../ingestion2026/ingestionTypes";

export interface RetrievalCandidate {
  chunk: IngestedChunk;
  vectorScore: number;
  keywordScore: number;
  hybridScore: number;
  reasons: string[];
}

export interface RetrievalResult {
  query: string;
  selected: RetrievalCandidate[];
  stats: {
    totalChunks: number;
    keywordCandidates: number;
    embeddedCandidates: number;
    graphExpanded: boolean;
    durationMs: number;
  };
}

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
  // Lightweight BM25-ish scoring (no corpus stats). Good enough for hybrid prefiltering.
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

function extractEntitiesCheap(text: string): string[] {
  const t = (text || "").replace(/\s+/g, " ").trim();
  if (!t) return [];

  const matches = t.match(/\b(?:[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+(?:\s+[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+){0,3}|[A-Z]{2,}(?:\s+[A-Z]{2,}){0,2}|ISO\s?\d{4,5}|\d{4})\b/g) || [];
  const cleaned = matches
    .map(m => m.trim())
    .filter(m => m.length >= 3)
    .filter(m => !/^(Type|HeadingPath|Headers|CSV|Summary|ImageId)$/i.test(m));

  // Dedup with stable ordering
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of cleaned) {
    const key = c.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out.slice(0, 20);
}

function hashEmbeddingKey(text: string): string {
  return crypto.createHash("sha1").update(text.slice(0, 4000), "utf8").digest("hex").slice(0, 16);
}

function normalizeEmbedding(vec: number[], targetDim: number): number[] {
  if (!Array.isArray(vec)) return new Array(targetDim).fill(0);
  if (vec.length === targetDim) return vec;
  if (vec.length > targetDim) return vec.slice(0, targetDim);
  return vec.concat(new Array(targetDim - vec.length).fill(0));
}

export async function hybridRetrieveInMemory(args: {
  query: string;
  chunks: IngestedChunk[];
  topK?: number;
  keywordPrefilter?: number;
  vectorWeight?: number;
  keywordWeight?: number;
  enableGraphExpansion?: boolean;
}): Promise<RetrievalResult> {
  const start = Date.now();
  const {
    query,
    chunks,
    topK = 10,
    keywordPrefilter = 60,
    vectorWeight = 0.7,
    keywordWeight = 0.3,
    enableGraphExpansion = true,
  } = args;

  const totalChunks = chunks.length;
  if (totalChunks === 0) {
    return {
      query,
      selected: [],
      stats: {
        totalChunks,
        keywordCandidates: 0,
        embeddedCandidates: 0,
        graphExpanded: false,
        durationMs: Date.now() - start,
      },
    };
  }

  // Keyword prefilter over all chunks (cheap).
  const keywordScored = chunks.map((chunk) => {
    const body = chunk.rawContent || chunk.content;
    const bm25 = calculateBM25Score(query, body);
    return { chunk, bm25 };
  });
  keywordScored.sort((a, b) => b.bm25 - a.bm25);
  const keywordCandidates = keywordScored.slice(0, Math.min(keywordPrefilter, keywordScored.length));

  // Compute query embedding once (best-effort). If embeddings fail, fall back to keyword-only retrieval.
  let queryEmbedding: number[] | null = null;
  let embeddingsEnabled = true;
  try {
    queryEmbedding = await ragPipeline.generateEmbeddingGemini(query);
  } catch (err: any) {
    embeddingsEnabled = false;
    queryEmbedding = null;
    console.warn(`[HybridRetrieval] Embeddings disabled (query embedding failed):`, err?.message || err);
  }

  const effectiveVectorWeight = embeddingsEnabled ? vectorWeight : 0;
  const effectiveKeywordWeight = embeddingsEnabled ? keywordWeight : 1;

  const embeddingCache = new Map<string, number[]>();
  const getChunkEmbedding = async (chunk: IngestedChunk): Promise<number[]> => {
    if (!embeddingsEnabled || !queryEmbedding) return [];
    if (chunk.embedding) {
      if (chunk.embedding.length !== queryEmbedding.length) {
        chunk.embedding = normalizeEmbedding(chunk.embedding, queryEmbedding.length);
      }
      return chunk.embedding;
    }
    const key = hashEmbeddingKey(chunk.content);
    const cached = embeddingCache.get(key);
    if (cached) return cached.length === queryEmbedding.length ? cached : normalizeEmbedding(cached, queryEmbedding.length);
    try {
      const emb = await ragPipeline.generateEmbeddingGemini(chunk.content.slice(0, 8000));
      const norm = emb.length === queryEmbedding.length ? emb : normalizeEmbedding(emb, queryEmbedding.length);
      embeddingCache.set(key, norm);
      chunk.embedding = norm;
      return norm;
    } catch (err: any) {
      // If a single chunk embedding fails, degrade gracefully for this chunk.
      console.warn(`[HybridRetrieval] Chunk embedding failed; using keyword-only for this chunk:`, err?.message || err);
      return [];
    }
  };

  const candidates: RetrievalCandidate[] = [];
  for (const { chunk, bm25 } of keywordCandidates) {
    const reasons: string[] = [];
    if (bm25 > 0) reasons.push(`bm25=${bm25.toFixed(2)}`);
    const keywordScore = Math.min(bm25 / 10, 1);

    const emb = await getChunkEmbedding(chunk);
    const vectorScore = (queryEmbedding && emb.length === queryEmbedding.length)
      ? cosineSimilarity(queryEmbedding, emb)
      : 0;
    reasons.push(embeddingsEnabled ? `vec=${vectorScore.toFixed(2)}` : `vec=disabled`);

    let hybrid = vectorScore * effectiveVectorWeight + keywordScore * effectiveKeywordWeight;

    // Structural boosts
    const kindLabel = String(chunk.metadata?.kindLabel || "");
    if (kindLabel === "heading") hybrid += 0.05;
    if (kindLabel === "table" && /\b(tabla|table|dataset|datos|data|columns?|columnas?)\b/i.test(query)) hybrid += 0.08;
    if (chunk.kind === "image") hybrid += 0.03;

    candidates.push({
      chunk,
      vectorScore,
      keywordScore,
      hybridScore: hybrid,
      reasons,
    });
  }

  candidates.sort((a, b) => b.hybridScore - a.hybridScore);

  // Optional GraphRAG-lite expansion: pull connected chunks by entity overlap.
  let graphExpanded = false;
  if (enableGraphExpansion && candidates.length > 0) {
    const top = candidates.slice(0, Math.min(8, candidates.length));
    const queryEntities = new Set(extractEntitiesCheap(query).map(e => e.toLowerCase()));
    const entityFreq = new Map<string, number>();

    for (const c of top) {
      for (const e of extractEntitiesCheap(c.chunk.rawContent || c.chunk.content)) {
        const k = e.toLowerCase();
        if (!k || queryEntities.has(k)) continue;
        entityFreq.set(k, (entityFreq.get(k) || 0) + 1);
      }
    }

    const entities = [...entityFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k]) => k);

    if (entities.length > 0) {
      graphExpanded = true;
      const existingIds = new Set(candidates.map(c => c.chunk.id));

      for (const ent of entities) {
        const entRegex = new RegExp(`\\b${ent.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`, "i");
        const hits = chunks
          .filter(ch => !existingIds.has(ch.id) && entRegex.test(ch.rawContent || ch.content))
          .slice(0, 2);
        for (const hit of hits) {
          const emb = await getChunkEmbedding(hit);
          const vectorScore = (queryEmbedding && emb.length === queryEmbedding.length)
            ? cosineSimilarity(queryEmbedding, emb)
            : 0;
          const bm25 = calculateBM25Score(query, hit.rawContent || hit.content);
          const keywordScore = Math.min(bm25 / 10, 1);
          const hybrid = vectorScore * effectiveVectorWeight + keywordScore * effectiveKeywordWeight - 0.05; // small penalty; expansion is auxiliary
          candidates.push({
            chunk: hit,
            vectorScore,
            keywordScore,
            hybridScore: hybrid,
            reasons: [`graph_expand:${ent}`, `vec=${vectorScore.toFixed(2)}`, `bm25=${bm25.toFixed(2)}`],
          });
          existingIds.add(hit.id);
        }
      }

      candidates.sort((a, b) => b.hybridScore - a.hybridScore);
    }
  }

  // Diversity: penalize too many chunks from same sourceId/page.
  const selected: RetrievalCandidate[] = [];
  const sourceCounts = new Map<string, number>();
  const pageCounts = new Map<string, number>();

  for (const cand of candidates) {
    if (selected.length >= topK) break;
    const src = cand.chunk.sourceId;
    const srcCount = sourceCounts.get(src) || 0;
    if (srcCount >= 2) continue;

    const pageKey = `${cand.chunk.filename || "image"}:${cand.chunk.location.page || "-"}`;
    const pageCount = pageCounts.get(pageKey) || 0;
    if (pageCount >= 3) continue;

    selected.push(cand);
    sourceCounts.set(src, srcCount + 1);
    pageCounts.set(pageKey, pageCount + 1);
  }

  return {
    query,
    selected,
    stats: {
      totalChunks,
      keywordCandidates: keywordCandidates.length,
      embeddedCandidates: embeddingsEnabled ? keywordCandidates.length : 0,
      graphExpanded,
      durationMs: Date.now() - start,
    },
  };
}
