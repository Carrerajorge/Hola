/**
 * AgentOS Knowledge-Plane — Public API
 */

// Types
export type {
  Document,
  DocumentFormat,
  DocumentMetadata,
  Chunk,
  EmbeddingVector,
  SearchQuery,
  SearchResult,
  RetrievalMode,
  Citation,
  EvidenceClaim,
  EvidencePack,
  KnowledgeGraphNode,
  KnowledgeGraphEdge,
  RerankerConfig,
  FreshnessPolicy,
} from "./types";

// RAG Pipeline
export { RAGPipeline } from "./rag/rag-pipeline";
export type {
  RAGPipelineConfig,
  SparseIndex,
  DenseIndex,
  Embedder,
  Reranker,
  EvidenceAssembler as EvidenceAssemblerInterface,
} from "./rag/rag-pipeline";

// ETL / Document Processor
export { DocumentProcessor } from "./etl/document-processor";
export type { ETLConfig, ChunkingConfig } from "./etl/document-processor";

// Cross-Encoder Reranker
export { CrossEncoderReranker, HeuristicScorer } from "./reranker/cross-encoder-reranker";
export type { ScoringBackend } from "./reranker/cross-encoder-reranker";

// Knowledge Graph
export { GraphStore } from "./knowledge-graph/graph-store";
export type { CypherPattern, GraphQueryResult, EntityLinkResult } from "./knowledge-graph/graph-store";

// Evidence Assembler
export { EvidenceAssembler } from "./evidence/evidence-assembler";
export type { EvidenceAssemblerConfig } from "./evidence/evidence-assembler";
