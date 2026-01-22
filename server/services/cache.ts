import Redis from "ioredis";
import { ICacheService } from "../lib/interfaces";
import { Logger } from "../lib/logger";

export class RedisCacheService implements ICacheService {
    private client: Redis;

    constructor() {
        this.client = new Redis({
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379'),
            password: process.env.REDIS_PASSWORD || undefined,
            keyPrefix: 'cache:',
        });

        this.client.on('error', (err) => {
            Logger.error('Redis Cache Error', err);
        });
    }

    async get<T>(key: string): Promise<T | null> {
        try {
            const data = await this.client.get(key);
            if (!data) return null;
            return JSON.parse(data) as T;
        } catch (error) {
            Logger.error(`Cache Get Error (${key})`, error);
            return null;
        }
    }

    async set<T>(key: string, value: T, ttlSeconds: number = 300): Promise<void> {
        try {
            const data = JSON.stringify(value);
            await this.client.setex(key, ttlSeconds, data);
        } catch (error) {
            Logger.error(`Cache Set Error (${key})`, error);
        }
    }

    async del(key: string): Promise<void> {
        try {
            await this.client.del(key);
        } catch (error) {
            Logger.error(`Cache Del Error (${key})`, error);
        }
    }
}

// Singleton
let cacheInstance: RedisCacheService | null = null;

export function getCacheService(): ICacheService {
    if (!cacheInstance) {
        cacheInstance = new RedisCacheService();
    }
    return cacheInstance;
}

export const cacheService = {
    getCacheService
};
