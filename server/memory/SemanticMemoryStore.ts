/**
 * Semantic Memory Store
 * 
 * Vector-based memory search using embeddings for semantic similarity.
 * Inspired by OpenClaw's memory system - uses embeddings to find related memories
 * even when wording differs.
 */

import { db } from "../db";
import { storage } from "../storage";
import { llmGateway } from "../lib/llmGateway";
import * as crypto from "crypto";

// ============================================================================
// TYPES
// ============================================================================

export interface MemoryChunk {
    id: string;
    userId: string;
    content: string;
    type: "fact" | "preference" | "conversation" | "instruction" | "note";
    embedding?: number[];
    metadata: {
        source: string;
        createdAt: Date;
        lastAccessed: Date;
        accessCount: number;
        confidence: number;
        tags?: string[];
    };
}

export interface SearchResult {
    chunk: MemoryChunk;
    score: number;
    matchType: "semantic" | "keyword" | "hybrid";
}

export interface SemanticSearchOptions {
    limit?: number;
    minScore?: number;
    types?: MemoryChunk["type"][];
    hybridSearch?: boolean;
    keywordWeight?: number;
    vectorWeight?: number;
}

// ============================================================================
// EMBEDDING PROVIDER
// ============================================================================

class EmbeddingProvider {
    private cache = new Map<string, number[]>();
    private cacheMaxSize = 10000;

    /**
     * Get embedding for text, with caching
     */
    async getEmbedding(text: string): Promise<number[]> {
        // Check cache first
        const cacheKey = this.hashText(text);
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;

        try {
            // Use Gemini embeddings if available
            if (process.env.GEMINI_API_KEY) {
                const embedding = await this.getGeminiEmbedding(text);
                this.cacheEmbedding(cacheKey, embedding);
                return embedding;
            }

            // Fallback to OpenAI embeddings
            if (process.env.OPENAI_API_KEY) {
                const embedding = await this.getOpenAIEmbedding(text);
                this.cacheEmbedding(cacheKey, embedding);
                return embedding;
            }

            // No embedding provider available - return simple TF-IDF style vector
            return this.getSimpleEmbedding(text);

        } catch (error) {
            console.warn("[EmbeddingProvider] Error getting embedding, using fallback:", error);
            return this.getSimpleEmbedding(text);
        }
    }

    private async getGeminiEmbedding(text: string): Promise<number[]> {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1/models/text-embedding-004:embedContent?key=${process.env.GEMINI_API_KEY}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    content: { parts: [{ text: text.slice(0, 2048) }] }
                })
            }
        );

        if (!response.ok) {
            throw new Error(`Gemini embedding failed: ${response.status}`);
        }

        const data = await response.json();
        return data.embedding?.values || [];
    }

    private async getOpenAIEmbedding(text: string): Promise<number[]> {
        const response = await fetch("https://api.openai.com/v1/embeddings", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "text-embedding-3-small",
                input: text.slice(0, 8000)
            })
        });

        if (!response.ok) {
            throw new Error(`OpenAI embedding failed: ${response.status}`);
        }

        const data = await response.json();
        return data.data?.[0]?.embedding || [];
    }

    /**
     * Simple TF-IDF style embedding for fallback
     */
    private getSimpleEmbedding(text: string): number[] {
        const words = text.toLowerCase().split(/\s+/);
        const wordFreq = new Map<string, number>();
        
        for (const word of words) {
            wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
        }

        // Create a simple 256-dimensional vector based on character/word patterns
        const vector = new Array(256).fill(0);
        
        for (const [word, freq] of Array.from(wordFreq.entries())) {
            for (let i = 0; i < word.length; i++) {
                const idx = word.charCodeAt(i) % 256;
                vector[idx] += freq / words.length;
            }
        }

        // Normalize
        const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
        if (magnitude > 0) {
            for (let i = 0; i < vector.length; i++) {
                vector[i] /= magnitude;
            }
        }

        return vector;
    }

    private hashText(text: string): string {
        return crypto.createHash("md5").update(text).digest("hex");
    }

    private cacheEmbedding(key: string, embedding: number[]): void {
        if (this.cache.size >= this.cacheMaxSize) {
            // Evict oldest entries (simple FIFO)
            const keysToDelete = Array.from(this.cache.keys()).slice(0, 1000);
            for (const k of keysToDelete) {
                this.cache.delete(k);
            }
        }
        this.cache.set(key, embedding);
    }
}

// ============================================================================
// SEMANTIC MEMORY STORE
// ============================================================================

export class SemanticMemoryStore {
    private embeddingProvider = new EmbeddingProvider();
    private memoryChunks = new Map<string, MemoryChunk[]>(); // userId -> chunks
    private initialized = false;

    async initialize(): Promise<void> {
        if (this.initialized) return;
        console.log("[SemanticMemoryStore] Initialized with embedding support");
        this.initialized = true;
    }

    /**
     * Store a memory with semantic embedding
     */
    async remember(
        userId: string,
        content: string,
        type: MemoryChunk["type"],
        options: {
            source?: string;
            confidence?: number;
            tags?: string[];
        } = {}
    ): Promise<MemoryChunk> {
        // Get embedding for the content
        const embedding = await this.embeddingProvider.getEmbedding(content);

        const chunk: MemoryChunk = {
            id: `mem_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
            userId,
            content,
            type,
            embedding,
            metadata: {
                source: options.source || "explicit",
                createdAt: new Date(),
                lastAccessed: new Date(),
                accessCount: 0,
                confidence: options.confidence ?? 0.8,
                tags: options.tags
            }
        };

        // Store in memory (would persist to DB in production)
        const userChunks = this.memoryChunks.get(userId) || [];
        
        // Check for duplicates by semantic similarity
        const similar = await this.findSimilar(userId, content, { limit: 1, minScore: 0.95 });
        if (similar.length > 0) {
            // Update existing instead of creating duplicate
            const existing = similar[0].chunk;
            existing.metadata.lastAccessed = new Date();
            existing.metadata.accessCount++;
            existing.metadata.confidence = Math.max(existing.metadata.confidence, options.confidence ?? 0.8);
            console.log(`[SemanticMemoryStore] Updated existing memory: ${existing.id}`);
            return existing;
        }

        userChunks.push(chunk);
        this.memoryChunks.set(userId, userChunks);

        console.log(`[SemanticMemoryStore] Stored memory: ${chunk.id} (${type})`);
        return chunk;
    }

    /**
     * Semantic search for related memories
     */
    async search(
        userId: string,
        query: string,
        options: SemanticSearchOptions = {}
    ): Promise<SearchResult[]> {
        const {
            limit = 10,
            minScore = 0.3,
            types,
            hybridSearch = true,
            keywordWeight = 0.3,
            vectorWeight = 0.7
        } = options;

        const userChunks = this.memoryChunks.get(userId) || [];
        if (userChunks.length === 0) return [];

        // Get query embedding
        const queryEmbedding = await this.embeddingProvider.getEmbedding(query);
        const queryWords = new Set(query.toLowerCase().split(/\s+/));

        const results: SearchResult[] = [];

        for (const chunk of userChunks) {
            // Filter by type if specified
            if (types && types.length > 0 && !types.includes(chunk.type)) {
                continue;
            }

            // Calculate vector similarity
            const vectorScore = chunk.embedding
                ? this.cosineSimilarity(queryEmbedding, chunk.embedding)
                : 0;

            // Calculate keyword overlap (BM25-lite)
            const chunkWords = new Set(chunk.content.toLowerCase().split(/\s+/));
            const intersection = Array.from(queryWords).filter(w => chunkWords.has(w));
            const keywordScore = intersection.length / Math.max(queryWords.size, 1);

            // Hybrid score
            const finalScore = hybridSearch
                ? (vectorWeight * vectorScore) + (keywordWeight * keywordScore)
                : vectorScore;

            if (finalScore >= minScore) {
                results.push({
                    chunk,
                    score: finalScore,
                    matchType: hybridSearch ? "hybrid" : "semantic"
                });

                // Update access metadata
                chunk.metadata.lastAccessed = new Date();
                chunk.metadata.accessCount++;
            }
        }

        // Sort by score descending and limit
        results.sort((a, b) => b.score - a.score);
        return results.slice(0, limit);
    }

    /**
     * Find similar memories (for deduplication)
     */
    private async findSimilar(
        userId: string,
        content: string,
        options: { limit?: number; minScore?: number } = {}
    ): Promise<SearchResult[]> {
        return this.search(userId, content, {
            limit: options.limit || 5,
            minScore: options.minScore || 0.8,
            hybridSearch: false
        });
    }

    /**
     * Get all memories for a user, optionally filtered
     */
    async recall(
        userId: string,
        options: {
            types?: MemoryChunk["type"][];
            limit?: number;
            sortBy?: "recent" | "accessed" | "confidence";
        } = {}
    ): Promise<MemoryChunk[]> {
        let chunks = this.memoryChunks.get(userId) || [];

        if (options.types && options.types.length > 0) {
            chunks = chunks.filter(c => options.types!.includes(c.type));
        }

        // Sort
        switch (options.sortBy) {
            case "recent":
                chunks.sort((a, b) => 
                    b.metadata.createdAt.getTime() - a.metadata.createdAt.getTime()
                );
                break;
            case "accessed":
                chunks.sort((a, b) => 
                    b.metadata.lastAccessed.getTime() - a.metadata.lastAccessed.getTime()
                );
                break;
            case "confidence":
                chunks.sort((a, b) => b.metadata.confidence - a.metadata.confidence);
                break;
        }

        if (options.limit) {
            chunks = chunks.slice(0, options.limit);
        }

        return chunks;
    }

    /**
     * Delete a specific memory
     */
    async forget(userId: string, memoryId: string): Promise<boolean> {
        const chunks = this.memoryChunks.get(userId) || [];
        const index = chunks.findIndex(c => c.id === memoryId);
        
        if (index >= 0) {
            chunks.splice(index, 1);
            console.log(`[SemanticMemoryStore] Deleted memory: ${memoryId}`);
            return true;
        }
        return false;
    }

    /**
     * Build context injection from semantic search
     */
    async buildContextFromQuery(
        userId: string,
        query: string,
        maxTokens: number = 500
    ): Promise<string | null> {
        const results = await this.search(userId, query, {
            limit: 10,
            minScore: 0.4
        });

        if (results.length === 0) return null;

        const lines: string[] = ["[Memoria Relevante]"];
        let tokenCount = 20; // Header estimate

        for (const result of results) {
            const line = `• [${result.chunk.type}] ${result.chunk.content}`;
            const lineTokens = Math.ceil(line.length / 4);
            
            if (tokenCount + lineTokens > maxTokens) break;
            
            lines.push(line);
            tokenCount += lineTokens;
        }

        return lines.length > 1 ? lines.join("\n") : null;
    }

    /**
     * Extract and store memories from conversation
     */
    async extractFromConversation(
        userId: string,
        messages: Array<{ role: string; content: string }>
    ): Promise<number> {
        let extracted = 0;

        for (const msg of messages) {
            if (msg.role !== "user") continue;

            // Extract explicit facts
            const factPatterns = [
                /(?:me llamo|my name is|soy)\s+(\w+)/i,
                /(?:trabajo en|i work at)\s+(.+?)(?:\.|,|$)/i,
                /(?:vivo en|i live in)\s+(.+?)(?:\.|,|$)/i,
                /(?:mi email es|my email is)\s+([\w@.]+)/i
            ];

            for (const pattern of factPatterns) {
                const match = msg.content.match(pattern);
                if (match) {
                    await this.remember(userId, match[0], "fact", {
                        source: "conversation",
                        confidence: 0.9
                    });
                    extracted++;
                }
            }

            // Extract preferences
            const prefPatterns = [
                /(?:prefiero|i prefer|me gusta)\s+(.+?)(?:\.|,|$)/i,
                /(?:siempre quiero|always want)\s+(.+?)(?:\.|,|$)/i,
                /(?:no me gusta|i don't like)\s+(.+?)(?:\.|,|$)/i
            ];

            for (const pattern of prefPatterns) {
                const match = msg.content.match(pattern);
                if (match) {
                    await this.remember(userId, match[0], "preference", {
                        source: "conversation",
                        confidence: 0.75
                    });
                    extracted++;
                }
            }

            // Extract instructions
            const instrPatterns = [
                /(?:recuerda que|remember that)\s+(.+?)(?:\.|$)/i,
                /(?:siempre|always)\s+(.+?)(?:\.|$)/i,
                /(?:nunca|never)\s+(.+?)(?:\.|$)/i
            ];

            for (const pattern of instrPatterns) {
                const match = msg.content.match(pattern);
                if (match) {
                    await this.remember(userId, match[0], "instruction", {
                        source: "conversation",
                        confidence: 0.85
                    });
                    extracted++;
                }
            }
        }

        if (extracted > 0) {
            console.log(`[SemanticMemoryStore] Extracted ${extracted} memories from conversation`);
        }

        return extracted;
    }

    /**
     * Get memory statistics
     */
    getStats(userId: string): {
        totalMemories: number;
        byType: Record<string, number>;
        avgConfidence: number;
        embeddingProvider: string;
    } {
        const chunks = this.memoryChunks.get(userId) || [];
        const byType: Record<string, number> = {};
        let totalConfidence = 0;

        for (const chunk of chunks) {
            byType[chunk.type] = (byType[chunk.type] || 0) + 1;
            totalConfidence += chunk.metadata.confidence;
        }

        return {
            totalMemories: chunks.length,
            byType,
            avgConfidence: chunks.length > 0 ? totalConfidence / chunks.length : 0,
            embeddingProvider: process.env.GEMINI_API_KEY 
                ? "gemini" 
                : process.env.OPENAI_API_KEY 
                    ? "openai" 
                    : "simple"
        };
    }

    // ============================================================================
    // PRIVATE HELPERS
    // ============================================================================

    private cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length || a.length === 0) return 0;

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
        return magnitude > 0 ? dotProduct / magnitude : 0;
    }
}

// Singleton instance
export const semanticMemoryStore = new SemanticMemoryStore();

export default semanticMemoryStore;
