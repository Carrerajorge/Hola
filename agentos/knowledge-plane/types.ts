/**
 * AgentOS Knowledge-Plane — Core Types
 *
 * Canonical type definitions for documents, embeddings, search,
 * evidence packs, knowledge-graph nodes, reranking, and freshness.
 */

// ---------------------------------------------------------------------------
// Documents & Chunks
// ---------------------------------------------------------------------------

export type DocumentFormat = "pdf" | "html" | "markdown" | "code" | "image" | "plaintext";

export interface DocumentMetadata {
  source: string;
  author?: string;
  createdAt?: Date;
  updatedAt?: Date;
  language?: string;
  tags?: string[];
  mimeType?: string;
  /** Arbitrary key-value pairs carried through the pipeline. */
  extra?: Record<string, unknown>;
}

export interface Document {
  id: string;
  format: DocumentFormat;
  content: string;
  /** Raw bytes for binary formats (PDF, image). */
  rawBytes?: Uint8Array;
  metadata: DocumentMetadata;
}

export interface Chunk {
  id: string;
  documentId: string;
  content: string;
  index: number;
  /** Character offset range in the source document. */
  startOffset: number;
  endOffset: number;
  /** Structural hint — paragraph, heading, code-block, table-row, etc. */
  structuralType?: string;
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

export interface EmbeddingVector {
  chunkId: string;
  vector: Float64Array;
  model: string;
  dimensions: number;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Search & Retrieval
// ---------------------------------------------------------------------------

export type RetrievalMode = "sparse" | "dense" | "hybrid" | "structural";

export interface SearchQuery {
  original: string;
  rewritten?: string[];
  filters?: Record<string, unknown>;
  mode: RetrievalMode;
  topK: number;
}

export interface SearchResult {
  chunk: Chunk;
  score: number;
  retrievalMode: RetrievalMode;
  /** Optional cross-encoder rerank score (populated after reranking). */
  rerankScore?: number;
  highlights?: string[];
}

// ---------------------------------------------------------------------------
// Evidence & Citations
// ---------------------------------------------------------------------------

export interface Citation {
  documentId: string;
  chunkId: string;
  source: string;
  excerpt: string;
  page?: number;
  lineRange?: [number, number];
  confidence: number;
}

export interface EvidencePack {
  id: string;
  query: string;
  claims: EvidenceClaim[];
  assembledAt: Date;
  totalConfidence: number;
}

export interface EvidenceClaim {
  statement: string;
  citations: Citation[];
  confidence: number;
  freshnessStatus: "fresh" | "stale" | "unknown";
  provenanceChain: string[];
}

// ---------------------------------------------------------------------------
// Knowledge Graph
// ---------------------------------------------------------------------------

export interface KnowledgeGraphNode {
  id: string;
  label: string;
  entityType: string;
  properties: Record<string, unknown>;
  linkedChunkIds: string[];
}

export interface KnowledgeGraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relation: string;
  weight: number;
  properties?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Reranker Config
// ---------------------------------------------------------------------------

export interface RerankerConfig {
  modelName: string;
  batchSize: number;
  maxInputTokens: number;
  /** Minimum score threshold; results below are dropped. */
  scoreThreshold: number;
  /** Whether to normalize scores to [0, 1]. */
  normalize: boolean;
}

// ---------------------------------------------------------------------------
// Freshness / TTL
// ---------------------------------------------------------------------------

export interface FreshnessPolicy {
  /** Maximum age in seconds before a chunk is considered stale. */
  maxAgeSec: number;
  /** How often (seconds) to re-check upstream sources. */
  refreshIntervalSec: number;
  /** Strategy when a chunk is stale. */
  onStale: "warn" | "exclude" | "refresh";
  /** Per-source overrides keyed by source name. */
  sourceOverrides?: Record<string, Partial<FreshnessPolicy>>;
}
