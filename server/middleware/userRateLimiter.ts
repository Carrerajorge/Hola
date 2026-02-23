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
