/**
 * Model-Based Reranker
 *
 * Inspired by RAGFlow's reranking pipeline.
 * Auto-selects: Cohere Rerank > Gemini cross-encoder > Heuristic.
 */

import type { ScoredChunk } from "./hybridRetriever";

const isTestEnv = () =>
    process.env.NODE_ENV === "test" || !!process.env.VITEST_WORKER_ID;

export interface RerankOptions {
    model?: "gemini" | "cohere" | "heuristic" | "auto";
    topN?: number;
}

export async function rerankChunks(
    query: string,
    chunks: ScoredChunk[],
    options: RerankOptions = {},
): Promise<ScoredChunk[]> {
    if (chunks.length === 0) return [];

    const { model = "auto", topN = chunks.length } = options;

    let reranked: ScoredChunk[];

    if (model === "cohere" || (model === "auto" && process.env.COHERE_API_KEY?.trim() && !isTestEnv())) {
        reranked = await rerankCohere(query, chunks);
    } else if (model === "gemini" || (model === "auto" && process.env.GEMINI_API_KEY?.trim() && !isTestEnv())) {
        reranked = await rerankGemini(query, chunks);
    } else {
        reranked = rerankHeuristic(query, chunks);
    }

    return reranked.slice(0, topN);
}

// ---------------------------------------------------------------------------
// Gemini cross-encoder reranker
// ---------------------------------------------------------------------------

async function rerankGemini(query: string, chunks: ScoredChunk[]): Promise<ScoredChunk[]> {
    try {
        const { GoogleGenAI } = await import("@google/genai");
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

        const passages = chunks.map((c, i) => `[${i}] ${c.content.slice(0, 300)}`).join("\n\n");
        const prompt = `Given the query: "${query}"
Rate each passage's relevance from 0.0 to 1.0. Return ONLY a JSON array of numbers in order.

${passages}`;

        const result = await ai.models.generateContent({
            model: process.env.RAG_RERANKER_MODEL || "gemini-2.0-flash",
            contents: [{ role: "user", parts: [{ text: prompt }] }],
        });

        const text = result.text?.replace(/```json?\n?/g, "").replace(/```/g, "").trim() || "[]";
        const scores: number[] = JSON.parse(text);

        return chunks
            .map((chunk, i) => ({
                ...chunk,
                rerankerScore: scores[i] ?? chunk.score,
                score: (chunk.score + (scores[i] ?? chunk.score)) / 2,
            }))
            .sort((a, b) => b.score - a.score);
    } catch {
        return rerankHeuristic(query, chunks);
    }
}

// ---------------------------------------------------------------------------
// Cohere Rerank API
// ---------------------------------------------------------------------------

async function rerankCohere(query: string, chunks: ScoredChunk[]): Promise<ScoredChunk[]> {
    try {
        const res = await fetch("https://api.cohere.ai/v1/rerank", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.COHERE_API_KEY}`,
            },
            body: JSON.stringify({
                model: "rerank-v3.5",
                query,
                documents: chunks.map((c) => c.content.slice(0, 1000)),
                top_n: chunks.length,
            }),
        });

        if (!res.ok) return rerankHeuristic(query, chunks);
        const data = await res.json();

        const indexed = new Map(chunks.map((c, i) => [i, c]));
        return data.results.map((r: any) => ({
            ...indexed.get(r.index)!,
            rerankerScore: r.relevance_score,
            score: (indexed.get(r.index)!.score + r.relevance_score) / 2,
        }));
    } catch {
        return rerankHeuristic(query, chunks);
    }
}

// ---------------------------------------------------------------------------
// Heuristic reranker (term matching + proximity + context boosts)
// ---------------------------------------------------------------------------

function rerankHeuristic(query: string, chunks: ScoredChunk[]): ScoredChunk[] {
    const queryTerms = new Set(query.toLowerCase().split(/\s+/).filter((t) => t.length > 2));

    return chunks
        .map((chunk) => {
            let boost = 0;
            const contentLower = chunk.content.toLowerCase();
            const contentTerms = contentLower.split(/\s+/);

            // Exact match boost
            const exactMatches = contentTerms.filter((t) => queryTerms.has(t)).length;
            boost += exactMatches * 0.03;

            // Title match boost
            if (chunk.sectionTitle) {
                const titleTerms = chunk.sectionTitle.toLowerCase().split(/\s+/);
                boost += titleTerms.filter((t) => queryTerms.has(t)).length * 0.08;
            }

            // Proximity boost: query terms appearing near each other
            const queryArr = Array.from(queryTerms);
            for (let i = 0; i < queryArr.length - 1; i++) {
                const escaped1 = queryArr[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const escaped2 = queryArr[i + 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const pattern = new RegExp(`${escaped1}\\s+(?:\\S+\\s+){0,3}${escaped2}`, "i");
                if (pattern.test(chunk.content)) boost += 0.05;
            }

            // Content-type context boosts
            if (chunk.chunkType === "heading") boost += 0.04;
            if (chunk.chunkType === "table" && /tabla|table|datos|data/i.test(query)) boost += 0.08;
            if (chunk.chunkType === "code" && /código|code|función|function/i.test(query)) boost += 0.08;

            // Header chain boost (breadcrumb relevance from hierarchical chunker)
            const headerChain = (chunk.metadata as any)?.headerChain as string[] | undefined;
            if (headerChain) {
                for (const header of headerChain) {
                    const headerTerms = header.toLowerCase().split(/\s+/);
                    boost += headerTerms.filter((t) => queryTerms.has(t)).length * 0.06;
                }
            }

            const rerankerScore = chunk.score + boost;
            return { ...chunk, rerankerScore, score: rerankerScore };
        })
        .sort((a, b) => b.score - a.score);
}
