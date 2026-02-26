# RAGFlow Fusion into ILIAGPT - Design Document

**Date:** 2026-02-23
**Approach:** Fusion Nativa TypeScript (Enfoque A)
**Goal:** Integrate RAGFlow's deep document parsing and advanced RAG pipeline into ILIAGPT's existing codebase, fusing the functional core without additional UI or services.

---

## 1. Context

### Current State (ILIAGPT)
- **ragService.ts**: Basic TF-IDF 256-dim embeddings, PostgreSQL JSONB storage, in-memory cosine similarity
- **ragPipeline.ts**: Gemini embeddings (768-dim), semantic chunking, BM25+vector hybrid retrieval, basic reranking
- **advancedRAG.ts**: Gemini embeddings, LRU caches, query expansion (HyDE), semantic cache
- **hybridRAGEngine.ts**: 3-strategy (vector+BM25+GraphRAG), RRF fusion, cross-encoder reranking, MMR diversification
- **rag/index.ts**: Full pipeline orchestrator with memory, privacy, tracing
- **documentIngestion.ts**: PDF (pdf-parse), DOCX (mammoth), XLSX (ExcelJS/xlsx), images (tesseract.js OCR)
- **embeddingsCache.ts**: LRU embedding cache (in-memory)
- **Embeddings stored as JSONB** in PostgreSQL, similarity computed in JavaScript

### What RAGFlow Adds
- DeepDoc: Layout recognition, table structure recognition (TSR), specialized OCR
- 15+ specialized document parsers (academic papers, legal, manuals, books, Q&A, etc.)
- Template-based chunking with hierarchical merging
- Multi-model embeddings (OpenAI, HuggingFace, local models)
- Re-ranking with real models (BGE, Cohere, Pinecone)
- pgvector-like vector search (via Elasticsearch, but we'll use pgvector)

---

## 2. Architecture

### 2.1 pgvector - Native Vector Search

**Change:** Replace JSONB embedding storage + JS-side similarity with PostgreSQL pgvector.

**Schema changes:**
```sql
-- Enable extension
CREATE EXTENSION IF NOT EXISTS vector;

-- file_chunks table: change embedding column
ALTER TABLE file_chunks ADD COLUMN embedding_vec vector(768);
CREATE INDEX idx_file_chunks_embedding ON file_chunks
  USING ivfflat (embedding_vec vector_cosine_ops) WITH (lists = 100);

-- Full-text search index
ALTER TABLE file_chunks ADD COLUMN content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('spanish', content)) STORED;
CREATE INDEX idx_file_chunks_fts ON file_chunks USING gin(content_tsv);

-- rag_documents table: same pattern
ALTER TABLE rag_documents ADD COLUMN embedding_vec vector(768);
CREATE INDEX idx_rag_docs_embedding ON rag_documents
  USING ivfflat (embedding_vec vector_cosine_ops) WITH (lists = 100);
```

**Retrieval becomes SQL:**
```sql
-- Hybrid search: vector + full-text in one query
WITH vector_results AS (
  SELECT id, content, page_number, metadata,
         1 - (embedding_vec <=> $1::vector) AS vector_score
  FROM file_chunks
  WHERE file_id = ANY($2)
  ORDER BY embedding_vec <=> $1::vector
  LIMIT 20
),
fts_results AS (
  SELECT id, content, page_number, metadata,
         ts_rank_cd(content_tsv, plainto_tsquery('spanish', $3)) AS fts_score
  FROM file_chunks
  WHERE file_id = ANY($2) AND content_tsv @@ plainto_tsquery('spanish', $3)
  ORDER BY fts_score DESC
  LIMIT 20
)
SELECT COALESCE(v.id, f.id) AS id,
       COALESCE(v.content, f.content) AS content,
       COALESCE(v.page_number, f.page_number) AS page_number,
       COALESCE(v.metadata, f.metadata) AS metadata,
       COALESCE(v.vector_score, 0) * 0.7 + COALESCE(f.fts_score, 0) * 0.3 AS hybrid_score
FROM vector_results v
FULL OUTER JOIN fts_results f ON v.id = f.id
ORDER BY hybrid_score DESC
LIMIT $4;
```

**Impact:** O(n) in-memory search -> O(log n) indexed search. Scalable to millions of chunks.

**npm dependency:** `pgvector` (Node.js pgvector support for Drizzle)

### 2.2 Deep Document Parsing

**Inspired by RAGFlow's DeepDoc.** Create a multi-level parsing system.

**New files:**
```
server/services/rag/deepParsing/
  index.ts                   -- Parser factory + auto-detection
  pdfStructuredParser.ts     -- PDF with structure extraction
  docxStructuredParser.ts    -- DOCX with section preservation
  spreadsheetParser.ts       -- Enhanced table extraction
  imageParser.ts             -- OCR + layout heuristics
  specializedParsers.ts      -- Paper, Legal, Manual, Table parsers
  layoutDetector.ts          -- Basic layout detection heuristics
  tableExtractor.ts          -- Table detection + NL description
```

**Parsing levels:**

1. **Level 1: Format Detection + Metadata** (already exists in documentIngestion.ts)
   - Magic bytes, MIME type, file size

2. **Level 2: Structured Extraction** (enhanced)
   - PDF: Use pdf-lib + pdfjs-dist for text positions, detect table regions by coordinate clustering, OCR only image regions
   - DOCX: Mammoth with custom transforms to preserve heading hierarchy, tables as structured data
   - XLSX: Schema detection, header row inference, data type analysis
   - Images: Tesseract.js with layout heuristic zones

3. **Level 3: Content-Type Specialized Parsers** (new)
   - Auto-detect document type from content patterns:
     - Has "Abstract", "References", "Methodology" -> PaperParser
     - Has "Articulo", "Clausula", "Ley" -> LegalParser
     - Has "Paso 1", "Procedimiento", "WARNING" -> ManualParser
     - >50% table content -> TableHeavyParser
     - Else -> GenericParser (enhanced current parser)

**Output format (ParsedStructure):**
```typescript
interface ParsedStructure {
  sections: Section[];
  tables: ExtractedTable[];
  figures: ExtractedFigure[];
  metadata: {
    documentType: 'paper' | 'legal' | 'manual' | 'table' | 'generic';
    language: string;
    pageCount: number;
    hasImages: boolean;
    hasTables: boolean;
  };
}

interface Section {
  title: string;
  level: number;        // heading depth (1-6)
  content: string;
  pageNumber: number;
  children: Section[];   // hierarchical structure
  type: 'heading' | 'paragraph' | 'list' | 'code' | 'table' | 'figure';
}

interface ExtractedTable {
  headers: string[];
  rows: string[][];
  caption?: string;
  pageNumber: number;
  naturalLanguageDescription: string;  // LLM-generated description
}
```

### 2.3 Hierarchical Chunking

**New files:**
```
server/services/rag/chunking/
  hierarchicalChunker.ts     -- Main chunker with hierarchy awareness
  templateStrategies.ts      -- Per-document-type chunking strategies
  chunkMerger.ts             -- Merge small adjacent chunks
```

**Features:**

1. **Template-Based Strategies:**
   - Paper: chunk by section (abstract = 1 chunk, each methodology subsection = 1 chunk, etc.)
   - Legal: chunk by article/clause
   - Table: each table + surrounding context = 1 chunk
   - Generic: improved semantic chunking (current logic, enhanced)

2. **Hierarchical Merging:**
   - Merge chunks < minSize that are adjacent and same type
   - Preserve hierarchy: Document > Section > Subsection > Chunk
   - Each chunk inherits breadcrumb from ancestors

3. **Context Propagation:**
   - Every chunk gets a `headerChain: string[]` (e.g., ["Chapter 3", "Section 3.2", "Methods"])
   - Tables never split across chunks
   - Code blocks stay as single units
   - Lists maintained as units

4. **Enhanced Chunk Metadata:**
```typescript
interface EnhancedChunkMetadata {
  // Existing
  pageNumber: number;
  sectionType: string;
  sectionTitle: string;
  startOffset: number;
  endOffset: number;
  hasTable: boolean;
  hasFigure: boolean;

  // New from RAGFlow concepts
  headerChain: string[];           // breadcrumb path
  semanticDensity: number;         // info per token
  documentPosition: number;        // 0-1 position in doc
  extractedKeywords: string[];     // auto-extracted keywords
  proposedQuestions: string[];     // questions this chunk answers
  language: string;
  documentType: string;
  chunkStrategy: string;           // which template was used
}
```

### 2.4 Retrieval Pipeline Enhancement

**Modified files:**
```
server/services/rag/hybridRetriever.ts  -- Add pgvector queries
server/services/rag/reranker.ts         -- NEW: model-based reranking
```

**Retrieval flow:**
```
Query -> [Query Processing]
  |-> Query Rewriting (HyDE, already in hybridRAGEngine)
  |-> Sub-query decomposition (for complex queries)
  |-> Intent detection (factual/analytical/comparative)
  |-> Keyword expansion
  v
[pgvector Hybrid Retrieval] (NEW - replaces JS-side computation)
  |-> Dense: pgvector cosine similarity (top-20)
  |-> Sparse: PostgreSQL ts_vector full-text (top-20)
  |-> Fusion: RRF or weighted sum (already have this logic)
  v
[Model Reranking] (NEW)
  |-> Option 1: Gemini as cross-encoder (send query + candidates, ask for ranking)
  |-> Option 2: Cohere Rerank API (if key available)
  |-> Option 3: Heuristic reranking (enhanced current rerank())
  |-> Auto-select based on available API keys
  v
[Result Assembly]
  |-> Header propagation (breadcrumbs from hierarchical chunks)
  |-> MMR diversification (already have)
  |-> Token budget management (already in promptContextBuilder)
  v
[Context -> LLM]
```

**Reranker implementation:**
```typescript
// server/services/rag/reranker.ts
interface RerankerOptions {
  model?: 'gemini' | 'cohere' | 'heuristic';
  topN?: number;
}

async function rerankWithModel(
  query: string,
  chunks: ScoredChunk[],
  options: RerankerOptions
): Promise<ScoredChunk[]> {
  // Auto-detect best available reranker
  if (options.model === 'cohere' && process.env.COHERE_API_KEY) {
    return rerankCohere(query, chunks, options.topN);
  }
  if (process.env.GEMINI_API_KEY) {
    return rerankGemini(query, chunks, options.topN);
  }
  return rerankHeuristic(query, chunks, options.topN);
}
```

### 2.5 Multi-Model Embeddings

**New file:**
```
server/services/rag/embeddings/
  embeddingProvider.ts  -- Multi-model embedding factory
```

**Providers:**
```typescript
interface EmbeddingProvider {
  name: string;
  dimensions: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

// Auto-selects based on available API keys:
// 1. Gemini embedding-001 (768 dims) - if GEMINI_API_KEY
// 2. OpenAI text-embedding-3-small (1536 dims) - if OPENAI_API_KEY
// 3. Fallback hash-based (768 dims) - always available
```

**Cache enhancement:**
- Keep existing LRU in-memory cache (embeddingsCache.ts)
- Add PostgreSQL persistence for cache entries that survive restarts

### 2.6 File Consolidation

**Before (dispersed):**
```
ragService.ts              -- basic TF-IDF (DEPRECATE)
ragPipeline.ts             -- Gemini + hybrid (DEPRECATE)
advancedRAG.ts             -- HyDE + cache (DEPRECATE)
hybridRAGEngine.ts         -- 3-strategy (KEEP, reference)
rag/index.ts               -- orchestrator (ENHANCE)
```

**After (unified under rag/):**
```
rag/
  index.ts                 -- orchestrator (enhanced, single entry point)
  ingestionPipeline.ts     -- enhanced with deep parsing
  hybridRetriever.ts       -- enhanced with pgvector
  reranker.ts              -- NEW: model-based reranking
  promptContextBuilder.ts  -- existing (minor updates)
  memoryService.ts         -- existing (unchanged)
  privacyService.ts        -- existing (unchanged)
  evaluationHarness.ts     -- existing (unchanged)
  deepParsing/             -- NEW: document parsers
  chunking/                -- NEW: hierarchical chunking
  embeddings/              -- NEW: multi-model embeddings

ragService.ts              -- DEPRECATED: re-exports from rag/
ragPipeline.ts             -- DEPRECATED: re-exports from rag/
advancedRAG.ts             -- DEPRECATED: re-exports from rag/
```

**Backward compatibility:** Old imports continue to work via re-exports.

---

## 3. Dependencies

**New npm packages:**
- `pgvector` - PostgreSQL vector extension support for Node.js
- `pdfjs-dist` - PDF.js for structured PDF text extraction with positions (may already be present)

**Existing packages leveraged:**
- `@google/genai` - Gemini embeddings (already present)
- `tesseract.js` - OCR (already present)
- `mammoth` - DOCX parsing (already present)
- `exceljs` / `xlsx` - Spreadsheet parsing (already present)
- `pdf-parse` - PDF text extraction (already present, enhanced by pdfjs-dist)
- `lru-cache` - Caching (already present)

**PostgreSQL extension:**
- `pgvector` - Must be installed on the PostgreSQL server

---

## 4. Migration Strategy

1. **Phase 1:** Add pgvector extension + new columns (backward compatible)
2. **Phase 2:** Add deep parsing + chunking modules (new code, no breaking changes)
3. **Phase 3:** Add reranker + multi-embeddings (new code, no breaking changes)
4. **Phase 4:** Wire new modules into ingestionPipeline + hybridRetriever
5. **Phase 5:** Deprecate old files with re-exports
6. **Phase 6:** Backfill existing chunks with new embeddings (optional, background job)

Each phase is independently deployable. No big-bang migration required.

---

## 5. Success Criteria

- Documents with tables, figures, and complex layouts are parsed with structure preservation
- Vector search uses pgvector index (not JS in-memory computation)
- Chunking preserves document hierarchy and context
- Re-ranking with model improves relevance over heuristic-only
- All existing API contracts maintained (backward compatible)
- No new UI elements, buttons, or pages - purely functional integration
