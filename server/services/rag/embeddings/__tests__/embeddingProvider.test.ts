import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    EmbeddingProviderFactory,
    FallbackEmbeddingProvider,
    GeminiEmbeddingProvider,
    OpenAIEmbeddingProvider,
} from "../embeddingProvider";

describe("EmbeddingProviderFactory", () => {
    beforeEach(() => {
        EmbeddingProviderFactory.reset();
        // Clear the keys set by tests/setup.ts so we start from a clean slate
        vi.stubEnv("GEMINI_API_KEY", "");
        vi.stubEnv("OPENAI_API_KEY", "");
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        EmbeddingProviderFactory.reset();
    });

    it("returns fallback provider when no API keys are set", () => {
        const provider = EmbeddingProviderFactory.getProvider();
        expect(provider).toBeInstanceOf(FallbackEmbeddingProvider);
        expect(provider.name).toBe("fallback");
        expect(provider.dimensions).toBe(768);
    });

    it("returns gemini provider when GEMINI_API_KEY is set", () => {
        vi.stubEnv("GEMINI_API_KEY", "test-gemini-key-123");
        vi.stubEnv("NODE_ENV", "development");
        // Temporarily unset VITEST_WORKER_ID to bypass test-env guard
        const savedWorker = process.env.VITEST_WORKER_ID;
        const savedPool = process.env.VITEST_POOL_ID;
        delete process.env.VITEST_WORKER_ID;
        delete process.env.VITEST_POOL_ID;
        try {
            const provider = EmbeddingProviderFactory.getProvider();
            expect(provider).toBeInstanceOf(GeminiEmbeddingProvider);
            expect(provider.name).toBe("gemini");
            expect(provider.dimensions).toBe(768);
        } finally {
            // Restore
            if (savedWorker !== undefined) process.env.VITEST_WORKER_ID = savedWorker;
            if (savedPool !== undefined) process.env.VITEST_POOL_ID = savedPool;
        }
    });

    it("returns openai provider when only OPENAI_API_KEY is set", () => {
        vi.stubEnv("OPENAI_API_KEY", "test-openai-key-123");
        vi.stubEnv("GEMINI_API_KEY", "");
        vi.stubEnv("NODE_ENV", "development");
        const savedWorker = process.env.VITEST_WORKER_ID;
        const savedPool = process.env.VITEST_POOL_ID;
        delete process.env.VITEST_WORKER_ID;
        delete process.env.VITEST_POOL_ID;
        try {
            const provider = EmbeddingProviderFactory.getProvider();
            expect(provider).toBeInstanceOf(OpenAIEmbeddingProvider);
            expect(provider.name).toBe("openai");
            expect(provider.dimensions).toBe(1536);
        } finally {
            if (savedWorker !== undefined) process.env.VITEST_WORKER_ID = savedWorker;
            if (savedPool !== undefined) process.env.VITEST_POOL_ID = savedPool;
        }
    });

    it("prefers gemini over openai when both keys are set", () => {
        vi.stubEnv("GEMINI_API_KEY", "test-gemini-key-123");
        vi.stubEnv("OPENAI_API_KEY", "test-openai-key-123");
        vi.stubEnv("NODE_ENV", "development");
        const savedWorker = process.env.VITEST_WORKER_ID;
        const savedPool = process.env.VITEST_POOL_ID;
        delete process.env.VITEST_WORKER_ID;
        delete process.env.VITEST_POOL_ID;
        try {
            const provider = EmbeddingProviderFactory.getProvider();
            expect(provider).toBeInstanceOf(GeminiEmbeddingProvider);
        } finally {
            if (savedWorker !== undefined) process.env.VITEST_WORKER_ID = savedWorker;
            if (savedPool !== undefined) process.env.VITEST_POOL_ID = savedPool;
        }
    });
});

describe("FallbackEmbeddingProvider", () => {
    const provider = new FallbackEmbeddingProvider();

    it("generates deterministic embeddings (same input = same output)", async () => {
        const text = "The quick brown fox jumps over the lazy dog";
        const embedding1 = await provider.embed(text);
        const embedding2 = await provider.embed(text);
        expect(embedding1).toEqual(embedding2);
    });

    it("generates different embeddings for different inputs", async () => {
        const embedding1 = await provider.embed("hello world");
        const embedding2 = await provider.embed("goodbye universe");
        expect(embedding1).not.toEqual(embedding2);
    });

    it("produces embeddings of correct dimensions", async () => {
        const embedding = await provider.embed("test input");
        expect(embedding).toHaveLength(768);
    });

    it("produces normalized embeddings (unit magnitude ~ 1.0)", async () => {
        const embedding = await provider.embed("The quick brown fox jumps over the lazy dog");
        const magnitude = Math.sqrt(
            embedding.reduce((sum, val) => sum + val * val, 0),
        );
        expect(magnitude).toBeCloseTo(1.0, 5);
    });

    it("produces zero vector for empty/whitespace input (magnitude 0)", async () => {
        const embedding = await provider.embed("   ");
        const magnitude = Math.sqrt(
            embedding.reduce((sum, val) => sum + val * val, 0),
        );
        expect(magnitude).toBe(0);
        expect(embedding).toHaveLength(768);
    });

    it("embedBatch matches individual embeds", async () => {
        const texts = [
            "first document about cats",
            "second document about dogs",
            "third document about birds",
        ];
        const batchResults = await provider.embedBatch(texts);
        expect(batchResults).toHaveLength(3);

        for (let i = 0; i < texts.length; i++) {
            const individual = await provider.embed(texts[i]);
            expect(batchResults[i]).toEqual(individual);
        }
    });

    it("embedBatch returns empty array for empty input", async () => {
        const results = await provider.embedBatch([]);
        expect(results).toEqual([]);
    });
});
