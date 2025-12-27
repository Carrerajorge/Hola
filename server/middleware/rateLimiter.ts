import type { Request, Response, NextFunction } from "express";

export interface RateLimitRecord {
  count: number;
  resetTime: number;
}

const requestCounts: Map<string, RateLimitRecord> = new Map();

const CLEANUP_INTERVAL = 60000;
setInterval(() => {
  const now = Date.now();
  const entries = Array.from(requestCounts.entries());
  for (const [key, record] of entries) {
    if (record.resetTime < now) {
      requestCounts.delete(key);
    }
  }
}, CLEANUP_INTERVAL);

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
  keyGenerator?: (req: Request) => string;
  message?: string;
}

export function createRateLimiter(options: RateLimiterOptions) {
  const {
    windowMs,
    max,
    keyGenerator = (req: Request) => {
      const user = (req as any).user;
      return user?.id || req.ip || "anonymous";
    },
    message = "Too many requests, please try again later.",
  } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyGenerator(req);
    const now = Date.now();

    let record = requestCounts.get(key);

    if (!record || record.resetTime < now) {
      record = {
        count: 0,
        resetTime: now + windowMs,
      };
      requestCounts.set(key, record);
    }

    record.count++;

    const remaining = Math.max(0, max - record.count);
    const resetSeconds = Math.ceil((record.resetTime - now) / 1000);

    res.setHeader("X-RateLimit-Limit", max.toString());
    res.setHeader("X-RateLimit-Remaining", remaining.toString());
    res.setHeader("X-RateLimit-Reset", Math.ceil(record.resetTime / 1000).toString());

    if (record.count > max) {
      res.setHeader("Retry-After", resetSeconds.toString());
      return res.status(429).json({
        error: message,
        retryAfter: resetSeconds,
      });
    }

    next();
  };
}

export const apiLimiter = createRateLimiter({
  windowMs: 60000,
  max: 100,
  message: "API rate limit exceeded. Please wait before making more requests.",
});

export const chatLimiter = createRateLimiter({
  windowMs: 60000,
  max: 30,
  message: "Chat rate limit exceeded. Please slow down your messages.",
});

export const adminLimiter = createRateLimiter({
  windowMs: 60000,
  max: 200,
  message: "Admin API rate limit exceeded.",
});

export const heavyLimiter = createRateLimiter({
  windowMs: 60000,
  max: 10,
  message: "Heavy operation rate limit exceeded. Please wait before retrying.",
});

export function getRateLimitStats() {
  const now = Date.now();
  const activeRecords = Array.from(requestCounts.entries())
    .filter(([_, record]) => record.resetTime > now)
    .map(([key, record]) => ({
      key,
      count: record.count,
      resetIn: Math.ceil((record.resetTime - now) / 1000),
    }));

  return {
    totalTracked: requestCounts.size,
    activeRecords: activeRecords.length,
    records: activeRecords.slice(0, 50),
  };
}
