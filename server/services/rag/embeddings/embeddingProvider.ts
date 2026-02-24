import { GoogleGenAI } from "@google/genai";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface EmbeddingProvider {
    /** Human-readable provider name. */
    name: string;
    /** Embedding vector dimensionality. */
    dimensions: number;
    /** Generate an embedding for a single text. */
    embed(text: string): Promise<number[]>;
    /** Generate embeddings for multiple texts. */
    embedBatch(texts: string[]): Promise<number[][]>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shape returned by Gemini embedContent — varies across SDK versions. */
interface GeminiEmbedResponse {
    embedding?: { values?: number[] };
    embeddings?: { values?: number[] };
}

function isTestEnv(): boolean {
    return (
        process.env.NODE_ENV === "test" ||
        !!process.env.VITEST_WORKER_ID ||
        !!process.env.VITEST_POOL_ID
    );
}

// ---------------------------------------------------------------------------
// 1. Gemini Embedding Provider
// ---------------------------------------------------------------------------

const EMBEDDING_MAX_CHARS = 8000;
const GEMINI_BATCH_SIZE = 10;

export class GeminiEmbeddingProvider implements EmbeddingProvider {
    public readonly name = "gemini" as const;
    public readonly dimensions = 768;

    private readonly ai: GoogleGenAI;
    private readonly model: string;

    constructor(apiKey: string) {
        this.ai = new GoogleGenAI({ apiKey });
        this.model =
            process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";
    }

    async embed(text: string): Promise<number[]> {
        const safeText =
            text.length > EMBEDDING_MAX_CHARS
                ? text.slice(0, EMBEDDING_MAX_CHARS)
                : text;

        const result = await this.ai.models.embedContent({
            model: this.model,
            contents: [{ role: "user", parts: [{ text: safeText }] }],
        });

        const typed = result as unknown as GeminiEmbedResponse;
        const embedding =
            typed.embedding?.values ?? typed.embeddings?.values;

        if (!embedding) {
            throw new Error("Gemini returned no embedding values");
        }
        return embedding;
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        if (texts.length === 0) return [];

        const results: number[][] = [];
        for (let i = 0; i < texts.length; i += GEMINI_BATCH_SIZE) {
            const batch = texts.slice(i, i + GEMINI_BATCH_SIZE);
            const batchResults = await Promise.all(
                batch.map((t) => this.embed(t)),
            );
            results.push(...batchResults);
        }
        return results;
    }
}

// ---------------------------------------------------------------------------
// 2. OpenAI Embedding Provider
// ---------------------------------------------------------------------------

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
    public readonly name = "openai" as const;
    public readonly dimensions = 1536;

    private readonly apiKey: string;
    private readonly model: string;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
        this.model =
            process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
    }

    async embed(text: string): Promise<number[]> {
        const [result] = await this.embedBatch([text]);
        return result;
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        if (texts.length === 0) return [];

        const safeBatch = texts.map((t) =>
            t.length > EMBEDDING_MAX_CHARS ? t.slice(0, EMBEDDING_MAX_CHARS) : t,
        );

        const response = await fetch(
            "https://api.openai.com/v1/embeddings",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify({
                    model: this.model,
                    input: safeBatch,
                }),
            },
        );

        if (!response.ok) {
            const body = await response.text();
            throw new Error(
                `OpenAI embeddings request failed (${response.status}): ${body}`,
            );
        }

        const json = (await response.json()) as {
            data: Array<{ embedding: number[]; index: number }>;
        };

        // Sort by index to guarantee order matches input
        return json.data
            .sort((a, b) => a.index - b.index)
            .map((d) => d.embedding);
    }
}

// ---------------------------------------------------------------------------
// 3. Fallback (hash-based) Embedding Provider
// ---------------------------------------------------------------------------

const FALLBACK_DIMENSIONS = 768;

export class FallbackEmbeddingProvider implements EmbeddingProvider {
    public readonly name = "fallback" as const;
    public readonly dimensions = FALLBACK_DIMENSIONS;

    async embed(text: string): Promise<number[]> {
        return generateFallbackEmbedding(text);
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        return texts.map((t) => generateFallbackEmbedding(t));
    }
}

/**
 * Deterministic, hash-based embedding generator.
 * Mirrors the algorithm in `server/services/embeddings.ts`.
 *
 * 1. Tokenise text to lowercase words (>2 chars).
 * 2. Hash each word (Java-style `hashCode`) to a dimension index.
 * 3. Weight contribution by 1/(wordIndex+1).
 * 4. L2-normalise to unit magnitude.
 */
function generateFallbackEmbedding(text: string): number[] {
    const embedding = new Array(FALLBACK_DIMENSIONS).fill(0);

    const words = text
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2);

    for (let idx = 0; idx < words.length; idx++) {
        const word = words[idx];
        let hash = 0;
        for (let i = 0; i < word.length; i++) {
            hash = ((hash << 5) - hash) + word.charCodeAt(i);
            hash = hash & hash; // Convert to 32-bit int
        }
        const position = Math.abs(hash) % FALLBACK_DIMENSIONS;
        embedding[position] += 1 / (idx + 1);
    }

    // L2 normalise
    const magnitude = Math.sqrt(
        embedding.reduce((sum: number, val: number) => sum + val * val, 0),
    );
    if (magnitude > 0) {
        for (let i = 0; i < embedding.length; i++) {
            embedding[i] /= magnitude;
        }
    }

    return embedding;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export class EmbeddingProviderFactory {
    private static instance: EmbeddingProvider | null = null;

    /**
     * Return the best available embedding provider.
     *
     * Priority: Gemini > OpenAI > Fallback (hash-based).
     *
     * In test environments (NODE_ENV=test or VITEST_WORKER_ID set) the factory
     * always returns a fresh FallbackEmbeddingProvider to avoid network calls.
     */
    static getProvider(): EmbeddingProvider {
        const testEnv = isTestEnv();

        // In test env always return a fresh fallback instance (no caching)
        if (testEnv) {
            return new FallbackEmbeddingProvider();
        }

        if (this.instance) return this.instance;

        const geminiKey = process.env.GEMINI_API_KEY?.trim();
        const openaiKey = process.env.OPENAI_API_KEY?.trim();

        if (geminiKey) {
            this.instance = new GeminiEmbeddingProvider(geminiKey);
        } else if (openaiKey) {
            this.instance = new OpenAIEmbeddingProvider(openaiKey);
        } else {
            this.instance = new FallbackEmbeddingProvider();
        }

        return this.instance;
    }

    /** Clear the cached singleton (useful for tests). */
    static reset(): void {
        this.instance = null;
    }
}
