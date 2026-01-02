import { EventEmitter } from "events";
import { policyEngine } from "./policyEngine";
import { eventLogger, logToolEvent } from "./eventLogger";
import type { ToolOutput, ToolCapability } from "./contracts";

export class CancellationToken {
  private _isCancelled: boolean = false;
  private _reason: string = "";
  private callbacks: (() => void)[] = [];

  get isCancelled(): boolean {
    return this._isCancelled;
  }

  get reason(): string {
    return this._reason;
  }

  cancel(reason: string = "Cancelled by user"): void {
    if (this._isCancelled) return;
    this._isCancelled = true;
    this._reason = reason;
    this.callbacks.forEach(cb => cb());
  }

  onCancelled(callback: () => void): void {
    if (this._isCancelled) {
      callback();
    } else {
      this.callbacks.push(callback);
    }
  }

  throwIfCancelled(): void {
    if (this._isCancelled) {
      throw new CancellationError(this._reason);
    }
  }
}

export class CancellationError extends Error {
  constructor(reason: string) {
    super(`Operation cancelled: ${reason}`);
    this.name = "CancellationError";
  }
}

interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  state: "closed" | "open" | "half-open";
  successesSinceHalfOpen: number;
}

export class CircuitBreaker {
  private states: Map<string, CircuitBreakerState> = new Map();
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly halfOpenSuccessThreshold: number;

  constructor(
    failureThreshold: number = 5,
    resetTimeoutMs: number = 60000,
    halfOpenSuccessThreshold: number = 2
  ) {
    this.failureThreshold = failureThreshold;
    this.resetTimeoutMs = resetTimeoutMs;
    this.halfOpenSuccessThreshold = halfOpenSuccessThreshold;
  }

  private getState(toolName: string): CircuitBreakerState {
    if (!this.states.has(toolName)) {
      this.states.set(toolName, {
        failures: 0,
        lastFailure: 0,
        state: "closed",
        successesSinceHalfOpen: 0,
      });
    }
    return this.states.get(toolName)!;
  }

  canExecute(toolName: string): boolean {
    const state = this.getState(toolName);
    const now = Date.now();

    if (state.state === "open") {
      if (now - state.lastFailure >= this.resetTimeoutMs) {
        state.state = "half-open";
        state.successesSinceHalfOpen = 0;
        console.log(`[CircuitBreaker] ${toolName}: open -> half-open`);
        return true;
      }
      return false;
    }

    return true;
  }

  recordSuccess(toolName: string): void {
    const state = this.getState(toolName);

    if (state.state === "half-open") {
      state.successesSinceHalfOpen++;
      if (state.successesSinceHalfOpen >= this.halfOpenSuccessThreshold) {
        state.state = "closed";
        state.failures = 0;
        console.log(`[CircuitBreaker] ${toolName}: half-open -> closed`);
      }
    } else if (state.state === "closed") {
      state.failures = Math.max(0, state.failures - 1);
    }
  }

  recordFailure(toolName: string): void {
    const state = this.getState(toolName);
    state.failures++;
    state.lastFailure = Date.now();

    if (state.state === "half-open") {
      state.state = "open";
      console.log(`[CircuitBreaker] ${toolName}: half-open -> open (failure during recovery)`);
    } else if (state.failures >= this.failureThreshold) {
      state.state = "open";
      console.log(`[CircuitBreaker] ${toolName}: closed -> open (threshold reached: ${state.failures})`);
    }
  }

  getStatus(toolName: string): CircuitBreakerState {
    return { ...this.getState(toolName) };
  }

  reset(toolName?: string): void {
    if (toolName) {
      this.states.delete(toolName);
    } else {
      this.states.clear();
    }
  }
}

export interface ExecutionOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  timeoutMs: number;
  cancellationToken?: CancellationToken;
}

const DEFAULT_OPTIONS: ExecutionOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  timeoutMs: 60000,
};

export interface ExecutionResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    attempt: number;
  };
  metrics: {
    attempts: number;
    totalDurationMs: number;
    lastAttemptDurationMs: number;
  };
}

export class ExecutionEngine extends EventEmitter {
  private circuitBreaker: CircuitBreaker;

  constructor() {
    super();
    this.circuitBreaker = new CircuitBreaker();
  }

  async execute<T>(
    toolName: string,
    fn: () => Promise<T>,
    options: Partial<ExecutionOptions> = {},
    context?: { runId: string; correlationId: string; stepIndex: number }
  ): Promise<ExecutionResult<T>> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const startTime = Date.now();
    let lastAttemptDuration = 0;
    let attempt = 0;

    const policy = policyEngine.getPolicy(toolName);
    if (policy) {
      opts.timeoutMs = Math.min(opts.timeoutMs, policy.maxExecutionTimeMs);
      opts.maxRetries = Math.min(opts.maxRetries, policy.maxRetries);
    }

    while (attempt <= opts.maxRetries) {
      attempt++;
      opts.cancellationToken?.throwIfCancelled();

      if (!this.circuitBreaker.canExecute(toolName)) {
        const status = this.circuitBreaker.getStatus(toolName);
        return {
          success: false,
          error: {
            code: "CIRCUIT_OPEN",
            message: `Circuit breaker is open for ${toolName}. Too many recent failures.`,
            retryable: false,
            attempt,
          },
          metrics: {
            attempts: attempt,
            totalDurationMs: Date.now() - startTime,
            lastAttemptDurationMs: 0,
          },
        };
      }

      const attemptStart = Date.now();

      try {
        const result = await this.executeWithTimeout(
          fn,
          opts.timeoutMs,
          opts.cancellationToken
        );

        lastAttemptDuration = Date.now() - attemptStart;
        this.circuitBreaker.recordSuccess(toolName);

        if (context) {
          await logToolEvent(
            context.runId,
            context.correlationId,
            context.stepIndex,
            toolName,
            "tool_completed",
            { attempt, durationMs: lastAttemptDuration }
          );
        }

        return {
          success: true,
          data: result,
          metrics: {
            attempts: attempt,
            totalDurationMs: Date.now() - startTime,
            lastAttemptDurationMs: lastAttemptDuration,
          },
        };
      } catch (error: any) {
        lastAttemptDuration = Date.now() - attemptStart;

        if (error instanceof CancellationError) {
          return {
            success: false,
            error: {
              code: "CANCELLED",
              message: error.message,
              retryable: false,
              attempt,
            },
            metrics: {
              attempts: attempt,
              totalDurationMs: Date.now() - startTime,
              lastAttemptDurationMs: lastAttemptDuration,
            },
          };
        }

        const isRetryable = this.isRetryableError(error);
        const isLastAttempt = attempt > opts.maxRetries;

        if (isLastAttempt || !isRetryable) {
          this.circuitBreaker.recordFailure(toolName);

          if (context) {
            await logToolEvent(
              context.runId,
              context.correlationId,
              context.stepIndex,
              toolName,
              "tool_failed",
              { attempt, error: error.message, retryable: isRetryable }
            );
          }

          return {
            success: false,
            error: {
              code: this.getErrorCode(error),
              message: error.message,
              retryable: isRetryable,
              attempt,
            },
            metrics: {
              attempts: attempt,
              totalDurationMs: Date.now() - startTime,
              lastAttemptDurationMs: lastAttemptDuration,
            },
          };
        }

        const delay = this.calculateBackoff(attempt, opts.baseDelayMs, opts.maxDelayMs);
        console.log(`[ExecutionEngine] ${toolName} attempt ${attempt} failed, retrying in ${delay}ms: ${error.message}`);

        await this.delay(delay, opts.cancellationToken);
      }
    }

    return {
      success: false,
      error: {
        code: "MAX_RETRIES_EXCEEDED",
        message: `Failed after ${attempt} attempts`,
        retryable: false,
        attempt,
      },
      metrics: {
        attempts: attempt,
        totalDurationMs: Date.now() - startTime,
        lastAttemptDurationMs: lastAttemptDuration,
      },
    };
  }

  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    cancellationToken?: CancellationToken
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const cancelHandler = () => {
        clearTimeout(timeoutId);
        reject(new CancellationError(cancellationToken?.reason || "Cancelled"));
      };

      if (cancellationToken) {
        cancellationToken.onCancelled(cancelHandler);
      }

      fn()
        .then(result => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  private calculateBackoff(attempt: number, baseDelay: number, maxDelay: number): number {
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 0.3 * exponentialDelay;
    return Math.min(exponentialDelay + jitter, maxDelay);
  }

  private async delay(ms: number, cancellationToken?: CancellationToken): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(resolve, ms);

      if (cancellationToken) {
        cancellationToken.onCancelled(() => {
          clearTimeout(timeoutId);
          reject(new CancellationError(cancellationToken.reason));
        });
      }
    });
  }

  private isRetryableError(error: any): boolean {
    const retryablePatterns = [
      "ETIMEDOUT",
      "ECONNRESET",
      "ECONNREFUSED",
      "ENOTFOUND",
      "timeout",
      "rate limit",
      "503",
      "502",
      "429",
      "temporarily unavailable",
    ];

    const errorString = (error.message || "").toLowerCase() + (error.code || "").toLowerCase();
    return retryablePatterns.some(pattern => errorString.includes(pattern.toLowerCase()));
  }

  private getErrorCode(error: any): string {
    if (error.code) return error.code;
    if (error.message?.includes("timeout")) return "TIMEOUT";
    if (error.message?.includes("rate limit")) return "RATE_LIMITED";
    return "EXECUTION_ERROR";
  }

  getCircuitBreakerStatus(toolName: string): CircuitBreakerState {
    return this.circuitBreaker.getStatus(toolName);
  }

  resetCircuitBreaker(toolName?: string): void {
    this.circuitBreaker.reset(toolName);
  }
}

export const executionEngine = new ExecutionEngine();
