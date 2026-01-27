/**
 * Network Resilience Service
 *
 * Robust network handling with retries, timeouts, and fallbacks.
 * Implements improvements 101-115: Network Resilience
 */

import { EventEmitter } from "events";
import crypto from "crypto";

// ============================================================================
// TYPES
// ============================================================================

interface RetryConfig {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
    retryableErrors: string[];
    onRetry?: (attempt: number, error: Error) => void;
}

interface CircuitState {
    state: "closed" | "open" | "half-open";
    failures: number;
    successes: number;
    lastFailure?: Date;
    lastSuccess?: Date;
    nextAttempt?: Date;
}

interface RequestConfig {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: any;
    timeout?: number;
    retryConfig?: Partial<RetryConfig>;
    circuitBreaker?: string;
    cacheKey?: string;
    cacheTtl?: number;
}

interface NetworkStats {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    retriedRequests: number;
    avgResponseTime: number;
    circuitBreakerTrips: number;
}

// ============================================================================
// RETRY HANDLER (Improvements 101-103)
// ============================================================================

class RetryHandler {
    private defaultConfig: RetryConfig = {
        maxAttempts: 3,
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
        retryableErrors: [
            "ECONNRESET",
            "ETIMEDOUT",
            "ECONNREFUSED",
            "EPIPE",
            "ENOTFOUND",
            "ENETUNREACH",
            "EAI_AGAIN",
            "FETCH_ERROR",
            "NETWORK_ERROR"
        ]
    };

    async execute<T>(
        fn: () => Promise<T>,
        config: Partial<RetryConfig> = {}
    ): Promise<T> {
        const finalConfig = { ...this.defaultConfig, ...config };
        let lastError: Error | null = null;
        let attempt = 0;

        while (attempt < finalConfig.maxAttempts) {
            attempt++;

            try {
                return await fn();
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));

                if (!this.isRetryable(lastError, finalConfig.retryableErrors)) {
                    throw lastError;
                }

                if (attempt < finalConfig.maxAttempts) {
                    const delay = this.calculateDelay(attempt, finalConfig);

                    if (finalConfig.onRetry) {
                        finalConfig.onRetry(attempt, lastError);
                    }

                    console.log(`[RetryHandler] Attempt ${attempt} failed, retrying in ${delay}ms: ${lastError.message}`);
                    await this.sleep(delay);
                }
            }
        }

        throw lastError || new Error("Max retries exceeded");
    }

    private isRetryable(error: Error, retryableErrors: string[]): boolean {
        const errorCode = (error as any).code || "";
        const errorMessage = error.message.toLowerCase();

        // Check error codes
        if (retryableErrors.some(code => errorCode === code)) {
            return true;
        }

        // Check for common network error patterns
        const retryablePatterns = [
            "network",
            "timeout",
            "connection",
            "socket",
            "econnreset",
            "fetch failed",
            "503",
            "502",
            "504",
            "429"
        ];

        return retryablePatterns.some(pattern => errorMessage.includes(pattern));
    }

    private calculateDelay(attempt: number, config: RetryConfig): number {
        // Exponential backoff with jitter
        const exponentialDelay = config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt - 1);
        const jitter = Math.random() * 0.3 * exponentialDelay; // 30% jitter
        const delay = Math.min(exponentialDelay + jitter, config.maxDelayMs);

        return Math.floor(delay);
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// ============================================================================
// CIRCUIT BREAKER (Improvements 104-106)
// ============================================================================

class CircuitBreakerManager extends EventEmitter {
    private circuits: Map<string, CircuitState> = new Map();
    private readonly failureThreshold = 5;
    private readonly successThreshold = 3;
    private readonly resetTimeout = 60000; // 1 minute

    getOrCreate(name: string): CircuitState {
        if (!this.circuits.has(name)) {
            this.circuits.set(name, {
                state: "closed",
                failures: 0,
                successes: 0
            });
        }
        return this.circuits.get(name)!;
    }

    async execute<T>(name: string, fn: () => Promise<T>): Promise<T> {
        const circuit = this.getOrCreate(name);

        // Check if circuit is open
        if (circuit.state === "open") {
            if (circuit.nextAttempt && circuit.nextAttempt > new Date()) {
                throw new Error(`Circuit breaker ${name} is open`);
            }
            // Try half-open
            circuit.state = "half-open";
            console.log(`[CircuitBreaker] ${name} transitioning to half-open`);
        }

        try {
            const result = await fn();
            this.recordSuccess(name);
            return result;
        } catch (error) {
            this.recordFailure(name);
            throw error;
        }
    }

    private recordSuccess(name: string): void {
        const circuit = this.getOrCreate(name);
        circuit.successes++;
        circuit.lastSuccess = new Date();

        if (circuit.state === "half-open") {
            if (circuit.successes >= this.successThreshold) {
                circuit.state = "closed";
                circuit.failures = 0;
                circuit.successes = 0;
                console.log(`[CircuitBreaker] ${name} closed after successful recovery`);
                this.emit("circuit_closed", { name });
            }
        } else {
            // Reset failures on success in closed state
            circuit.failures = Math.max(0, circuit.failures - 1);
        }
    }

    private recordFailure(name: string): void {
        const circuit = this.getOrCreate(name);
        circuit.failures++;
        circuit.lastFailure = new Date();
        circuit.successes = 0;

        if (circuit.state === "half-open") {
            // Immediately open on failure in half-open
            this.openCircuit(name);
        } else if (circuit.failures >= this.failureThreshold) {
            this.openCircuit(name);
        }
    }

    private openCircuit(name: string): void {
        const circuit = this.getOrCreate(name);
        circuit.state = "open";
        circuit.nextAttempt = new Date(Date.now() + this.resetTimeout);
        console.log(`[CircuitBreaker] ${name} opened, will retry at ${circuit.nextAttempt}`);
        this.emit("circuit_opened", { name, nextAttempt: circuit.nextAttempt });
    }

    getStatus(): Record<string, CircuitState> {
        return Object.fromEntries(this.circuits);
    }

    reset(name: string): void {
        const circuit = this.getOrCreate(name);
        circuit.state = "closed";
        circuit.failures = 0;
        circuit.successes = 0;
        circuit.nextAttempt = undefined;
        console.log(`[CircuitBreaker] ${name} manually reset`);
    }
}

// ============================================================================
// REQUEST QUEUE (Improvements 107-109)
// ============================================================================

interface QueuedRequest {
    id: string;
    config: RequestConfig;
    priority: number;
    addedAt: Date;
    resolve: (value: any) => void;
    reject: (error: Error) => void;
}

class RequestQueue {
    private queue: QueuedRequest[] = [];
    private processing = false;
    private concurrency = 5;
    private activeRequests = 0;
    private rateLimits: Map<string, { tokens: number; lastRefill: Date }> = new Map();

    async enqueue<T>(
        config: RequestConfig,
        priority: number = 5
    ): Promise<T> {
        return new Promise((resolve, reject) => {
            const request: QueuedRequest = {
                id: crypto.randomUUID(),
                config,
                priority,
                addedAt: new Date(),
                resolve,
                reject
            };

            // Insert in priority order
            const insertIndex = this.queue.findIndex(r => r.priority > priority);
            if (insertIndex === -1) {
                this.queue.push(request);
            } else {
                this.queue.splice(insertIndex, 0, request);
            }

            this.processQueue();
        });
    }

    private async processQueue(): Promise<void> {
        if (this.processing) return;
        this.processing = true;

        while (this.queue.length > 0 && this.activeRequests < this.concurrency) {
            const request = this.queue.shift();
            if (!request) continue;

            // Check rate limit for domain
            const domain = this.extractDomain(request.config.url);
            if (!this.checkRateLimit(domain)) {
                // Re-queue with slight delay
                this.queue.unshift(request);
                await this.sleep(100);
                continue;
            }

            this.activeRequests++;
            this.executeRequest(request);
        }

        this.processing = false;
    }

    private async executeRequest(request: QueuedRequest): Promise<void> {
        try {
            const response = await this.makeRequest(request.config);
            request.resolve(response);
        } catch (error) {
            request.reject(error instanceof Error ? error : new Error(String(error)));
        } finally {
            this.activeRequests--;
            this.processQueue();
        }
    }

    private async makeRequest(config: RequestConfig): Promise<any> {
        const controller = new AbortController();
        const timeout = config.timeout || 30000;
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(config.url, {
                method: config.method || "GET",
                headers: config.headers,
                body: config.body ? JSON.stringify(config.body) : undefined,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return response.json();
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }

    private extractDomain(url: string): string {
        try {
            return new URL(url).hostname;
        } catch {
            return "unknown";
        }
    }

    private checkRateLimit(domain: string): boolean {
        const limit = this.rateLimits.get(domain);
        const now = new Date();

        if (!limit) {
            this.rateLimits.set(domain, { tokens: 9, lastRefill: now }); // 10 tokens per second
            return true;
        }

        // Refill tokens
        const elapsed = now.getTime() - limit.lastRefill.getTime();
        const refill = Math.floor(elapsed / 100); // 10 tokens per second
        limit.tokens = Math.min(10, limit.tokens + refill);
        limit.lastRefill = now;

        if (limit.tokens > 0) {
            limit.tokens--;
            return true;
        }

        return false;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    getQueueStatus(): { pending: number; active: number } {
        return {
            pending: this.queue.length,
            active: this.activeRequests
        };
    }
}

// ============================================================================
// CONNECTION POOL (Improvements 110-112)
// ============================================================================

interface PooledConnection {
    id: string;
    host: string;
    createdAt: Date;
    lastUsed: Date;
    inUse: boolean;
    requestCount: number;
}

class ConnectionPoolManager {
    private pools: Map<string, PooledConnection[]> = new Map();
    private readonly maxPoolSize = 10;
    private readonly maxIdleTime = 300000; // 5 minutes
    private readonly maxRequestsPerConnection = 100;
    private cleanupInterval: NodeJS.Timeout | null = null;

    constructor() {
        this.startCleanup();
    }

    private startCleanup(): void {
        this.cleanupInterval = setInterval(() => {
            this.cleanupIdleConnections();
        }, 60000); // Every minute
    }

    acquire(host: string): PooledConnection {
        let pool = this.pools.get(host);

        if (!pool) {
            pool = [];
            this.pools.set(host, pool);
        }

        // Find available connection
        let connection = pool.find(c =>
            !c.inUse &&
            c.requestCount < this.maxRequestsPerConnection
        );

        if (!connection && pool.length < this.maxPoolSize) {
            // Create new connection
            connection = {
                id: crypto.randomUUID(),
                host,
                createdAt: new Date(),
                lastUsed: new Date(),
                inUse: false,
                requestCount: 0
            };
            pool.push(connection);
        }

        if (connection) {
            connection.inUse = true;
            connection.lastUsed = new Date();
            connection.requestCount++;
            return connection;
        }

        // Wait for available connection (would implement proper waiting in production)
        throw new Error(`Connection pool exhausted for ${host}`);
    }

    release(connection: PooledConnection): void {
        connection.inUse = false;
        connection.lastUsed = new Date();
    }

    private cleanupIdleConnections(): void {
        const now = Date.now();

        for (const [host, pool] of this.pools) {
            const activeConnections = pool.filter(c => {
                if (c.inUse) return true;

                const idleTime = now - c.lastUsed.getTime();
                if (idleTime > this.maxIdleTime) {
                    console.log(`[ConnectionPool] Removing idle connection for ${host}`);
                    return false;
                }

                if (c.requestCount >= this.maxRequestsPerConnection) {
                    console.log(`[ConnectionPool] Removing exhausted connection for ${host}`);
                    return false;
                }

                return true;
            });

            if (activeConnections.length !== pool.length) {
                this.pools.set(host, activeConnections);
            }
        }
    }

    getStats(): Record<string, { total: number; inUse: number; idle: number }> {
        const stats: Record<string, any> = {};

        for (const [host, pool] of this.pools) {
            const inUse = pool.filter(c => c.inUse).length;
            stats[host] = {
                total: pool.length,
                inUse,
                idle: pool.length - inUse
            };
        }

        return stats;
    }

    stop(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
}

// ============================================================================
// TIMEOUT MANAGER (Improvements 113-115)
// ============================================================================

class TimeoutManager {
    private defaultTimeouts: Record<string, number> = {
        connect: 5000,
        read: 30000,
        write: 30000,
        idle: 60000,
        total: 120000
    };

    private adaptiveTimeouts: Map<string, number[]> = new Map();
    private readonly historySize = 100;

    getTimeout(operation: string, host?: string): number {
        const key = host ? `${operation}:${host}` : operation;
        const history = this.adaptiveTimeouts.get(key);

        if (history && history.length >= 10) {
            // Use P95 of recent response times * 1.5
            const sorted = [...history].sort((a, b) => a - b);
            const p95 = sorted[Math.floor(sorted.length * 0.95)];
            return Math.min(p95 * 1.5, this.defaultTimeouts[operation] || 30000);
        }

        return this.defaultTimeouts[operation] || 30000;
    }

    recordResponseTime(operation: string, host: string, timeMs: number): void {
        const key = `${operation}:${host}`;
        let history = this.adaptiveTimeouts.get(key);

        if (!history) {
            history = [];
            this.adaptiveTimeouts.set(key, history);
        }

        history.push(timeMs);

        if (history.length > this.historySize) {
            history.shift();
        }
    }

    setDefaultTimeout(operation: string, timeoutMs: number): void {
        this.defaultTimeouts[operation] = timeoutMs;
    }

    createAbortController(operation: string, host?: string): {
        controller: AbortController;
        timeoutId: NodeJS.Timeout;
        cleanup: () => void;
    } {
        const controller = new AbortController();
        const timeout = this.getTimeout(operation, host);

        const timeoutId = setTimeout(() => {
            controller.abort();
        }, timeout);

        return {
            controller,
            timeoutId,
            cleanup: () => clearTimeout(timeoutId)
        };
    }
}

// ============================================================================
// NETWORK RESILIENCE SERVICE
// ============================================================================

export class NetworkResilienceService extends EventEmitter {
    public retryHandler: RetryHandler;
    public circuitBreaker: CircuitBreakerManager;
    public requestQueue: RequestQueue;
    public connectionPool: ConnectionPoolManager;
    public timeoutManager: TimeoutManager;

    private stats: NetworkStats = {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        retriedRequests: 0,
        avgResponseTime: 0,
        circuitBreakerTrips: 0
    };

    private responseTimes: number[] = [];

    constructor() {
        super();
        this.retryHandler = new RetryHandler();
        this.circuitBreaker = new CircuitBreakerManager();
        this.requestQueue = new RequestQueue();
        this.connectionPool = new ConnectionPoolManager();
        this.timeoutManager = new TimeoutManager();

        this.setupEventListeners();
        console.log("[NetworkResilience] Service initialized");
    }

    private setupEventListeners(): void {
        this.circuitBreaker.on("circuit_opened", (data) => {
            this.stats.circuitBreakerTrips++;
            this.emit("circuit_opened", data);
        });

        this.circuitBreaker.on("circuit_closed", (data) => {
            this.emit("circuit_closed", data);
        });
    }

    /**
     * Make a resilient HTTP request with retries, circuit breaker, and timeout
     */
    async request<T>(config: RequestConfig): Promise<T> {
        const startTime = Date.now();
        this.stats.totalRequests++;

        const domain = this.extractDomain(config.url);
        const circuitName = config.circuitBreaker || domain;

        try {
            const result = await this.circuitBreaker.execute(circuitName, async () => {
                return this.retryHandler.execute(async () => {
                    const { controller, cleanup } = this.timeoutManager.createAbortController("read", domain);

                    try {
                        const response = await fetch(config.url, {
                            method: config.method || "GET",
                            headers: {
                                "Content-Type": "application/json",
                                ...config.headers
                            },
                            body: config.body ? JSON.stringify(config.body) : undefined,
                            signal: controller.signal
                        });

                        cleanup();

                        if (!response.ok) {
                            throw new Error(`HTTP ${response.status}`);
                        }

                        return response.json();
                    } catch (error) {
                        cleanup();
                        throw error;
                    }
                }, config.retryConfig);
            });

            this.recordSuccess(startTime, domain);
            return result as T;

        } catch (error) {
            this.recordFailure();
            throw error;
        }
    }

    /**
     * Make a request through the queue (for rate-limited APIs)
     */
    async queuedRequest<T>(config: RequestConfig, priority: number = 5): Promise<T> {
        return this.requestQueue.enqueue<T>(config, priority);
    }

    private recordSuccess(startTime: number, host: string): void {
        const responseTime = Date.now() - startTime;
        this.stats.successfulRequests++;
        this.timeoutManager.recordResponseTime("read", host, responseTime);
        this.updateAvgResponseTime(responseTime);
    }

    private recordFailure(): void {
        this.stats.failedRequests++;
    }

    private updateAvgResponseTime(time: number): void {
        this.responseTimes.push(time);
        if (this.responseTimes.length > 1000) {
            this.responseTimes.shift();
        }
        this.stats.avgResponseTime =
            this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length;
    }

    private extractDomain(url: string): string {
        try {
            return new URL(url).hostname;
        } catch {
            return "unknown";
        }
    }

    getStats(): NetworkStats {
        return { ...this.stats };
    }

    getCircuitStatus(): Record<string, CircuitState> {
        return this.circuitBreaker.getStatus();
    }

    getConnectionPoolStats(): Record<string, any> {
        return this.connectionPool.getStats();
    }

    getQueueStatus(): { pending: number; active: number } {
        return this.requestQueue.getQueueStatus();
    }

    stop(): void {
        this.connectionPool.stop();
    }
}

// Singleton instance
export const networkResilience = new NetworkResilienceService();

export default networkResilience;
