/**
 * AgentOS Configuration
 *
 * Central configuration schema for all planes and cross-cutting concerns.
 */

// ── Top-level config ───────────────────────────────────────────────────

export interface AgentOSConfig {
  /** Human-readable name for this agent instance */
  name: string;

  /** Deployment environment */
  env: 'development' | 'staging' | 'production';

  /** Control plane settings */
  controlPlane: ControlPlaneConfig;

  /** Model plane settings */
  modelPlane: ModelPlaneConfig;

  /** Data plane settings */
  dataPlane: DataPlaneConfig;

  /** Knowledge plane settings */
  knowledgePlane: KnowledgePlaneConfig;

  /** Action plane settings */
  actionPlane: ActionPlaneConfig;

  /** Memory settings */
  memory: MemoryConfig;

  /** Security settings */
  security: SecurityConfig;

  /** Observability settings */
  observability: ObservabilityConfig;

  /** Plugin directories / registries */
  plugins: PluginConfig;
}

// ── Control Plane ──────────────────────────────────────────────────────

export interface ControlPlaneConfig {
  /** Max planning depth for hierarchical decomposition */
  maxPlanDepth: number;
  /** Max retries before escalating to human */
  maxRetries: number;
  /** Enable backtracking on critic rejection */
  backtrackingEnabled: boolean;
  /** Global budget limits */
  budget: BudgetLimits;
  /** Soul policy file path or inline policies */
  soulPolicies: string | SoulPolicyDef[];
  /** Risk threshold for human-in-the-loop escalation (0-1) */
  escalationThreshold: number;
}

export interface BudgetLimits {
  maxTokens: number;
  maxCostUSD: number;
  maxLatencyMs: number;
  maxApiCalls: number;
}

export interface SoulPolicyDef {
  id: string;
  description: string;
  condition: string;
  action: 'allow' | 'deny' | 'escalate' | 'log';
  priority: number;
}

// ── Model Plane ────────────────────────────────────────────────────────

export interface ModelPlaneConfig {
  /** Registered providers */
  providers: ProviderConfig[];
  /** Default routing policy */
  defaultPolicy: 'cost-optimized' | 'quality-optimized' | 'latency-optimized' | 'balanced';
  /** Canary/AB test configs */
  canary?: CanaryTestConfig;
  /** Rate limiting per provider */
  rateLimits: Record<string, RateLimitConfig>;
  /** Cost alert threshold in USD */
  costAlertThreshold: number;
}

export interface ProviderConfig {
  id: string;
  type: 'anthropic' | 'openai' | 'google' | 'xai' | 'local' | 'custom';
  endpoint?: string;
  apiKeyEnv: string;
  models: string[];
  capabilities: ('text' | 'image' | 'video' | 'voice' | 'code' | 'embedding')[];
  maxConcurrent: number;
  timeoutMs: number;
}

export interface CanaryTestConfig {
  enabled: boolean;
  trafficSplitPercent: number;
  baselineModel: string;
  canaryModel: string;
  metricsWindow: number;
}

export interface RateLimitConfig {
  requestsPerMinute: number;
  tokensPerMinute: number;
  burstMultiplier: number;
}

// ── Data Plane ─────────────────────────────────────────────────────────

export interface DataPlaneConfig {
  /** Event store backend */
  eventStore: 'memory' | 'postgres' | 'nats';
  /** PostgreSQL connection string (if using postgres) */
  postgresUrl?: string;
  /** NATS server URL (if using nats) */
  natsUrl?: string;
  /** Snapshot interval (every N events) */
  snapshotInterval: number;
  /** Workflow engine settings */
  workflows: {
    maxConcurrentWorkflows: number;
    defaultTimeoutMs: number;
    retryPolicy: { maxAttempts: number; backoffMs: number; backoffMultiplier: number };
  };
}

// ── Knowledge Plane ────────────────────────────────────────────────────

export interface KnowledgePlaneConfig {
  /** Vector store backend */
  vectorStore: 'pgvector' | 'qdrant' | 'milvus' | 'weaviate' | 'memory';
  /** Full-text search backend */
  textSearch: 'opensearch' | 'meilisearch' | 'memory';
  /** Embedding model to use */
  embeddingModel: string;
  /** Reranker model */
  rerankerModel?: string;
  /** Chunk size for document processing */
  chunkSize: number;
  /** Chunk overlap */
  chunkOverlap: number;
  /** Enable knowledge graph */
  knowledgeGraphEnabled: boolean;
  /** Freshness TTL in seconds */
  defaultTTL: number;
}

// ── Action Plane ───────────────────────────────────────────────────────

export interface ActionPlaneConfig {
  /** Browser automation settings */
  browser: {
    headless: boolean;
    timeout: number;
    respectRobotsTxt: boolean;
    screenshotOnError: boolean;
    userAgent?: string;
  };
  /** MCP server configurations */
  mcpServers: MCPServerConfig[];
  /** Telephony settings (disabled by default) */
  telephony: {
    enabled: boolean;
    provider: 'asterisk' | 'freeswitch' | 'twilio' | 'none';
    sttModel: string;
    ttsModel: string;
    requireConsent: boolean;
  };
}

export interface MCPServerConfig {
  name: string;
  transport: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
}

// ── Memory ─────────────────────────────────────────────────────────────

export interface MemoryConfig {
  /** Working memory max tokens */
  workingMemoryLimit: number;
  /** Episodic memory backend */
  episodicBackend: 'memory' | 'postgres' | 'vector';
  /** Default retention policy */
  defaultRetention: {
    ttlDays: number;
    maxEntries: number;
    privacyLevel: 'public' | 'internal' | 'confidential' | 'restricted';
  };
  /** Enable right-to-forget */
  rightToForget: boolean;
  /** Encryption at rest */
  encryptAtRest: boolean;
}

// ── Security ───────────────────────────────────────────────────────────

export interface SecurityConfig {
  /** Enable prompt injection detection */
  promptInjectionDetection: boolean;
  /** Enable input sanitization */
  inputSanitization: boolean;
  /** mTLS enabled */
  mtlsEnabled: boolean;
  /** Secret store backend */
  secretStore: 'env' | 'vault' | 'aws-sm' | 'gcp-sm';
  /** Audit log destination */
  auditLogDestination: string;
  /** Max privilege level for autonomous actions */
  maxAutonomousPrivilege: 'read' | 'write' | 'execute' | 'admin';
}

// ── Observability ──────────────────────────────────────────────────────

export interface ObservabilityConfig {
  /** OpenTelemetry collector endpoint */
  otelEndpoint?: string;
  /** Enable distributed tracing */
  tracingEnabled: boolean;
  /** Metrics export interval in seconds */
  metricsIntervalSec: number;
  /** Log level */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** Eval framework settings */
  evals: {
    enabled: boolean;
    autoRunOnDeploy: boolean;
    minSuccessRate: number;
    minGroundingRate: number;
  };
}

// ── Plugins ────────────────────────────────────────────────────────────

export interface PluginConfig {
  /** Local plugin directories */
  directories: string[];
  /** Remote plugin registries */
  registries: string[];
  /** Allowed plugin types */
  allowedTypes: ('wasm' | 'grpc' | 'openapi' | 'mcp')[];
  /** Plugin sandbox memory limit in MB */
  sandboxMemoryLimitMB: number;
}

// ── Defaults ───────────────────────────────────────────────────────────

export const DEFAULT_CONFIG: AgentOSConfig = {
  name: 'agentos-default',
  env: 'development',
  controlPlane: {
    maxPlanDepth: 5,
    maxRetries: 3,
    backtrackingEnabled: true,
    budget: { maxTokens: 1_000_000, maxCostUSD: 10, maxLatencyMs: 300_000, maxApiCalls: 100 },
    soulPolicies: [],
    escalationThreshold: 0.7,
  },
  modelPlane: {
    providers: [],
    defaultPolicy: 'balanced',
    rateLimits: {},
    costAlertThreshold: 5,
  },
  dataPlane: {
    eventStore: 'memory',
    snapshotInterval: 100,
    workflows: {
      maxConcurrentWorkflows: 10,
      defaultTimeoutMs: 600_000,
      retryPolicy: { maxAttempts: 3, backoffMs: 1000, backoffMultiplier: 2 },
    },
  },
  knowledgePlane: {
    vectorStore: 'memory',
    textSearch: 'memory',
    embeddingModel: 'text-embedding-3-small',
    chunkSize: 512,
    chunkOverlap: 64,
    knowledgeGraphEnabled: false,
    defaultTTL: 86400,
  },
  actionPlane: {
    browser: {
      headless: true,
      timeout: 30_000,
      respectRobotsTxt: true,
      screenshotOnError: true,
    },
    mcpServers: [],
    telephony: {
      enabled: false,
      provider: 'none',
      sttModel: 'whisper-large-v3',
      ttsModel: 'tts-1',
      requireConsent: true,
    },
  },
  memory: {
    workingMemoryLimit: 128_000,
    episodicBackend: 'memory',
    defaultRetention: { ttlDays: 30, maxEntries: 10_000, privacyLevel: 'internal' },
    rightToForget: true,
    encryptAtRest: false,
  },
  security: {
    promptInjectionDetection: true,
    inputSanitization: true,
    mtlsEnabled: false,
    secretStore: 'env',
    auditLogDestination: 'stdout',
    maxAutonomousPrivilege: 'write',
  },
  observability: {
    tracingEnabled: true,
    metricsIntervalSec: 30,
    logLevel: 'info',
    evals: { enabled: true, autoRunOnDeploy: false, minSuccessRate: 0.8, minGroundingRate: 0.9 },
  },
  plugins: {
    directories: ['./plugins'],
    registries: [],
    allowedTypes: ['wasm', 'grpc', 'openapi', 'mcp'],
    sandboxMemoryLimitMB: 256,
  },
};
