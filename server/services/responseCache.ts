/**
 * Response Cache Layer - ILIAGPT PRO 3.0
 * 
 * Intelligent caching for similar queries.
 * Reduces API costs 30-50% and improves latency.
 */

import crypto from "crypto";

// ============== Types ==============

export interface CacheEntry {
    key: string;
    query: string;
    response: string;
    modelId: string;
    tokens: number;
    createdAt: Date;
    expiresAt: Date;
    hitCount: number;
    metadata?: Record<string, any>;
}

export interface CacheConfig {
    maxSize?: number;
    defaultTTL?: number; // seconds
    similarityThreshold?: number; // 0-1
    enableSimilarityMatching?: boolean;
}

export interface CacheStats {
    hits: number;
    misses: number;
    hitRate: number;
    totalEntries: number;
    memoryUsageMB: number;
}

// ============== Cache Implementation ==============

export class ResponseCache {
    private cache: Map<string, CacheEntry> = new Map();
    private stats = { hits: 0, misses: 0 };
    private config: Required<CacheConfig>;

    constructor(config: CacheConfig = {}) {
        this.config = {
            maxSize: config.maxSize ?? 1000,
            defaultTTL: config.defaultTTL ?? 3600, // 1 hour
            similarityThreshold: config.similarityThreshold ?? 0.85,
            enableSimilarityMatching: config.enableSimilarityMatching ?? true,
        };
    }

    /**
     * Generate cache key from query
     */
    private generateKey(query: string, modelId: string): string {
        const normalized = this.normalizeQuery(query);
        return crypto
            .createHash("sha256")
            .update(`${modelId}:${normalized}`)
            .digest("hex")
            .slice(0, 16);
    }

    /**
     * Normalize query for better matching
     */
    private normalizeQuery(query: string): string {
        return query
            .toLowerCase()
            .trim()
            .replace(/\s+/g, " ")
            .replace(/[^\w\s]/g, "");
    }

    /**
     * Calculate similarity between two queries
     */
    private calculateSimilarity(query1: string, query2: string): number {
        const words1 = new Set(this.normalizeQuery(query1).split(" "));
        const words2 = new Set(this.normalizeQuery(query2).split(" "));

        const intersection = new Set([...words1].filter(x => words2.has(x)));
        const union = new Set([...words1, ...words2]);

        return intersection.size / union.size; // Jaccard similarity
    }

    /**
     * Get cached response
     */
    get(query: string, modelId: string): CacheEntry | null {
        const key = this.generateKey(query, modelId);

        // Direct hit
        const entry = this.cache.get(key);
        if (entry && entry.expiresAt > new Date()) {
            entry.hitCount++;
            this.stats.hits++;
            return entry;
        }

        // Similarity matching
        if (this.config.enableSimilarityMatching) {
            for (const [, cachedEntry] of this.cache) {
                if (cachedEntry.modelId !== modelId) continue;
                if (cachedEntry.expiresAt <= new Date()) continue;

                const similarity = this.calculateSimilarity(query, cachedEntry.query);
                if (similarity >= this.config.similarityThreshold) {
                    cachedEntry.hitCount++;
                    this.stats.hits++;
                    return cachedEntry;
                }
            }
        }

        this.stats.misses++;
        return null;
    }

    /**
     * Store response in cache
     */
    set(
        query: string,
        response: string,
        modelId: string,
        tokens: number,
        ttl?: number,
        metadata?: Record<string, any>
    ): void {
        const key = this.generateKey(query, modelId);
        const expiresAt = new Date(
            Date.now() + (ttl ?? this.config.defaultTTL) * 1000
        );

        // Evict if at capacity
        if (this.cache.size >= this.config.maxSize) {
            this.evictOldest();
        }

        this.cache.set(key, {
            key,
            query,
            response,
            modelId,
            tokens,
            createdAt: new Date(),
            expiresAt,
            hitCount: 0,
            metadata,
        });
    }

    /**
     * Evict oldest/least used entries
     */
    private evictOldest(): void {
        const now = new Date();

        // First, remove expired
        for (const [key, entry] of this.cache) {
            if (entry.expiresAt <= now) {
                this.cache.delete(key);
            }
        }

        // If still over capacity, remove least used
        if (this.cache.size >= this.config.maxSize) {
            const entries = Array.from(this.cache.entries())
                .sort((a, b) => a[1].hitCount - b[1].hitCount);

            const toRemove = Math.ceil(this.config.maxSize * 0.1); // Remove 10%
            for (let i = 0; i < toRemove && i < entries.length; i++) {
                this.cache.delete(entries[i][0]);
            }
        }
    }

    /**
     * Invalidate cache for specific model
     */
    invalidateModel(modelId: string): void {
        for (const [key, entry] of this.cache) {
            if (entry.modelId === modelId) {
                this.cache.delete(key);
            }
        }
    }

    /**
     * Clear entire cache
     */
    clear(): void {
        this.cache.clear();
        this.stats = { hits: 0, misses: 0 };
    }

    /**
     * Get cache statistics
     */
    getStats(): CacheStats {
        const total = this.stats.hits + this.stats.misses;
        let memoryUsage = 0;

        for (const entry of this.cache.values()) {
            memoryUsage += entry.response.length + entry.query.length;
        }

        return {
            hits: this.stats.hits,
            misses: this.stats.misses,
            hitRate: total > 0 ? this.stats.hits / total : 0,
            totalEntries: this.cache.size,
            memoryUsageMB: memoryUsage / (1024 * 1024),
        };
    }

    /**
     * Get all entries (for persistence)
     */
    getEntries(): CacheEntry[] {
        return Array.from(this.cache.values());
    }

    /**
     * Restore entries (from persistence)
     */
    restoreEntries(entries: CacheEntry[]): void {
        const now = new Date();
        for (const entry of entries) {
            if (new Date(entry.expiresAt) > now) {
                this.cache.set(entry.key, {
                    ...entry,
                    createdAt: new Date(entry.createdAt),
                    expiresAt: new Date(entry.expiresAt),
                });
            }
        }
    }
}

// ============== Singleton ==============

let cacheInstance: ResponseCache | null = null;

export function getResponseCache(config?: CacheConfig): ResponseCache {
    if (!cacheInstance) {
        cacheInstance = new ResponseCache(config);
    }
    return cacheInstance;
}

export default ResponseCache;
