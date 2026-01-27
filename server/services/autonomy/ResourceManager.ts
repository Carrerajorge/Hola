/**
 * Resource Manager Service
 *
 * Automatic resource optimization and management.
 * Implements improvements 46-60: Resource Management
 */

import { EventEmitter } from "events";
import crypto from "crypto";

// ============================================================================
// TYPES
// ============================================================================

interface CacheEntry<T> {
    key: string;
    value: T;
    size: number;
    hits: number;
    createdAt: Date;
    lastAccess: Date;
    ttl: number;
    priority: "low" | "normal" | "high";
}

interface CacheStats {
    entries: number;
    totalSize: number;
    hitRate: number;
    missRate: number;
    evictions: number;
}

interface MemoryMetrics {
    heapUsed: number;
    heapTotal: number;
    external: number;
    arrayBuffers: number;
    rss: number;
    percentUsed: number;
}

interface ConnectionPool {
    name: string;
    active: number;
    idle: number;
    waiting: number;
    maxSize: number;
    minSize: number;
}

// ============================================================================
// MULTI-LEVEL CACHE (Improvement #26)
// ============================================================================

class MultiLevelCache {
    private l1Cache: Map<string, CacheEntry<any>> = new Map(); // Memory (fast, small)
    private l2Cache: Map<string, CacheEntry<any>> = new Map(); // Memory (slower, larger)

    private readonly L1_MAX_SIZE = 50 * 1024 * 1024; // 50MB
    private readonly L2_MAX_SIZE = 200 * 1024 * 1024; // 200MB
    private l1Size = 0;
    private l2Size = 0;

    private hits = 0;
    private misses = 0;
    private evictions = 0;

    async get<T>(key: string): Promise<T | null> {
        // Check L1 first
        const l1Entry = this.l1Cache.get(key);
        if (l1Entry && !this.isExpired(l1Entry)) {
            l1Entry.hits++;
            l1Entry.lastAccess = new Date();
            this.hits++;
            return l1Entry.value;
        }

        // Check L2
        const l2Entry = this.l2Cache.get(key);
        if (l2Entry && !this.isExpired(l2Entry)) {
            l2Entry.hits++;
            l2Entry.lastAccess = new Date();
            this.hits++;

            // Promote to L1 if frequently accessed
            if (l2Entry.hits > 3) {
                await this.promoteToL1(key, l2Entry);
            }

            return l2Entry.value;
        }

        this.misses++;
        return null;
    }

    async set<T>(
        key: string,
        value: T,
        options: { ttl?: number; priority?: CacheEntry<T>["priority"] } = {}
    ): Promise<void> {
        const size = this.estimateSize(value);
        const entry: CacheEntry<T> = {
            key,
            value,
            size,
            hits: 0,
            createdAt: new Date(),
            lastAccess: new Date(),
            ttl: options.ttl || 3600000, // 1 hour default
            priority: options.priority || "normal"
        };

        // High priority goes to L1
        if (entry.priority === "high" || size < 10240) { // < 10KB
            await this.setL1(key, entry);
        } else {
            await this.setL2(key, entry);
        }
    }

    private async setL1(key: string, entry: CacheEntry<any>): Promise<void> {
        // Evict if necessary
        while (this.l1Size + entry.size > this.L1_MAX_SIZE && this.l1Cache.size > 0) {
            await this.evictFromL1();
        }

        const existing = this.l1Cache.get(key);
        if (existing) {
            this.l1Size -= existing.size;
        }

        this.l1Cache.set(key, entry);
        this.l1Size += entry.size;
    }

    private async setL2(key: string, entry: CacheEntry<any>): Promise<void> {
        while (this.l2Size + entry.size > this.L2_MAX_SIZE && this.l2Cache.size > 0) {
            await this.evictFromL2();
        }

        const existing = this.l2Cache.get(key);
        if (existing) {
            this.l2Size -= existing.size;
        }

        this.l2Cache.set(key, entry);
        this.l2Size += entry.size;
    }

    private async promoteToL1(key: string, entry: CacheEntry<any>): Promise<void> {
        this.l2Cache.delete(key);
        this.l2Size -= entry.size;
        await this.setL1(key, entry);
    }

    private async evictFromL1(): Promise<void> {
        // LRU eviction with priority consideration
        let oldest: CacheEntry<any> | null = null;
        let oldestKey = "";

        for (const [key, entry] of this.l1Cache) {
            if (entry.priority === "high") continue;

            if (!oldest || entry.lastAccess < oldest.lastAccess) {
                oldest = entry;
                oldestKey = key;
            }
        }

        if (oldest) {
            this.l1Cache.delete(oldestKey);
            this.l1Size -= oldest.size;
            this.evictions++;

            // Demote to L2 instead of discarding
            if (oldest.hits > 1) {
                await this.setL2(oldestKey, oldest);
            }
        }
    }

    private async evictFromL2(): Promise<void> {
        let oldest: CacheEntry<any> | null = null;
        let oldestKey = "";

        for (const [key, entry] of this.l2Cache) {
            if (!oldest || entry.lastAccess < oldest.lastAccess) {
                oldest = entry;
                oldestKey = key;
            }
        }

        if (oldest) {
            this.l2Cache.delete(oldestKey);
            this.l2Size -= oldest.size;
            this.evictions++;
        }
    }

    private isExpired(entry: CacheEntry<any>): boolean {
        return Date.now() - entry.createdAt.getTime() > entry.ttl;
    }

    private estimateSize(value: any): number {
        try {
            return JSON.stringify(value).length * 2; // Approximate UTF-16 size
        } catch {
            return 1024; // Default estimate
        }
    }

    async delete(key: string): Promise<boolean> {
        const l1Entry = this.l1Cache.get(key);
        if (l1Entry) {
            this.l1Cache.delete(key);
            this.l1Size -= l1Entry.size;
            return true;
        }

        const l2Entry = this.l2Cache.get(key);
        if (l2Entry) {
            this.l2Cache.delete(key);
            this.l2Size -= l2Entry.size;
            return true;
        }

        return false;
    }

    async clear(): Promise<void> {
        this.l1Cache.clear();
        this.l2Cache.clear();
        this.l1Size = 0;
        this.l2Size = 0;
    }

    getStats(): CacheStats {
        const total = this.hits + this.misses;
        return {
            entries: this.l1Cache.size + this.l2Cache.size,
            totalSize: this.l1Size + this.l2Size,
            hitRate: total > 0 ? this.hits / total : 0,
            missRate: total > 0 ? this.misses / total : 0,
            evictions: this.evictions
        };
    }

    async cleanup(): Promise<number> {
        let cleaned = 0;

        for (const [key, entry] of this.l1Cache) {
            if (this.isExpired(entry)) {
                this.l1Cache.delete(key);
                this.l1Size -= entry.size;
                cleaned++;
            }
        }

        for (const [key, entry] of this.l2Cache) {
            if (this.isExpired(entry)) {
                this.l2Cache.delete(key);
                this.l2Size -= entry.size;
                cleaned++;
            }
        }

        return cleaned;
    }
}

// ============================================================================
// REQUEST DEDUPLICATION (Improvement #59)
// ============================================================================

class RequestDeduplicator {
    private pendingRequests: Map<string, Promise<any>> = new Map();
    private requestHashes: Map<string, { timestamp: Date; result: any }> = new Map();
    private readonly DEDUP_WINDOW_MS = 5000; // 5 seconds

    async deduplicate<T>(
        key: string,
        executor: () => Promise<T>
    ): Promise<T> {
        // Check if identical request is pending
        const pending = this.pendingRequests.get(key);
        if (pending) {
            console.log(`[RequestDeduplicator] Deduplicating request: ${key.slice(0, 20)}...`);
            return pending;
        }

        // Check if we have a recent result
        const cached = this.requestHashes.get(key);
        if (cached && Date.now() - cached.timestamp.getTime() < this.DEDUP_WINDOW_MS) {
            return cached.result;
        }

        // Execute and cache
        const promise = executor();
        this.pendingRequests.set(key, promise);

        try {
            const result = await promise;
            this.requestHashes.set(key, { timestamp: new Date(), result });
            return result;
        } finally {
            this.pendingRequests.delete(key);
        }
    }

    createKey(...args: any[]): string {
        return crypto.createHash("md5").update(JSON.stringify(args)).digest("hex");
    }

    cleanup(): void {
        const cutoff = Date.now() - this.DEDUP_WINDOW_MS;
        for (const [key, data] of this.requestHashes) {
            if (data.timestamp.getTime() < cutoff) {
                this.requestHashes.delete(key);
            }
        }
    }
}

// ============================================================================
// RESPONSE CACHE (Improvement #60)
// ============================================================================

class AIResponseCache {
    private cache: Map<string, { response: string; timestamp: Date; model: string }> = new Map();
    private readonly MAX_ENTRIES = 1000;
    private readonly TTL_MS = 3600000; // 1 hour

    private hashPrompt(prompt: string, model: string): string {
        return crypto.createHash("sha256").update(`${model}:${prompt}`).digest("hex");
    }

    get(prompt: string, model: string): string | null {
        const key = this.hashPrompt(prompt, model);
        const entry = this.cache.get(key);

        if (!entry) return null;
        if (Date.now() - entry.timestamp.getTime() > this.TTL_MS) {
            this.cache.delete(key);
            return null;
        }

        return entry.response;
    }

    set(prompt: string, model: string, response: string): void {
        const key = this.hashPrompt(prompt, model);

        // Evict old entries if at capacity
        if (this.cache.size >= this.MAX_ENTRIES) {
            const oldest = this.findOldest();
            if (oldest) this.cache.delete(oldest);
        }

        this.cache.set(key, {
            response,
            timestamp: new Date(),
            model
        });
    }

    private findOldest(): string | null {
        let oldestKey: string | null = null;
        let oldestTime = Date.now();

        for (const [key, entry] of this.cache) {
            if (entry.timestamp.getTime() < oldestTime) {
                oldestTime = entry.timestamp.getTime();
                oldestKey = key;
            }
        }

        return oldestKey;
    }

    getStats(): { entries: number; hitRate: number } {
        return {
            entries: this.cache.size,
            hitRate: 0 // Would need to track hits/misses
        };
    }
}

// ============================================================================
// RESOURCE MANAGER SERVICE
// ============================================================================

export class ResourceManagerService extends EventEmitter {
    private cache: MultiLevelCache;
    private deduplicator: RequestDeduplicator;
    private aiResponseCache: AIResponseCache;
    private connectionPools: Map<string, ConnectionPool> = new Map();
    private cleanupInterval: NodeJS.Timeout | null = null;
    private memoryCheckInterval: NodeJS.Timeout | null = null;

    private readonly MEMORY_THRESHOLD = 0.85; // 85%
    private readonly CRITICAL_MEMORY_THRESHOLD = 0.95; // 95%

    constructor() {
        super();
        this.cache = new MultiLevelCache();
        this.deduplicator = new RequestDeduplicator();
        this.aiResponseCache = new AIResponseCache();
        this.initializeConnectionPools();
        console.log("[ResourceManager] Service initialized");
    }

    // ========================================================================
    // INITIALIZATION
    // ========================================================================

    private initializeConnectionPools(): void {
        this.connectionPools.set("database", {
            name: "database",
            active: 0,
            idle: 10,
            waiting: 0,
            maxSize: 50,
            minSize: 5
        });

        this.connectionPools.set("redis", {
            name: "redis",
            active: 0,
            idle: 5,
            waiting: 0,
            maxSize: 20,
            minSize: 2
        });
    }

    start(): void {
        console.log("[ResourceManager] Starting resource management...");

        // Cleanup expired cache entries every 5 minutes
        this.cleanupInterval = setInterval(() => {
            this.performCleanup();
        }, 300000);

        // Check memory every 30 seconds
        this.memoryCheckInterval = setInterval(() => {
            this.checkMemory();
        }, 30000);
    }

    stop(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        if (this.memoryCheckInterval) {
            clearInterval(this.memoryCheckInterval);
            this.memoryCheckInterval = null;
        }
    }

    // ========================================================================
    // CACHE OPERATIONS
    // ========================================================================

    async cacheGet<T>(key: string): Promise<T | null> {
        return this.cache.get<T>(key);
    }

    async cacheSet<T>(key: string, value: T, options?: { ttl?: number; priority?: "low" | "normal" | "high" }): Promise<void> {
        await this.cache.set(key, value, options);
    }

    async cacheDelete(key: string): Promise<boolean> {
        return this.cache.delete(key);
    }

    getCacheStats(): CacheStats {
        return this.cache.getStats();
    }

    // ========================================================================
    // REQUEST DEDUPLICATION
    // ========================================================================

    async deduplicateRequest<T>(key: string, executor: () => Promise<T>): Promise<T> {
        return this.deduplicator.deduplicate(key, executor);
    }

    createRequestKey(...args: any[]): string {
        return this.deduplicator.createKey(...args);
    }

    // ========================================================================
    // AI RESPONSE CACHING
    // ========================================================================

    getCachedAIResponse(prompt: string, model: string): string | null {
        return this.aiResponseCache.get(prompt, model);
    }

    cacheAIResponse(prompt: string, model: string, response: string): void {
        this.aiResponseCache.set(prompt, model, response);
    }

    // ========================================================================
    // MEMORY MANAGEMENT (Improvements #46, #47, #48)
    // ========================================================================

    getMemoryMetrics(): MemoryMetrics {
        const usage = process.memoryUsage();
        return {
            heapUsed: usage.heapUsed,
            heapTotal: usage.heapTotal,
            external: usage.external,
            arrayBuffers: usage.arrayBuffers,
            rss: usage.rss,
            percentUsed: usage.heapUsed / usage.heapTotal
        };
    }

    private checkMemory(): void {
        const metrics = this.getMemoryMetrics();

        if (metrics.percentUsed > this.CRITICAL_MEMORY_THRESHOLD) {
            console.warn("[ResourceManager] CRITICAL: Memory usage at", (metrics.percentUsed * 100).toFixed(1) + "%");
            this.emergencyCleanup();
            this.emit("memory_critical", metrics);
        } else if (metrics.percentUsed > this.MEMORY_THRESHOLD) {
            console.warn("[ResourceManager] WARNING: Memory usage at", (metrics.percentUsed * 100).toFixed(1) + "%");
            this.performCleanup();
            this.emit("memory_warning", metrics);
        }
    }

    private async emergencyCleanup(): Promise<void> {
        console.log("[ResourceManager] Performing emergency cleanup...");

        // Clear caches aggressively
        await this.cache.clear();

        // Force garbage collection if available
        if (global.gc) {
            global.gc();
        }

        this.emit("emergency_cleanup_complete");
    }

    private async performCleanup(): Promise<void> {
        const cleanedCache = await this.cache.cleanup();
        this.deduplicator.cleanup();

        if (cleanedCache > 0) {
            console.log(`[ResourceManager] Cleaned ${cleanedCache} cache entries`);
        }
    }

    // ========================================================================
    // CONNECTION POOL MANAGEMENT (Improvement #52)
    // ========================================================================

    updatePoolStatus(poolName: string, status: Partial<ConnectionPool>): void {
        const pool = this.connectionPools.get(poolName);
        if (pool) {
            Object.assign(pool, status);

            // Check for issues
            if (pool.waiting > 10) {
                this.emit("pool_pressure", { pool: poolName, waiting: pool.waiting });
            }
        }
    }

    getPoolStatus(poolName: string): ConnectionPool | undefined {
        return this.connectionPools.get(poolName);
    }

    getAllPoolsStatus(): ConnectionPool[] {
        return Array.from(this.connectionPools.values());
    }

    shouldScalePool(poolName: string): { scale: "up" | "down" | "none"; reason: string } {
        const pool = this.connectionPools.get(poolName);
        if (!pool) return { scale: "none", reason: "Pool not found" };

        const utilization = pool.active / pool.maxSize;

        if (utilization > 0.8 && pool.waiting > 0) {
            return { scale: "up", reason: `High utilization (${(utilization * 100).toFixed(0)}%) with waiting requests` };
        }

        if (utilization < 0.2 && pool.active + pool.idle > pool.minSize) {
            return { scale: "down", reason: `Low utilization (${(utilization * 100).toFixed(0)}%)` };
        }

        return { scale: "none", reason: "Optimal" };
    }

    // ========================================================================
    // LAZY LOADING (Improvement #27)
    // ========================================================================

    private lazyModules: Map<string, { loader: () => Promise<any>; instance?: any }> = new Map();

    registerLazyModule(name: string, loader: () => Promise<any>): void {
        this.lazyModules.set(name, { loader });
    }

    async getLazyModule<T>(name: string): Promise<T | null> {
        const module = this.lazyModules.get(name);
        if (!module) return null;

        if (!module.instance) {
            console.log(`[ResourceManager] Lazy loading module: ${name}`);
            module.instance = await module.loader();
        }

        return module.instance;
    }

    unloadLazyModule(name: string): boolean {
        const module = this.lazyModules.get(name);
        if (module && module.instance) {
            module.instance = undefined;
            console.log(`[ResourceManager] Unloaded module: ${name}`);
            return true;
        }
        return false;
    }

    // ========================================================================
    // BATCH PROCESSING (Improvement #29)
    // ========================================================================

    private batchQueues: Map<string, { items: any[]; processor: (items: any[]) => Promise<void>; timeout: NodeJS.Timeout | null }> = new Map();

    registerBatchProcessor(name: string, processor: (items: any[]) => Promise<void>, flushIntervalMs: number = 1000): void {
        this.batchQueues.set(name, {
            items: [],
            processor,
            timeout: null
        });
    }

    async addToBatch(name: string, item: any, maxBatchSize: number = 100): Promise<void> {
        const queue = this.batchQueues.get(name);
        if (!queue) throw new Error(`Batch queue not found: ${name}`);

        queue.items.push(item);

        // Flush if batch is full
        if (queue.items.length >= maxBatchSize) {
            await this.flushBatch(name);
        } else if (!queue.timeout) {
            // Set timeout for auto-flush
            queue.timeout = setTimeout(() => this.flushBatch(name), 1000);
        }
    }

    async flushBatch(name: string): Promise<void> {
        const queue = this.batchQueues.get(name);
        if (!queue || queue.items.length === 0) return;

        if (queue.timeout) {
            clearTimeout(queue.timeout);
            queue.timeout = null;
        }

        const items = [...queue.items];
        queue.items = [];

        try {
            await queue.processor(items);
        } catch (error) {
            console.error(`[ResourceManager] Batch processing failed for ${name}:`, error);
            // Re-add items on failure (could implement retry logic)
        }
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    getStatus(): {
        memory: MemoryMetrics;
        cache: CacheStats;
        pools: ConnectionPool[];
        aiResponseCacheStats: { entries: number; hitRate: number };
    } {
        return {
            memory: this.getMemoryMetrics(),
            cache: this.getCacheStats(),
            pools: this.getAllPoolsStatus(),
            aiResponseCacheStats: this.aiResponseCache.getStats()
        };
    }

    async forceCleanup(): Promise<void> {
        console.log("[ResourceManager] Forcing cleanup...");
        await this.performCleanup();

        if (global.gc) {
            global.gc();
            console.log("[ResourceManager] Garbage collection triggered");
        }
    }
}

// Singleton instance
export const resourceManager = new ResourceManagerService();

export default resourceManager;
