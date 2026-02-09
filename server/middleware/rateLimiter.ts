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

// Inicialización asíncrona segura
(async () => {
  try {
    if (process.env.REDIS_URL) {
      await redisClient.connect();
      console.log("[RateLimiter] Redis connected");
      
      rateLimiterGlobal = new RateLimiterRedis({
        storeClient: redisClient,
        keyPrefix: "middleware_global",
        points: 200, // 200 peticiones
        duration: 60, // por 60 segundos por IP
      });

      rateLimiterAuth = new RateLimiterRedis({
        storeClient: redisClient,
        keyPrefix: "middleware_auth",
        points: 10, // 10 intentos
        duration: 60 * 15, // por 15 minutos (bloqueo fuerza bruta)
      });

      rateLimiterAi = new RateLimiterRedis({
        storeClient: redisClient,
        keyPrefix: "middleware_ai",
        points: 60, // 60 peticiones de IA
        duration: 60, // por minuto
      });
    } else {
        throw new Error("No Redis URL");
    }
  } catch (err) {
    console.warn("[RateLimiter] Redis connection failed, falling back to Memory:", err);
    // Fallback a memoria si Redis falla o no está
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
})();

const consumeLimiter = (limiter: RateLimiterRedis | RateLimiterMemory, req: Request, res: Response, next: NextFunction) => {
    // Usar IP o User ID si está autenticado
    const key = (req as any).user?.id || req.ip;
    
    limiter.consume(key)
        .then(() => {
            next();
        })
        .catch(() => {
            res.status(429).json({
                status: "error",
                message: "Too Many Requests",
                retryAfter: Math.round((limiter as any).msBeforeNext / 1000) || 60
            });
        });
};

export const globalLimiter = (req: Request, res: Response, next: NextFunction) => consumeLimiter(rateLimiterGlobal, req, res, next);
export const authLimiter = (req: Request, res: Response, next: NextFunction) => consumeLimiter(rateLimiterAuth, req, res, next);
export const aiLimiter = (req: Request, res: Response, next: NextFunction) => consumeLimiter(rateLimiterAi, req, res, next);
