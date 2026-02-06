import * as crypto from "crypto";
import { GoogleGenAI } from "@google/genai";
import { generateEmbedding as localEmbedding } from "../embeddingService";

let geminiClient: GoogleGenAI | null = null;
let geminiClientKey = "";

const TARGET_EMBEDDING_DIMENSIONS = 1536; // Must match pgvector column dimension (vector(1536))

function getGeminiClient(): GoogleGenAI | null {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;
    if (!geminiClient || geminiClientKey !== apiKey) {
        geminiClient = new GoogleGenAI({ apiKey });
        geminiClientKey = apiKey;
    }
    return geminiClient;
}

const EMBEDDING_MODEL = "text-embedding-004";
const EMBEDDING_CACHE_SIZE = 1000;
const OPENAI_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

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

function normalizeEmbedding(vec: number[], targetDim = TARGET_EMBEDDING_DIMENSIONS): number[] {
    if (!Array.isArray(vec)) return new Array(targetDim).fill(0);
    if (vec.length === targetDim) return vec;
    if (vec.length > targetDim) return vec.slice(0, targetDim);
    // Pad with zeros (keeps cosine similarity unchanged when both vectors are padded equally)
    return vec.concat(new Array(targetDim - vec.length).fill(0));
}

async function getOpenAIEmbedding(text: string): Promise<number[]> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

    const resp = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: OPENAI_EMBEDDING_MODEL,
            input: text.slice(0, 8000),
        }),
    });

    if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`OpenAI embedding failed: ${resp.status} ${body}`.trim());
    }

    const data: any = await resp.json();
    const emb = data?.data?.[0]?.embedding;
    if (!Array.isArray(emb) || emb.length === 0) {
        throw new Error("OpenAI returned no embedding");
    }
    return emb as number[];
}

export async function getEmbedding(text: string): Promise<number[]> {
    // 1. Truncate to avoid 400 Bad Request (Token limit)
    // Improvement #7: Chunking/Truncation
    const safeText = text.length > MAX_TOKEN_CHARS ? text.slice(0, MAX_TOKEN_CHARS) : text;

    const networkDisabled =
        String(process.env.EMBEDDINGS_DISABLE_NETWORK || (process.env.NODE_ENV === "test" ? "true" : "false"))
            .toLowerCase() === "true";

    const hash = crypto.createHash("md5").update(safeText).digest("hex");

    if (embeddingCache.has(hash)) {
        return embeddingCache.get(hash)!;
    }

    if (networkDisabled) {
        const embedding = normalizeEmbedding(await localEmbedding(safeText));
        embeddingCache.set(hash, embedding);
        return embedding;
    }

    // Provider selection (auto):
    // - Prefer OpenAI when available (1536-d output for text-embedding-3-small/large).
    // - Else Gemini (typically 768-d) padded to 1536 so DB/vector ops stay consistent.
    // - Else local fallback (1536-d, low quality but deterministic).
    const hasOpenAI = !!process.env.OPENAI_API_KEY;
    const client = getGeminiClient();

    // Improvement #4: Rate Limiting
    await limiter.acquire();

    try {
        let embedding: number[];

        if (hasOpenAI) {
            embedding = await getOpenAIEmbedding(safeText);
        } else if (client) {
            const result = await client.models.embedContent({
                model: EMBEDDING_MODEL,
                contents: [
                    {
                        role: "user",
                        parts: [{ text: safeText }]
                    }
                ]
            });

            const raw = (result as any).embedding?.values || (result as any).embeddings?.values;
            if (!raw) {
                throw new Error("No embedding returned");
            }
            embedding = raw as number[];
        } else {
            embedding = await localEmbedding(safeText);
        }

        embedding = normalizeEmbedding(embedding);

        // Cache management
        if (embeddingCache.size >= EMBEDDING_CACHE_SIZE) {
            const firstKey = embeddingCache.keys().next().value;
            if (firstKey) embeddingCache.delete(firstKey);
        }

        embeddingCache.set(hash, embedding);
        return embedding;
    } catch (error) {
        console.error("Embedding error:", error);
        // Fail closed: fall back to deterministic local embeddings (still normalized to 1536).
        return normalizeEmbedding(await localEmbedding(safeText));
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
