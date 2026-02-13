/**
 * Rate Limiting Service
 * Advanced rate limiting with per-user and per-IP tracking
 */

import { Request, Response, NextFunction } from "express";

interface RateLimitEntry {
  count: number;
  firstRequest: number;
  lastRequest: number;
}

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  message?: string;
  keyGenerator?: (req: Request) => string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

class RateLimiter {
  private stores: Map<string, Map<string, RateLimitEntry>> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Cleanup expired entries every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  private getStore(name: string): Map<string, RateLimitEntry> {
    if (!this.stores.has(name)) {
      this.stores.set(name, new Map());
    }
    return this.stores.get(name)!;
  }

  private cleanup() {
    const now = Date.now();
    for (const [, store] of this.stores) {
      for (const [key, entry] of store) {
        // Remove entries older than 1 hour
        if (now - entry.lastRequest > 3600000) {
          store.delete(key);
        }
      }
    }
  }

  /**
   * Create a rate limiter middleware
   */
  create(name: string, config: RateLimitConfig) {
    const store = this.getStore(name);
    const { windowMs, maxRequests, message, keyGenerator } = config;

    return (req: Request, res: Response, next: NextFunction) => {
      const key = keyGenerator 
        ? keyGenerator(req) 
        : this.getKey(req);

      const now = Date.now();
      let entry = store.get(key);

      if (!entry) {
        entry = { count: 0, firstRequest: now, lastRequest: now };
        store.set(key, entry);
      }

      // Reset if window has passed
      if (now - entry.firstRequest > windowMs) {
        entry.count = 0;
        entry.firstRequest = now;
      }

      entry.count++;
      entry.lastRequest = now;

      // Set rate limit headers
      res.setHeader("X-RateLimit-Limit", maxRequests);
      res.setHeader("X-RateLimit-Remaining", Math.max(0, maxRequests - entry.count));
      res.setHeader("X-RateLimit-Reset", Math.ceil((entry.firstRequest + windowMs) / 1000));

      if (entry.count > maxRequests) {
        const retryAfter = Math.ceil((entry.firstRequest + windowMs - now) / 1000);
        res.setHeader("Retry-After", retryAfter);
        
        return res.status(429).json({
          error: "Too Many Requests",
          message: message || `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
          retryAfter
        });
      }

      next();
    };
  }

  private getKey(req: Request): string {
    // Try to get user ID first, then fall back to IP
    const userId = (req as any).user?.id;
    if (userId) {
      return `user:${userId}`;
    }

    const ip = this.getIP(req);
    return `ip:${ip}`;
  }

  private getIP(req: Request): string {
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) {
      return (typeof forwarded === "string" ? forwarded : forwarded[0]).split(",")[0].trim();
    }
    return req.socket.remoteAddress || "unknown";
  }

  /**
   * Check if a key is currently rate limited
   */
  isLimited(name: string, key: string, windowMs: number, maxRequests: number): boolean {
    const store = this.getStore(name);
    const entry = store.get(key);
    
    if (!entry) return false;
    
    const now = Date.now();
    if (now - entry.firstRequest > windowMs) return false;
    
    return entry.count >= maxRequests;
  }

  /**
   * Manually increment counter (for failed attempts tracking)
   */
  increment(name: string, key: string) {
    const store = this.getStore(name);
    const now = Date.now();
    let entry = store.get(key);

    if (!entry) {
      entry = { count: 0, firstRequest: now, lastRequest: now };
      store.set(key, entry);
    }

    entry.count++;
    entry.lastRequest = now;
  }

  /**
   * Reset counter for a key
   */
  reset(name: string, key: string) {
    const store = this.getStore(name);
    store.delete(key);
  }

  /**
   * Get current stats for monitoring
   */
  getStats() {
    const stats: Record<string, { keys: number; totalRequests: number }> = {};
    
    for (const [name, store] of this.stores) {
      let totalRequests = 0;
      for (const [, entry] of store) {
        totalRequests += entry.count;
      }
      stats[name] = { keys: store.size, totalRequests };
    }
    
    return stats;
  }

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.stores.clear();
  }
}

// Singleton instance
export const rateLimiter = new RateLimiter();

// Pre-configured limiters
export const authLimiter = rateLimiter.create("auth", {
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 5,
  message: "Too many login attempts. Please try again in 15 minutes."
});

export const apiLimiter = rateLimiter.create("api", {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 60,
  message: "API rate limit exceeded."
});

export const chatLimiter = rateLimiter.create("chat", {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 20,
  message: "Too many messages. Please slow down."
});

export const adminLimiter = rateLimiter.create("admin", {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 100,
  message: "Admin API rate limit exceeded."
});

export const uploadLimiter = rateLimiter.create("upload", {
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 50,
  message: "Upload limit exceeded. Please try again later."
});

// Special limiter for failed login attempts (stricter)
export const loginFailureLimiter = {
  check: (email: string) => rateLimiter.isLimited("loginFailures", email, 15 * 60 * 1000, 5),
  increment: (email: string) => rateLimiter.increment("loginFailures", email),
  reset: (email: string) => rateLimiter.reset("loginFailures", email)
};
