export class RateLimiter {
  private limits = new Map<string, { count: number; resetAt: number }>();
  
  // Default: 50 requests per minute
  private config = {
    windowMs: 60 * 1000,
    maxRequests: 50
  };

  constructor(config?: { windowMs: number; maxRequests: number }) {
    if (config) this.config = config;
  }

  check(userId: string): { allowed: boolean; remaining: number; resetIn: number } {
    const now = Date.now();
    let record = this.limits.get(userId);

    if (!record || now > record.resetAt) {
        record = { count: 0, resetAt: now + this.config.windowMs };
        this.limits.set(userId, record);
    }

    if (record.count >= this.config.maxRequests) {
        return {
            allowed: false,
            remaining: 0,
            resetIn: record.resetAt - now
        };
    }

    record.count++;
    return {
        allowed: true,
        remaining: this.config.maxRequests - record.count,
        resetIn: record.resetAt - now
    };
  }

  // Adaptive throttling (#34)
  // If user hits limit frequently, penalty increases
  checkAdaptive(userId: string) {
      // Implementación futura: almacenar historial de violaciones en Redis
      return this.check(userId);
  }
}
