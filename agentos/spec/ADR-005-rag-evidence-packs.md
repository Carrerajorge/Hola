# ADR-005: RAG with Evidence Packs and Provenance

**Date:** 2026-03-05
**Status:** Accepted
**Deciders:** AgentOS-ASI Architecture Board

---

## Context

AgentOS-ASI agents make claims -- answering questions, producing reports, making recommendations. These claims must be **verifiable**: the user, the Critic, and the Judge must be able to trace every claim back to its source material and assess its reliability.

Standard RAG (Retrieval-Augmented Generation) pipelines retrieve relevant chunks and inject them into the LLM prompt. However, standard RAG has several deficiencies for a safety-critical agent system:

1. **No provenance**: Retrieved chunks are presented as undifferentiated context. The LLM and downstream components cannot distinguish between authoritative sources and unreliable ones.
2. **No freshness tracking**: Stale information is indistinguishable from fresh information. An agent may cite a product spec from 2022 when a 2025 revision exists.
3. **Single retrieval strategy**: Vector similarity alone misses structured data (tables, graphs) and exact-match needs (IDs, dates, code symbols).
4. **No evidence bundling**: There is no structured artifact that bundles the evidence used for a particular reasoning step, making audit and review difficult.
5. **No quality scoring**: The system cannot assess whether the retrieved evidence is sufficient to support the claim.

We need a retrieval architecture that produces **structured, provenanced, assessable evidence** for every reasoning step.

---

## Decision

We implement **RAG++** in the Knowledge Plane, producing **Evidence Packs** -- structured bundles that link every retrieval to its source with full provenance metadata.

### RAG++ Pipeline

The retrieval pipeline has five stages:

```
Query --> [1. Query Planning] --> [2. Multi-Index Retrieval] -->
          [3. Re-ranking] --> [4. Evidence Assembly] --> [5. Quality Gate]
          --> EvidencePack
```

#### Stage 1: Query Planning

The query planner analyzes the incoming query and determines the retrieval strategy:

- **Query decomposition**: Complex queries are broken into sub-queries. E.g., "Compare the pricing of Product A and Product B" becomes two sub-queries.
- **Query rewriting**: Queries are rewritten for each index type (natural language for vector search, keywords for BM25, SPARQL for graph, SQL for structured).
- **Hop planning**: Multi-hop retrieval is planned when the answer requires chaining facts. E.g., "Who manages the team that built Feature X?" requires two hops.

Query planning may use an LLM call for complex queries, or rule-based heuristics for simple ones.

#### Stage 2: Multi-Index Retrieval

Queries are dispatched to multiple index types in parallel:

| Index Type | Technology | Strengths | Use Cases |
|-----------|-----------|-----------|-----------|
| **Vector** | pgvector / Qdrant | Semantic similarity | Natural language questions, conceptual search. |
| **Full-text (BM25)** | Elasticsearch / Tantivy | Exact term matching | Searching for specific names, IDs, code symbols. |
| **Graph** | Neo4j | Relationship traversal | "Who reports to X?", entity relationships. |
| **Structured** | PostgreSQL | Exact queries on structured data | Dates, prices, status fields, aggregations. |

Each index returns candidates with index-specific scores. Candidates include:

```
RetrievalCandidate {
  chunk_id:          UUID
  content:           string
  source: {
    document_id:     UUID
    uri:             string       -- original document URL or path
    title:           string
    author:          string
    ingested_at:     Timestamp    -- when the document was indexed
    content_hash:    SHA256       -- hash of the source document at ingest time
    last_verified:   Timestamp    -- when the source was last checked for updates
  }
  retrieval: {
    index_type:      "vector" | "bm25" | "graph" | "sql"
    index_name:      string
    raw_score:       float
    query_used:      string      -- the actual query sent to this index
  }
}
```

#### Stage 3: Re-ranking

Candidates from all indexes are merged and re-ranked using a cross-encoder model:

1. **Deduplication**: Candidates with overlapping content (>80% token overlap) are merged, keeping the highest-scoring version.
2. **Cross-encoder scoring**: A cross-encoder model (e.g., ms-marco-MiniLM) scores each (query, candidate) pair for relevance.
3. **Diversity sampling**: If top candidates are too homogeneous (all from the same document), diversity injection selects candidates from different sources.
4. **Top-K selection**: The top K candidates (configurable, default K=10) are selected.

#### Stage 4: Evidence Assembly

Selected candidates are assembled into an Evidence Pack:

```
EvidencePack {
  pack_id:          UUID
  query:            string             -- original query
  sub_queries:      [string]           -- decomposed sub-queries
  strategy:         RetrievalStrategy  -- planner's chosen strategy

  evidence: [
    {
      chunk_id:      UUID
      content:       string
      relevance:     float (0.0 - 1.0) -- re-ranker score, normalized
      source:        SourceReference    -- full provenance (see above)
      provenance: {
        retrieval_method: "vector" | "bm25" | "graph" | "sql"
        index_name:       string
        raw_score:        float
        rerank_score:     float
        hop_number:       uint32       -- 0 = direct, 1+ = multi-hop
        sub_query:        string       -- which sub-query retrieved this
      }
    }
  ]

  quality: {
    coverage_score:    float          -- what fraction of the query is addressed
    confidence_score:  float          -- aggregate evidence confidence
    freshness:         Timestamp      -- age of the oldest evidence item
    source_diversity:  uint32         -- number of distinct source documents
    sufficient:        bool           -- does evidence meet minimum quality bar
  }

  metadata: {
    total_candidates:  uint32         -- candidates before re-ranking
    retrieval_time_ms: uint32
    rerank_model:      string
    created_at:        Timestamp
  }
}
```

#### Stage 5: Quality Gate

Before returning the Evidence Pack, a quality gate checks:

1. **Minimum coverage**: At least `MIN_COVERAGE` (default: 0.6) of the query facets must have supporting evidence.
2. **Minimum confidence**: The aggregate confidence score must exceed `MIN_CONFIDENCE` (default: 0.5).
3. **Freshness threshold**: No evidence item older than `MAX_STALENESS` (configurable per domain).
4. **Source diversity**: At least `MIN_SOURCES` (default: 2) distinct source documents for claims that require corroboration.

If the quality gate fails, the Knowledge Plane can:
- Return the pack with a `quality.sufficient = false` flag (the Critic will handle it).
- Trigger a re-retrieval with relaxed parameters.
- Report that insufficient evidence exists for the query.

### Ingestion Pipeline

Documents enter the Knowledge Plane through a structured ingestion pipeline:

1. **Intake**: Documents are received via API, file upload, or crawler.
2. **Parsing**: Document-type-specific parsers extract text, tables, and metadata.
3. **Chunking**: Text is split into chunks with configurable size and overlap. Chunk boundaries respect paragraph and sentence boundaries.
4. **Enrichment**: Each chunk is enriched with:
   - Embeddings (for vector index).
   - Named entities (for graph index).
   - Metadata extraction (dates, authors, topics).
5. **Indexing**: Chunks are inserted into all relevant indexes.
6. **Verification scheduling**: The ingestion system schedules periodic re-verification of source URLs to detect updates or deletions.

### Freshness Management

- **Source polling**: Configurable polling interval per source (e.g., every 24h for web pages, every 7d for internal docs).
- **Content hash comparison**: If the content hash changes, the document is re-ingested and the old version is marked as superseded.
- **Staleness flagging**: Evidence items from superseded documents are flagged in Evidence Packs.
- **TTL-based expiry**: Documents with no re-verification within their TTL are marked as potentially stale.

---

## Consequences

### Positive

- **Verifiable claims**: Every piece of evidence traces back to a specific source document with content hash, URI, and ingestion timestamp. The user, Critic, and Judge can verify claims independently.
- **Structured audit**: Evidence Packs are immutable artifacts stored in the Data Plane. Auditors can review exactly what evidence was available for any decision.
- **Multi-strategy retrieval**: Combining vector, BM25, graph, and SQL retrieval captures a wider range of relevant information than any single method.
- **Quality awareness**: The quality gate and scoring metadata allow downstream components to calibrate their confidence in the evidence.
- **Freshness tracking**: Stale evidence is detected and flagged, preventing agents from making decisions based on outdated information.
- **Critic integration**: The Critic can validate that agent claims are grounded in the Evidence Pack's sources, catching hallucinations.

### Negative

- **Retrieval latency**: Multi-index retrieval + re-ranking is slower than simple vector search. Mitigated by parallel index queries and cached embeddings. Typical latency: 200-800ms.
- **Storage overhead**: Evidence Packs and provenance metadata consume more storage than raw chunks. Mitigated by CBOR encoding and blob storage for packs.
- **Ingestion complexity**: The multi-index ingestion pipeline is more complex than a simple vector-only pipeline. Mitigated by standardized ingestion adapters per document type.
- **Re-ranker dependency**: Cross-encoder re-ranking requires a dedicated model. Mitigated by using a lightweight model (MiniLM) and caching re-rank scores.

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Re-ranker model produces biased rankings | Low | Medium | Periodic evaluation against labeled relevance datasets. A/B testing between re-ranker versions. |
| Source polling misses document updates (eventual staleness) | Medium | Medium | Content hash comparison catches all changes on poll. Critical sources can use webhooks for real-time notification. |
| Evidence Pack quality gate is too strict (blocks valid results) | Medium | Low | Quality thresholds are configurable per task type. The gate returns insufficient-evidence signal rather than blocking entirely. |
| Graph index becomes stale or inconsistent with vector index | Low | Medium | Ingestion pipeline updates all indexes atomically. Consistency checks run as a background job. |

---

## References

- Bohnet, B. et al. "Attributed QA: Evaluation and Modeling for Attributed Large Language Models." 2022.
- RAGAS evaluation framework documentation.
- RAGFlow architecture documentation.
- Lewis, P. et al. "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks." NeurIPS 2020.
- Khattab, O. et al. "DSPy: Compiling Declarative Language Model Calls into Self-Improving Pipelines." 2023.
- [ARCHITECTURE.md](ARCHITECTURE.md) -- Knowledge Plane section.
