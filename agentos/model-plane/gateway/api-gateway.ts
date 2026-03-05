// AgentOS Model-Plane — API Gateway
// Unified gateway that normalizes requests/responses, adds observability,
// manages rate limiting, and provides cost control.

import {
  ModelRequest,
  ModelResponse,
  CostTracker,
  CostSnapshot,
  QoSConfig,
  RateLimitConfig,
  Logger,
  defaultLogger,
  ProviderKind,
} from '../types';
import { ModelRouter } from '../router/model-router';

// ---------------------------------------------------------------------------
// Trace / Observability
// ---------------------------------------------------------------------------

export interface RequestTrace {
  traceId: string;
  requestId: string;
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
  model?: string;
  provider?: ProviderKind;
  status: 'pending' | 'success' | 'error';
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  metadata?: Record<string, unknown>;
}

export type TraceCallback = (trace: RequestTrace) => void;

// ---------------------------------------------------------------------------
// Rate limiter (token bucket)
// ---------------------------------------------------------------------------

class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private capacity: number,
    private refillRate: number, // tokens per ms
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  tryAcquire(count = 1): boolean {
    this.refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}

class RateLimiter {
  private requestBucket: TokenBucket;
  private tokenBucket: TokenBucket;
  private concurrentCount = 0;
  private maxConcurrent: number;

  constructor(config: RateLimitConfig) {
    this.requestBucket = new TokenBucket(config.requestsPerMinute, config.requestsPerMinute / 60_000);
    this.tokenBucket = new TokenBucket(config.tokensPerMinute, config.tokensPerMinute / 60_000);
    this.maxConcurrent = config.concurrentRequests;
  }

  acquire(estimatedTokens: number): boolean {
    if (this.concurrentCount >= this.maxConcurrent) return false;
    if (!this.requestBucket.tryAcquire(1)) return false;
    if (!this.tokenBucket.tryAcquire(estimatedTokens)) return false;
    this.concurrentCount++;
    return true;
  }

  release(): void {
    this.concurrentCount = Math.max(0, this.concurrentCount - 1);
  }
}

// ---------------------------------------------------------------------------
// In-memory cost tracker
// ---------------------------------------------------------------------------

export class InMemoryCostTracker implements CostTracker {
  totalCostUsd = 0;
  requestCount = 0;
  tokenCounts = { input: 0, output: 0 };
  costByProvider: Record<string, number> = {};
  costByModel: Record<string, number> = {};
  budgetRemainingUsd: number;
  windowStart: Date;
  windowEnd: Date;

  constructor(private budgetUsd: number, windowMinutes = 60) {
    this.budgetRemainingUsd = budgetUsd;
    this.windowStart = new Date();
    this.windowEnd = new Date(Date.now() + windowMinutes * 60_000);
  }

  recordUsage(response: ModelResponse): void {
    this.totalCostUsd += response.costUsd;
    this.budgetRemainingUsd -= response.costUsd;
    this.requestCount++;
    this.tokenCounts.input += response.usage.inputTokens;
    this.tokenCounts.output += response.usage.outputTokens;
    this.costByProvider[response.provider] = (this.costByProvider[response.provider] ?? 0) + response.costUsd;
    this.costByModel[response.model] = (this.costByModel[response.model] ?? 0) + response.costUsd;
  }

  isWithinBudget(estimatedCostUsd: number): boolean {
    return this.budgetRemainingUsd >= estimatedCostUsd;
  }

  reset(): void {
    this.totalCostUsd = 0;
    this.requestCount = 0;
    this.tokenCounts = { input: 0, output: 0 };
    this.costByProvider = {};
    this.costByModel = {};
    this.budgetRemainingUsd = this.budgetUsd;
    this.windowStart = new Date();
  }

  snapshot(): CostSnapshot {
    return {
      timestamp: new Date(),
      totalCostUsd: this.totalCostUsd,
      requestCount: this.requestCount,
      costByProvider: { ...this.costByProvider },
    };
  }
}

// ---------------------------------------------------------------------------
// Gateway options
// ---------------------------------------------------------------------------

export interface ApiGatewayOptions {
  router: ModelRouter;
  costTracker?: CostTracker;
  rateLimitConfig?: RateLimitConfig;
  defaultQos?: QoSConfig;
  traceCallback?: TraceCallback;
  logger?: Logger;
}

// ---------------------------------------------------------------------------
// API Gateway
// ---------------------------------------------------------------------------

export class ApiGateway {
  private router: ModelRouter;
  private costTracker: CostTracker;
  private rateLimiter?: RateLimiter;
  private defaultQos?: QoSConfig;
  private traceCallback?: TraceCallback;
  private logger: Logger;
  private traces = new Map<string, RequestTrace>();

  constructor(options: ApiGatewayOptions) {
    this.router = options.router;
    this.costTracker = options.costTracker ?? new InMemoryCostTracker(100); // $100 default budget
    this.defaultQos = options.defaultQos;
    this.traceCallback = options.traceCallback;
    this.logger = options.logger ?? defaultLogger;

    if (options.rateLimitConfig) {
      this.rateLimiter = new RateLimiter(options.rateLimitConfig);
    }
  }

  // -----------------------------------------------------------------------
  // Main entry point
  // -----------------------------------------------------------------------

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const traceId = `gw-${request.requestId}-${Date.now()}`;
    const trace: RequestTrace = {
      traceId,
      requestId: request.requestId,
      startTime: new Date(),
      status: 'pending',
      metadata: request.metadata,
    };
    this.traces.set(traceId, trace);

    try {
      // 1. Normalize & enrich the request.
      const normalized = this.normalizeRequest(request);

      // 2. Rate limiting.
      if (this.rateLimiter) {
        const estTokens = normalized.maxTokens ?? 2048;
        if (!this.rateLimiter.acquire(estTokens)) {
          throw new GatewayError('RATE_LIMITED', 'Request rate limit exceeded — try again shortly');
        }
      }

      // 3. Cost budget check.
      const estCost = this.estimateCost(normalized);
      if (!this.costTracker.isWithinBudget(estCost)) {
        throw new GatewayError('BUDGET_EXCEEDED', `Estimated cost $${estCost.toFixed(4)} exceeds remaining budget $${this.costTracker.budgetRemainingUsd.toFixed(4)}`);
      }

      // 4. Route and execute.
      const response = await this.router.route(normalized);

      // 5. Post-processing.
      this.costTracker.recordUsage(response);

      // 6. Finalize trace.
      trace.endTime = new Date();
      trace.durationMs = trace.endTime.getTime() - trace.startTime.getTime();
      trace.model = response.model;
      trace.provider = response.provider;
      trace.status = 'success';
      trace.inputTokens = response.usage.inputTokens;
      trace.outputTokens = response.usage.outputTokens;
      trace.costUsd = response.costUsd;
      this.emitTrace(trace);

      this.logger.log('info', 'Request completed', {
        requestId: request.requestId,
        model: response.model,
        latencyMs: response.latencyMs,
        cost: response.costUsd.toFixed(6),
      });

      return { ...response, traceId };
    } catch (err) {
      trace.endTime = new Date();
      trace.durationMs = trace.endTime.getTime() - trace.startTime.getTime();
      trace.status = 'error';
      trace.error = err instanceof Error ? err.message : String(err);
      this.emitTrace(trace);

      this.logger.log('error', 'Request failed', { requestId: request.requestId, error: trace.error });
      throw err;
    } finally {
      this.rateLimiter?.release();
    }
  }

  // -----------------------------------------------------------------------
  // Observability
  // -----------------------------------------------------------------------

  getTrace(traceId: string): RequestTrace | undefined {
    return this.traces.get(traceId);
  }

  getRecentTraces(limit = 50): RequestTrace[] {
    const all = [...this.traces.values()];
    return all.slice(-limit);
  }

  getCostSnapshot(): CostSnapshot {
    return this.costTracker.snapshot();
  }

  resetCostTracker(): void {
    this.costTracker.reset();
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private normalizeRequest(request: ModelRequest): ModelRequest {
    return {
      ...request,
      temperature: request.temperature ?? 0.7,
      maxTokens: request.maxTokens ?? 4096,
      qos: request.qos ?? this.defaultQos,
      metadata: {
        ...request.metadata,
        gatewayTimestamp: new Date().toISOString(),
      },
    };
  }

  private estimateCost(request: ModelRequest): number {
    // Rough estimate: assume ~1k input tokens + maxTokens output tokens
    const inputTokens = 1000;
    const outputTokens = request.maxTokens ?? 4096;
    // Use mid-range cost as estimate ($0.003 / 1k in, $0.015 / 1k out)
    return (inputTokens / 1000) * 0.003 + (outputTokens / 1000) * 0.015;
  }

  private emitTrace(trace: RequestTrace): void {
    if (this.traceCallback) {
      try {
        this.traceCallback(trace);
      } catch (err) {
        this.logger.log('warn', 'Trace callback error', { error: String(err) });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Gateway-specific error
// ---------------------------------------------------------------------------

export class GatewayError extends Error {
  constructor(
    public readonly code: 'RATE_LIMITED' | 'BUDGET_EXCEEDED' | 'NO_MODEL' | 'PROVIDER_ERROR',
    message: string,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}
