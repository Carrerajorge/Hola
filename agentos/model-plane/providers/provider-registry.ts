// AgentOS Model-Plane — Provider Registry
// Central registry for model providers with health monitoring and capability discovery.

import {
  ModelProvider,
  ModelProviderConfig,
  ModelInfo,
  ModelCapability,
  ProviderHealth,
  ProviderKind,
  HealthStatus,
  Logger,
  defaultLogger,
} from '../types';

// ---------------------------------------------------------------------------
// Registry entry
// ---------------------------------------------------------------------------

interface RegistryEntry {
  provider: ModelProvider;
  config: ModelProviderConfig;
  health: ProviderHealth;
  models: ModelInfo[];
  lastHealthCheck: number;  // epoch ms
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class ProviderRegistry {
  private entries = new Map<ProviderKind, RegistryEntry>();
  private healthCheckIntervalMs: number;
  private healthTimer?: ReturnType<typeof setInterval>;
  private logger: Logger;

  constructor(options?: { healthCheckIntervalMs?: number; logger?: Logger }) {
    this.healthCheckIntervalMs = options?.healthCheckIntervalMs ?? 60_000;
    this.logger = options?.logger ?? defaultLogger;
  }

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  async register(provider: ModelProvider, config: ModelProviderConfig): Promise<void> {
    if (this.entries.has(provider.kind)) {
      this.logger.log('warn', `Replacing existing provider: ${provider.kind}`);
      await this.unregister(provider.kind);
    }

    await provider.initialize(config);
    const models = await provider.listModels();
    const health = await provider.healthCheck();

    this.entries.set(provider.kind, {
      provider,
      config,
      health,
      models,
      lastHealthCheck: Date.now(),
      enabled: true,
    });

    this.logger.log('info', `Registered provider: ${provider.name}`, {
      kind: provider.kind,
      modelCount: models.length,
      status: health.status,
    });
  }

  async unregister(kind: ProviderKind): Promise<void> {
    const entry = this.entries.get(kind);
    if (!entry) return;
    try {
      await entry.provider.shutdown();
    } catch (err) {
      this.logger.log('warn', `Error shutting down provider ${kind}`, { error: String(err) });
    }
    this.entries.delete(kind);
    this.logger.log('info', `Unregistered provider: ${kind}`);
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  getProvider(kind: ProviderKind): ModelProvider | undefined {
    return this.entries.get(kind)?.provider;
  }

  getEntry(kind: ProviderKind): RegistryEntry | undefined {
    return this.entries.get(kind);
  }

  listProviders(): ProviderKind[] {
    return [...this.entries.keys()];
  }

  listAllModels(): ModelInfo[] {
    const models: ModelInfo[] = [];
    for (const entry of this.entries.values()) {
      if (entry.enabled) models.push(...entry.models);
    }
    return models;
  }

  /** Find models that satisfy every requested capability. */
  findModels(capabilities: ModelCapability[]): ModelInfo[] {
    return this.listAllModels().filter((m) =>
      capabilities.every((cap) => m.capabilities.includes(cap)),
    );
  }

  /** Find the cheapest model that satisfies the given capabilities. */
  findCheapest(capabilities: ModelCapability[]): ModelInfo | undefined {
    return this.findModels(capabilities).sort(
      (a, b) => a.costPer1kInputTokens + a.costPer1kOutputTokens - (b.costPer1kInputTokens + b.costPer1kOutputTokens),
    )[0];
  }

  /** Find the highest-quality model that satisfies the given capabilities. */
  findBestQuality(capabilities: ModelCapability[]): ModelInfo | undefined {
    return this.findModels(capabilities).sort((a, b) => b.qualityScore - a.qualityScore)[0];
  }

  /** Find the lowest-latency model that satisfies the given capabilities. */
  findFastest(capabilities: ModelCapability[]): ModelInfo | undefined {
    return this.findModels(capabilities).sort((a, b) => a.avgLatencyMs - b.avgLatencyMs)[0];
  }

  getModelInfo(modelId: string): { model: ModelInfo; provider: ModelProvider } | undefined {
    for (const entry of this.entries.values()) {
      const model = entry.models.find((m) => m.id === modelId);
      if (model) return { model, provider: entry.provider };
    }
    return undefined;
  }

  // -----------------------------------------------------------------------
  // Health
  // -----------------------------------------------------------------------

  getHealth(kind: ProviderKind): ProviderHealth | undefined {
    return this.entries.get(kind)?.health;
  }

  getAllHealth(): Map<ProviderKind, ProviderHealth> {
    const out = new Map<ProviderKind, ProviderHealth>();
    for (const [kind, entry] of this.entries) {
      out.set(kind, entry.health);
    }
    return out;
  }

  getHealthyProviders(): ProviderKind[] {
    return [...this.entries.entries()]
      .filter(([, e]) => e.enabled && (e.health.status === 'healthy' || e.health.status === 'degraded'))
      .map(([kind]) => kind);
  }

  async refreshHealth(kind: ProviderKind): Promise<ProviderHealth> {
    const entry = this.entries.get(kind);
    if (!entry) throw new Error(`Provider ${kind} not registered`);
    entry.health = await entry.provider.healthCheck();
    entry.lastHealthCheck = Date.now();
    this.logger.log('debug', `Health check: ${kind} => ${entry.health.status}`, { latencyMs: entry.health.latencyMs });
    return entry.health;
  }

  async refreshAllHealth(): Promise<Map<ProviderKind, ProviderHealth>> {
    const results = new Map<ProviderKind, ProviderHealth>();
    const checks = [...this.entries.keys()].map(async (kind) => {
      const h = await this.refreshHealth(kind);
      results.set(kind, h);
    });
    await Promise.allSettled(checks);
    return results;
  }

  // -----------------------------------------------------------------------
  // Enable / Disable
  // -----------------------------------------------------------------------

  setEnabled(kind: ProviderKind, enabled: boolean): void {
    const entry = this.entries.get(kind);
    if (!entry) throw new Error(`Provider ${kind} not registered`);
    entry.enabled = enabled;
    this.logger.log('info', `Provider ${kind} ${enabled ? 'enabled' : 'disabled'}`);
  }

  // -----------------------------------------------------------------------
  // Background health monitoring
  // -----------------------------------------------------------------------

  startHealthMonitor(): void {
    if (this.healthTimer) return;
    this.healthTimer = setInterval(() => {
      this.refreshAllHealth().catch((err) => {
        this.logger.log('error', 'Background health check failed', { error: String(err) });
      });
    }, this.healthCheckIntervalMs);
    this.logger.log('info', `Health monitor started (interval=${this.healthCheckIntervalMs}ms)`);
  }

  stopHealthMonitor(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = undefined;
      this.logger.log('info', 'Health monitor stopped');
    }
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async shutdownAll(): Promise<void> {
    this.stopHealthMonitor();
    const kinds = [...this.entries.keys()];
    await Promise.allSettled(kinds.map((k) => this.unregister(k)));
    this.logger.log('info', 'All providers shut down');
  }

  get size(): number {
    return this.entries.size;
  }
}
