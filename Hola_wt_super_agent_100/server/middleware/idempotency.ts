
import { Request, Response, NextFunction } from 'express';
import { log } from '../index';

// Simple in-memory store (Replace with Redis in production)
const idempotencyStore = new Map<string, { status: 'processing' | 'completed'; response?: any }>();
const EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

export const idempotency = (req: Request, res: Response, next: NextFunction) => {
    const key = req.headers['idempotency-key'] as string;

    // Only applicable for mutating methods
    if (!key || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
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
    idempotencyStore.set(key, { status: 'processing' });

    // Hook into response send to cache result
    const originalSend = res.json;
    res.json = function (body) {
        idempotencyStore.set(key, { status: 'completed', response: body });

        // Cleanup after expiry
        setTimeout(() => idempotencyStore.delete(key), EXPIRY_MS);

        return originalSend.call(this, body);
    };

    next();
};
