import Redis from 'ioredis';
import { Logger } from './logger';

export class CacheService {
    private redis: Redis | null = null;
    private isConnected = false;
    private readonly defaultTTL = 60; // 60 seconds

    constructor() {
        this.initialize();
    }

    private initialize() {
        if (process.env.REDIS_URL) {
            try {
                this.redis = new Redis(process.env.REDIS_URL, {
                    maxRetriesPerRequest: 1,
                    retryStrategy: (times) => {
                        if (times > 3) return null; // Stop retrying after 3 attempts
                        return Math.min(times * 100, 2000);
                    },
                    reconnectOnError: (err) => {
                        Logger.error('[Cache] Redis reconnect error', err);
                        return false;
                    }
                });

                this.redis.on('connect', () => {
                    this.isConnected = true;
                    Logger.info('[Cache] Redis connected');
                });

                this.redis.on('error', (err) => {
                    this.isConnected = false;
                    Logger.warn('[Cache] Redis connection error (running in fallback mode):', err.message);
                });

            } catch (error: any) {
                Logger.error('[Cache] Failed to initialize Redis', error);
                this.isConnected = false;
            }
        } else {
            Logger.info('[Cache] REDIS_URL not set, running in memory-only/fallback mode (no caching)');
        }
    }

    /**
     * Get item from cache
     */
    async get<T>(key: string): Promise<T | null> {
        if (!this.isConnected || !this.redis) return null;

        try {
            const data = await this.redis.get(key);
            if (!data) return null;
            return JSON.parse(data) as T;
        } catch (error) {
            Logger.warn(`[Cache] Get error for key ${key}`, error);
            return null;
        }
    }

    /**
     * Set item in cache
     */
    async set(key: string, value: any, ttlSeconds: number = this.defaultTTL): Promise<void> {
        if (!this.isConnected || !this.redis) return;

        try {
            const serialized = JSON.stringify(value);
            await this.redis.setex(key, ttlSeconds, serialized);
        } catch (error) {
            Logger.warn(`[Cache] Set error for key ${key}`, error);
        }
    }

    /**
     * Delete item from cache
     */
    async delete(key: string): Promise<void> {
        if (!this.isConnected || !this.redis) return;
        try {
            await this.redis.del(key);
        } catch (error) {
            Logger.warn(`[Cache] Delete error for key ${key}`, error);
        }
    }

    /**
     * Pattern: Cache-Aside (Get or Set)
     * If key exists, return it.
     * If not, execute fetchingFunction, store result, and return it.
     * 
     * @param key Cache key
     * @param ttlSeconds Time to live
     * @param fetchingFunction Function to retrieve data if cache miss
     */
    async remember<T>(
        key: string,
        ttlSeconds: number,
        fetchingFunction: () => Promise<T>
    ): Promise<T> {
        // 1. Try cache
        const cached = await this.get<T>(key);
        if (cached !== null) {
            return cached;
        }

        // 2. Fetch fresh
        const freshData = await fetchingFunction();

        // 3. Store async (don't await to block response)
        if (freshData !== undefined && freshData !== null) {
            this.set(key, freshData, ttlSeconds).catch(err =>
                Logger.warn(`[Cache] Failed to set cache for key ${key}`, err)
            );
        }

        return freshData;
    }
}

export const cache = new CacheService();
