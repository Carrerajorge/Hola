/**
 * Enhanced Rate Limiting Middleware
 * 
 * Granular rate limiting by:
 * - User ID (authenticated)
 * - IP address (anonymous)
 * - Endpoint groups
 * - Action types
 */

import type { Request, Response, NextFunction } from 'express';
import { createLogger } from './productionLogger';
import { RateLimitError } from './errorHandler';

const logger = createLogger('RateLimiter');

interface RateLimitConfig {
    windowMs: number;      // Time window in milliseconds
    maxRequests: number;   // Max requests per window
    keyPrefix: string;     // Prefix for storage key
    skipFailedRequests?: boolean;
    message?: string;
}

interface RateLimitEntry {
    count: number;
    resetAt: number;
}

// In-memory store (use Redis in production for horizontal scaling)
const store = new Map<string, RateLimitEntry>();

// Cleanup old entries periodically
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
        if (entry.resetAt <= now) {
            store.delete(key);
        }
    }
}, 60000); // Clean up every minute

/**
 * Get rate limit key for request
 */
function getKey(req: Request, prefix: string): string {
    // Use user ID if authenticated
    const userId = (req as any).user?.id;
    if (userId) {
        return `${prefix}:user:${userId}`;
    }

    // Fall back to IP
    const ip = req.ip ||
        req.headers['x-forwarded-for']?.toString().split(',')[0] ||
        req.socket.remoteAddress ||
        'unknown';
    return `${prefix}:ip:${ip}`;
}

/**
 * Check and update rate limit
 */
function checkRateLimit(key: string, config: RateLimitConfig): {
    allowed: boolean;
    remaining: number;
    resetAt: number;
} {
    const now = Date.now();
    const entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
        // Create new window
        const resetAt = now + config.windowMs;
        store.set(key, { count: 1, resetAt });
        return { allowed: true, remaining: config.maxRequests - 1, resetAt };
    }

    if (entry.count >= config.maxRequests) {
        return { allowed: false, remaining: 0, resetAt: entry.resetAt };
    }

    entry.count++;
    return { allowed: true, remaining: config.maxRequests - entry.count, resetAt: entry.resetAt };
}

/**
 * Create rate limiter middleware
 */
export function createRateLimiter(config: Partial<RateLimitConfig> = {}) {
    const finalConfig: RateLimitConfig = {
        windowMs: config.windowMs || 60000,        // 1 minute default
        maxRequests: config.maxRequests || 100,    // 100 requests default
        keyPrefix: config.keyPrefix || 'rl',
        skipFailedRequests: config.skipFailedRequests || false,
        message: config.message || 'Too many requests, please try again later.',
    };

    return (req: Request, res: Response, next: NextFunction) => {
        const key = getKey(req, finalConfig.keyPrefix);
        const result = checkRateLimit(key, finalConfig);

        // Set rate limit headers
        res.setHeader('X-RateLimit-Limit', finalConfig.maxRequests);
        res.setHeader('X-RateLimit-Remaining', result.remaining);
        res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));

        if (!result.allowed) {
            res.setHeader('Retry-After', Math.ceil((result.resetAt - Date.now()) / 1000));

            logger.warn('Rate limit exceeded', {
                key,
                limit: finalConfig.maxRequests,
                window: finalConfig.windowMs,
            });

            throw new RateLimitError();
        }

        next();
    };
}

// Pre-configured limiters for common use cases

/**
 * Strict limiter for authentication endpoints
 */
export const authRateLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 5,           // 5 attempts
    keyPrefix: 'rl:auth',
    message: 'Too many authentication attempts, please try again in 15 minutes.',
});

/**
 * API rate limiter (general)
 */
export const apiRateLimiter = createRateLimiter({
    windowMs: 60 * 1000,     // 1 minute
    maxRequests: 60,         // 60 requests per minute
    keyPrefix: 'rl:api',
});

/**
 * Chat rate limiter (LLM calls)
 */
export const chatRateLimiter = createRateLimiter({
    windowMs: 60 * 1000,     // 1 minute
    maxRequests: 20,         // 20 messages per minute
    keyPrefix: 'rl:chat',
    message: 'Message rate limit exceeded. Please wait before sending more messages.',
});

/**
 * File upload limiter
 */
export const uploadRateLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 50,          // 50 uploads per hour
    keyPrefix: 'rl:upload',
    message: 'Upload limit exceeded. Please try again later.',
});

/**
 * Admin action limiter
 */
export const adminRateLimiter = createRateLimiter({
    windowMs: 60 * 1000,     // 1 minute
    maxRequests: 30,         // 30 admin actions per minute
    keyPrefix: 'rl:admin',
});

/**
 * Search limiter
 */
export const searchRateLimiter = createRateLimiter({
    windowMs: 60 * 1000,     // 1 minute
    maxRequests: 30,         // 30 searches per minute
    keyPrefix: 'rl:search',
});
