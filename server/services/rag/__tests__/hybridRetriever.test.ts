import { describe, it, expect, vi } from "vitest";
import { hybridRetriever } from "../hybridRetriever";

describe("hybridRetriever", () => {
    // Unit tests for exported utilities
    it("rewriteQuery expands Spanish synonyms", () => {
        const result = hybridRetriever.rewriteQuery("error configurar");
        expect(result).toContain("error");
        expect(result).toContain("bug");
        expect(result).toContain("ajustar");
    });

    it("calculateBM25 returns positive score for matching terms", () => {
        const score = hybridRetriever.calculateBM25(
            ["test", "query"],
            ["this", "is", "a", "test", "document"],
            5,
        );
        expect(score).toBeGreaterThan(0);
    });

    it("calculateBM25 returns 0 for no matching terms", () => {
        const score = hybridRetriever.calculateBM25(
            ["test"],
            ["no", "matching", "terms", "here"],
            4,
        );
        expect(score).toBe(0);
    });

    // retrieve() requires DB connection -- integration test only
    // We test the interface contract
    it("exports retrieve function", () => {
        expect(typeof hybridRetriever.retrieve).toBe("function");
    });
});
