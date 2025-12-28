import type { Request, Response, NextFunction } from "express";

/**
 * Enterprise-grade Rate Limiter with Sliding Window Algorithm
 * 
 * IMPORTANT SCALING NOTE:
 * This implementation uses an in-memory store which works well for single-node deployments.
 * For multi-node/horizontally scaled deployments (required for millions of users), you should:
 * 1. Replace the in-memory Map with Redis/Upstash for distributed rate limiting
 * 2. Or use a reverse proxy (nginx, CloudFlare) with built-in rate limiting
 * 3. Or implement a sticky session strategy with the in-memory limiter
 * 
 * The current implementation protects against brute-force attacks on a per-node basis
 * and is suitable for development and single-node production deployments.
 */

interface SlidingWindowEntry {
  timestamps: number[];
}

interface RateLimiterConfig {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (req: Request) => string;
  message?: string;
  skipFailCallback?: (req: Request) => boolean;
}

const DEFAULT_WINDOW_MS = 60000;
const DEFAULT_MAX_REQUESTS = 100;
const AUTH_MAX_REQUESTS = 10;
const CLEANUP_INTERVAL_MS = 60000;

const rateLimitStore: Map<string, SlidingWindowEntry> = new Map();

function getClientIp(req: Request): string {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (forwardedFor) {
    const ips = Array.isArray(forwardedFor) 
      ? forwardedFor[0] 
      : forwardedFor.split(",")[0];
    return ips.trim();
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}

function cleanupExpiredEntries(): void {
  const now = Date.now();
  let cleanedCount = 0;
  
  for (const [key, entry] of rateLimitStore.entries()) {
    const validTimestamps = entry.timestamps.filter(ts => now - ts < DEFAULT_WINDOW_MS * 2);
    
    if (validTimestamps.length === 0) {
      rateLimitStore.delete(key);
      cleanedCount++;
    } else {
      entry.timestamps = validTimestamps;
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`[RateLimiter] Cleanup completed: removed ${cleanedCount} expired entries, ${rateLimitStore.size} entries remaining`);
  }
}

setInterval(cleanupExpiredEntries, CLEANUP_INTERVAL_MS);

function getSlidingWindowCount(key: string, windowMs: number): number {
  const now = Date.now();
  const entry = rateLimitStore.get(key);
  
  if (!entry) {
    return 0;
  }
  
  const windowStart = now - windowMs;
  const validTimestamps = entry.timestamps.filter(ts => ts > windowStart);
  
  entry.timestamps = validTimestamps;
  
  return validTimestamps.length;
}

function recordRequest(key: string): void {
  const now = Date.now();
  let entry = rateLimitStore.get(key);
  
  if (!entry) {
    entry = { timestamps: [] };
    rateLimitStore.set(key, entry);
  }
  
  entry.timestamps.push(now);
}

function getOldestTimestampInWindow(key: string, windowMs: number): number | null {
  const now = Date.now();
  const entry = rateLimitStore.get(key);
  
  if (!entry || entry.timestamps.length === 0) {
    return null;
  }
  
  const windowStart = now - windowMs;
  const validTimestamps = entry.timestamps.filter(ts => ts > windowStart);
  
  if (validTimestamps.length === 0) {
    return null;
  }
  
  return Math.min(...validTimestamps);
}

function isAuthEndpoint(path: string): boolean {
  const authPaths = [
    "/api/login",
    "/api/callback",
    "/api/auth/login",
    "/api/auth/admin-login",
    "/api/auth/register",
    "/api/auth/signup",
    "/api/auth/reset-password",
    "/api/auth/forgot-password"
  ];
  
  return authPaths.some(authPath => 
    path === authPath || path.startsWith(authPath + "/")
  );
}

export function rateLimiter(config: Partial<RateLimiterConfig> = {}) {
  const {
    windowMs = DEFAULT_WINDOW_MS,
    maxRequests = DEFAULT_MAX_REQUESTS,
    keyGenerator = getClientIp,
    message = "Too many requests, please try again later.",
    skipFailCallback
  } = config;

  return function rateLimiterMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    if (skipFailCallback && skipFailCallback(req)) {
      next();
      return;
    }

    const key = `${keyGenerator(req)}:general`;
    const currentCount = getSlidingWindowCount(key, windowMs);
    
    recordRequest(key);
    
    const remaining = Math.max(0, maxRequests - currentCount - 1);
    const resetTime = Date.now() + windowMs;
    
    res.setHeader("X-RateLimit-Limit", maxRequests.toString());
    res.setHeader("X-RateLimit-Remaining", remaining.toString());
    res.setHeader("X-RateLimit-Reset", Math.ceil(resetTime / 1000).toString());

    if (currentCount >= maxRequests) {
      const oldestTimestamp = getOldestTimestampInWindow(key, windowMs);
      const retryAfterMs = oldestTimestamp 
        ? (oldestTimestamp + windowMs) - Date.now()
        : windowMs;
      const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
      
      const clientIp = getClientIp(req);
      console.log(`[RateLimiter] Rate limit exceeded: ip=${clientIp}, path=${req.path}, method=${req.method}, count=${currentCount + 1}, limit=${maxRequests}, retryAfter=${retryAfterSeconds}s`);
      
      res.setHeader("Retry-After", retryAfterSeconds.toString());
      res.status(429).json({
        error: {
          message,
          code: "RATE_LIMIT_EXCEEDED",
          retryAfter: retryAfterSeconds
        }
      });
      return;
    }

    next();
  };
}

export function authRateLimiter(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const windowMs = DEFAULT_WINDOW_MS;
  const maxRequests = AUTH_MAX_REQUESTS;
  
  if (!isAuthEndpoint(req.path)) {
    next();
    return;
  }
  
  const clientIp = getClientIp(req);
  const key = `${clientIp}:auth`;
  const currentCount = getSlidingWindowCount(key, windowMs);
  
  recordRequest(key);
  
  const remaining = Math.max(0, maxRequests - currentCount - 1);
  const resetTime = Date.now() + windowMs;
  
  res.setHeader("X-RateLimit-Limit", maxRequests.toString());
  res.setHeader("X-RateLimit-Remaining", remaining.toString());
  res.setHeader("X-RateLimit-Reset", Math.ceil(resetTime / 1000).toString());

  if (currentCount >= maxRequests) {
    const oldestTimestamp = getOldestTimestampInWindow(key, windowMs);
    const retryAfterMs = oldestTimestamp 
      ? (oldestTimestamp + windowMs) - Date.now()
      : windowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    
    console.log(`[RateLimiter] Auth rate limit exceeded: ip=${clientIp}, path=${req.path}, method=${req.method}, count=${currentCount + 1}, limit=${maxRequests}, retryAfter=${retryAfterSeconds}s`);
    
    res.setHeader("Retry-After", retryAfterSeconds.toString());
    res.status(429).json({
      error: {
        message: "Too many authentication attempts. Please try again later.",
        code: "AUTH_RATE_LIMIT_EXCEEDED",
        retryAfter: retryAfterSeconds
      }
    });
    return;
  }

  next();
}

export function createRateLimiter(options: {
  windowMs?: number;
  maxRequests?: number;
  keyPrefix?: string;
  message?: string;
}) {
  const {
    windowMs = DEFAULT_WINDOW_MS,
    maxRequests = DEFAULT_MAX_REQUESTS,
    keyPrefix = "custom",
    message = "Too many requests, please try again later."
  } = options;

  return function customRateLimiter(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    const clientIp = getClientIp(req);
    const key = `${clientIp}:${keyPrefix}`;
    const currentCount = getSlidingWindowCount(key, windowMs);
    
    recordRequest(key);
    
    const remaining = Math.max(0, maxRequests - currentCount - 1);
    const resetTime = Date.now() + windowMs;
    
    res.setHeader("X-RateLimit-Limit", maxRequests.toString());
    res.setHeader("X-RateLimit-Remaining", remaining.toString());
    res.setHeader("X-RateLimit-Reset", Math.ceil(resetTime / 1000).toString());

    if (currentCount >= maxRequests) {
      const oldestTimestamp = getOldestTimestampInWindow(key, windowMs);
      const retryAfterMs = oldestTimestamp 
        ? (oldestTimestamp + windowMs) - Date.now()
        : windowMs;
      const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
      
      console.log(`[RateLimiter] Custom rate limit exceeded: ip=${clientIp}, path=${req.path}, method=${req.method}, prefix=${keyPrefix}, count=${currentCount + 1}, limit=${maxRequests}, retryAfter=${retryAfterSeconds}s`);
      
      res.setHeader("Retry-After", retryAfterSeconds.toString());
      res.status(429).json({
        error: {
          message,
          code: "RATE_LIMIT_EXCEEDED",
          retryAfter: retryAfterSeconds
        }
      });
      return;
    }

    next();
  };
}

export const apiLimiter = createRateLimiter({
  windowMs: DEFAULT_WINDOW_MS,
  maxRequests: DEFAULT_MAX_REQUESTS,
  keyPrefix: "api",
  message: "API rate limit exceeded. Please wait before making more requests."
});

export const chatLimiter = createRateLimiter({
  windowMs: DEFAULT_WINDOW_MS,
  maxRequests: 30,
  keyPrefix: "chat",
  message: "Chat rate limit exceeded. Please slow down your messages."
});

export const adminLimiter = createRateLimiter({
  windowMs: DEFAULT_WINDOW_MS,
  maxRequests: 200,
  keyPrefix: "admin",
  message: "Admin API rate limit exceeded."
});

export const heavyLimiter = createRateLimiter({
  windowMs: DEFAULT_WINDOW_MS,
  maxRequests: 10,
  keyPrefix: "heavy",
  message: "Heavy operation rate limit exceeded. Please wait before retrying."
});

export function getRateLimitStats(): {
  totalTracked: number;
  activeEntries: number;
  entriesByPrefix: Record<string, number>;
} {
  const now = Date.now();
  const entriesByPrefix: Record<string, number> = {};
  let activeEntries = 0;
  
  for (const [key, entry] of rateLimitStore.entries()) {
    const validCount = entry.timestamps.filter(ts => now - ts < DEFAULT_WINDOW_MS * 2).length;
    
    if (validCount > 0) {
      activeEntries++;
      const prefix = key.split(":")[1] || "unknown";
      entriesByPrefix[prefix] = (entriesByPrefix[prefix] || 0) + 1;
    }
  }
  
  return {
    totalTracked: rateLimitStore.size,
    activeEntries,
    entriesByPrefix
  };
}

export function clearRateLimitStore(): void {
  rateLimitStore.clear();
  console.log("[RateLimiter] Rate limit store cleared");
}
