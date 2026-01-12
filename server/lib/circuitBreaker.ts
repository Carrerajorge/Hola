import { CircuitBreaker, CircuitState, CircuitBreakerError, getCircuitBreaker } from "../utils/circuitBreaker";
import { createLogger } from "./structuredLogger";
import { recordConnectorUsage } from "./connectorMetrics";

const logger = createLogger("circuit-breaker-wrapper");

export interface ServiceCircuitConfig {
  name: string;
  failureThreshold?: number;
  resetTimeout?: number;
  halfOpenMaxCalls?: number;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  fallback?: () => Promise<any>;
  onSuccess?: (latencyMs: number) => void;
  onFailure?: (error: Error, latencyMs: number) => void;
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
}

export interface ServiceCallResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  latencyMs: number;
  fromFallback?: boolean;
  circuitState: CircuitState;
  retryCount?: number;
}

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Operation ${operationName} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}

function calculateRetryDelay(attempt: number, baseDelay: number): number {
  const jitter = Math.random() * 0.3 * baseDelay;
  return Math.min(baseDelay * Math.pow(2, attempt) + jitter, 10000);
}

export class ServiceCircuitBreaker<T = any> {
  private breaker: CircuitBreaker;
  private config: Required<Omit<ServiceCircuitConfig, "fallback" | "onSuccess" | "onFailure" | "onStateChange">> & 
    Pick<ServiceCircuitConfig, "fallback" | "onSuccess" | "onFailure" | "onStateChange">;
  private metrics: {
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    timeouts: number;
    fallbackCalls: number;
    totalLatencyMs: number;
    lastCallTime: number;
  };

  constructor(config: ServiceCircuitConfig) {
    this.config = {
      name: config.name,
      failureThreshold: config.failureThreshold ?? 5,
      resetTimeout: config.resetTimeout ?? 60000,
      halfOpenMaxCalls: config.halfOpenMaxCalls ?? 2,
      timeout: config.timeout ?? DEFAULT_TIMEOUT,
      retries: config.retries ?? DEFAULT_RETRIES,
      retryDelay: config.retryDelay ?? DEFAULT_RETRY_DELAY,
      fallback: config.fallback,
      onSuccess: config.onSuccess,
      onFailure: config.onFailure,
      onStateChange: config.onStateChange,
    };

    this.breaker = getCircuitBreaker(this.config.name, {
      failureThreshold: this.config.failureThreshold,
      resetTimeout: this.config.resetTimeout,
      halfOpenMaxCalls: this.config.halfOpenMaxCalls,
      onStateChange: (from, to) => {
        logger.info(`Circuit breaker state change: ${this.config.name}`, { from, to });
        this.config.onStateChange?.(from, to);
      },
    });

    this.metrics = {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      timeouts: 0,
      fallbackCalls: 0,
      totalLatencyMs: 0,
      lastCallTime: 0,
    };
  }

  async call(fn: () => Promise<T>, operationName?: string): Promise<ServiceCallResult<T>> {
    const startTime = Date.now();
    const opName = operationName || this.config.name;
    let retryCount = 0;

    this.metrics.totalCalls++;
    this.metrics.lastCallTime = startTime;

    try {
      const result = await this.breaker.execute(async () => {
        let lastError: Error | undefined;

        for (let attempt = 0; attempt <= this.config.retries; attempt++) {
          try {
            if (attempt > 0) {
              retryCount = attempt;
              const delay = calculateRetryDelay(attempt - 1, this.config.retryDelay);
              logger.debug(`Retrying ${opName}, attempt ${attempt + 1}`, { delay });
              await sleep(delay);
            }

            const data = await withTimeout(fn(), this.config.timeout, opName);
            return data;
          } catch (error: any) {
            lastError = error;
            
            if (error.message?.includes("timed out")) {
              this.metrics.timeouts++;
            }

            if (attempt === this.config.retries) {
              throw error;
            }

            logger.warn(`Attempt ${attempt + 1} failed for ${opName}`, {
              error: error.message,
              remainingRetries: this.config.retries - attempt,
            });
          }
        }

        throw lastError || new Error(`All retries exhausted for ${opName}`);
      });

      const latencyMs = Date.now() - startTime;
      this.metrics.successfulCalls++;
      this.metrics.totalLatencyMs += latencyMs;

      recordConnectorUsage(this.config.name as any, latencyMs, true);
      this.config.onSuccess?.(latencyMs);

      return {
        success: true,
        data: result,
        latencyMs,
        circuitState: this.breaker.getState(),
        retryCount: retryCount > 0 ? retryCount : undefined,
      };
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      this.metrics.failedCalls++;
      this.metrics.totalLatencyMs += latencyMs;

      recordConnectorUsage(this.config.name as any, latencyMs, false);
      this.config.onFailure?.(error, latencyMs);

      if (error instanceof CircuitBreakerError) {
        logger.warn(`Circuit open for ${opName}`, {
          state: error.state,
          nextAttemptAt: error.nextAttemptAt,
        });
      } else {
        logger.error(`Service call failed: ${opName}`, {
          error: error.message,
          latencyMs,
          retryCount,
        });
      }

      if (this.config.fallback) {
        try {
          const fallbackData = await this.config.fallback();
          this.metrics.fallbackCalls++;
          
          return {
            success: true,
            data: fallbackData,
            latencyMs: Date.now() - startTime,
            fromFallback: true,
            circuitState: this.breaker.getState(),
          };
        } catch (fallbackError: any) {
          logger.error(`Fallback failed for ${opName}`, { error: fallbackError.message });
        }
      }

      return {
        success: false,
        error: error.message,
        latencyMs,
        circuitState: this.breaker.getState(),
        retryCount: retryCount > 0 ? retryCount : undefined,
      };
    }
  }

  getState(): CircuitState {
    return this.breaker.getState();
  }

  getStats() {
    const breakerStats = this.breaker.getStats();
    return {
      ...breakerStats,
      ...this.metrics,
      averageLatencyMs: this.metrics.totalCalls > 0
        ? Math.round(this.metrics.totalLatencyMs / this.metrics.totalCalls)
        : 0,
      successRate: this.metrics.totalCalls > 0
        ? ((this.metrics.successfulCalls / this.metrics.totalCalls) * 100).toFixed(2) + "%"
        : "N/A",
    };
  }

  reset(): void {
    this.breaker.reset();
    logger.info(`Circuit breaker reset: ${this.config.name}`);
  }
}

const serviceBreakers = new Map<string, ServiceCircuitBreaker>();

export function createServiceCircuitBreaker<T = any>(config: ServiceCircuitConfig): ServiceCircuitBreaker<T> {
  const existing = serviceBreakers.get(config.name);
  if (existing) {
    return existing as ServiceCircuitBreaker<T>;
  }

  const breaker = new ServiceCircuitBreaker<T>(config);
  serviceBreakers.set(config.name, breaker);
  return breaker;
}

export function getServiceCircuitBreaker(name: string): ServiceCircuitBreaker | undefined {
  return serviceBreakers.get(name);
}

export function getAllServiceCircuitBreakers(): Map<string, ServiceCircuitBreaker> {
  return new Map(serviceBreakers);
}

export const llmCircuitBreaker = createServiceCircuitBreaker({
  name: "llm-gateway",
  failureThreshold: 5,
  resetTimeout: 30000,
  timeout: 60000,
  retries: 2,
  retryDelay: 1000,
});

export const xaiCircuitBreaker = createServiceCircuitBreaker({
  name: "xai-api",
  failureThreshold: 5,
  resetTimeout: 60000,
  timeout: 60000,
  retries: 2,
  retryDelay: 1000,
});

export const geminiCircuitBreaker = createServiceCircuitBreaker({
  name: "gemini-api",
  failureThreshold: 5,
  resetTimeout: 60000,
  timeout: 60000,
  retries: 2,
  retryDelay: 1000,
});

export { CircuitState, CircuitBreakerError };
