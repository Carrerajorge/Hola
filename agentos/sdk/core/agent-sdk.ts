// AgentOS SDK - Core: createAgent(), runMission(), registerPlugin()
// Fluent builder API with proper error handling

import { PluginSystem } from "../plugins/plugin-system";
import type {
  PluginManifest,
  PluginContext,
  PluginLogger,
  PluginMetrics,
  IPlugin,
  PluginLifecycleHooks,
} from "../plugins/plugin-types";

// --- Types ---

export interface AgentConfig {
  name: string;
  modelId: string;
  systemPrompt?: string;
  maxTokens?: number;
  budgetTokens?: number;
  budgetCostUsd?: number;
  timeoutMs?: number;
  maxConcurrency?: number;
  retryPolicy?: RetryPolicy;
  tags?: Record<string, string>;
}

export interface RetryPolicy {
  maxRetries: number;
  backoffMs: number;
  backoffMultiplier: number;
  maxBackoffMs: number;
  retryableErrors?: string[];
}

export interface MissionConfig {
  goal: string;
  context?: Record<string, unknown>;
  constraints?: string[];
  outputSchema?: Record<string, unknown>;
  webhookUrl?: string;
  priority?: "low" | "normal" | "high" | "critical";
}

export interface MissionRun {
  runId: string;
  missionId: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  startedAt: number;
  completedAt?: number;
  result?: unknown;
  error?: string;
  tokenUsage: { input: number; output: number; total: number };
  costUsd: number;
}

export interface AgentEvent {
  type: string;
  timestamp: number;
  data: unknown;
}

type EventHandler = (event: AgentEvent) => void | Promise<void>;

// --- Default logger & metrics ---

function createDefaultLogger(agentName: string): PluginLogger {
  const fmt = (level: string, msg: string, data?: Record<string, unknown>) =>
    console.log(`[${level}] [${agentName}] ${msg}`, data ?? "");

  return {
    debug: (msg, data) => fmt("DEBUG", msg, data),
    info: (msg, data) => fmt("INFO", msg, data),
    warn: (msg, data) => fmt("WARN", msg, data),
    error: (msg, data) => fmt("ERROR", msg, data),
  };
}

function createNoopMetrics(): PluginMetrics {
  return {
    increment: () => {},
    gauge: () => {},
    histogram: () => {},
    timing: () => {},
  };
}

// --- Agent Builder ---

export class AgentBuilder {
  private config: Partial<AgentConfig> = {};
  private plugins: PluginManifest[] = [];
  private eventHandlers = new Map<string, Set<EventHandler>>();
  private lifecycleHooks: PluginLifecycleHooks = {};
  private middleware: Array<(ctx: MissionContext, next: () => Promise<void>) => Promise<void>> = [];

  name(name: string): this {
    this.config.name = name;
    return this;
  }

  model(modelId: string): this {
    this.config.modelId = modelId;
    return this;
  }

  systemPrompt(prompt: string): this {
    this.config.systemPrompt = prompt;
    return this;
  }

  maxTokens(tokens: number): this {
    this.config.maxTokens = tokens;
    return this;
  }

  budget(options: { tokens?: number; costUsd?: number }): this {
    if (options.tokens) this.config.budgetTokens = options.tokens;
    if (options.costUsd) this.config.budgetCostUsd = options.costUsd;
    return this;
  }

  timeout(ms: number): this {
    this.config.timeoutMs = ms;
    return this;
  }

  concurrency(max: number): this {
    this.config.maxConcurrency = max;
    return this;
  }

  retry(policy: RetryPolicy): this {
    this.config.retryPolicy = policy;
    return this;
  }

  tags(tags: Record<string, string>): this {
    this.config.tags = { ...this.config.tags, ...tags };
    return this;
  }

  plugin(manifest: PluginManifest): this {
    this.plugins.push(manifest);
    return this;
  }

  on(event: string, handler: EventHandler): this {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
    return this;
  }

  hooks(hooks: PluginLifecycleHooks): this {
    this.lifecycleHooks = { ...this.lifecycleHooks, ...hooks };
    return this;
  }

  use(mw: (ctx: MissionContext, next: () => Promise<void>) => Promise<void>): this {
    this.middleware.push(mw);
    return this;
  }

  build(): Agent {
    if (!this.config.name) throw new AgentSDKError("Agent name is required", "MISSING_NAME");
    if (!this.config.modelId) throw new AgentSDKError("Model ID is required", "MISSING_MODEL");

    const fullConfig: AgentConfig = {
      name: this.config.name,
      modelId: this.config.modelId,
      systemPrompt: this.config.systemPrompt,
      maxTokens: this.config.maxTokens ?? 100_000,
      budgetTokens: this.config.budgetTokens ?? 500_000,
      budgetCostUsd: this.config.budgetCostUsd ?? 10,
      timeoutMs: this.config.timeoutMs ?? 300_000,
      maxConcurrency: this.config.maxConcurrency ?? 4,
      retryPolicy: this.config.retryPolicy ?? {
        maxRetries: 3,
        backoffMs: 1000,
        backoffMultiplier: 2,
        maxBackoffMs: 30_000,
      },
      tags: this.config.tags ?? {},
    };

    return new Agent(fullConfig, this.plugins, this.eventHandlers, this.lifecycleHooks, this.middleware);
  }
}

// --- Mission Context ---

export interface MissionContext {
  runId: string;
  missionId: string;
  agent: Agent;
  config: MissionConfig;
  abortController: AbortController;
  logger: PluginLogger;
  set(key: string, value: unknown): void;
  get<T = unknown>(key: string): T | undefined;
}

// --- Agent ---

export class Agent {
  private pluginSystem: PluginSystem;
  private abortController = new AbortController();
  private runs = new Map<string, MissionRun>();

  constructor(
    public readonly config: AgentConfig,
    private pluginManifests: PluginManifest[],
    private eventHandlers: Map<string, Set<EventHandler>>,
    private lifecycleHooks: PluginLifecycleHooks,
    private middleware: Array<(ctx: MissionContext, next: () => Promise<void>) => Promise<void>>
  ) {
    const logger = createDefaultLogger(config.name);
    const metrics = createNoopMetrics();

    this.pluginSystem = new PluginSystem({
      runId: "",
      config: {},
      logger,
      metrics,
      abortSignal: this.abortController.signal,
    });

    this.pluginSystem.setLifecycleHooks(this.lifecycleHooks);
  }

  async initialize(): Promise<void> {
    for (const manifest of this.pluginManifests) {
      await this.pluginSystem.installPlugin(manifest);
    }
    this.emit("agent:initialized", { name: this.config.name });
  }

  async runMission(missionConfig: MissionConfig): Promise<MissionRun> {
    const runId = crypto.randomUUID();
    const missionId = crypto.randomUUID();

    const run: MissionRun = {
      runId,
      missionId,
      status: "pending",
      startedAt: Date.now(),
      tokenUsage: { input: 0, output: 0, total: 0 },
      costUsd: 0,
    };

    this.runs.set(runId, run);
    this.emit("mission:started", { runId, goal: missionConfig.goal });

    const missionAbort = new AbortController();
    const store = new Map<string, unknown>();

    const ctx: MissionContext = {
      runId,
      missionId,
      agent: this,
      config: missionConfig,
      abortController: missionAbort,
      logger: createDefaultLogger(this.config.name),
      set: (key, value) => store.set(key, value),
      get: <T>(key: string) => store.get(key) as T | undefined,
    };

    // Timeout
    const timeoutId = setTimeout(() => {
      missionAbort.abort("Mission timeout exceeded");
    }, this.config.timeoutMs);

    try {
      run.status = "running";

      // Execute middleware chain
      await this.runMiddleware(ctx, async () => {
        // Core mission execution would happen here
        // This is where the agent's planning and execution loop runs
        this.emit("mission:planning", { runId });
        this.emit("mission:executing", { runId });
      });

      run.status = "completed";
      run.completedAt = Date.now();
      this.emit("mission:completed", { runId });
    } catch (err) {
      run.status = "failed";
      run.error = String(err);
      run.completedAt = Date.now();
      this.emit("mission:failed", { runId, error: run.error });
    } finally {
      clearTimeout(timeoutId);
    }

    return run;
  }

  registerPlugin(manifest: PluginManifest): Promise<IPlugin> {
    return this.pluginSystem.installPlugin(manifest);
  }

  getPluginSystem(): PluginSystem {
    return this.pluginSystem;
  }

  getRun(runId: string): MissionRun | undefined {
    return this.runs.get(runId);
  }

  async cancelRun(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) throw new AgentSDKError(`Run "${runId}" not found`, "RUN_NOT_FOUND");
    run.status = "cancelled";
    run.completedAt = Date.now();
    this.emit("mission:cancelled", { runId });
  }

  async shutdown(): Promise<void> {
    this.abortController.abort("Agent shutdown");
    await this.pluginSystem.shutdown();
    this.emit("agent:shutdown", { name: this.config.name });
  }

  private emit(type: string, data: unknown): void {
    const event: AgentEvent = { type, timestamp: Date.now(), data };
    const handlers = this.eventHandlers.get(type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch {
          // Event handler errors are swallowed
        }
      }
    }
    // Wildcard handlers
    const wildcardHandlers = this.eventHandlers.get("*");
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        try {
          handler(event);
        } catch {
          // Swallowed
        }
      }
    }
  }

  private async runMiddleware(ctx: MissionContext, core: () => Promise<void>): Promise<void> {
    let index = 0;
    const next = async (): Promise<void> => {
      if (index < this.middleware.length) {
        const mw = this.middleware[index++];
        await mw(ctx, next);
      } else {
        await core();
      }
    };
    await next();
  }
}

// --- Error ---

export class AgentSDKError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "AgentSDKError";
  }
}

// --- Factory functions ---

export function createAgent(): AgentBuilder {
  return new AgentBuilder();
}

export async function runMission(agent: Agent, config: MissionConfig): Promise<MissionRun> {
  return agent.runMission(config);
}
