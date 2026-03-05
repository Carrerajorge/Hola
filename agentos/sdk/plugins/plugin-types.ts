// AgentOS SDK - Plugin Type Definitions and Interfaces

export type PluginKind = "wasm" | "grpc" | "openapi" | "mcp" | "native";

export type PluginState =
  | "discovered"
  | "loading"
  | "loaded"
  | "validating"
  | "validated"
  | "registered"
  | "executing"
  | "unloading"
  | "unloaded"
  | "error";

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  kind: PluginKind;
  description?: string;
  author?: string;
  license?: string;
  entrypoint: string;
  capabilities: PluginCapability[];
  permissions: PluginPermission[];
  config?: Record<string, PluginConfigField>;
  dependencies?: PluginDependency[];
}

export interface PluginCapability {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
}

export interface PluginPermission {
  resource: "network" | "filesystem" | "env" | "subprocess" | "memory";
  access: "read" | "write" | "execute";
  scope?: string;
}

export interface PluginConfigField {
  type: "string" | "number" | "boolean" | "secret";
  required: boolean;
  default?: unknown;
  description?: string;
}

export interface PluginDependency {
  pluginId: string;
  version: string;
  optional?: boolean;
}

export type JsonSchema = Record<string, unknown>;

export interface PluginContext {
  pluginId: string;
  runId: string;
  config: Record<string, unknown>;
  logger: PluginLogger;
  metrics: PluginMetrics;
  abortSignal: AbortSignal;
}

export interface PluginLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export interface PluginMetrics {
  increment(name: string, value?: number, tags?: Record<string, string>): void;
  gauge(name: string, value: number, tags?: Record<string, string>): void;
  histogram(name: string, value: number, tags?: Record<string, string>): void;
  timing(name: string, durationMs: number, tags?: Record<string, string>): void;
}

export interface PluginExecutionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: PluginError;
  durationMs: number;
  tokensUsed?: number;
  metadata?: Record<string, unknown>;
}

export interface PluginError {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface PluginHealthStatus {
  healthy: boolean;
  lastCheck: number;
  latencyMs: number;
  message?: string;
  consecutiveFailures: number;
}

export interface IPlugin {
  readonly manifest: PluginManifest;
  readonly state: PluginState;

  load(context: PluginContext): Promise<void>;
  validate(): Promise<boolean>;
  execute<TIn, TOut>(capability: string, input: TIn, context: PluginContext): Promise<PluginExecutionResult<TOut>>;
  healthCheck(): Promise<PluginHealthStatus>;
  unload(): Promise<void>;
}

export interface IPluginLoader {
  readonly kind: PluginKind;
  canLoad(manifest: PluginManifest): boolean;
  load(manifest: PluginManifest, context: PluginContext): Promise<IPlugin>;
}

export interface IPluginRegistry {
  register(plugin: IPlugin): void;
  unregister(pluginId: string): void;
  get(pluginId: string): IPlugin | undefined;
  list(): IPlugin[];
  findByCapability(capabilityName: string): IPlugin[];
}

export interface PluginDiscoverySource {
  type: "directory" | "registry" | "url" | "inline";
  location: string;
  options?: Record<string, unknown>;
}

export interface PluginLifecycleHooks {
  onDiscover?: (manifest: PluginManifest) => Promise<boolean>;
  onBeforeLoad?: (manifest: PluginManifest) => Promise<void>;
  onAfterLoad?: (plugin: IPlugin) => Promise<void>;
  onBeforeExecute?: (pluginId: string, capability: string) => Promise<void>;
  onAfterExecute?: (pluginId: string, result: PluginExecutionResult) => Promise<void>;
  onError?: (pluginId: string, error: PluginError) => Promise<void>;
  onUnload?: (pluginId: string) => Promise<void>;
}
