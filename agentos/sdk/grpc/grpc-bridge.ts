// AgentOS SDK - gRPC Bridge
// Remote plugin communication with health checking, load balancing, and deadline propagation

import type {
  IPlugin,
  IPluginLoader,
  PluginManifest,
  PluginContext,
  PluginState,
  PluginExecutionResult,
  PluginHealthStatus,
  PluginKind,
  PluginError,
} from "../plugins/plugin-types";

// --- Types ---

export interface GrpcBridgeConfig {
  endpoints: GrpcEndpoint[];
  loadBalancingPolicy: "round_robin" | "least_connections" | "random";
  deadlineMs: number;
  keepAliveIntervalMs: number;
  maxRetries: number;
  retryBackoffMs: number;
  tlsEnabled: boolean;
  metadata?: Record<string, string>;
}

export interface GrpcEndpoint {
  host: string;
  port: number;
  weight?: number;
  region?: string;
}

interface EndpointState {
  endpoint: GrpcEndpoint;
  healthy: boolean;
  activeConnections: number;
  lastHealthCheck: number;
  consecutiveFailures: number;
  latencyMs: number;
}

interface GrpcCallOptions {
  deadlineMs?: number;
  metadata?: Record<string, string>;
  retries?: number;
}

// --- Load Balancer ---

class LoadBalancer {
  private endpointStates: EndpointState[] = [];
  private roundRobinIndex = 0;

  constructor(
    endpoints: GrpcEndpoint[],
    private policy: GrpcBridgeConfig["loadBalancingPolicy"]
  ) {
    this.endpointStates = endpoints.map((ep) => ({
      endpoint: ep,
      healthy: true,
      activeConnections: 0,
      lastHealthCheck: Date.now(),
      consecutiveFailures: 0,
      latencyMs: 0,
    }));
  }

  selectEndpoint(): EndpointState {
    const healthy = this.endpointStates.filter((s) => s.healthy);
    if (healthy.length === 0) {
      throw new GrpcBridgeError("No healthy endpoints available", "NO_ENDPOINTS");
    }

    switch (this.policy) {
      case "round_robin": {
        const index = this.roundRobinIndex % healthy.length;
        this.roundRobinIndex++;
        return healthy[index];
      }
      case "least_connections": {
        return healthy.reduce((min, s) =>
          s.activeConnections < min.activeConnections ? s : min
        );
      }
      case "random": {
        return healthy[Math.floor(Math.random() * healthy.length)];
      }
    }
  }

  markHealthy(endpoint: GrpcEndpoint): void {
    const state = this.findState(endpoint);
    if (state) {
      state.healthy = true;
      state.consecutiveFailures = 0;
      state.lastHealthCheck = Date.now();
    }
  }

  markUnhealthy(endpoint: GrpcEndpoint): void {
    const state = this.findState(endpoint);
    if (state) {
      state.consecutiveFailures++;
      if (state.consecutiveFailures >= 3) {
        state.healthy = false;
      }
      state.lastHealthCheck = Date.now();
    }
  }

  updateLatency(endpoint: GrpcEndpoint, latencyMs: number): void {
    const state = this.findState(endpoint);
    if (state) {
      // Exponential moving average
      state.latencyMs = state.latencyMs === 0
        ? latencyMs
        : state.latencyMs * 0.7 + latencyMs * 0.3;
    }
  }

  incrementConnections(endpoint: GrpcEndpoint): void {
    const state = this.findState(endpoint);
    if (state) state.activeConnections++;
  }

  decrementConnections(endpoint: GrpcEndpoint): void {
    const state = this.findState(endpoint);
    if (state) state.activeConnections = Math.max(0, state.activeConnections - 1);
  }

  getStates(): EndpointState[] {
    return [...this.endpointStates];
  }

  private findState(endpoint: GrpcEndpoint): EndpointState | undefined {
    return this.endpointStates.find(
      (s) => s.endpoint.host === endpoint.host && s.endpoint.port === endpoint.port
    );
  }
}

// --- gRPC Plugin ---

export class GrpcPlugin implements IPlugin {
  private _state: PluginState = "discovered";
  private loadBalancer: LoadBalancer;
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private callCount = 0;

  constructor(
    public readonly manifest: PluginManifest,
    private config: GrpcBridgeConfig
  ) {
    this.loadBalancer = new LoadBalancer(config.endpoints, config.loadBalancingPolicy);
  }

  get state(): PluginState {
    return this._state;
  }

  async load(context: PluginContext): Promise<void> {
    this._state = "loading";
    context.logger.info(`Connecting gRPC bridge: ${this.manifest.id}`);

    // Verify at least one endpoint is reachable
    let anyReachable = false;
    for (const ep of this.config.endpoints) {
      try {
        await this.pingEndpoint(ep, context);
        this.loadBalancer.markHealthy(ep);
        anyReachable = true;
      } catch {
        this.loadBalancer.markUnhealthy(ep);
        context.logger.warn(`Endpoint ${ep.host}:${ep.port} unreachable`);
      }
    }

    if (!anyReachable) {
      this._state = "error";
      throw new GrpcBridgeError("No gRPC endpoints reachable", "ALL_ENDPOINTS_DOWN");
    }

    // Start periodic health checks
    this.healthCheckInterval = setInterval(async () => {
      for (const ep of this.config.endpoints) {
        try {
          await this.pingEndpoint(ep, context);
          this.loadBalancer.markHealthy(ep);
        } catch {
          this.loadBalancer.markUnhealthy(ep);
        }
      }
    }, this.config.keepAliveIntervalMs);

    this._state = "loaded";
    context.logger.info(`gRPC bridge connected: ${this.manifest.id}`);
  }

  async validate(): Promise<boolean> {
    this._state = "validating";
    const healthyEndpoints = this.loadBalancer.getStates().filter((s) => s.healthy);
    const valid = healthyEndpoints.length > 0;
    this._state = valid ? "validated" : "error";
    return valid;
  }

  async execute<TIn, TOut>(
    capability: string,
    input: TIn,
    context: PluginContext
  ): Promise<PluginExecutionResult<TOut>> {
    this._state = "executing";

    const options: GrpcCallOptions = {
      deadlineMs: this.config.deadlineMs,
      metadata: {
        ...this.config.metadata,
        "x-run-id": context.runId,
        "x-plugin-id": context.pluginId,
      },
      retries: this.config.maxRetries,
    };

    try {
      const result = await this.callWithRetry<TIn, TOut>(capability, input, options, context);
      this._state = "registered";
      return result;
    } catch (err) {
      this._state = "registered";
      return {
        success: false,
        error: {
          code: err instanceof GrpcBridgeError ? err.code : "GRPC_ERROR",
          message: String(err),
          retryable: true,
        },
        durationMs: 0,
      };
    }
  }

  async healthCheck(): Promise<PluginHealthStatus> {
    const states = this.loadBalancer.getStates();
    const healthyCount = states.filter((s) => s.healthy).length;
    const avgLatency = states.reduce((sum, s) => sum + s.latencyMs, 0) / (states.length || 1);

    return {
      healthy: healthyCount > 0,
      lastCheck: Date.now(),
      latencyMs: avgLatency,
      consecutiveFailures: states.reduce((sum, s) => sum + s.consecutiveFailures, 0),
      message: `${healthyCount}/${states.length} endpoints healthy`,
    };
  }

  async unload(): Promise<void> {
    this._state = "unloading";

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    this._state = "unloaded";
  }

  // --- Internal ---

  private async callWithRetry<TIn, TOut>(
    capability: string,
    input: TIn,
    options: GrpcCallOptions,
    context: PluginContext
  ): Promise<PluginExecutionResult<TOut>> {
    const maxRetries = options.retries ?? this.config.maxRetries;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const epState = this.loadBalancer.selectEndpoint();
      const endpoint = epState.endpoint;

      this.loadBalancer.incrementConnections(endpoint);
      const start = performance.now();

      try {
        const result = await this.makeCall<TIn, TOut>(endpoint, capability, input, options, context);
        const durationMs = performance.now() - start;
        this.loadBalancer.decrementConnections(endpoint);
        this.loadBalancer.updateLatency(endpoint, durationMs);
        this.loadBalancer.markHealthy(endpoint);

        this.callCount++;
        context.metrics.timing("grpc.call_duration", durationMs, {
          plugin: this.manifest.id,
          capability,
        });

        return { success: true, data: result, durationMs };
      } catch (err) {
        const durationMs = performance.now() - start;
        this.loadBalancer.decrementConnections(endpoint);
        this.loadBalancer.markUnhealthy(endpoint);
        lastError = err instanceof Error ? err : new Error(String(err));

        context.logger.warn(
          `gRPC call failed (attempt ${attempt + 1}/${maxRetries + 1}): ${lastError.message}`,
          { endpoint: `${endpoint.host}:${endpoint.port}`, capability }
        );

        if (attempt < maxRetries) {
          const backoff = this.config.retryBackoffMs * Math.pow(2, attempt);
          await this.sleep(Math.min(backoff, 30_000));
        }
      }
    }

    throw lastError ?? new GrpcBridgeError("All retries exhausted", "RETRIES_EXHAUSTED");
  }

  private async makeCall<TIn, TOut>(
    endpoint: GrpcEndpoint,
    capability: string,
    input: TIn,
    options: GrpcCallOptions,
    context: PluginContext
  ): Promise<TOut> {
    const url = `${this.config.tlsEnabled ? "https" : "http"}://${endpoint.host}:${endpoint.port}/${this.manifest.id}/${capability}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/grpc+json",
      "grpc-timeout": `${options.deadlineMs ?? this.config.deadlineMs}m`,
      ...options.metadata,
    };

    const controller = new AbortController();
    const deadlineTimer = setTimeout(
      () => controller.abort("Deadline exceeded"),
      options.deadlineMs ?? this.config.deadlineMs
    );

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(input),
        signal: controller.signal,
      });

      if (!response.ok) {
        const grpcStatus = response.headers.get("grpc-status");
        throw new GrpcBridgeError(
          `gRPC call failed with status ${grpcStatus ?? response.status}`,
          `GRPC_STATUS_${grpcStatus ?? "UNKNOWN"}`
        );
      }

      return (await response.json()) as TOut;
    } finally {
      clearTimeout(deadlineTimer);
    }
  }

  private async pingEndpoint(endpoint: GrpcEndpoint, context: PluginContext): Promise<void> {
    const url = `${this.config.tlsEnabled ? "https" : "http"}://${endpoint.host}:${endpoint.port}/grpc.health.v1.Health/Check`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/grpc+json" },
      body: JSON.stringify({ service: this.manifest.id }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new GrpcBridgeError(`Health check failed: ${response.status}`, "HEALTH_CHECK_FAILED");
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// --- gRPC Plugin Loader ---

export class GrpcPluginLoader implements IPluginLoader {
  readonly kind: PluginKind = "grpc";

  constructor(private defaultConfig: Partial<GrpcBridgeConfig> = {}) {}

  canLoad(manifest: PluginManifest): boolean {
    return manifest.kind === "grpc" && !!manifest.entrypoint;
  }

  async load(manifest: PluginManifest, context: PluginContext): Promise<IPlugin> {
    const endpoints = this.parseEndpoints(manifest.entrypoint);

    const config: GrpcBridgeConfig = {
      endpoints,
      loadBalancingPolicy: this.defaultConfig.loadBalancingPolicy ?? "round_robin",
      deadlineMs: this.defaultConfig.deadlineMs ?? 30_000,
      keepAliveIntervalMs: this.defaultConfig.keepAliveIntervalMs ?? 60_000,
      maxRetries: this.defaultConfig.maxRetries ?? 3,
      retryBackoffMs: this.defaultConfig.retryBackoffMs ?? 1000,
      tlsEnabled: this.defaultConfig.tlsEnabled ?? true,
      metadata: this.defaultConfig.metadata,
    };

    const plugin = new GrpcPlugin(manifest, config);
    await plugin.load(context);
    return plugin;
  }

  private parseEndpoints(entrypoint: string): GrpcEndpoint[] {
    // Format: "host1:port1,host2:port2" or single "host:port"
    return entrypoint.split(",").map((addr) => {
      const [host, portStr] = addr.trim().split(":");
      return { host, port: parseInt(portStr, 10) || 443 };
    });
  }
}

// --- Error ---

export class GrpcBridgeError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "GrpcBridgeError";
  }
}

// --- Factory ---

export function createGrpcLoader(config?: Partial<GrpcBridgeConfig>): GrpcPluginLoader {
  return new GrpcPluginLoader(config);
}
