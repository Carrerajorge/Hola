
import { Request, Response, NextFunction } from 'express';
import { log } from '../index';

// Simple in-memory store for demo (Replace with Redis in production)
const rateLimitStore = new Map<string, { count: number; windowStart: number }>();

const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS = 100; // 100 requests per minute per user

export const rateLimiter = (req: Request, res: Response, next: NextFunction) => {
  // Identify by User ID if authenticated, otherwise IP
  // @ts-ignore - Assuming req.user is populated by auth middleware
  const key = req.user?.id || req.ip || 'unknown';

  const now = Date.now();
  const record = rateLimitStore.get(key) || { count: 0, windowStart: now };

  if (now - record.windowStart > WINDOW_MS) {
    // Reset window
    record.count = 1;
    record.windowStart = now;
  } else {
    record.count++;
  }

  rateLimitStore.set(key, record);

  // Set standard headers
  res.setHeader('X-RateLimit-Limit', MAX_REQUESTS);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, MAX_REQUESTS - record.count));
  res.setHeader('X-RateLimit-Reset', Math.ceil((record.windowStart + WINDOW_MS) / 1000));

  if (record.count > MAX_REQUESTS) {
    log(`[Rate Limit Exceeded] User: ${key} exceeded ${MAX_REQUESTS} req/min`, 'security');

    return res.status(429).json({
      status: 'error',
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests, please try again later.',
      retryAfter: Math.ceil((record.windowStart + WINDOW_MS - now) / 1000)
    });
  }

  next();
};

export const getRateLimitStats = () => {
  return {
    totalKeys: rateLimitStore.size,
    windowMs: WINDOW_MS,
    maxRequests: MAX_REQUESTS
  };
};

export const createRateLimiter = (options: {
  windowMs: number;
  maxRequests: number;
  keyPrefix?: string;
  message?: string;
}) => {
  const store = new Map<string, { count: number; windowStart: number }>();

  return (req: Request, res: Response, next: NextFunction) => {
    // @ts-ignore - Assuming req.user is populated by auth middleware
    const userId = req.user?.id || req.ip || 'unknown';
    const key = (options.keyPrefix ? `${options.keyPrefix}:` : "") + userId;

    const now = Date.now();
    const record = store.get(key) || { count: 0, windowStart: now };

    if (now - record.windowStart > options.windowMs) {
      record.count = 1;
      record.windowStart = now;
    } else {
      record.count++;
    }
    store.set(key, record);

    res.setHeader('X-RateLimit-Limit', options.maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, options.maxRequests - record.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil((record.windowStart + options.windowMs) / 1000));

    if (record.count > options.maxRequests) {
      log(`[Rate Limit Exceeded] key: ${key} exceeded ${options.maxRequests} req/${options.windowMs}ms`, 'security');
      return res.status(429).json({
        status: 'error',
        code: 'RATE_LIMIT_EXCEEDED',
        message: options.message || 'Too many requests, please try again later.',
        retryAfter: Math.ceil((record.windowStart + options.windowMs - now) / 1000)
      });
    }

    next();
  };
};

// Pre-configured rate limiter for admin endpoints (stricter limits)
export const adminRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 30, // 30 requests per minute (stricter than default 100)
  keyPrefix: 'admin',
  message: 'Admin rate limit exceeded. Please wait before retrying.'
});

// Pre-configured rate limiter for authentication endpoints (very strict)
export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 10, // 10 login attempts per 15 minutes
  keyPrefix: 'auth',
  message: 'Too many authentication attempts. Please try again later.'
});
