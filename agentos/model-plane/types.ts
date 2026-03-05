// AgentOS Model-Plane — Core Types
// Defines the type system for multi-model routing with provider abstraction.

// ---------------------------------------------------------------------------
// Enums & Literals
// ---------------------------------------------------------------------------

export type ModelCapability =
  | 'text-generation'
  | 'text-embedding'
  | 'image-generation'
  | 'image-understanding'
  | 'video-generation'
  | 'video-understanding'
  | 'voice-synthesis'
  | 'voice-recognition'
  | 'code-generation'
  | 'code-editing'
  | 'function-calling'
  | 'structured-output'
  | 'long-context'
  | 'reasoning';

export type ProviderKind =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'xai'
  | 'local'
  | 'custom';

export type TaskType =
  | 'chat'
  | 'completion'
  | 'embedding'
  | 'image'
  | 'video'
  | 'voice'
  | 'code'
  | 'reasoning'
  | 'multi-modal';

export type RoutingStrategy =
  | 'cost-optimized'
  | 'quality-optimized'
  | 'latency-optimized'
  | 'balanced'
  | 'custom';

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface ModelProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  organizationId?: string;
  headers?: Record<string, string>;
  timeout?: number;          // ms
  maxRetries?: number;
  rateLimit?: RateLimitConfig;
}

export interface RateLimitConfig {
  requestsPerMinute: number;
  tokensPerMinute: number;
  concurrentRequests: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: ProviderKind;
  capabilities: ModelCapability[];
  maxContextTokens: number;
  costPer1kInputTokens: number;   // USD
  costPer1kOutputTokens: number;  // USD
  avgLatencyMs: number;           // p50
  qualityScore: number;           // 0-1 normalised benchmark score
}

export interface ModelProvider {
  readonly kind: ProviderKind;
  readonly name: string;

  initialize(config: ModelProviderConfig): Promise<void>;
  listModels(): Promise<ModelInfo[]>;
  complete(request: ModelRequest): Promise<ModelResponse>;
  healthCheck(): Promise<ProviderHealth>;
  shutdown(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Request / Response
// ---------------------------------------------------------------------------

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[];
  name?: string;
  toolCallId?: string;
}

export interface ContentPart {
  type: 'text' | 'image_url' | 'audio' | 'video';
  text?: string;
  url?: string;
  mediaType?: string;
  data?: string; // base64
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ModelRequest {
  requestId: string;
  taskType: TaskType;
  messages: ModelMessage[];
  model?: string;               // explicit override
  requiredCapabilities?: ModelCapability[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string[];
  stream?: boolean;
  metadata?: Record<string, unknown>;
  budget?: BudgetConstraint;
  qos?: QoSConfig;
}

export interface BudgetConstraint {
  maxCostUsd: number;
  maxLatencyMs: number;
}

export interface ModelResponse {
  requestId: string;
  model: string;
  provider: ProviderKind;
  content: string;
  toolCalls?: ToolCall[];
  usage: TokenUsage;
  latencyMs: number;
  costUsd: number;
  traceId: string;
  cached: boolean;
  metadata?: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string; // JSON
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

// ---------------------------------------------------------------------------
// QoS & Cost
// ---------------------------------------------------------------------------

export interface QoSConfig {
  maxLatencyMs: number;
  minQualityScore: number;        // 0-1
  maxCostPerRequestUsd: number;
  retryPolicy: RetryPolicy;
  timeout: number;                // ms
}

export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors: string[];
}

export interface CostTracker {
  totalCostUsd: number;
  requestCount: number;
  tokenCounts: { input: number; output: number };
  costByProvider: Record<string, number>;
  costByModel: Record<string, number>;
  budgetRemainingUsd: number;
  windowStart: Date;
  windowEnd: Date;

  recordUsage(response: ModelResponse): void;
  isWithinBudget(estimatedCostUsd: number): boolean;
  reset(): void;
  snapshot(): CostSnapshot;
}

export interface CostSnapshot {
  timestamp: Date;
  totalCostUsd: number;
  requestCount: number;
  costByProvider: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export interface ProviderHealth {
  provider: ProviderKind;
  status: HealthStatus;
  latencyMs: number;
  lastChecked: Date;
  errorRate: number;            // 0-1 over sliding window
  availableModels: string[];
  message?: string;
}

// ---------------------------------------------------------------------------
// Canary / A-B Testing
// ---------------------------------------------------------------------------

export interface CanaryConfig {
  enabled: boolean;
  experimentId: string;
  variants: CanaryVariant[];
  stickySessions: boolean;       // hash on user/session id
  metricsCallback?: (result: CanaryResult) => void;
}

export interface CanaryVariant {
  name: string;
  model: string;
  provider: ProviderKind;
  weight: number;               // 0-1, all weights must sum to 1
}

export interface CanaryResult {
  experimentId: string;
  variant: string;
  requestId: string;
  latencyMs: number;
  costUsd: number;
  qualityScore?: number;
}

// ---------------------------------------------------------------------------
// Routing Policy
// ---------------------------------------------------------------------------

export interface RoutingPolicy {
  name: string;
  strategy: RoutingStrategy;
  rules: RoutingRule[];
  fallbackChain: string[];       // model ids in priority order
  canary?: CanaryConfig;
}

export interface RoutingRule {
  condition: RoutingCondition;
  target: RoutingTarget;
  priority: number;              // lower = higher priority
}

export interface RoutingCondition {
  taskTypes?: TaskType[];
  capabilities?: ModelCapability[];
  maxCostUsd?: number;
  maxLatencyMs?: number;
  minQuality?: number;
  custom?: (request: ModelRequest) => boolean;
}

export interface RoutingTarget {
  modelId: string;
  provider: ProviderKind;
  weight?: number;               // for weighted random
}

// ---------------------------------------------------------------------------
// Logging hook
// ---------------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void;
}

export const defaultLogger: Logger = {
  log(level, message, meta) {
    const ts = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    // eslint-disable-next-line no-console
    console[level === 'debug' ? 'log' : level](`[${ts}] [model-plane] [${level}] ${message}${metaStr}`);
  },
};
