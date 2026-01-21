/**
 * User-Based Rate Limiter Middleware
 * Rate limits by user ID in addition to IP
 */

import { Request, Response, NextFunction } from 'express';
import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import Redis from 'ioredis';

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
        points: 10,
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
};

type RateLimitTier = keyof typeof RATE_LIMIT_CONFIGS;

// Store for rate limiters
const rateLimiters: Map<string, RateLimiterMemory | RateLimiterRedis> = new Map();

/**
 * Initialize rate limiter for a tier
 */
function getRateLimiter(tier: RateLimitTier, redisClient?: Redis): RateLimiterMemory | RateLimiterRedis {
    const key = tier;

    if (rateLimiters.has(key)) {
        return rateLimiters.get(key)!;
    }

    const config = RATE_LIMIT_CONFIGS[tier];

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
export function createUserRateLimiter(
    tier: RateLimitTier = 'default',
    redisClient?: Redis
) {
    const limiter = getRateLimiter(tier, redisClient);
    const config = RATE_LIMIT_CONFIGS[tier];

    return async (req: Request, res: Response, next: NextFunction) => {
        const key = getRateLimitKey(req);

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

                return res.status(429).json({
                    error: 'Too Many Requests',
                    message: 'Has excedido el límite de solicitudes. Por favor espera antes de intentar de nuevo.',
                    retryAfter,
                    tier,
                });
            }

            // Unknown error, let it pass
            console.error('Rate limiter error:', error);
            next();
        }
    };
}

/**
 * Apply different rate limits based on path
 */
export function createSmartRateLimiter(redisClient?: Redis) {
    const limiters = {
        chat: createUserRateLimiter('chat', redisClient),
        documents: createUserRateLimiter('documents', redisClient),
        auth: createUserRateLimiter('auth', redisClient),
        ai: createUserRateLimiter('ai', redisClient),
        default: createUserRateLimiter('default', redisClient),
    };

    return (req: Request, res: Response, next: NextFunction) => {
        const path = req.path.toLowerCase();

        // Determine which limiter to use based on path
        if (path.includes('/chat') || path.includes('/message')) {
            return limiters.chat(req, res, next);
        }
        if (path.includes('/document') || path.includes('/export')) {
            return limiters.documents(req, res, next);
        }
        if (path.includes('/auth') || path.includes('/login') || path.includes('/register')) {
            return limiters.auth(req, res, next);
        }
        if (path.includes('/ai') || path.includes('/generate') || path.includes('/model')) {
            return limiters.ai(req, res, next);
        }

        return limiters.default(req, res, next);
    };
}

/**
 * Rate limit status endpoint
 */
export function getRateLimitStatus(req: Request): Promise<{
    tier: RateLimitTier;
    remaining: number;
    limit: number;
    resetTime: Date;
}> {
    return new Promise(async (resolve) => {
        const key = getRateLimitKey(req);
        const tier: RateLimitTier = 'default';
        const config = RATE_LIMIT_CONFIGS[tier];

        try {
            const limiter = getRateLimiter(tier);
            const result = await limiter.get(key);

            resolve({
                tier,
                remaining: result ? result.remainingPoints : config.points,
                limit: config.points,
                resetTime: result
                    ? new Date(Date.now() + result.msBeforeNext)
                    : new Date(Date.now() + config.duration * 1000),
            });
        } catch {
            resolve({
                tier,
                remaining: config.points,
                limit: config.points,
                resetTime: new Date(Date.now() + config.duration * 1000),
            });
        }
    });
}

/**
 * Whitelist check - skip rate limiting for certain users/IPs
 */
const whitelist = new Set<string>([
    // Add admin user IDs or internal IPs here
    // 'user_1',
    // 'ip_127.0.0.1',
]);

export function isWhitelisted(req: Request): boolean {
    const key = getRateLimitKey(req);
    return whitelist.has(key);
}

/**
 * Add to whitelist
 */
export function addToWhitelist(key: string): void {
    whitelist.add(key);
}

/**
 * Remove from whitelist
 */
export function removeFromWhitelist(key: string): void {
    whitelist.delete(key);
}
