/**
 * AgentOS Knowledge-Plane — RAG Pipeline
 *
 * RAGFlow-class++ pipeline with:
 *  - Multi-hop query rewriting
 *  - Hybrid retrieval (sparse BM25 + dense vector + metadata filters + structural)
 *  - Deduplication
 *  - Freshness / TTL checks
 *  - Evidence assembly with provenance and citations
 */

import {
  Chunk,
  EvidencePack,
  FreshnessPolicy,
  RerankerConfig,
  RetrievalMode,
  SearchQuery,
  SearchResult,
} from "../types";

// ---------------------------------------------------------------------------
// Logger helper
// ---------------------------------------------------------------------------

const log = {
  info: (msg: string, ctx?: Record<string, unknown>) =>
    console.log(`[RAG][INFO] ${msg}`, ctx ?? ""),
  warn: (msg: string, ctx?: Record<string, unknown>) =>
    console.warn(`[RAG][WARN] ${msg}`, ctx ?? ""),
  error: (msg: string, ctx?: Record<string, unknown>) =>
    console.error(`[RAG][ERROR] ${msg}`, ctx ?? ""),
};

// ---------------------------------------------------------------------------
// Pluggable backends (injected at construction)
// ---------------------------------------------------------------------------

export interface SparseIndex {
  search(query: string, topK: number): Promise<SearchResult[]>;
}

export interface DenseIndex {
  search(embedding: Float64Array, topK: number, filters?: Record<string, unknown>): Promise<SearchResult[]>;
}

export interface Embedder {
  embed(text: string): Promise<Float64Array>;
}

export interface Reranker {
  rerank(query: string, results: SearchResult[], config: RerankerConfig): Promise<SearchResult[]>;
}

export interface EvidenceAssembler {
  assemble(query: string, results: SearchResult[]): Promise<EvidencePack>;
}

// ---------------------------------------------------------------------------
// Pipeline configuration
// ---------------------------------------------------------------------------

export interface RAGPipelineConfig {
  sparseIndex: SparseIndex;
  denseIndex: DenseIndex;
  embedder: Embedder;
  reranker: Reranker;
  evidenceAssembler: EvidenceAssembler;
  rerankerConfig: RerankerConfig;
  freshnessPolicy: FreshnessPolicy;
  /** Maximum multi-hop rewrite iterations. */
  maxHops: number;
  /** Default top-K per retrieval leg. */
  defaultTopK: number;
}

// ---------------------------------------------------------------------------
// RAG Pipeline
// ---------------------------------------------------------------------------

export class RAGPipeline {
  private cfg: RAGPipelineConfig;

  constructor(config: RAGPipelineConfig) {
    this.cfg = config;
    log.info("RAGPipeline initialised", { maxHops: config.maxHops, topK: config.defaultTopK });
  }

  // ---- public entry point ------------------------------------------------

  async query(rawQuery: string, filters?: Record<string, unknown>): Promise<EvidencePack> {
    log.info("Pipeline invoked", { rawQuery });

    // 1. Multi-hop query rewriting
    const rewrites = await this.rewriteQuery(rawQuery);
    const allQueries: SearchQuery[] = [rawQuery, ...rewrites].map((q) => ({
      original: rawQuery,
      rewritten: rewrites,
      filters,
      mode: "hybrid" as RetrievalMode,
      topK: this.cfg.defaultTopK,
    }));

    // 2. Hybrid retrieval across all rewritten queries
    const merged: SearchResult[] = [];
    for (const sq of allQueries) {
      const [sparse, dense] = await Promise.all([
        this.retrieveSparse(sq),
        this.retrieveDense(sq),
      ]);
      merged.push(...sparse, ...dense);
    }

    // 3. Deduplicate
    const unique = this.deduplicate(merged);
    log.info("After dedup", { count: unique.length });

    // 4. Freshness / TTL filtering
    const fresh = this.applyFreshness(unique);
    log.info("After freshness filter", { count: fresh.length });

    // 5. Cross-encoder reranking
    const reranked = await this.cfg.reranker.rerank(rawQuery, fresh, this.cfg.rerankerConfig);
    log.info("After reranking", { count: reranked.length });

    // 6. Assemble evidence pack with citations + provenance
    const evidence = await this.cfg.evidenceAssembler.assemble(rawQuery, reranked);
    log.info("Evidence assembled", { claims: evidence.claims.length });

    return evidence;
  }

  // ---- multi-hop query rewriting -----------------------------------------

  private async rewriteQuery(query: string): Promise<string[]> {
    const rewrites: string[] = [];
    let current = query;

    for (let hop = 0; hop < this.cfg.maxHops; hop++) {
      const decomposed = this.decomposeQuestion(current);
      if (decomposed.length === 0) break;
      rewrites.push(...decomposed);
      current = decomposed[decomposed.length - 1];
    }

    log.info("Query rewriting complete", { original: query, rewrites });
    return rewrites;
  }

  /**
   * Heuristic sub-question decomposition.
   * In production this would call an LLM; here we apply rule-based splitting.
   */
  private decomposeQuestion(question: string): string[] {
    const parts: string[] = [];
    const conjunctions = / and | or | but | then /i;
    if (conjunctions.test(question)) {
      const segments = question.split(conjunctions).map((s) => s.trim()).filter(Boolean);
      parts.push(...segments);
    }
    return parts;
  }

  // ---- retrieval legs ----------------------------------------------------

  private async retrieveSparse(sq: SearchQuery): Promise<SearchResult[]> {
    try {
      const text = sq.rewritten?.[0] ?? sq.original;
      return await this.cfg.sparseIndex.search(text, sq.topK);
    } catch (err) {
      log.error("Sparse retrieval failed", { error: String(err) });
      return [];
    }
  }

  private async retrieveDense(sq: SearchQuery): Promise<SearchResult[]> {
    try {
      const text = sq.rewritten?.[0] ?? sq.original;
      const embedding = await this.cfg.embedder.embed(text);
      return await this.cfg.denseIndex.search(embedding, sq.topK, sq.filters);
    } catch (err) {
      log.error("Dense retrieval failed", { error: String(err) });
      return [];
    }
  }

  // ---- deduplication -----------------------------------------------------

  private deduplicate(results: SearchResult[]): SearchResult[] {
    const seen = new Set<string>();
    const out: SearchResult[] = [];
    for (const r of results) {
      if (!seen.has(r.chunk.id)) {
        seen.add(r.chunk.id);
        out.push(r);
      }
    }
    return out;
  }

  // ---- freshness ---------------------------------------------------------

  private applyFreshness(results: SearchResult[]): SearchResult[] {
    const policy = this.cfg.freshnessPolicy;
    const now = Date.now();

    return results.filter((r) => {
      const updatedAt = r.chunk.metadata["updatedAt"];
      if (typeof updatedAt !== "number") return true; // unknown age — keep

      const ageSec = (now - updatedAt) / 1000;
      const sourceName = String(r.chunk.metadata["source"] ?? "");
      const effective = policy.sourceOverrides?.[sourceName]
        ? { ...policy, ...policy.sourceOverrides[sourceName] }
        : policy;

      if (ageSec > effective.maxAgeSec) {
        if (effective.onStale === "exclude") {
          log.warn("Excluding stale chunk", { chunkId: r.chunk.id, ageSec });
          return false;
        }
        if (effective.onStale === "warn") {
          log.warn("Stale chunk included with warning", { chunkId: r.chunk.id, ageSec });
        }
        // "refresh" would trigger async refresh — not blocking here
      }
      return true;
    });
  }
}
