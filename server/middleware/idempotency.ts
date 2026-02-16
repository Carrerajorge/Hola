
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
    const key = req.headers['idempotency-key'] as string;

    if (!key || typeof key !== 'string') {
        return next();
    }

    if (key.length > MAX_KEY_LENGTH) {
        return res.status(400).json({
            status: 'error',
            code: 'INVALID_KEY',
            message: `Idempotency-Key exceeds max length of ${MAX_KEY_LENGTH}`
        });
    }

    // Only applicable for mutating methods
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        return next();
    }

    const cached = idempotencyStore.get(key);

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
    idempotencyStore.set(key, {
        status: 'processing',
        createdAt: Date.now(),
    });
    purgeExpiredEntries();

    // Hook into response send to cache result
    const originalSend = res.json;
    res.json = function (body) {
        idempotencyStore.set(key, {
            status: 'completed',
            response: body,
            createdAt: Date.now(),
        });

        // Cleanup after expiry
        setTimeout(() => idempotencyStore.delete(key), EXPIRY_MS);

        return originalSend.call(this, body);
    };

    res.on('finish', () => {
        if (res.statusCode >= 500) {
            idempotencyStore.delete(key);
        }
    });

    next();
};
