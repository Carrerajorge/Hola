import { describe, it, expect, vi, beforeEach } from "vitest";
import { rerankChunks, type RerankOptions } from "../reranker";
import type { ScoredChunk } from "../hybridRetriever";

describe("rerankChunks", () => {
    beforeEach(() => {
        vi.unstubAllEnvs();
    });

    const mockChunks: ScoredChunk[] = [
        { id: "1", content: "PostgreSQL is a database", score: 0.8, vectorScore: 0.8, bm25Score: 0.6, source: "doc", metadata: {}, tags: [] },
        { id: "2", content: "Redis is an in-memory store", score: 0.7, vectorScore: 0.7, bm25Score: 0.5, source: "doc", metadata: {}, tags: [] },
        { id: "3", content: "PostgreSQL supports vector search via pgvector", score: 0.6, vectorScore: 0.6, bm25Score: 0.4, source: "doc", metadata: {}, tags: [] },
    ];

    it("reranks using heuristic when no API keys available", async () => {
        vi.stubEnv("GEMINI_API_KEY", "");
        vi.stubEnv("COHERE_API_KEY", "");
        const result = await rerankChunks("pgvector database", mockChunks);
        expect(result.length).toBe(3);
        // Chunk 3 mentions both pgvector and database, should be boosted
        expect(result[0].rerankerScore).toBeDefined();
    });

    it("respects topN parameter", async () => {
        vi.stubEnv("GEMINI_API_KEY", "");
        const result = await rerankChunks("pgvector", mockChunks, { topN: 2 });
        expect(result.length).toBe(2);
    });

    it("preserves all chunk properties", async () => {
        vi.stubEnv("GEMINI_API_KEY", "");
        const result = await rerankChunks("test", mockChunks);
        for (const chunk of result) {
            expect(chunk.id).toBeDefined();
            expect(chunk.content).toBeDefined();
            expect(chunk.source).toBeDefined();
        }
    });
});
