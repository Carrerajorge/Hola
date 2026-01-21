import { GoogleGenAI } from "@google/genai";
import * as crypto from "crypto";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const EMBEDDING_MODEL = "text-embedding-004";
const EMBEDDING_CACHE_SIZE = 1000;

// Simple in-memory cache
const embeddingCache = new Map<string, number[]>();

const MAX_TOKEN_CHARS = 8192; // Approx safe limit for standard models
const CONCURRENCY_LIMIT = 5;

class Semaphore {
    private tasks: (() => void)[] = [];
    private count = 0;
    constructor(private max: number) { }

    async acquire() {
        if (this.count < this.max) {
            this.count++;
            return;
        }
        await new Promise<void>(resolve => this.tasks.push(resolve));
        this.count++;
    }

    release() {
        this.count--;
        if (this.tasks.length > 0) {
            this.tasks.shift()!();
        }
    }
}

const limiter = new Semaphore(CONCURRENCY_LIMIT);

export async function getEmbedding(text: string): Promise<number[]> {
    // 1. Truncate to avoid 400 Bad Request (Token limit)
    // Improvement #7: Chunking/Truncation
    const safeText = text.length > MAX_TOKEN_CHARS ? text.slice(0, MAX_TOKEN_CHARS) : text;

    const hash = crypto.createHash("md5").update(safeText).digest("hex");

    if (embeddingCache.has(hash)) {
        return embeddingCache.get(hash)!;
    }

    // Improvement #4: Rate Limiting
    await limiter.acquire();

    try {
        const result = await ai.models.embedContent({
            model: EMBEDDING_MODEL,
            contents: [
                {
                    role: "user",
                    parts: [{ text: safeText }]
                }
            ]
        });

        const embedding = (result as any).embedding?.values || (result as any).embeddings?.values;
        if (!embedding) {
            throw new Error("No embedding returned");
        }

        // Cache management
        if (embeddingCache.size >= EMBEDDING_CACHE_SIZE) {
            const firstKey = embeddingCache.keys().next().value;
            if (firstKey) embeddingCache.delete(firstKey);
        }

        embeddingCache.set(hash, embedding);
        return embedding;
    } catch (error) {
        console.error("Embedding error:", error);
        throw error;
    } finally {
        limiter.release();
    }
}

export function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
}
