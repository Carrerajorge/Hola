/**
 * User-Based Rate Limiter Middleware
 * Rate limits by user ID in addition to IP
 */

import { Request, Response, NextFunction } from 'express';
import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import Redis from 'ioredis';
import { cache } from '../lib/cache';
import { createAlert } from '../lib/alertManager';
import { logger } from '../utils/logger';

// Rate limit configurations for different endpoints
const RATE_LIMIT_CONFIGS = {
    // Chat endpoints - more generous
    chat: {
        points: 60,          // 60 requests
        duration: 60,        // per 60 seconds
        blockDuration: 120,  // block for 2 minutes if exceeded
    },
    // Document generation - more restrictive
    documents: {
        points: 20,
        duration: 60,
        blockDuration: 300,
    },
    // Authentication endpoints - strict
    auth: {
        points: 25,
        duration: 60,
        blockDuration: 600,
    },
    // AI endpoints - based on cost
    ai: {
        points: 30,
        duration: 60,
        blockDuration: 180,
    },
    // General API - default
    default: {
        points: 100,
        duration: 60,
        blockDuration: 60,
    },
    // Trusted IPs / Admins / Development - Very high limits
    trusted: {
        points: 10000,
        duration: 60,
        blockDuration: 5,
    },
};

type RateLimitTier = keyof typeof RATE_LIMIT_CONFIGS;

// Store for rate limiters
const rateLimiters: Map<string, RateLimiterMemory | RateLimiterRedis> = new Map();

/**
 * Initialize rate limiter for a tier
 */
function getRateLimiter(tier: RateLimitTier): RateLimiterMemory | RateLimiterRedis {
    const key = tier;

    if (rateLimiters.has(key)) {
        return rateLimiters.get(key)!;
    }

    const config = RATE_LIMIT_CONFIGS[tier];
    const redisClient = cache.getRedisClient();

    let limiter: RateLimiterMemory | RateLimiterRedis;

    if (redisClient) {
        // Use Redis for distributed rate limiting
        limiter = new RateLimiterRedis({
            storeClient: redisClient,
            keyPrefix: `rl_${tier}`,
            points: config.points,
            duration: config.duration,
            blockDuration: config.blockDuration,
        });
    } else {
        // Fallback to in-memory
        limiter = new RateLimiterMemory({
            keyPrefix: `rl_${tier}`,
            points: config.points,
            duration: config.duration,
            blockDuration: config.blockDuration,
        });
    }

    rateLimiters.set(key, limiter);
    return limiter;
}

/**
 * Get rate limit key from request
 * Combines user ID (if authenticated) with IP for uniqueness
 */
function getRateLimitKey(req: Request): string {
    const userId = (req as any).user?.id;
    const ip = req.ip || req.socket.remoteAddress || 'unknown';

    // Authenticated users get their own bucket
    if (userId) {
        return `user_${userId}`;
    }

    // Anonymous users are limited by IP
    return `ip_${ip}`;
}

/**
 * Create user-based rate limiter middleware
 */
export function createUserRateLimiter(tier: RateLimitTier = 'default') {
    return async (req: Request, res: Response, next: NextFunction) => {
        const limiter = getRateLimiter(tier);
        const config = RATE_LIMIT_CONFIGS[tier];
        const key = getRateLimitKey(req);

        // Allow whitelisted IPs/Users (future implementation)
        // if (isWhitelisted(req)) return next();

        try {
            const result = await limiter.consume(key);

            // Add rate limit headers
            res.setHeader('X-RateLimit-Limit', config.points);
            res.setHeader('X-RateLimit-Remaining', result.remainingPoints);
            res.setHeader('X-RateLimit-Reset', new Date(Date.now() + result.msBeforeNext).toISOString());

            next();
        } catch (error) {
            if (error instanceof RateLimiterRes) {
                const retryAfter = Math.ceil(error.msBeforeNext / 1000);

                res.setHeader('Retry-After', retryAfter);
                res.setHeader('X-RateLimit-Limit', config.points);
                res.setHeader('X-RateLimit-Remaining', 0);
                res.setHeader('X-RateLimit-Reset', new Date(Date.now() + error.msBeforeNext).toISOString());

                // Trigger Alert for abuse
                createAlert({
                    type: "rate_limit",
                    service: "api-gateway",
                    severity: "medium", // Escalate to high if critical endpoint
                    message: `Rate limit exceeded for ${tier} tier by ${key}`,
                    resolved: false
                });

                return res.status(429).json({
                    error: 'Too Many Requests',
                    message: 'Has excedido el límite de solicitudes. Por favor espera antes de intentar de nuevo.',
                    retryAfter,
                    tier,
                });
            }

            // Unknown error, let it pass but log it
            logger.error('Rate limiter error:', { error });
            next();
        }
    };
}

/**
 * Create a custom rate limiter for specific routes
 */
export function createCustomRateLimiter(options: {
    windowMs: number;
    maxRequests: number;
    keyPrefix: string;
    message?: string;
}) {
    const redisClient = cache.getRedisClient();
    let limiter: RateLimiterMemory | RateLimiterRedis;
    const duration = Math.ceil(options.windowMs / 1000);

    if (redisClient) {
        limiter = new RateLimiterRedis({
            storeClient: redisClient,
            keyPrefix: options.keyPrefix,
            points: options.maxRequests,
            duration: duration,
        });
    } else {
        limiter = new RateLimiterMemory({
            keyPrefix: options.keyPrefix,
            points: options.maxRequests,
            duration: duration,
        });
    }

    return async (req: Request, res: Response, next: NextFunction) => {
        // Use user ID if authenticated, else IP
        const userId = (req as any).user?.id;
        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        const key = userId ? `user_${userId}` : `ip_${ip}`;

        try {
            const result = await limiter.consume(key);

            res.setHeader('X-RateLimit-Limit', options.maxRequests);
            res.setHeader('X-RateLimit-Remaining', result.remainingPoints);
            res.setHeader('X-RateLimit-Reset', new Date(Date.now() + result.msBeforeNext).toISOString());

            next();
        } catch (error) {
            if (error && typeof error === 'object' && 'msBeforeNext' in error) {
                const limitErr = error as RateLimiterRes;
                const retryAfter = Math.ceil(limitErr.msBeforeNext / 1000);

                res.setHeader('Retry-After', retryAfter);
                res.setHeader('X-RateLimit-Limit', options.maxRequests);
                res.setHeader('X-RateLimit-Remaining', 0);
                res.setHeader('X-RateLimit-Reset', new Date(Date.now() + limitErr.msBeforeNext).toISOString());

                return res.status(429).json({
                    error: 'Too Many Requests',
                    message: options.message || 'Rate limit exceeded.',
                    retryAfter
                });
            }
            // Log unknown error
            console.error('Custom Rate limiter error:', error);
            next();
        }
    };
}

/**
 * Smart Rate Limiter that routes based on path
 * This is the main middleware to be used in routes
 */
export const rateLimiter = (req: Request, res: Response, next: NextFunction) => {
    const path = req.path.toLowerCase();

    // Skip rate limiting for health checks and status endpoints
    if (path.includes('/health') || path.includes('/status') || path === '/') {
        return next();
    }

    // Determine which limiter to use based on path
    let tier: RateLimitTier = 'default';

    // Check for Trusted Role (Admin) or Trusted IP (Internal)
    const user = (req as any).user;
    const ip = req.ip || req.socket.remoteAddress || '';
    const isLocalhost = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip.includes('localhost');

    // Check if user is admin (claims.role or role property depending on object structure)
    const isAdmin = user?.claims?.role === 'admin' || user?.role === 'admin';

    // In development, be more permissive - BYPASS rate limiting entirely
    const isDev = process.env.NODE_ENV === 'development';

    if (isDev) {
        // Skip rate limiting entirely in development
        return next();
    }

    if (isAdmin || isLocalhost) {
        tier = 'trusted';
    } else if (path.includes('/chat') || path.includes('/message')) {
        tier = 'chat';
    } else if (path.includes('/document') || path.includes('/export')) {
        tier = 'documents';
    } else if (path.includes('/auth') || path.includes('/login') || path.includes('/register')) {
        tier = 'auth';
    } else if (path.includes('/ai') || path.includes('/generate') || path.includes('/model')) {
        tier = 'ai';
    }

    createUserRateLimiter(tier)(req, res, next);
};


/**
 * Get internal stats about active rate limiters
 */
export function getRateLimitStats() {
    const stats: Record<string, any> = {};
    for (const [key, limiter] of rateLimiters.entries()) {
        stats[key] = {
            points: (limiter as any).points,
            duration: (limiter as any).duration,
            type: limiter instanceof RateLimiterRedis ? 'Redis' : 'Memory'
        };
    }
    return stats;
}
