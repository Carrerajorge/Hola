import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionChunk } from "openai/resources/chat/completions";
import Anthropic from "@anthropic-ai/sdk";
import { MODELS } from "./openai";
import { geminiChat, geminiStreamChat, GEMINI_MODELS, type GeminiChatMessage } from "./gemini";
import crypto from "crypto";
import { analyzeResponseQuality, calculateQualityScore } from "../services/responseQuality";
import { recordQualityMetric, getQualityStats, type QualityMetric, type QualityStats } from "./qualityMetrics";
import { recordConnectorUsage } from "./connectorMetrics";
import { storage } from "../storage";
import type { InsertApiLog } from "@shared/schema";
import { detectProviderFromModel, normalizeProvider, type LLMProviderId, type LLMProviderOrAuto } from "./llmProviders";

import { getCircuitBreaker, CircuitBreakerOpenError, CircuitState } from "./circuitBreaker";
import type { ZodSchema } from "zod";
import { type AgentEvent } from "./typedStreaming";

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
  provider?: LLMProviderOrAuto;
  enableFallback?: boolean;
  skipCache?: boolean;
  disableImageGeneration?: boolean;
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
  provider: LLMProviderId;
  cached?: boolean;
  fromFallback?: boolean;
}

interface StreamChunk {
  content: string;
  sequenceId: number;
  done: boolean;
  requestId: string;
  provider?: LLMProviderId;
  checkpoint?: StreamCheckpoint;
}

interface StreamCheckpoint {
  requestId: string;
  sequenceId: number;
  accumulatedContent: string;
  timestamp: number;
}

interface InFlightRequest {
  promise: Promise<LLMResponse>;
  startTime: number;
}

interface TokenUsageRecord {
  requestId: string;
  userId: string;
  provider: LLMProviderId;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  timestamp: number;
  latencyMs: number;
  cached: boolean;
  fromFallback: boolean;
}

// ===== Configuration =====
const CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: 5,
  resetTimeout: 30000,
  timeout: 30000,
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
const CACHE_TTL_MS = 300000; // 5 minutes
const IN_FLIGHT_TIMEOUT_MS = 120000; // 2 minutes
const TOKEN_HISTORY_MAX = 1000;

const DEFAULT_PROVIDER_MODELS: Record<LLMProviderId, string> = {
  xai: MODELS.TEXT,
  gemini: GEMINI_MODELS.FLASH_PREVIEW,
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-20241022",
  deepseek: "deepseek-chat",
};

class LLMGateway {
  private xaiClient: OpenAI;
  private openaiClient: OpenAI | null = null;
  private openaiClientKey = "";
  private openaiClientBaseUrl = "";
  private deepseekClient: OpenAI | null = null;
  private deepseekClientKey = "";
  private deepseekClientBaseUrl = "";
  private anthropicClient: Anthropic | null = null;
  private anthropicClientKey = "";

  private rateLimitByUser: Map<string, RateLimitState> = new Map();
  private requestCache: Map<string, { response: LLMResponse; expiresAt: number }> = new Map();
  private inFlightRequests: Map<string, InFlightRequest> = new Map();
  private streamCheckpoints: Map<string, StreamCheckpoint> = new Map();
  private tokenUsageHistory: TokenUsageRecord[] = [];

  private metrics: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    totalLatencyMs: number;
    totalTokens: number;
    rateLimitHits: number;
    circuitBreakerOpens: number;
    cacheHits: number;
    fallbackSuccesses: number;
    deduplicatedRequests: number;
    streamRecoveries: number;
    byProvider: {
      xai: { requests: number; tokens: number; failures: number };
      gemini: { requests: number; tokens: number; failures: number };
      openai: { requests: number; tokens: number; failures: number };
      anthropic: { requests: number; tokens: number; failures: number };
      deepseek: { requests: number; tokens: number; failures: number };
    };
  };

  constructor() {
    this.xaiClient = new OpenAI({
      baseURL: "https://api.x.ai/v1",
      apiKey: process.env.XAI_API_KEY,
    });

    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalLatencyMs: 0,
      totalTokens: 0,
      rateLimitHits: 0,
      circuitBreakerOpens: 0,
      cacheHits: 0,
      fallbackSuccesses: 0,
      deduplicatedRequests: 0,
      streamRecoveries: 0,
      byProvider: {
        xai: { requests: 0, tokens: 0, failures: 0 },
        gemini: { requests: 0, tokens: 0, failures: 0 },
        openai: { requests: 0, tokens: 0, failures: 0 },
        anthropic: { requests: 0, tokens: 0, failures: 0 },
        deepseek: { requests: 0, tokens: 0, failures: 0 },
      },
    };

    // Cleanup intervals
    setInterval(() => this.cleanupCache(), 60000);
    setInterval(() => this.cleanupInFlightRequests(), 30000);
    setInterval(() => this.cleanupStreamCheckpoints(), 60000);
  }



  // ===== API Log Persistence =====
  private persistApiLog(logData: {
    provider: string;
    model: string;
    endpoint: string;
    latencyMs: number;
    statusCode: number;
    tokensIn?: number;
    tokensOut?: number;
    errorMessage?: string;
    userId?: string;
  }): void {
    const apiLog: InsertApiLog = {
      userId: logData.userId || null,
      endpoint: logData.endpoint,
      method: "POST",
      statusCode: logData.statusCode,
      latencyMs: logData.latencyMs,
      tokensIn: logData.tokensIn || null,
      tokensOut: logData.tokensOut || null,
      model: logData.model,
      provider: logData.provider,
      requestPreview: null,
      responsePreview: null,
      errorMessage: logData.errorMessage ? logData.errorMessage.slice(0, 200) : null,
      ipAddress: null,
      userAgent: null,
    };

    storage.createApiLog(apiLog).catch((err) => {
      console.error("[LLMGateway] Failed to persist API log:", err.message);
    });
  }

  // ===== Request Deduplication =====
  private generateContentHash(messages: ChatCompletionMessageParam[], options: LLMRequestOptions): string {
    const providerKey = normalizeProvider(options.provider) || "auto";
    const content = JSON.stringify({
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      model: options.model,
      provider: providerKey,
      temperature: options.temperature,
      topP: options.topP,
      maxTokens: options.maxTokens,
    });
    return crypto.createHash("sha256").update(content).digest("hex").slice(0, 32);
  }

  private getInFlightRequest(hash: string): InFlightRequest | undefined {
    const request = this.inFlightRequests.get(hash);
    if (request && Date.now() - request.startTime < IN_FLIGHT_TIMEOUT_MS) {
      return request;
    }
    if (request) {
      this.inFlightRequests.delete(hash);
    }
    return undefined;
  }

  // ===== Cache Management =====
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getCacheKey(messages: ChatCompletionMessageParam[], options: LLMRequestOptions): string | null {
    if (options.skipCache) return null;

    const lastUserMessage = messages.filter(m => m.role === "user").pop();
    const lastMsgContent = typeof lastUserMessage?.content === "string" ? lastUserMessage.content : "";
    if (lastMsgContent.length < 50) {
      return null;
    }

    const userId = options.userId || "anonymous";
    return `${userId}:${this.generateContentHash(messages, options)}`;
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

  private cleanupInFlightRequests(): void {
    const now = Date.now();
    const entries = Array.from(this.inFlightRequests.entries());
    for (const [key, value] of entries) {
      if (now - value.startTime > IN_FLIGHT_TIMEOUT_MS) {
        this.inFlightRequests.delete(key);
      }
    }
  }

  private cleanupStreamCheckpoints(): void {
    const now = Date.now();
    const entries = Array.from(this.streamCheckpoints.entries());
    for (const [key, value] of entries) {
      if (now - value.timestamp > 300000) { // 5 minutes
        this.streamCheckpoints.delete(key);
      }
    }
  }

  // ===== Rate Limiting =====
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



  // ===== Retry Logic =====
  private calculateRetryDelay(attempt: number): number {
    const baseDelay = RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt);
    const jitter = baseDelay * RETRY_CONFIG.jitterFactor * Math.random();
    return Math.min(baseDelay + jitter, RETRY_CONFIG.maxDelayMs);
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ===== Context Truncation =====
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

  // ===== Message Conversion =====
  private convertToGeminiMessages(messages: ChatCompletionMessageParam[]): { messages: GeminiChatMessage[]; systemInstruction?: string } {
    const systemMsg = messages.find(m => m.role === "system");
    const systemInstruction = systemMsg && typeof systemMsg.content === "string" ? systemMsg.content : undefined;

    const geminiMessages: GeminiChatMessage[] = messages
      .filter(m => m.role !== "system")
      .map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
      }));

    return { messages: geminiMessages, systemInstruction };
  }

  // ===== Provider Selection =====
  private isProviderConfigured(provider: LLMProviderId): boolean {
    switch (provider) {
      case "xai":
        return Boolean(process.env.XAI_API_KEY);
      case "gemini":
        return Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
      case "openai":
        return Boolean(process.env.OPENAI_API_KEY);
      case "anthropic":
        return Boolean(process.env.ANTHROPIC_API_KEY);
      case "deepseek":
        return Boolean(process.env.DEEPSEEK_API_KEY);
      default:
        return false;
    }
  }

  private getProviderTryOrder(options: LLMRequestOptions): LLMProviderId[] {
    const priority: LLMProviderId[] = ["xai", "gemini", "openai", "anthropic", "deepseek"];

    const out: LLMProviderId[] = [];
    const push = (p: LLMProviderId | null) => {
      if (!p) return;
      if (!out.includes(p)) out.push(p);
    };

    const explicit = normalizeProvider(options.provider);
    if (explicit && explicit !== "auto") {
      push(explicit);
    } else {
      const detected = detectProviderFromModel(options.model);
      push(detected);
    }

    for (const p of priority) push(p);
    return out;
  }

  private selectProvider(options: LLMRequestOptions): LLMProviderId {
    const candidates = this.getProviderTryOrder(options);

    for (const provider of candidates) {
      const breaker = getCircuitBreaker("system", provider, CIRCUIT_BREAKER_CONFIG);
      if (breaker.getState() === CircuitState.OPEN) continue;
      if (this.isProviderConfigured(provider)) return provider;
    }

    // Final fallback: keep behavior deterministic even without configured keys.
    return candidates[0] || "xai";
  }

  private getOpenAIClient(): OpenAI {
    const apiKey = process.env.OPENAI_API_KEY || "";
    const baseURL = (process.env.OPENAI_BASE_URL || "").trim();

    if (!this.openaiClient || this.openaiClientKey !== apiKey || this.openaiClientBaseUrl !== baseURL) {
      this.openaiClient = new OpenAI({
        apiKey,
        baseURL: baseURL || undefined,
      });
      this.openaiClientKey = apiKey;
      this.openaiClientBaseUrl = baseURL;
    }

    return this.openaiClient;
  }

  private getDeepseekClient(): OpenAI {
    const apiKey = process.env.DEEPSEEK_API_KEY || "";
    const baseURL = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1").trim();

    if (!this.deepseekClient || this.deepseekClientKey !== apiKey || this.deepseekClientBaseUrl !== baseURL) {
      this.deepseekClient = new OpenAI({
        apiKey,
        baseURL,
      });
      this.deepseekClientKey = apiKey;
      this.deepseekClientBaseUrl = baseURL;
    }

    return this.deepseekClient;
  }

  private getAnthropicClient(): Anthropic {
    const apiKey = process.env.ANTHROPIC_API_KEY || "";
    if (!this.anthropicClient || this.anthropicClientKey !== apiKey) {
      this.anthropicClient = new Anthropic({ apiKey });
      this.anthropicClientKey = apiKey;
    }
    return this.anthropicClient;
  }

  private resolveModelForProvider(provider: LLMProviderId, options: LLMRequestOptions, primaryProvider: LLMProviderId): string {
    const requestedModel = typeof options.model === "string" ? options.model.trim() : "";
    if (!requestedModel) return DEFAULT_PROVIDER_MODELS[provider];

    const explicit = normalizeProvider(options.provider);
    if (explicit && explicit !== "auto") {
      return provider === explicit ? requestedModel : DEFAULT_PROVIDER_MODELS[provider];
    }

    const detected = detectProviderFromModel(requestedModel);
    if (detected && detected !== provider) return DEFAULT_PROVIDER_MODELS[provider];

    if (!detected && provider !== primaryProvider) return DEFAULT_PROVIDER_MODELS[provider];

    return requestedModel;
  }

  private convertToAnthropicMessages(messages: ChatCompletionMessageParam[]): { system?: string; messages: Array<{ role: "user" | "assistant"; content: string }> } {
    const systemParts: string[] = [];
    const out: Array<{ role: "user" | "assistant"; content: string }> = [];

    for (const m of messages) {
      const role = m.role;
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);

      if (role === "system" || role === "developer") {
        if (content) systemParts.push(content);
        continue;
      }

      if (role === "assistant" || role === "user") {
        out.push({ role, content });
        continue;
      }

      out.push({ role: "user", content: `[${String(role)}] ${content}` });
    }

    const system = systemParts.length ? systemParts.join("\n\n") : undefined;
    return { system, messages: out };
  }

  private async executeOpenAICompatible(
    provider: "xai" | "openai" | "deepseek",
    client: OpenAI,
    messages: ChatCompletionMessageParam[],
    options: LLMRequestOptions & { requestId: string; timeout: number },
    model: string,
    startTime: number,
    endpoint: string
  ): Promise<LLMResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout);

    try {
      const response = await client.chat.completions.create(
        {
          model,
          messages,
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

      this.metrics.totalLatencyMs += latencyMs;

      const usageRecord: TokenUsageRecord = {
        requestId: options.requestId,
        userId: options.userId || "anonymous",
        provider,
        model,
        promptTokens: usage?.prompt_tokens || 0,
        completionTokens: usage?.completion_tokens || 0,
        totalTokens: usage?.total_tokens || 0,
        timestamp: Date.now(),
        latencyMs,
        cached: false,
        fromFallback: false,
      };
      this.recordTokenUsage(usageRecord);

      recordConnectorUsage(provider as any, latencyMs, true);

      this.persistApiLog({
        provider,
        model,
        endpoint,
        latencyMs,
        statusCode: 200,
        tokensIn: usage?.prompt_tokens,
        tokensOut: usage?.completion_tokens,
        userId: options.userId,
      });

      const qualityAnalysis = analyzeResponseQuality(content);
      const qualityScore = calculateQualityScore(content, usage?.total_tokens || 0, latencyMs);
      const qualityMetric: QualityMetric = {
        responseId: options.requestId,
        provider,
        score: qualityScore,
        tokensUsed: usage?.total_tokens || 0,
        latencyMs,
        timestamp: new Date(),
        issues: qualityAnalysis.issues,
        isComplete: qualityAnalysis.isComplete,
        hasContentIssues: qualityAnalysis.hasContentIssues,
      };
      recordQualityMetric(qualityMetric);

      return {
        content,
        usage: usage
          ? {
              promptTokens: usage.prompt_tokens,
              completionTokens: usage.completion_tokens,
              totalTokens: usage.total_tokens,
            }
          : undefined,
        requestId: options.requestId,
        latencyMs,
        model,
        provider,
      };
    } catch (error: any) {
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - startTime;
      recordConnectorUsage(provider as any, latencyMs, false);

      this.persistApiLog({
        provider,
        model,
        endpoint,
        latencyMs,
        statusCode: error.status || 500,
        errorMessage: error.message,
        userId: options.userId,
      });

      if (error.name === "AbortError") {
        throw new Error(`Request timeout after ${options.timeout}ms`);
      }
      throw error;
    }
  }

  private async executeAnthropic(
    messages: ChatCompletionMessageParam[],
    options: LLMRequestOptions & { requestId: string; timeout: number },
    model: string,
    startTime: number
  ): Promise<LLMResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout);

    try {
      const client = this.getAnthropicClient();
      const converted = this.convertToAnthropicMessages(messages);

      const response = await client.messages.create(
        {
          model,
          system: converted.system,
          messages: converted.messages,
          max_tokens: options.maxTokens ?? 1024,
          temperature: options.temperature ?? 0.7,
        },
        { signal: controller.signal }
      );

      clearTimeout(timeoutId);

      const latencyMs = Date.now() - startTime;
      const content = (response as any).content
        ? (response as any).content.map((block: any) => (block?.type === "text" ? block.text : "")).join("")
        : "";

      const inputTokens = (response as any).usage?.input_tokens ?? 0;
      const outputTokens = (response as any).usage?.output_tokens ?? 0;
      const totalTokens = inputTokens + outputTokens;

      this.metrics.totalLatencyMs += latencyMs;

      const usageRecord: TokenUsageRecord = {
        requestId: options.requestId,
        userId: options.userId || "anonymous",
        provider: "anthropic",
        model,
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        totalTokens,
        timestamp: Date.now(),
        latencyMs,
        cached: false,
        fromFallback: false,
      };
      this.recordTokenUsage(usageRecord);

      recordConnectorUsage("anthropic", latencyMs, true);

      this.persistApiLog({
        provider: "anthropic",
        model,
        endpoint: "/messages",
        latencyMs,
        statusCode: 200,
        tokensIn: inputTokens,
        tokensOut: outputTokens,
        userId: options.userId,
      });

      const qualityAnalysis = analyzeResponseQuality(content);
      const qualityScore = calculateQualityScore(content, totalTokens, latencyMs);
      const qualityMetric: QualityMetric = {
        responseId: options.requestId,
        provider: "anthropic",
        score: qualityScore,
        tokensUsed: totalTokens,
        latencyMs,
        timestamp: new Date(),
        issues: qualityAnalysis.issues,
        isComplete: qualityAnalysis.isComplete,
        hasContentIssues: qualityAnalysis.hasContentIssues,
      };
      recordQualityMetric(qualityMetric);

      return {
        content,
        usage: {
          promptTokens: inputTokens,
          completionTokens: outputTokens,
          totalTokens,
        },
        requestId: options.requestId,
        latencyMs,
        model,
        provider: "anthropic",
      };
    } catch (error: any) {
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - startTime;
      recordConnectorUsage("anthropic", latencyMs, false);

      this.persistApiLog({
        provider: "anthropic",
        model,
        endpoint: "/messages",
        latencyMs,
        statusCode: error.status || 500,
        errorMessage: error.message,
        userId: options.userId,
      });

      if (error.name === "AbortError") {
        throw new Error(`Request timeout after ${options.timeout}ms`);
      }
      throw error;
    }
  }

  // ===== Token Usage Tracking =====
  private recordTokenUsage(record: TokenUsageRecord): void {
    this.tokenUsageHistory.push(record);
    if (this.tokenUsageHistory.length > TOKEN_HISTORY_MAX) {
      this.tokenUsageHistory.shift();
    }
    this.metrics.totalTokens += record.totalTokens;
    this.metrics.byProvider[record.provider].tokens += record.totalTokens;
  }

  getTokenUsageStats(since?: number): {
    total: number;
    byProvider: Record<string, number>;
    byUser: Record<string, number>;
    recentRequests: number;
  } {
    const cutoff = since || Date.now() - 3600000; // Last hour by default
    const relevant = this.tokenUsageHistory.filter(r => r.timestamp >= cutoff);

    const byProvider: Record<string, number> = { xai: 0, gemini: 0, openai: 0, anthropic: 0, deepseek: 0 };
    const byUser: Record<string, number> = {};
    let total = 0;

    for (const record of relevant) {
      total += record.totalTokens;
      byProvider[record.provider] += record.totalTokens;
      byUser[record.userId] = (byUser[record.userId] || 0) + record.totalTokens;
    }

    return { total, byProvider, byUser, recentRequests: relevant.length };
  }

  // ===== Main Chat Method with Multi-Provider Fallback =====
  async chat(
    messages: ChatCompletionMessageParam[],
    options: LLMRequestOptions = {}
  ): Promise<LLMResponse> {
    const requestId = options.requestId || this.generateRequestId();
    const startTime = Date.now();
    const userId = options.userId || "anonymous";
    const enableFallback = options.enableFallback !== false;
    const timeout = options.timeout || DEFAULT_TIMEOUT_MS;

    this.metrics.totalRequests++;

    // Check cache first
    const cacheKey = this.getCacheKey(messages, options);
    if (cacheKey) {
      const cached = this.requestCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        this.metrics.cacheHits++;
        console.log(`[LLMGateway] ${requestId} cache hit`);
        return { ...cached.response, cached: true, requestId };
      }
    }

    // Check for duplicate in-flight request
    const contentHash = this.generateContentHash(messages, options);
    const inFlight = this.getInFlightRequest(contentHash);
    if (inFlight) {
      this.metrics.deduplicatedRequests++;
      console.log(`[LLMGateway] ${requestId} deduplicated (waiting for existing request)`);
      return inFlight.promise;
    }

    // Rate limit check
    if (!this.checkRateLimit(userId)) {
      throw new Error(`Rate limit exceeded for user ${userId}`);
    }

    // Truncate context
    const truncatedMessages = this.truncateContext(messages, options.maxTokens ? options.maxTokens * 2 : MAX_CONTEXT_TOKENS);

    // Create the request promise
    const requestPromise = this.executeWithFallback(
      truncatedMessages,
      { ...options, requestId, timeout },
      startTime,
      enableFallback
    );

    // Register as in-flight
    this.inFlightRequests.set(contentHash, { promise: requestPromise, startTime });

    try {
      const result = await requestPromise;

      // Cache successful response
      if (cacheKey) {
        this.requestCache.set(cacheKey, {
          response: result,
          expiresAt: Date.now() + CACHE_TTL_MS,
        });
      }

      return result;
    } finally {
      this.inFlightRequests.delete(contentHash);
    }
  }

  private async executeWithFallback(
    messages: ChatCompletionMessageParam[],
    options: LLMRequestOptions & { requestId: string; timeout: number },
    startTime: number,
    enableFallback: boolean
  ): Promise<LLMResponse> {
    const tryOrder = enableFallback ? this.getProviderTryOrder(options) : [this.selectProvider(options)];
    const providers: LLMProviderId[] = Array.from(new Set(tryOrder)).filter((p) => this.isProviderConfigured(p));
    const primaryProvider = providers[0] || this.selectProvider(options);

    let lastError: Error | null = null;

    for (const provider of providers) {
      const breaker = getCircuitBreaker("system", provider, CIRCUIT_BREAKER_CONFIG);
      if (breaker.getState() === CircuitState.OPEN) {
        console.log(`[LLMGateway] ${options.requestId} skipping ${provider} (circuit breaker open)`);
        continue;
      }

      try {
        const result = await this.executeOnProvider(provider, messages, options, startTime, primaryProvider);

        if (providers.indexOf(provider) > 0) {
          this.metrics.fallbackSuccesses++;
          console.log(`[LLMGateway] ${options.requestId} succeeded on fallback provider ${provider}`);
        }

        return { ...result, fromFallback: providers.indexOf(provider) > 0 };
      } catch (error: any) {
        lastError = error;
        console.warn(`[LLMGateway] ${options.requestId} failed on ${provider}: ${error.message}`);

        if (!enableFallback) {
          throw error;
        }
      }
    }

    if (!providers.length) {
      throw new Error("No LLM providers configured");
    }
    throw lastError || new Error("All providers failed");
  }

  private async executeOnProvider(
    provider: LLMProviderId,
    messages: ChatCompletionMessageParam[],
    options: LLMRequestOptions & { requestId: string; timeout: number },
    startTime: number,
    primaryProvider: LLMProviderId
  ): Promise<LLMResponse> {
    const breaker = getCircuitBreaker("system", provider, CIRCUIT_BREAKER_CONFIG);

    try {
      return await breaker.execute(() => this.executeOnProviderNoBreaker(provider, messages, options, startTime, primaryProvider));
    } catch (error) {
      throw error;
    }
  }

  private async executeOnProviderNoBreaker(
    provider: LLMProviderId,
    messages: ChatCompletionMessageParam[],
    options: LLMRequestOptions & { requestId: string; timeout: number },
    startTime: number,
    primaryProvider: LLMProviderId
  ): Promise<LLMResponse> {
    const model = this.resolveModelForProvider(provider, options, primaryProvider);
    this.metrics.byProvider[provider].requests++;

    for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
      try {
        const result = await (async () => {
          switch (provider) {
            case "xai":
              return await this.executeXai(messages, options, model, startTime);
            case "gemini":
              return await this.executeGemini(messages, options, model, startTime);
            case "openai":
              return await this.executeOpenAICompatible(
                "openai",
                this.getOpenAIClient(),
                messages,
                options,
                model,
                startTime,
                "/chat/completions"
              );
            case "deepseek":
              return await this.executeOpenAICompatible(
                "deepseek",
                this.getDeepseekClient(),
                messages,
                options,
                model,
                startTime,
                "/chat/completions"
              );
            case "anthropic":
              return await this.executeAnthropic(messages, options, model, startTime);
            default:
              throw new Error(`Unsupported provider: ${provider satisfies never}`);
          }
        })();

        this.metrics.successfulRequests++;
        return result;
      } catch (error: any) {
        const isRetryable =
          error.status === 429 ||
          error.status === 500 ||
          error.status === 502 ||
          error.status === 503 ||
          error.code === "ECONNRESET" ||
          error.code === "ETIMEDOUT";

        if (!isRetryable || attempt >= RETRY_CONFIG.maxRetries) {
          this.metrics.failedRequests++;
          this.metrics.byProvider[provider].failures++;
          throw error;
        }

        const delay = this.calculateRetryDelay(attempt);
        console.warn(`[LLMGateway] ${options.requestId} ${provider} attempt ${attempt + 1} failed, retrying in ${delay}ms`);
        await this.sleep(delay);
      }
    }

    throw new Error("Max retries exceeded");
  }

  private async executeXai(
    messages: ChatCompletionMessageParam[],
    options: LLMRequestOptions & { requestId: string; timeout: number },
    model: string,
    startTime: number
  ): Promise<LLMResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout);

    try {
      const response = await this.xaiClient.chat.completions.create(
        {
          model,
          messages,
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


      this.metrics.totalLatencyMs += latencyMs;

      const usageRecord: TokenUsageRecord = {
        requestId: options.requestId,
        userId: options.userId || "anonymous",
        provider: "xai",
        model,
        promptTokens: usage?.prompt_tokens || 0,
        completionTokens: usage?.completion_tokens || 0,
        totalTokens: usage?.total_tokens || 0,
        timestamp: Date.now(),
        latencyMs,
        cached: false,
        fromFallback: false,
      };
      this.recordTokenUsage(usageRecord);

      console.log(`[LLMGateway] ${options.requestId} xai completed in ${latencyMs}ms, tokens: ${usage?.total_tokens || 0}`);

      // Record connector usage for xai
      recordConnectorUsage("xai", latencyMs, true);

      // Persist API log to database asynchronously
      this.persistApiLog({
        provider: "xai",
        model,
        endpoint: "/chat/completions",
        latencyMs,
        statusCode: 200,
        tokensIn: usage?.prompt_tokens,
        tokensOut: usage?.completion_tokens,
        userId: options.userId,
      });

      // Analyze response quality and record metrics
      const qualityAnalysis = analyzeResponseQuality(content);
      const qualityScore = calculateQualityScore(content, usage?.total_tokens || 0, latencyMs);

      const qualityMetric: QualityMetric = {
        responseId: options.requestId,
        provider: "xai",
        score: qualityScore,
        tokensUsed: usage?.total_tokens || 0,
        latencyMs,
        timestamp: new Date(),
        issues: qualityAnalysis.issues,
        isComplete: qualityAnalysis.isComplete,
        hasContentIssues: qualityAnalysis.hasContentIssues,
      };
      recordQualityMetric(qualityMetric);

      return {
        content,
        usage: usage ? {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
        } : undefined,
        requestId: options.requestId,
        latencyMs,
        model,
        provider: "xai",
      };
    } catch (error: any) {
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - startTime;
      // Record connector failure for xai
      recordConnectorUsage("xai", latencyMs, false);

      // Persist API error log to database asynchronously
      this.persistApiLog({
        provider: "xai",
        model,
        endpoint: "/chat/completions",
        latencyMs,
        statusCode: error.status || 500,
        errorMessage: error.message,
        userId: options.userId,
      });

      if (error.name === "AbortError") {
        throw new Error(`Request timeout after ${options.timeout}ms`);
      }
      throw error;
    }
  }

  private async executeGemini(
    messages: ChatCompletionMessageParam[],
    options: LLMRequestOptions & { requestId: string; timeout: number },
    model: string,
    startTime: number
  ): Promise<LLMResponse> {
    const { messages: geminiMessages, systemInstruction } = this.convertToGeminiMessages(messages);

    if (geminiMessages.length === 0) {
      throw new Error("Gemini API error: No valid messages after conversion (contents are required)");
    }

    let response;
    try {
      response = await geminiChat(geminiMessages, {
        model: model as any,
        systemInstruction,
        temperature: options.temperature ?? 0.7,
        topP: options.topP ?? 1,
        maxOutputTokens: options.maxTokens,
      });
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      // Record connector failure for gemini
      recordConnectorUsage("gemini", latencyMs, false);

      // Persist API error log to database asynchronously
      this.persistApiLog({
        provider: "gemini",
        model,
        endpoint: "/generateContent",
        latencyMs,
        statusCode: error.status || 500,
        errorMessage: error.message,
        userId: options.userId,
      });

      throw error;
    }

    const latencyMs = Date.now() - startTime;


    this.metrics.totalLatencyMs += latencyMs;

    // Estimate tokens for Gemini (Gemini doesn't return usage in simple API)
    const estimatedTokens = Math.ceil((JSON.stringify(messages).length + response.content.length) / 4);

    const usageRecord: TokenUsageRecord = {
      requestId: options.requestId,
      userId: options.userId || "anonymous",
      provider: "gemini",
      model,
      promptTokens: Math.ceil(JSON.stringify(messages).length / 4),
      completionTokens: Math.ceil(response.content.length / 4),
      totalTokens: estimatedTokens,
      timestamp: Date.now(),
      latencyMs,
      cached: false,
      fromFallback: false,
    };
    this.recordTokenUsage(usageRecord);

    console.log(`[LLMGateway] ${options.requestId} gemini completed in ${latencyMs}ms, est. tokens: ${estimatedTokens}`);

    // Record connector usage for gemini
    recordConnectorUsage("gemini", latencyMs, true);

    // Persist API log to database asynchronously
    this.persistApiLog({
      provider: "gemini",
      model,
      endpoint: "/generateContent",
      latencyMs,
      statusCode: 200,
      tokensIn: usageRecord.promptTokens,
      tokensOut: usageRecord.completionTokens,
      userId: options.userId,
    });

    // Analyze response quality and record metrics
    const qualityAnalysis = analyzeResponseQuality(response.content);
    const qualityScore = calculateQualityScore(response.content, estimatedTokens, latencyMs);

    const qualityMetric: QualityMetric = {
      responseId: options.requestId,
      provider: "gemini",
      score: qualityScore,
      tokensUsed: estimatedTokens,
      latencyMs,
      timestamp: new Date(),
      issues: qualityAnalysis.issues,
      isComplete: qualityAnalysis.isComplete,
      hasContentIssues: qualityAnalysis.hasContentIssues,
    };
    recordQualityMetric(qualityMetric);

    return {
      content: response.content,
      usage: {
        promptTokens: usageRecord.promptTokens,
        completionTokens: usageRecord.completionTokens,
        totalTokens: estimatedTokens,
      },
      requestId: options.requestId,
      latencyMs,
      model,
      provider: "gemini",
    };
  }

  // ===== Streaming with Checkpoints =====
  async * streamChat(
    messages: ChatCompletionMessageParam[],
    options: LLMRequestOptions = {}
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const requestId = options.requestId || this.generateRequestId();
    const userId = options.userId || "anonymous";
    const enableFallback = options.enableFallback !== false;
    let sequenceId = 0;
    let accumulatedContent = "";
    const tryOrder = enableFallback ? this.getProviderTryOrder(options) : [this.selectProvider(options)];
    const providers: LLMProviderId[] = Array.from(new Set(tryOrder)).filter((p) => this.isProviderConfigured(p));
    const primaryProvider = providers[0] || this.selectProvider(options);

    this.metrics.totalRequests++;

    if (!this.checkRateLimit(userId)) {
      throw new Error(`Rate limit exceeded for user ${userId}`);
    }

    const truncatedMessages = this.truncateContext(messages, options.maxTokens ? options.maxTokens * 2 : MAX_CONTEXT_TOKENS);

    // Check for existing checkpoint (recovery)
    const existingCheckpoint = this.streamCheckpoints.get(requestId);
    if (existingCheckpoint) {
      sequenceId = existingCheckpoint.sequenceId;
      accumulatedContent = existingCheckpoint.accumulatedContent;
      this.metrics.streamRecoveries++;
      console.log(`[LLMGateway] ${requestId} recovering from checkpoint at seq ${sequenceId}`);
    }

    for (const provider of providers) {
      const breaker = getCircuitBreaker("system", provider, CIRCUIT_BREAKER_CONFIG);
      if (breaker.getState() === CircuitState.OPEN) {
        continue;
      }

      try {
        const model = this.resolveModelForProvider(provider, options, primaryProvider);
        this.metrics.byProvider[provider].requests++;

        const stream = (async () => {
          switch (provider) {
            case "xai":
              return this.streamOpenAICompatible("xai", this.xaiClient, truncatedMessages, options, requestId, model);
            case "openai":
              return this.streamOpenAICompatible("openai", this.getOpenAIClient(), truncatedMessages, options, requestId, model);
            case "deepseek":
              return this.streamOpenAICompatible("deepseek", this.getDeepseekClient(), truncatedMessages, options, requestId, model);
            case "gemini":
              return this.streamGemini(truncatedMessages, options, requestId, model);
            case "anthropic":
              return this.streamAnthropic(truncatedMessages, options, requestId, model);
            default:
              throw new Error(`Unsupported provider: ${provider satisfies never}`);
          }
        })();

        for await (const chunk of await stream) {
          accumulatedContent += chunk.content;

          const streamChunk: StreamChunk = {
            content: chunk.content,
            sequenceId: sequenceId++,
            done: chunk.done,
            requestId,
            provider,
            checkpoint: {
              requestId,
              sequenceId,
              accumulatedContent,
              timestamp: Date.now(),
            },
          };

          // Save checkpoint periodically
          if (sequenceId % 10 === 0) {
            this.streamCheckpoints.set(requestId, streamChunk.checkpoint!);
          }

          yield streamChunk;

          if (chunk.done) {
            this.streamCheckpoints.delete(requestId);
            getCircuitBreaker("system", provider, CIRCUIT_BREAKER_CONFIG).recordSuccess();
            this.metrics.successfulRequests++;
            return;
          }
        }
      } catch (error: any) {
        // Save checkpoint before failing
        this.streamCheckpoints.set(requestId, {
          requestId,
          sequenceId,
          accumulatedContent,
          timestamp: Date.now(),
        });

        getCircuitBreaker("system", provider, CIRCUIT_BREAKER_CONFIG).recordFailure();
        this.metrics.failedRequests++;
        this.metrics.byProvider[provider].failures++;
        console.warn(`[LLMGateway] ${requestId} stream failed on ${provider}: ${error.message}`);

        if (!enableFallback || providers.indexOf(provider) === providers.length - 1) {
          throw error;
        }

        console.log(`[LLMGateway] ${requestId} attempting stream fallback to next provider`);
      }
    }

    if (!providers.length) {
      throw new Error("No LLM providers configured");
    }
    throw new Error("All providers failed during streaming");
  }

  // ===== Typed Streaming (Schema Validation) =====
  async * streamStructured(
    messages: ChatCompletionMessageParam[],
    schema: ZodSchema<any>,
    options: LLMRequestOptions = {}
  ): AsyncGenerator<AgentEvent, void, unknown> {
    const requestId = options.requestId || this.generateRequestId();

    // Inject system instruction for JSON enforcement
    // We add this to the messages locally without mutating existing array
    const systemPrompt: ChatCompletionMessageParam = {
      role: "system",
      content: `You must respond with valid JSON strictly conforming to the provided schema. Do not output markdown blocks or explanations.`
    };

    const augmentedMessages = [systemPrompt, ...messages];

    // In a real implementation with "Instructor" pattern, we would:
    // 1. Accumulate the full text stream
    // 2. Parsed JSON incrementally (if possible) or at chunks
    // 3. For now, we wrap the text stream and emit "content_delta" events
    //    and then try to parse the final result to ensure validity?
    //    Wait, "Typed Streaming" in the plan implies emitting events like "ThreadRunStep"

    // Actually, for "Typed Streaming", we largely want to standardize the events THE AGENT emits.
    // So this method might be consumed by the Agent Logic, which parses raw LLM text into these events.

    // Let's implement a simpler version that wraps streamChat and emits typed events.
    // If the schema is for the FINAL output, we validate at the end.

    let currentMessages = [...augmentedMessages];
    const maxRetries = 2; // 0 = initial, 1 = first retry, 2 = second retry

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let fullContent = "";

      try {
        if (attempt > 0) {
          yield { type: "status", status: "thinking", message: `Fixing output format (Attempt ${attempt + 1})...` };
        } else {
          yield { type: "status", status: "thinking", message: "Connecting to model..." };
        }

        const stream = this.streamChat(currentMessages, options);

        let fullContent = "";

        for await (const chunk of stream) {
          fullContent += chunk.content;

          yield {
            type: "content_delta",
            delta: chunk.content,
            snapshot: fullContent // accumulation for recovery/UI
          };
        }

        yield { type: "status", status: "parsing_document", message: "Validating output schema..." };

        // Attempt to parse final content against schema
        // Only if content is expected to be JSON. If it's chat, schema might be just "z.string()"
        try {
          // Heuristic: if schema looks like an object/array, try JSON parsing
          // This is a naive check. Ideally we use structured output modes from providers.
          const firstChar = fullContent.trim()[0];
          if (firstChar === "{" || firstChar === "[") {
            const json = JSON.parse(fullContent);
            const result = schema.parse(json);
            // We could emit a "final_result" event if we had one
          }

          yield { type: "status", status: "ready" };

        } catch (validationError: any) {
          console.warn(`[LLMGateway] Schema violation on ${requestId} (attempt ${attempt + 1}):`, validationError.message);

          if (attempt === maxRetries) {
            yield {
              type: "status",
              status: "error",
              message: `Final Schema violation: ${validationError.message}`
            };
            return;
          }

          // Retry: Feed error back to LLM
          currentMessages.push({ role: "assistant", content: fullContent });
          currentMessages.push({
            role: "user",
            content: `Your response was not valid JSON or did not match the schema. Error: ${validationError.message}\n\nPlease correct your JSON.`
          });

          yield {
            type: "status",
            status: "error",
            message: `Validation failed, retrying...`
          };
        }

      } catch (error: any) {
        yield { type: "status", status: "error", message: error.message };
        return;
      }
    }
  }

  private async * streamOpenAICompatible(
    provider: "xai" | "openai" | "deepseek",
    client: OpenAI,
    messages: ChatCompletionMessageParam[],
    options: LLMRequestOptions,
    requestId: string,
    modelOverride?: string
  ): AsyncGenerator<{ content: string; done: boolean }, void, unknown> {
    const model =
      modelOverride ||
      (typeof options.model === "string" && options.model.trim().length > 0 ? options.model.trim() : "") ||
      (provider === "xai" ? DEFAULT_PROVIDER_MODELS.xai : DEFAULT_PROVIDER_MODELS[provider]);

    const stream = await client.chat.completions.create({
      model,
      messages,
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
          content: buffer, done: false
        };
        buffer = "";
      }
    }

    if (buffer) {
      yield { content: buffer, done: false };
    }

    yield { content: "", done: true };
  }

  private async * streamGemini(
    messages: ChatCompletionMessageParam[],
    options: LLMRequestOptions,
    requestId: string,
    modelOverride?: string
  ): AsyncGenerator<{ content: string; done: boolean }, void, unknown> {
    const model = modelOverride || options.model || GEMINI_MODELS.FLASH_PREVIEW;
    const { messages: geminiMessages, systemInstruction } = this.convertToGeminiMessages(messages);

    const stream = geminiStreamChat(geminiMessages, {
      model: model as any,
      systemInstruction,
      temperature: options.temperature ?? 0.7,
      topP: options.topP ?? 1,
      maxOutputTokens: options.maxTokens,
      responseModalities: options.disableImageGeneration ? ["text"] : undefined,
    });

    for await (const chunk of stream) {
      yield chunk;
    }
  }

  private async * streamAnthropic(
    messages: ChatCompletionMessageParam[],
    options: LLMRequestOptions,
    requestId: string,
    modelOverride?: string
  ): AsyncGenerator<{ content: string; done: boolean }, void, unknown> {
    const model = modelOverride || options.model || DEFAULT_PROVIDER_MODELS.anthropic;
    const client = this.getAnthropicClient();
    const converted = this.convertToAnthropicMessages(messages);

    const stream = await client.messages.create({
      model,
      system: converted.system,
      messages: converted.messages,
      max_tokens: options.maxTokens ?? 1024,
      temperature: options.temperature ?? 0.7,
      stream: true,
    });

    for await (const event of stream as any) {
      if (event?.type === "content_block_delta" && event.delta?.type === "text_delta") {
        const text = event.delta.text || "";
        if (text) yield { content: text, done: false };
      }
    }

    yield { content: "", done: true };
  }

  // ===== Metrics =====
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
      circuitBreakerStatus: {
        xai: getCircuitBreaker("system", "xai").getState(),
        gemini: getCircuitBreaker("system", "gemini").getState(),
        openai: getCircuitBreaker("system", "openai").getState(),
        anthropic: getCircuitBreaker("system", "anthropic").getState(),
        deepseek: getCircuitBreaker("system", "deepseek").getState(),
      },
      cacheSize: this.requestCache.size,
      inFlightRequests: this.inFlightRequests.size,
      streamCheckpoints: this.streamCheckpoints.size,
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
      fallbackSuccesses: 0,
      deduplicatedRequests: 0,
      streamRecoveries: 0,
      byProvider: {
        xai: { requests: 0, tokens: 0, failures: 0 },
        gemini: { requests: 0, tokens: 0, failures: 0 },
        openai: { requests: 0, tokens: 0, failures: 0 },
        anthropic: { requests: 0, tokens: 0, failures: 0 },
        deepseek: { requests: 0, tokens: 0, failures: 0 },
      },
    };
  }

  // ===== Quality Stats =====
  getQualityStats(since?: Date): QualityStats {
    return getQualityStats(since);
  }

  // ===== Health Check =====
  async healthCheck(): Promise<{
    xai: { available: boolean; latencyMs?: number; error?: string };
    gemini: { available: boolean; latencyMs?: number; error?: string };
    openai: { available: boolean; latencyMs?: number; error?: string };
    anthropic: { available: boolean; latencyMs?: number; error?: string };
    deepseek: { available: boolean; latencyMs?: number; error?: string };
  }> {
    const results: any = {
      xai: { available: false },
      gemini: { available: false },
      openai: { available: false },
      anthropic: { available: false },
      deepseek: { available: false },
    };

    if (process.env.NODE_ENV === "test") {
      results.xai = { available: Boolean(process.env.XAI_API_KEY) };
      results.gemini = { available: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) };
      results.openai = { available: Boolean(process.env.OPENAI_API_KEY) };
      results.anthropic = { available: Boolean(process.env.ANTHROPIC_API_KEY) };
      results.deepseek = { available: Boolean(process.env.DEEPSEEK_API_KEY) };
      return results;
    }

    // Test xAI with quick timeout
    if (process.env.XAI_API_KEY) {
      try {
        const start = Date.now();
        const client = new OpenAI({
          baseURL: "https://api.x.ai/v1",
          apiKey: process.env.XAI_API_KEY,
          timeout: 5000,
        });
        await client.chat.completions.create({
          model: "grok-3-mini-fast",
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 5,
        });
        results.xai = { available: true, latencyMs: Date.now() - start };
      } catch (error: any) {
        results.xai = { available: false, error: error.message?.slice(0, 100) };
      }
    }

    // Test Gemini with quick timeout
    if (process.env.GEMINI_API_KEY) {
      try {
        const start = Date.now();
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: "hi" }] }],
              generationConfig: { maxOutputTokens: 5 }
            }),
            signal: AbortSignal.timeout(5000)
          }
        );
        if (response.ok) {
          results.gemini = { available: true, latencyMs: Date.now() - start };
        } else {
          const err = await response.json().catch(() => ({}));
          results.gemini = { available: false, error: (err as any)?.error?.message?.slice(0, 100) || "API error" };
        }
      } catch (error: any) {
        results.gemini = { available: false, error: error.message?.slice(0, 100) };
      }
    }

    // Test OpenAI with quick timeout
    if (process.env.OPENAI_API_KEY) {
      try {
        const start = Date.now();
        const client = this.getOpenAIClient();
        await client.chat.completions.create(
          {
            model: DEFAULT_PROVIDER_MODELS.openai,
            messages: [{ role: "user", content: "hi" }],
            max_tokens: 5,
          },
          { signal: AbortSignal.timeout(5000) }
        );
        results.openai = { available: true, latencyMs: Date.now() - start };
      } catch (error: any) {
        results.openai = { available: false, error: error.message?.slice(0, 100) };
      }
    }

    // Test DeepSeek with quick timeout
    if (process.env.DEEPSEEK_API_KEY) {
      try {
        const start = Date.now();
        const client = this.getDeepseekClient();
        await client.chat.completions.create(
          {
            model: DEFAULT_PROVIDER_MODELS.deepseek,
            messages: [{ role: "user", content: "hi" }],
            max_tokens: 5,
          },
          { signal: AbortSignal.timeout(5000) }
        );
        results.deepseek = { available: true, latencyMs: Date.now() - start };
      } catch (error: any) {
        results.deepseek = { available: false, error: error.message?.slice(0, 100) };
      }
    }

    // Test Anthropic with quick timeout
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const start = Date.now();
        const client = this.getAnthropicClient();
        await client.messages.create(
          {
            model: DEFAULT_PROVIDER_MODELS.anthropic,
            max_tokens: 5,
            messages: [{ role: "user", content: "hi" }],
          },
          { signal: AbortSignal.timeout(5000) }
        );
        results.anthropic = { available: true, latencyMs: Date.now() - start };
      } catch (error: any) {
        results.anthropic = { available: false, error: error.message?.slice(0, 100) };
      }
    }

    return results;
  }
}

export const llmGateway = new LLMGateway();
export type { LLMRequestOptions, LLMResponse, StreamChunk, StreamCheckpoint, TokenUsageRecord };
