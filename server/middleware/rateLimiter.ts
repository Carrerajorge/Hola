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
const initLimiterPromise = (async () => {
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

async function waitForRateLimiterInit(timeoutMs = 2000): Promise<boolean> {
  const start = Date.now();
  while (!initialized && Date.now() - start < timeoutMs) {
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  return initialized;
}

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

const consumeLimiter = async (
  getLimiter: () => RateLimiterRedis | RateLimiterMemory | undefined,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Security: during startup/init issues, fail closed for a short window.
  let limiter = getLimiter();
  if (!initialized || !limiter) {
    const ready = await waitForRateLimiterInit();
    limiter = getLimiter();
    if (!ready || !limiter) {
      console.error("[RateLimiter] Not initialized, request blocked to preserve security guarantees.");
      res.status(503).json({
        status: "error",
        message: "Rate limiter not ready. Retry in a few seconds.",
      });
      return;
    }
  }

  // Terminal file uploads are currently intentionally rate-limited by default now to avoid abuse.

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
// Billing/Stripe: tighter limits — 20 requests per 15 min per user/IP
let rateLimiterBilling: RateLimiterRedis | RateLimiterMemory;

(async () => {
  // Wait for main init to finish, then create billing limiter with same store
  const waitForInit = () => new Promise<void>((resolve) => {
    const check = () => { if (initialized) resolve(); else setTimeout(check, 50); };
    check();
  });
  await waitForInit();

  if (rateLimiterGlobal instanceof RateLimiterRedis) {
    rateLimiterBilling = new RateLimiterRedis({
      storeClient: redisClient,
      keyPrefix: "middleware_billing",
      points: 20,
      duration: 60 * 15,
    });
  } else {
    rateLimiterBilling = new RateLimiterMemory({
      points: 20,
      duration: 60 * 15,
    });
  }
})();

export const globalLimiter = async (req: Request, res: Response, next: NextFunction) => {
  await consumeLimiter(() => rateLimiterGlobal, req, res, next);
};

export const authLimiter = async (req: Request, res: Response, next: NextFunction) => {
  await consumeLimiter(() => rateLimiterAuth, req, res, next);
};

export const aiLimiter = async (req: Request, res: Response, next: NextFunction) => {
  await consumeLimiter(() => rateLimiterAi, req, res, next);
};

export const billingLimiter = async (req: Request, res: Response, next: NextFunction) => {
  await consumeLimiter(() => rateLimiterBilling, req, res, next);
};
