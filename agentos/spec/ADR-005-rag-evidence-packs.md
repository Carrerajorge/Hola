# ADR-005: RAG with Evidence Packs and Provenance

## Status
Accepted

## Context
Agent claims must be verifiable. Standard RAG returns chunks without provenance tracking. Users and the critic/judge system need to verify the source and freshness of every claim.

## Decision
Implement "Evidence Packs" — structured bundles that link every agent claim to its sources:
- Each claim includes citations with source document, excerpt, retrieval timestamp, and relevance score
- RAG pipeline includes query rewriting (multi-hop), hybrid retrieval (sparse+dense+metadata), cross-encoder reranking, and freshness/TTL checks
- Evidence assembler creates provenance chains from retrieval to final claim
- Stale evidence is flagged and can be auto-refreshed

## Consequences
- **Positive**: Every claim is verifiable with source links
- **Positive**: Critic can validate grounding against evidence
- **Positive**: Users can click through to original sources
- **Negative**: Higher retrieval latency due to reranking and assembly
- **Negative**: Storage overhead for evidence metadata

## References
- RAGAS evaluation framework
- RAGFlow architecture
- Attributed QA (Bohnet et al., 2022)
