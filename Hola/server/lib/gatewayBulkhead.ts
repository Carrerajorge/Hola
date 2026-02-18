/**
 * Gateway Bulkhead - Concurrency isolation and queue management for LLM requests.
 *
 * Provides:
 * - Per-provider concurrency limits (bulkhead isolation)
 * - Per-user concurrency limits (prevent single user hogging)
 * - Per-model concurrency limits (prevent model saturation)
 * - Bounded queue with backpressure (reject when full)
 * - Queue timeout (don't wait forever for a slot)
 * - Metrics for observability
 */

type LLMProvider = "xai" | "gemini" | "openai" | "anthropic" | "deepseek";

// ===== Configuration =====
export interface BulkheadConfig {
  /** Max concurrent requests per provider. Default: 50 */
  maxConcurrentPerProvider: number;
  /** Max concurrent requests per user. Default: 5 */
  maxConcurrentPerUser: number;
  /** Max concurrent requests per model. Default: 20 */
  maxConcurrentPerModel: number;
  /** Max queue depth per provider before rejecting. Default: 100 */
  maxQueuePerProvider: number;
  /** Max queue depth per user before rejecting. Default: 10 */
  maxQueuePerUser: number;
  /** Max time (ms) to wait in queue before timeout. Default: 30_000 */
  queueTimeoutMs: number;
}

const DEFAULT_CONFIG: BulkheadConfig = {
  maxConcurrentPerProvider: 50,
  maxConcurrentPerUser: 5,
  maxConcurrentPerModel: 20,
  maxQueuePerProvider: 100,
  maxQueuePerUser: 10,
  queueTimeoutMs: 30_000,
};

// ===== Semaphore with Queue Limit and Timeout =====
class BoundedSemaphore {
  private _available: number;
  private _queue: Array<{ resolve: () => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }> = [];
  private _maxQueue: number;
  private _timeoutMs: number;

  // Metrics
  private _totalAcquired: number = 0;
  private _totalRejected: number = 0;
  private _totalTimedOut: number = 0;

  constructor(
    private _maxConcurrent: number,
    maxQueue: number,
    timeoutMs: number,
  ) {
    this._available = _maxConcurrent;
    this._maxQueue = maxQueue;
    this._timeoutMs = timeoutMs;
  }

  async acquire(): Promise<void> {
    if (this._available > 0) {
      this._available--;
      this._totalAcquired++;
      return;
    }

    // Check queue limit (backpressure)
    if (this._queue.length >= this._maxQueue) {
      this._totalRejected++;
      throw new BulkheadFullError(
        `Queue full: ${this._queue.length}/${this._maxQueue} waiting, ${this._maxConcurrent} concurrent slots occupied`
      );
    }

    // Wait with timeout
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Remove from queue
        const idx = this._queue.findIndex(q => q.resolve === resolve);
        if (idx !== -1) this._queue.splice(idx, 1);
        this._totalTimedOut++;
        reject(new BulkheadTimeoutError(
          `Queue timeout after ${this._timeoutMs}ms (${this._queue.length} still waiting)`
        ));
      }, this._timeoutMs);

      this._queue.push({ resolve, reject, timer });
    });
  }

  release(): void {
    if (this._queue.length > 0) {
      const next = this._queue.shift()!;
      clearTimeout(next.timer);
      this._totalAcquired++;
      next.resolve();
    } else {
      this._available = Math.min(this._available + 1, this._maxConcurrent);
    }
  }

  get available(): number { return this._available; }
  get queueLength(): number { return this._queue.length; }
  get maxConcurrent(): number { return this._maxConcurrent; }
  get totalAcquired(): number { return this._totalAcquired; }
  get totalRejected(): number { return this._totalRejected; }
  get totalTimedOut(): number { return this._totalTimedOut; }
}

// ===== Error Classes =====
export class BulkheadFullError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BulkheadFullError";
  }
}

export class BulkheadTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BulkheadTimeoutError";
  }
}

// ===== Gateway Bulkhead =====
export class GatewayBulkhead {
  private _config: BulkheadConfig;
  private _providerSemaphores: Map<string, BoundedSemaphore> = new Map();
  private _userSemaphores: Map<string, BoundedSemaphore> = new Map();
  private _modelSemaphores: Map<string, BoundedSemaphore> = new Map();

  constructor(config?: Partial<BulkheadConfig>) {
    this._config = { ...DEFAULT_CONFIG, ...config };
  }

  private _getProviderSemaphore(provider: string): BoundedSemaphore {
    let sem = this._providerSemaphores.get(provider);
    if (!sem) {
      sem = new BoundedSemaphore(
        this._config.maxConcurrentPerProvider,
        this._config.maxQueuePerProvider,
        this._config.queueTimeoutMs,
      );
      this._providerSemaphores.set(provider, sem);
    }
    return sem;
  }

  private _getUserSemaphore(userId: string): BoundedSemaphore {
    let sem = this._userSemaphores.get(userId);
    if (!sem) {
      sem = new BoundedSemaphore(
        this._config.maxConcurrentPerUser,
        this._config.maxQueuePerUser,
        this._config.queueTimeoutMs,
      );
      this._userSemaphores.set(userId, sem);
    }
    return sem;
  }

  private _getModelSemaphore(model: string): BoundedSemaphore {
    let sem = this._modelSemaphores.get(model);
    if (!sem) {
      sem = new BoundedSemaphore(
        this._config.maxConcurrentPerModel,
        this._config.maxQueuePerProvider,
        this._config.queueTimeoutMs,
      );
      this._modelSemaphores.set(model, sem);
    }
    return sem;
  }

  /**
   * Acquire all required semaphores for a request. If any fails, release those already acquired.
   * Returns a release function that frees all slots.
   */
  async acquire(provider: string, userId: string, model: string): Promise<() => void> {
    const providerSem = this._getProviderSemaphore(provider);
    const userSem = this._getUserSemaphore(userId);
    const modelSem = this._getModelSemaphore(model);

    const acquired: BoundedSemaphore[] = [];

    try {
      // Acquire in deterministic order to prevent deadlocks
      await providerSem.acquire();
      acquired.push(providerSem);

      await userSem.acquire();
      acquired.push(userSem);

      await modelSem.acquire();
      acquired.push(modelSem);
    } catch (err) {
      // Rollback any acquired semaphores
      for (const sem of acquired) {
        sem.release();
      }
      throw err;
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      modelSem.release();
      userSem.release();
      providerSem.release();
    };
  }

  /**
   * Execute a function within the bulkhead.
   */
  async execute<T>(
    provider: string,
    userId: string,
    model: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const release = await this.acquire(provider, userId, model);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Check if a request would be accepted without actually acquiring.
   */
  canAccept(provider: string, userId: string, model: string): { accepted: boolean; reason?: string } {
    const providerSem = this._getProviderSemaphore(provider);
    const userSem = this._getUserSemaphore(userId);
    const modelSem = this._getModelSemaphore(model);

    if (providerSem.available <= 0 && providerSem.queueLength >= this._config.maxQueuePerProvider) {
      return { accepted: false, reason: `Provider ${provider} at capacity` };
    }
    if (userSem.available <= 0 && userSem.queueLength >= this._config.maxQueuePerUser) {
      return { accepted: false, reason: `User ${userId} at capacity` };
    }
    if (modelSem.available <= 0 && modelSem.queueLength >= this._config.maxQueuePerProvider) {
      return { accepted: false, reason: `Model ${model} at capacity` };
    }
    return { accepted: true };
  }

  /** Get snapshot of all semaphore states. */
  snapshot(): {
    providers: Record<string, { available: number; queued: number; max: number }>;
    users: Record<string, { available: number; queued: number; max: number }>;
    models: Record<string, { available: number; queued: number; max: number }>;
  } {
    const mapSnapshot = (map: Map<string, BoundedSemaphore>) => {
      const result: Record<string, { available: number; queued: number; max: number }> = {};
      for (const [key, sem] of map.entries()) {
        result[key] = { available: sem.available, queued: sem.queueLength, max: sem.maxConcurrent };
      }
      return result;
    };

    return {
      providers: mapSnapshot(this._providerSemaphores),
      users: mapSnapshot(this._userSemaphores),
      models: mapSnapshot(this._modelSemaphores),
    };
  }

  /** Get metrics for a specific provider. */
  getProviderMetrics(provider: string): {
    available: number;
    queued: number;
    max: number;
    totalAcquired: number;
    totalRejected: number;
    totalTimedOut: number;
  } | null {
    const sem = this._providerSemaphores.get(provider);
    if (!sem) return null;
    return {
      available: sem.available,
      queued: sem.queueLength,
      max: sem.maxConcurrent,
      totalAcquired: sem.totalAcquired,
      totalRejected: sem.totalRejected,
      totalTimedOut: sem.totalTimedOut,
    };
  }

  /** Cleanup stale user semaphores (users with no activity). */
  cleanupStaleUsers(): number {
    let cleaned = 0;
    for (const [userId, sem] of this._userSemaphores.entries()) {
      if (sem.available === sem.maxConcurrent && sem.queueLength === 0) {
        this._userSemaphores.delete(userId);
        cleaned++;
      }
    }
    return cleaned;
  }
}

// ===== Global Instance =====
export const gatewayBulkhead = new GatewayBulkhead();
