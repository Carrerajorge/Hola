import { createHash } from "crypto";
import { z } from "zod";

export const CacheEntrySchema = z.object({
  url: z.string(),
  urlHash: z.string(),
  queryHash: z.string().optional(),
  content: z.string(),
  title: z.string().optional(),
  etag: z.string().optional(),
  lastModified: z.string().optional(),
  contentType: z.string().optional(),
  fetchMethod: z.enum(["fetch", "browser"]),
  cachedAt: z.number(),
  expiresAt: z.number(),
  hitCount: z.number().default(0),
  lastAccessedAt: z.number(),
  ttlMs: z.number(),
});

export type CacheEntry = z.infer<typeof CacheEntrySchema>;

export interface CacheOptions {
  maxEntries: number;
  defaultTtlMs: number;
  fetchTtlMs: number;
  browserTtlMs: number;
  cleanupIntervalMs: number;
  maxMemoryMb: number;
  maxContentSizeBytes: number;
}

export interface CacheStats {
  entries: number;
  hits: number;
  misses: number;
  hitRate: number;
  memoryUsageMb: number;
  oldestEntryAge: number;
}

const DEFAULT_CACHE_OPTIONS: CacheOptions = {
  maxEntries: 500,
  defaultTtlMs: 5 * 60 * 1000,
  fetchTtlMs: 10 * 60 * 1000,
  browserTtlMs: 5 * 60 * 1000,
  cleanupIntervalMs: 60 * 1000,
  maxMemoryMb: 50,
  maxContentSizeBytes: 1024 * 1024,
};

export class ResponseCache {
  private cache: Map<string, CacheEntry> = new Map();
  private queryIndex: Map<string, Set<string>> = new Map();
  private options: CacheOptions;
  private hits = 0;
  private misses = 0;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private currentMemoryBytes = 0;

  constructor(options: Partial<CacheOptions> = {}) {
    this.options = { ...DEFAULT_CACHE_OPTIONS, ...options };
    this.startCleanup();
  }

  private estimateEntrySize(entry: CacheEntry): number {
    return entry.content.length + (entry.title?.length || 0) + entry.url.length + 200;
  }

  private startCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.cleanupTimer = setInterval(() => this.cleanup(), this.options.cleanupIntervalMs);
  }

  static hashUrl(url: string): string {
    return createHash("sha256").update(url.toLowerCase()).digest("hex").slice(0, 16);
  }

  static hashQuery(query: string): string {
    const normalized = query.toLowerCase().replace(/\s+/g, " ").trim();
    return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  }

  get(urlOrHash: string, queryHash?: string): CacheEntry | null {
    const urlHash = urlOrHash.length === 16 ? urlOrHash : ResponseCache.hashUrl(urlOrHash);
    const entry = this.cache.get(urlHash);
    
    if (!entry) {
      this.misses++;
      return null;
    }
    
    if (Date.now() > entry.expiresAt) {
      this.currentMemoryBytes -= this.estimateEntrySize(entry);
      this.cache.delete(urlHash);
      this.removeFromQueryIndex(urlHash, entry.queryHash);
      this.misses++;
      return null;
    }
    
    entry.hitCount++;
    entry.lastAccessedAt = Date.now();
    this.hits++;
    
    return entry;
  }

  set(
    url: string,
    content: string,
    options: {
      title?: string;
      etag?: string;
      lastModified?: string;
      contentType?: string;
      fetchMethod: "fetch" | "browser";
      queryHash?: string;
      ttlMs?: number;
    }
  ): boolean {
    if (content.length > this.options.maxContentSizeBytes) {
      console.warn(`[ResponseCache] Content too large for caching: ${content.length} bytes (max: ${this.options.maxContentSizeBytes})`);
      return false;
    }
    
    const urlHash = ResponseCache.hashUrl(url);
    const now = Date.now();
    
    const ttlMs = options.ttlMs || 
      (options.fetchMethod === "fetch" ? this.options.fetchTtlMs : this.options.browserTtlMs);
    
    const entry: CacheEntry = {
      url,
      urlHash,
      queryHash: options.queryHash,
      content,
      title: options.title,
      etag: options.etag,
      lastModified: options.lastModified,
      contentType: options.contentType,
      fetchMethod: options.fetchMethod,
      cachedAt: now,
      expiresAt: now + ttlMs,
      hitCount: 0,
      lastAccessedAt: now,
      ttlMs,
    };
    
    const entrySize = this.estimateEntrySize(entry);
    const maxBytes = this.options.maxMemoryMb * 1024 * 1024;
    
    const existingEntry = this.cache.get(urlHash);
    if (existingEntry) {
      this.currentMemoryBytes -= this.estimateEntrySize(existingEntry);
    }
    
    while (this.currentMemoryBytes + entrySize > maxBytes && this.cache.size > 0) {
      this.evictOldest();
    }
    
    if (this.cache.size >= this.options.maxEntries) {
      this.evictOldest();
    }
    
    this.cache.set(urlHash, entry);
    this.currentMemoryBytes += entrySize;
    
    if (options.queryHash) {
      this.addToQueryIndex(urlHash, options.queryHash);
    }
    
    return true;
  }

  getConditionalHeaders(url: string): Record<string, string> | null {
    const entry = this.cache.get(ResponseCache.hashUrl(url));
    if (!entry) {
      return null;
    }
    
    const headers: Record<string, string> = {};
    if (entry.etag) {
      headers["If-None-Match"] = entry.etag;
    }
    if (entry.lastModified) {
      headers["If-Modified-Since"] = entry.lastModified;
    }
    
    return Object.keys(headers).length > 0 ? headers : null;
  }

  handleNotModified(url: string, newTtlMs?: number): CacheEntry | null {
    const urlHash = ResponseCache.hashUrl(url);
    const entry = this.cache.get(urlHash);
    
    if (!entry) {
      return null;
    }
    
    const ttlMs = newTtlMs || entry.ttlMs;
    entry.expiresAt = Date.now() + ttlMs;
    entry.lastAccessedAt = Date.now();
    entry.hitCount++;
    this.hits++;
    
    return entry;
  }

  getByQuery(queryHash: string): CacheEntry[] {
    const urlHashes = this.queryIndex.get(queryHash);
    if (!urlHashes) {
      return [];
    }
    
    const entries: CacheEntry[] = [];
    for (const urlHash of urlHashes) {
      const entry = this.get(urlHash);
      if (entry) {
        entries.push(entry);
      }
    }
    
    return entries;
  }

  prefetch(urls: string[], queryHash?: string): void {
  }

  invalidate(url: string): boolean {
    const urlHash = ResponseCache.hashUrl(url);
    const entry = this.cache.get(urlHash);
    
    if (entry) {
      this.currentMemoryBytes -= this.estimateEntrySize(entry);
      this.removeFromQueryIndex(urlHash, entry.queryHash);
      this.cache.delete(urlHash);
      return true;
    }
    
    return false;
  }

  invalidateByQuery(queryHash: string): number {
    const urlHashes = this.queryIndex.get(queryHash);
    if (!urlHashes) {
      return 0;
    }
    
    let count = 0;
    for (const urlHash of urlHashes) {
      const entry = this.cache.get(urlHash);
      if (entry) {
        this.currentMemoryBytes -= this.estimateEntrySize(entry);
      }
      if (this.cache.delete(urlHash)) {
        count++;
      }
    }
    
    this.queryIndex.delete(queryHash);
    return count;
  }

  clear(): void {
    this.cache.clear();
    this.queryIndex.clear();
    this.hits = 0;
    this.misses = 0;
    this.currentMemoryBytes = 0;
  }

  getStats(): CacheStats {
    const entries = this.cache.size;
    const totalRequests = this.hits + this.misses;
    
    let oldestAge = 0;
    let totalSize = 0;
    
    for (const entry of this.cache.values()) {
      const age = Date.now() - entry.cachedAt;
      if (age > oldestAge) {
        oldestAge = age;
      }
      totalSize += entry.content.length + (entry.title?.length || 0);
    }
    
    return {
      entries,
      hits: this.hits,
      misses: this.misses,
      hitRate: totalRequests > 0 ? this.hits / totalRequests : 0,
      memoryUsageMb: totalSize / (1024 * 1024),
      oldestEntryAge: oldestAge,
    };
  }

  private addToQueryIndex(urlHash: string, queryHash: string): void {
    let hashes = this.queryIndex.get(queryHash);
    if (!hashes) {
      hashes = new Set();
      this.queryIndex.set(queryHash, hashes);
    }
    hashes.add(urlHash);
  }

  private removeFromQueryIndex(urlHash: string, queryHash?: string): void {
    if (!queryHash) return;
    
    const hashes = this.queryIndex.get(queryHash);
    if (hashes) {
      hashes.delete(urlHash);
      if (hashes.size === 0) {
        this.queryIndex.delete(queryHash);
      }
    }
  }

  private evictOldest(): void {
    let oldestHash: string | null = null;
    let oldestAccess = Infinity;
    
    for (const [hash, entry] of this.cache.entries()) {
      if (entry.lastAccessedAt < oldestAccess) {
        oldestAccess = entry.lastAccessedAt;
        oldestHash = hash;
      }
    }
    
    if (oldestHash) {
      const entry = this.cache.get(oldestHash);
      if (entry) {
        this.currentMemoryBytes -= this.estimateEntrySize(entry);
        this.removeFromQueryIndex(oldestHash, entry.queryHash);
      }
      this.cache.delete(oldestHash);
    }
  }

  private cleanup(): void {
    const now = Date.now();
    const expired: string[] = [];
    
    for (const [hash, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        expired.push(hash);
      }
    }
    
    for (const hash of expired) {
      const entry = this.cache.get(hash);
      if (entry) {
        this.currentMemoryBytes -= this.estimateEntrySize(entry);
        this.removeFromQueryIndex(hash, entry.queryHash);
      }
      this.cache.delete(hash);
    }
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.clear();
  }
}

export const responseCache = new ResponseCache();
