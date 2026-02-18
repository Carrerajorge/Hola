import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger';

const logger = createLogger('idempotency');

interface IdempotencyEntry {
    status: 'processing' | 'completed';
    response?: any;
    statusCode?: number;
}

const EXPIRY_SECONDS = 86400; // 24 hours
const MAX_KEY_LENGTH = 256;

// ─── In-Memory Backend (fallback) ──────────────────────────────────
const memoryStore = new Map<string, IdempotencyEntry>();

async function memGet(key: string): Promise<IdempotencyEntry | null> {
    return memoryStore.get(key) ?? null;
}

async function memSet(key: string, entry: IdempotencyEntry): Promise<void> {
    memoryStore.set(key, entry);
    // Auto-cleanup after expiry to prevent unbounded memory growth.
    setTimeout(() => memoryStore.delete(key), EXPIRY_SECONDS * 1000);
}

// ─── Redis Backend (preferred when available) ──────────────────────
let redisClient: any = null;
let redisAvailable = false;

async function initRedis(): Promise<void> {
    const url = process.env.REDIS_URL;
    if (!url) return;

    try {
        const { default: Redis } = await import('ioredis');
        redisClient = new Redis(url, {
            keyPrefix: 'idempotency:',
            connectTimeout: 3000,
            maxRetriesPerRequest: 1,
            lazyConnect: true,
        });
        await redisClient.connect();
        redisAvailable = true;
        logger.info('Redis backend connected for idempotency');
    } catch {
        logger.warn('Redis unavailable for idempotency, using in-memory fallback');
        redisClient = null;
        redisAvailable = false;
    }
}

// Best-effort Redis initialization at import time (non-blocking).
initRedis().catch(() => {});

async function redisGet(key: string): Promise<IdempotencyEntry | null> {
    if (!redisAvailable || !redisClient) return memGet(key);
    try {
        const raw = await redisClient.get(key);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return memGet(key);
    }
}

async function redisSet(key: string, entry: IdempotencyEntry): Promise<void> {
    if (!redisAvailable || !redisClient) {
        await memSet(key, entry);
        return;
    }
    try {
        await redisClient.setex(key, EXPIRY_SECONDS, JSON.stringify(entry));
    } catch {
        await memSet(key, entry);
    }
}

// ─── Unified accessors ─────────────────────────────────────────────
async function getEntry(key: string): Promise<IdempotencyEntry | null> {
    return redisAvailable ? redisGet(key) : memGet(key);
}

async function setEntry(key: string, entry: IdempotencyEntry): Promise<void> {
    return redisAvailable ? redisSet(key, entry) : memSet(key, entry);
}

// ─── Middleware ─────────────────────────────────────────────────────
export const idempotency = (req: Request, res: Response, next: NextFunction) => {
    const rawKey = req.headers['idempotency-key'] as string | undefined;

    // Only applicable for mutating methods with an explicit key.
    if (!rawKey || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        return next();
    }

    // Sanitize key: limit length, strip control characters.
    const key = rawKey.replace(/[\x00-\x1f]/g, '').slice(0, MAX_KEY_LENGTH);
    if (!key) return next();

    getEntry(key)
        .then((cached) => {
            if (cached) {
                if (cached.status === 'processing') {
                    return res.status(409).json({
                        status: 'error',
                        code: 'CONFLICT',
                        message: 'Request with this Idempotency-Key is currently processing.',
                    });
                }

                if (cached.status === 'completed') {
                    logger.debug('Idempotency cache hit', { key });
                    return res.status(cached.statusCode ?? 200).json(cached.response);
                }
            }

            // Mark as processing
            setEntry(key, { status: 'processing' }).catch(() => {});

            // Hook into response to cache the result
            const originalJson = res.json;
            res.json = function (body) {
                setEntry(key, {
                    status: 'completed',
                    response: body,
                    statusCode: res.statusCode,
                }).catch(() => {});
                return originalJson.call(this, body);
            };

            next();
        })
        .catch(() => {
            // If store lookup fails, proceed without idempotency (graceful degradation).
            next();
        });
};
