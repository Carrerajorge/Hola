import { RateLimiterRedis, RateLimiterMemory } from "rate-limiter-flexible";
import { Request, Response, NextFunction } from "express";
import { createClient } from "redis";
import { env } from "../config/env";

// Cliente Redis para Rate Limiter
const redisClient = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
  password: process.env.REDIS_PASSWORD,
});

let rateLimiterGlobal: RateLimiterRedis | RateLimiterMemory;
let rateLimiterAuth: RateLimiterRedis | RateLimiterMemory;
let rateLimiterAi: RateLimiterRedis | RateLimiterMemory;

// Track initialization state
let initialized = false;

// Inicialización asíncrona segura
(async () => {
  try {
    if (process.env.REDIS_URL) {
      await redisClient.connect();
      console.log("[RateLimiter] Redis connected");

      rateLimiterGlobal = new RateLimiterRedis({
        storeClient: redisClient,
        keyPrefix: "middleware_global",
        points: 200, // 200 requests
        duration: 60, // per 60 seconds per IP
      });

      rateLimiterAuth = new RateLimiterRedis({
        storeClient: redisClient,
        keyPrefix: "middleware_auth",
        points: 10, // 10 attempts
        duration: 60 * 15, // per 15 minutes (brute force protection)
      });

      rateLimiterAi = new RateLimiterRedis({
        storeClient: redisClient,
        keyPrefix: "middleware_ai",
        points: 60, // 60 AI requests
        duration: 60, // per minute
      });
    } else {
        throw new Error("No Redis URL");
    }
  } catch (err) {
    console.warn("[RateLimiter] Redis connection failed, falling back to Memory:", err);
    // Fallback to memory if Redis fails or is unavailable
    rateLimiterGlobal = new RateLimiterMemory({
      points: 200,
      duration: 60,
    });
    rateLimiterAuth = new RateLimiterMemory({
      points: 10,
      duration: 60 * 15,
    });
    rateLimiterAi = new RateLimiterMemory({
      points: 60,
      duration: 60,
    });
  }
  initialized = true;
})();

/**
 * Security: extract the real client IP behind reverse proxies.
 * Trusts X-Forwarded-For only when app.set('trust proxy') is enabled,
 * which makes req.ip return the correct client IP.
 * As a fallback, we use req.ip which Express resolves based on trust proxy setting.
 */
function getClientKey(req: Request): string {
  // Prefer authenticated user ID for per-user limiting
  const userId = (req as any).user?.id;
  if (userId && typeof userId === "string") {
    return `user:${userId}`;
  }

  // Use req.ip which respects Express 'trust proxy' setting
  const ip = req.ip || req.socket?.remoteAddress || "unknown";

  // Security: normalize IPv6-mapped IPv4 addresses
  if (ip.startsWith("::ffff:")) { return ip.slice(7);
  }

  return ip;
}

const consumeLimiter = (
  limiter: RateLimiterRedis | RateLimiterMemory,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Security: if rate limiter not yet initialized (startup race), allow through
  if (!initialized || !limiter) {
    console.warn("[RateLimiter] Not yet initialized, allowing request through");
    return next();
  }

  // ✅ BYPASS: Terminal file ops (evita 429 y evita romper UI Files)
  const pathOnly = (req.originalUrl || req.url || req.path || "").split("?")[0];
  const skipRateLimit =
    req.method === "POST" &&
    (/^\/api\/terminal\/sessions\/[^/]+\/file$/.test(pathOnly) ||
      /^\/terminal\/sessions\/[^/]+\/file$/.test(pathOnly));

  if (skipRateLimit) return next();

  const key = getClientKey(req);

  limiter
    .consume(key)
    .then(() => next())
    .catch((rateLimiterRes) => {
      const retryAfter = Math.round((rateLimiterRes?.msBeforeNext || 60000) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      res.setHeader("X-RateLimit-Limit", String((limiter as any).points));
      res.setHeader("X-RateLimit-Remaining", "0");
      res.setHeader("X-RateLimit-Reset", String(Math.ceil(Date.now() / 1000) + retryAfter));
      res.status(429).json({
        status: "error",
        message: "Too Many Requests",
        retryAfter,
      });
    });
};
export const globalLimiter = (req: Request, res: Response, next: NextFunction) => consumeLimiter(rateLimiterGlobal, req, res, next);
export const authLimiter = (req: Request, res: Response, next: NextFunction) => consumeLimiter(rateLimiterAuth, req, res, next);
export const aiLimiter = (req: Request, res: Response, next: NextFunction) => consumeLimiter(rateLimiterAi, req, res, next);
