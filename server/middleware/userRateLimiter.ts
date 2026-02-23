/**
 * T21: Security & Rate Limiting (Token Bucket Algorithm)
 * Protege al Daemon hipervisor y al EventBus de saturaciones (Flood / DDoS preventions).
 */
export class RateLimiter {
    private requests = new Map<string, { tokens: number; lastRefill: number }>();
    private REFILL_RATE: number; // tokens per millisecond
    private CAPACITY: number;

    constructor(capacity = 50, refillRatePerSec = 5) {
        this.CAPACITY = capacity;
        this.REFILL_RATE = refillRatePerSec / 1000;
    }

    public checkLimit(clientId: string): boolean {
        const now = Date.now();

        if (!this.requests.has(clientId)) {
            this.requests.set(clientId, { tokens: this.CAPACITY - 1, lastRefill: now });
            return true;
        }

        const record = this.requests.get(clientId)!;
        const timePassed = now - record.lastRefill;

        // Refill
        let tokens = record.tokens + (timePassed * this.REFILL_RATE);
        if (tokens > this.CAPACITY) tokens = this.CAPACITY;

        if (tokens >= 1) {
            this.requests.set(clientId, { tokens: tokens - 1, lastRefill: now });
            return true; // Allowed
        }

        return false; // Rate limited
    }
}

export const rpcRateLimiter = new RateLimiter(100, 20); // RPC permite alta frecuencia
export const httpRateLimiter = new RateLimiter(30, 2);  // HTTP (A11y dumps) es estricto
// Express middleware wrapper — routes use `rateLimiter` as (req, res, next) middleware.
// Identifies clients by IP and returns 429 when the token bucket is exhausted.
export function rateLimiter(req: any, res: any, next: any) {
  const clientId = req.ip || req.connection?.remoteAddress || 'unknown';
  if (httpRateLimiter.checkLimit(clientId)) {
    return next();
  }
  return res.status(429).json({ error: 'Too many requests. Please try again later.' });
}

/**
 * Create an Express middleware rate-limiter.
 * Accepts either positional args (capacity, refillRate) for simple use,
 * or an options object { windowMs, maxRequests, keyPrefix, message } for express-rate-limit style.
 */
export function createCustomRateLimiter(
  optsOrCapacity: number | { windowMs?: number; maxRequests?: number; keyPrefix?: string; message?: string } = 30,
  refillRatePerSec = 2
) {
  let limiter: RateLimiter;
  let msg = 'Too many requests. Please try again later.';

  if (typeof optsOrCapacity === 'object') {
    const { maxRequests = 30, windowMs = 60000, message } = optsOrCapacity;
    // Convert window-based rate to token-bucket refill rate
    const refillRate = maxRequests / (windowMs / 1000);
    limiter = new RateLimiter(maxRequests, refillRate);
    if (message) msg = message;
  } else {
    limiter = new RateLimiter(optsOrCapacity, refillRatePerSec);
  }

  return function rateLimitMiddleware(req: any, res: any, next: any) {
    const clientId = req.ip || req.connection?.remoteAddress || 'unknown';
    if (limiter.checkLimit(clientId)) {
      return next();
    }
    return res.status(429).json({ error: msg });
  };
}

export function getRateLimitStats() {
  return {
    rpc: { capacity: 100, refillRatePerSec: 20 },
    http: { capacity: 30, refillRatePerSec: 2 }
  };
}
