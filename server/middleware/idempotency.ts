
import { Request, Response, NextFunction } from 'express';
import { log } from '../index';

interface IdempotencyEntry {
    status: 'processing' | 'completed';
    response?: any;
    createdAt: number;
}

// Simple in-memory store (replace with Redis in production)
const idempotencyStore = new Map<string, IdempotencyEntry>();
const EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_ENTRIES = 5000;
const MAX_KEY_LENGTH = 128;
const MIN_KEY_LENGTH = 8;
const MAX_IDEMPOTENCY_RESPONSE_BYTES = 50 * 1024;
const KEY_PREFIX_MAX = 192;

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._-]+$/;

function purgeExpiredEntries() {
    const now = Date.now();
    for (const [key, value] of idempotencyStore.entries()) {
        if (now - value.createdAt > EXPIRY_MS) {
            idempotencyStore.delete(key);
        }
    }

    if (idempotencyStore.size <= MAX_ENTRIES) {
        return;
    }

    // Keep newest entries by insertion order fallback when size spikes.
    const overflow = idempotencyStore.size - MAX_ENTRIES;
    if (overflow <= 0) return;

    const staleKeys = Array.from(idempotencyStore.keys()).slice(0, overflow);
    for (const staleKey of staleKeys) {
        idempotencyStore.delete(staleKey);
    }
}

setInterval(purgeExpiredEntries, 60 * 60 * 1000).unref();

export const idempotency = (req: Request, res: Response, next: NextFunction) => {
    const key = req.headers['idempotency-key'];

    if (!key || typeof key !== 'string') {
        return next();
    }

    if (key.length < MIN_KEY_LENGTH || key.length > MAX_KEY_LENGTH || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
        return res.status(400).json({
            status: 'error',
            code: 'INVALID_KEY',
            message: `Invalid Idempotency-Key`
        });
    }

    const userScope = (req as any).user?.id || req.ip || "anonymous";
    const scope = String(userScope).slice(0, 64);
    const scopedKey = `${scope}:${key}`.slice(0, KEY_PREFIX_MAX + MAX_KEY_LENGTH);

    // Only applicable for mutating methods
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        return next();
    }

    const cached = idempotencyStore.get(scopedKey);

    if (cached) {
        if (cached.status === 'processing') {
            // Request is currently being processed - conflict
            return res.status(409).json({
                status: 'error',
                code: 'CONFLICT',
                message: 'Request with this Idempotency-Key is currently processing.'
            });
        }

        if (cached.status === 'completed') {
            log(`[Idempotency Hit] Key: ${key}`, 'api');
            return res.status(200).json(cached.response);
        }
    }

    // Mark as processing
        idempotencyStore.set(scopedKey, {
            status: 'processing',
            createdAt: Date.now(),
        });
    purgeExpiredEntries();

    // Hook into response send to cache result
    const canCacheBody = (body: any): boolean => {
        try {
            if (typeof body === "string") {
                return Buffer.byteLength(body, "utf8") <= MAX_IDEMPOTENCY_RESPONSE_BYTES;
            }
            if (typeof body === "undefined" || body === null) return true;
            return JSON.stringify(body).length <= MAX_IDEMPOTENCY_RESPONSE_BYTES;
        } catch {
            return false;
        }
    };

    const cacheCompletedResponse = (body: any) => {
        if (!canCacheBody(body)) {
            return;
        }
        idempotencyStore.set(scopedKey, {
            status: 'completed',
            response: body,
            createdAt: Date.now(),
        });

        // Cleanup after expiry
        setTimeout(() => idempotencyStore.delete(scopedKey), EXPIRY_MS);
    };

    const originalJson = res.json;
    const originalSend = res.send;
    res.json = function (body: any) {
        cacheCompletedResponse(body);
        return originalJson.call(this, body);
    };
    res.send = function (body: any) {
        cacheCompletedResponse(body);
        return originalSend.call(this, body);
    };

    res.on('finish', () => {
        if (res.statusCode >= 500) {
            idempotencyStore.delete(scopedKey);
        }
    });

    next();
};
