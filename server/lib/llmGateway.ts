import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionChunk } from "openai/resources/chat/completions";
import { MODELS } from "./openai";

interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  state: "closed" | "open" | "half-open";
  halfOpenAt: number;
  halfOpenAttempts: number;
}

interface RateLimitState {
  tokens: number;
  lastRefill: number;
}

interface LLMRequestOptions {
  model?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  userId?: string;
  requestId?: string;
  timeout?: number;
}

interface LLMResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  requestId: string;
  latencyMs: number;
  model: string;
  cached?: boolean;
}

interface StreamChunk {
  content: string;
  sequenceId: number;
  done: boolean;
  requestId: string;
}

const CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: 5,
  resetTimeoutMs: 30000,
  halfOpenRequests: 3,
};

const RATE_LIMIT_CONFIG = {
  tokensPerMinute: 100,
  refillRateMs: 600,
  maxBurst: 150,
};

const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  jitterFactor: 0.3,
};

const DEFAULT_TIMEOUT_MS = 60000;
const MAX_CONTEXT_TOKENS = 8000;

class LLMGateway {
  private client: OpenAI;
  private circuitBreaker: CircuitBreakerState;
  private rateLimitByUser: Map<string, RateLimitState> = new Map();
  private requestCache: Map<string, { response: LLMResponse; expiresAt: number }> = new Map();
  private metrics: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    totalLatencyMs: number;
    totalTokens: number;
    rateLimitHits: number;
    circuitBreakerOpens: number;
    cacheHits: number;
  };

  constructor() {
    this.client = new OpenAI({
      baseURL: "https://api.x.ai/v1",
      apiKey: process.env.XAI_API_KEY,
    });

    this.circuitBreaker = {
      failures: 0,
      lastFailure: 0,
      state: "closed",
      halfOpenAt: 0,
      halfOpenAttempts: 0,
    };

    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalLatencyMs: 0,
      totalTokens: 0,
      rateLimitHits: 0,
      circuitBreakerOpens: 0,
      cacheHits: 0,
    };

    setInterval(() => this.cleanupCache(), 60000);
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getCacheKey(messages: ChatCompletionMessageParam[], options: LLMRequestOptions): string | null {
    // Don't cache short conversational messages - they should get dynamic responses
    const lastUserMessage = messages.filter(m => m.role === "user").pop();
    const lastMsgContent = typeof lastUserMessage?.content === "string" ? lastUserMessage.content : "";
    if (lastMsgContent.length < 50) {
      return null; // Skip caching for short messages
    }
    
    const userId = options.userId || "anonymous";
    const msgHash = JSON.stringify(messages);
    const optsHash = `${userId}:${options.model}:${options.temperature}:${options.topP}`;
    return `${optsHash}:${Buffer.from(msgHash).toString("base64").slice(0, 64)}`;
  }

  private cleanupCache(): void {
    const now = Date.now();
    const entries = Array.from(this.requestCache.entries());
    for (const [key, value] of entries) {
      if (value.expiresAt < now) {
        this.requestCache.delete(key);
      }
    }
  }

  private checkRateLimit(userId: string): boolean {
    const now = Date.now();
    let state = this.rateLimitByUser.get(userId);

    if (!state) {
      state = { tokens: RATE_LIMIT_CONFIG.tokensPerMinute, lastRefill: now };
      this.rateLimitByUser.set(userId, state);
    }

    const elapsed = now - state.lastRefill;
    const refillAmount = Math.floor(elapsed / RATE_LIMIT_CONFIG.refillRateMs);
    
    if (refillAmount > 0) {
      state.tokens = Math.min(
        RATE_LIMIT_CONFIG.maxBurst,
        state.tokens + refillAmount
      );
      state.lastRefill = now;
    }

    if (state.tokens > 0) {
      state.tokens--;
      return true;
    }

    this.metrics.rateLimitHits++;
    return false;
  }

  private checkCircuitBreaker(): boolean {
    const now = Date.now();

    if (this.circuitBreaker.state === "open") {
      if (now >= this.circuitBreaker.halfOpenAt) {
        this.circuitBreaker.state = "half-open";
        this.circuitBreaker.halfOpenAttempts = 0;
        this.circuitBreaker.failures = 0;
        console.log(`[LLMGateway] Circuit breaker transitioning to half-open`);
      } else {
        return false;
      }
    }

    if (this.circuitBreaker.state === "half-open") {
      if (this.circuitBreaker.halfOpenAttempts >= CIRCUIT_BREAKER_CONFIG.halfOpenRequests) {
        return false;
      }
      this.circuitBreaker.halfOpenAttempts++;
    }

    return true;
  }

  private recordSuccess(): void {
    if (this.circuitBreaker.state === "half-open") {
      if (this.circuitBreaker.halfOpenAttempts >= CIRCUIT_BREAKER_CONFIG.halfOpenRequests) {
        this.circuitBreaker.state = "closed";
        this.circuitBreaker.halfOpenAttempts = 0;
        console.log(`[LLMGateway] Circuit breaker closed after successful probes`);
      }
    }
    this.circuitBreaker.failures = 0;
    this.metrics.successfulRequests++;
  }

  private recordFailure(): void {
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailure = Date.now();
    this.metrics.failedRequests++;

    if (this.circuitBreaker.state === "half-open") {
      this.circuitBreaker.state = "open";
      this.circuitBreaker.halfOpenAt = Date.now() + CIRCUIT_BREAKER_CONFIG.resetTimeoutMs;
      this.circuitBreaker.halfOpenAttempts = 0;
      this.metrics.circuitBreakerOpens++;
      console.error(`[LLMGateway] Circuit breaker re-opened from half-open at ${new Date().toISOString()}`);
    } else if (this.circuitBreaker.failures >= CIRCUIT_BREAKER_CONFIG.failureThreshold) {
      this.circuitBreaker.state = "open";
      this.circuitBreaker.halfOpenAt = Date.now() + CIRCUIT_BREAKER_CONFIG.resetTimeoutMs;
      this.metrics.circuitBreakerOpens++;
      console.error(`[LLMGateway] Circuit breaker opened at ${new Date().toISOString()}`);
    }
  }

  private calculateRetryDelay(attempt: number): number {
    const baseDelay = RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt);
    const jitter = baseDelay * RETRY_CONFIG.jitterFactor * Math.random();
    return Math.min(baseDelay + jitter, RETRY_CONFIG.maxDelayMs);
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  truncateContext(messages: ChatCompletionMessageParam[], maxTokens: number = MAX_CONTEXT_TOKENS): ChatCompletionMessageParam[] {
    let totalEstimatedTokens = messages.reduce((sum, msg) => {
      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      return sum + Math.ceil(content.length / 4);
    }, 0);

    if (totalEstimatedTokens <= maxTokens) {
      return messages;
    }

    const systemMessages = messages.filter((m) => m.role === "system");
    const otherMessages = messages.filter((m) => m.role !== "system");

    const truncated: ChatCompletionMessageParam[] = [...systemMessages];
    let remainingTokens = maxTokens - systemMessages.reduce((sum, msg) => {
      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      return sum + Math.ceil(content.length / 4);
    }, 0);

    for (let i = otherMessages.length - 1; i >= 0; i--) {
      const msg = otherMessages[i];
      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      const msgTokens = Math.ceil(content.length / 4);
      
      if (msgTokens <= remainingTokens) {
        truncated.splice(systemMessages.length, 0, msg);
        remainingTokens -= msgTokens;
      } else if (remainingTokens > 100) {
        const truncatedContent = content.slice(0, remainingTokens * 4);
        truncated.splice(systemMessages.length, 0, {
          ...msg,
          content: truncatedContent + "... [truncated]",
        } as ChatCompletionMessageParam);
        break;
      }
    }

    console.log(`[LLMGateway] Truncated context from ${totalEstimatedTokens} to ~${maxTokens - remainingTokens} tokens`);
    return truncated;
  }

  async chat(
    messages: ChatCompletionMessageParam[],
    options: LLMRequestOptions = {}
  ): Promise<LLMResponse> {
    const requestId = options.requestId || this.generateRequestId();
    const startTime = Date.now();
    const userId = options.userId || "anonymous";
    const model = options.model || MODELS.TEXT;
    const timeout = options.timeout || DEFAULT_TIMEOUT_MS;

    this.metrics.totalRequests++;

    const cacheKey = this.getCacheKey(messages, options);
    if (cacheKey) {
      const cached = this.requestCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        this.metrics.cacheHits++;
        return { ...cached.response, cached: true, requestId };
      }
    }

    if (!this.checkRateLimit(userId)) {
      throw new Error(`Rate limit exceeded for user ${userId}`);
    }

    if (!this.checkCircuitBreaker()) {
      throw new Error("Service temporarily unavailable (circuit breaker open)");
    }

    const truncatedMessages = this.truncateContext(messages, options.maxTokens ? options.maxTokens * 2 : MAX_CONTEXT_TOKENS);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await this.client.chat.completions.create(
          {
            model,
            messages: truncatedMessages,
            temperature: options.temperature ?? 0.7,
            top_p: options.topP ?? 1,
            max_tokens: options.maxTokens,
          },
          { signal: controller.signal }
        );

        clearTimeout(timeoutId);

        const latencyMs = Date.now() - startTime;
        const content = response.choices[0]?.message?.content || "";
        const usage = response.usage;

        if (usage) {
          this.metrics.totalTokens += usage.total_tokens;
        }

        this.recordSuccess();
        this.metrics.totalLatencyMs += latencyMs;

        const result: LLMResponse = {
          content,
          usage: usage
            ? {
                promptTokens: usage.prompt_tokens,
                completionTokens: usage.completion_tokens,
                totalTokens: usage.total_tokens,
              }
            : undefined,
          requestId,
          latencyMs,
          model,
        };

        if (cacheKey) {
          this.requestCache.set(cacheKey, {
            response: result,
            expiresAt: Date.now() + 300000,
          });
        }

        console.log(`[LLMGateway] ${requestId} completed in ${latencyMs}ms, tokens: ${usage?.total_tokens || 0}`);
        return result;
      } catch (error: any) {
        lastError = error;

        if (error.name === "AbortError") {
          console.error(`[LLMGateway] ${requestId} timeout after ${timeout}ms`);
          this.recordFailure();
          throw new Error(`Request timeout after ${timeout}ms`);
        }

        const isRetryable =
          error.status === 429 ||
          error.status === 500 ||
          error.status === 502 ||
          error.status === 503 ||
          error.code === "ECONNRESET" ||
          error.code === "ETIMEDOUT";

        if (!isRetryable || attempt >= RETRY_CONFIG.maxRetries) {
          this.recordFailure();
          console.error(`[LLMGateway] ${requestId} failed after ${attempt + 1} attempts:`, error.message);
          throw error;
        }

        const delay = this.calculateRetryDelay(attempt);
        console.warn(`[LLMGateway] ${requestId} attempt ${attempt + 1} failed, retrying in ${delay}ms`);
        await this.sleep(delay);
      }
    }

    this.recordFailure();
    throw lastError || new Error("Unknown error");
  }

  async *streamChat(
    messages: ChatCompletionMessageParam[],
    options: LLMRequestOptions = {}
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const requestId = options.requestId || this.generateRequestId();
    const userId = options.userId || "anonymous";
    const model = options.model || MODELS.TEXT;
    let sequenceId = 0;

    this.metrics.totalRequests++;

    if (!this.checkRateLimit(userId)) {
      throw new Error(`Rate limit exceeded for user ${userId}`);
    }

    if (!this.checkCircuitBreaker()) {
      throw new Error("Service temporarily unavailable (circuit breaker open)");
    }

    const truncatedMessages = this.truncateContext(messages, options.maxTokens ? options.maxTokens * 2 : MAX_CONTEXT_TOKENS);

    try {
      const stream = await this.client.chat.completions.create({
        model,
        messages: truncatedMessages,
        temperature: options.temperature ?? 0.7,
        top_p: options.topP ?? 1,
        max_tokens: options.maxTokens,
        stream: true,
      });

      let buffer = "";
      const flushThreshold = 50;

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        buffer += content;

        if (buffer.length >= flushThreshold || content.includes("\n") || content.includes(".")) {
          yield {
            content: buffer,
            sequenceId: sequenceId++,
            done: false,
            requestId,
          };
          buffer = "";
        }
      }

      if (buffer) {
        yield {
          content: buffer,
          sequenceId: sequenceId++,
          done: false,
          requestId,
        };
      }

      yield {
        content: "",
        sequenceId: sequenceId++,
        done: true,
        requestId,
      };

      this.recordSuccess();
    } catch (error: any) {
      this.recordFailure();
      console.error(`[LLMGateway] Stream ${requestId} failed:`, error.message);
      throw error;
    }
  }

  getMetrics() {
    return {
      ...this.metrics,
      averageLatencyMs:
        this.metrics.successfulRequests > 0
          ? Math.round(this.metrics.totalLatencyMs / this.metrics.successfulRequests)
          : 0,
      successRate:
        this.metrics.totalRequests > 0
          ? Math.round((this.metrics.successfulRequests / this.metrics.totalRequests) * 100)
          : 100,
      circuitBreakerStatus: this.circuitBreaker.state,
      cacheSize: this.requestCache.size,
      rateLimitedUsers: this.rateLimitByUser.size,
    };
  }

  resetMetrics(): void {
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalLatencyMs: 0,
      totalTokens: 0,
      rateLimitHits: 0,
      circuitBreakerOpens: 0,
      cacheHits: 0,
    };
  }
}

export const llmGateway = new LLMGateway();
export type { LLMRequestOptions, LLMResponse, StreamChunk };
