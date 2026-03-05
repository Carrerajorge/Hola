// AgentOS SDK - Plugin System
// Lifecycle: discover -> load -> validate -> register -> execute -> unload

import type {
  IPlugin,
  IPluginLoader,
  IPluginRegistry,
  PluginManifest,
  PluginContext,
  PluginKind,
  PluginExecutionResult,
  PluginHealthStatus,
  PluginError,
  PluginDiscoverySource,
  PluginLifecycleHooks,
  PluginState,
} from "./plugin-types";

// --- Plugin Registry ---

export class PluginRegistry implements IPluginRegistry {
  private plugins = new Map<string, IPlugin>();

  register(plugin: IPlugin): void {
    if (this.plugins.has(plugin.manifest.id)) {
      throw new PluginSystemError(
        `Plugin "${plugin.manifest.id}" is already registered`,
        "DUPLICATE_PLUGIN"
      );
    }
    this.plugins.set(plugin.manifest.id, plugin);
  }

  unregister(pluginId: string): void {
    if (!this.plugins.has(pluginId)) {
      throw new PluginSystemError(`Plugin "${pluginId}" not found`, "PLUGIN_NOT_FOUND");
    }
    this.plugins.delete(pluginId);
  }

  get(pluginId: string): IPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  list(): IPlugin[] {
    return Array.from(this.plugins.values());
  }

  findByCapability(capabilityName: string): IPlugin[] {
    return this.list().filter((p) =>
      p.manifest.capabilities.some((c) => c.name === capabilityName)
    );
  }
}

// --- Plugin System ---

export class PluginSystem {
  private registry = new PluginRegistry();
  private loaders = new Map<PluginKind, IPluginLoader>();
  private hooks: PluginLifecycleHooks = {};
  private healthIntervals = new Map<string, ReturnType<typeof setInterval>>();

  constructor(private defaultContext: Omit<PluginContext, "pluginId">) {}

  // --- Loader registration ---

  registerLoader(loader: IPluginLoader): this {
    this.loaders.set(loader.kind, loader);
    return this;
  }

  setLifecycleHooks(hooks: PluginLifecycleHooks): this {
    this.hooks = { ...this.hooks, ...hooks };
    return this;
  }

  // --- Discovery ---

  async discover(source: PluginDiscoverySource): Promise<PluginManifest[]> {
    const manifests: PluginManifest[] = [];

    switch (source.type) {
      case "directory":
        // In a real implementation, this would scan the filesystem
        throw new PluginSystemError("Directory discovery requires filesystem access", "NOT_IMPLEMENTED");

      case "url": {
        const response = await fetch(source.location, {
          signal: this.defaultContext.abortSignal,
        });
        if (!response.ok) {
          throw new PluginSystemError(`Failed to fetch manifest from ${source.location}`, "FETCH_ERROR");
        }
        const manifest = (await response.json()) as PluginManifest;
        manifests.push(manifest);
        break;
      }

      case "inline": {
        const manifest = JSON.parse(source.location) as PluginManifest;
        manifests.push(manifest);
        break;
      }

      default:
        throw new PluginSystemError(`Unknown source type: ${source.type}`, "INVALID_SOURCE");
    }

    // Apply discovery hook filter
    const approved: PluginManifest[] = [];
    for (const manifest of manifests) {
      const allowed = await this.hooks.onDiscover?.(manifest) ?? true;
      if (allowed) approved.push(manifest);
    }

    return approved;
  }

  // --- Load ---

  async loadPlugin(manifest: PluginManifest): Promise<IPlugin> {
    const loader = this.loaders.get(manifest.kind);
    if (!loader) {
      throw new PluginSystemError(
        `No loader registered for plugin kind "${manifest.kind}"`,
        "NO_LOADER"
      );
    }

    if (!loader.canLoad(manifest)) {
      throw new PluginSystemError(
        `Loader for "${manifest.kind}" cannot load plugin "${manifest.id}"`,
        "INCOMPATIBLE_PLUGIN"
      );
    }

    await this.hooks.onBeforeLoad?.(manifest);

    const context = this.createContext(manifest.id);
    const plugin = await loader.load(manifest, context);

    await this.hooks.onAfterLoad?.(plugin);

    return plugin;
  }

  // --- Validate ---

  async validatePlugin(plugin: IPlugin): Promise<boolean> {
    try {
      const valid = await plugin.validate();
      if (!valid) {
        throw new PluginSystemError(
          `Plugin "${plugin.manifest.id}" failed validation`,
          "VALIDATION_FAILED"
        );
      }
      return true;
    } catch (err) {
      if (err instanceof PluginSystemError) throw err;
      throw new PluginSystemError(
        `Plugin "${plugin.manifest.id}" validation error: ${String(err)}`,
        "VALIDATION_ERROR"
      );
    }
  }

  // --- Register ---

  registerPlugin(plugin: IPlugin): void {
    this.registry.register(plugin);
  }

  // --- Execute ---

  async execute<TIn, TOut>(
    pluginId: string,
    capability: string,
    input: TIn
  ): Promise<PluginExecutionResult<TOut>> {
    const plugin = this.registry.get(pluginId);
    if (!plugin) {
      throw new PluginSystemError(`Plugin "${pluginId}" not found`, "PLUGIN_NOT_FOUND");
    }

    const hasCap = plugin.manifest.capabilities.some((c) => c.name === capability);
    if (!hasCap) {
      throw new PluginSystemError(
        `Plugin "${pluginId}" does not have capability "${capability}"`,
        "CAPABILITY_NOT_FOUND"
      );
    }

    await this.hooks.onBeforeExecute?.(pluginId, capability);

    const context = this.createContext(pluginId);
    const start = performance.now();

    try {
      const result = await plugin.execute<TIn, TOut>(capability, input, context);
      await this.hooks.onAfterExecute?.(pluginId, result);
      return result;
    } catch (err) {
      const pluginError: PluginError = {
        code: "EXECUTION_ERROR",
        message: String(err),
        retryable: false,
      };
      await this.hooks.onError?.(pluginId, pluginError);
      return {
        success: false,
        error: pluginError,
        durationMs: performance.now() - start,
      };
    }
  }

  // --- Unload ---

  async unloadPlugin(pluginId: string): Promise<void> {
    const plugin = this.registry.get(pluginId);
    if (!plugin) {
      throw new PluginSystemError(`Plugin "${pluginId}" not found`, "PLUGIN_NOT_FOUND");
    }

    this.stopHealthCheck(pluginId);
    await plugin.unload();
    this.registry.unregister(pluginId);
    await this.hooks.onUnload?.(pluginId);
  }

  // --- Full lifecycle ---

  async installPlugin(manifest: PluginManifest): Promise<IPlugin> {
    const plugin = await this.loadPlugin(manifest);
    await this.validatePlugin(plugin);
    this.registerPlugin(plugin);
    return plugin;
  }

  // --- Health checking ---

  startHealthCheck(pluginId: string, intervalMs = 30_000): void {
    this.stopHealthCheck(pluginId);
    const interval = setInterval(async () => {
      const plugin = this.registry.get(pluginId);
      if (!plugin) {
        this.stopHealthCheck(pluginId);
        return;
      }
      try {
        const status = await plugin.healthCheck();
        if (!status.healthy) {
          const error: PluginError = {
            code: "HEALTH_CHECK_FAILED",
            message: status.message ?? "Plugin unhealthy",
            retryable: true,
          };
          await this.hooks.onError?.(pluginId, error);
        }
      } catch {
        // Health check itself failed
      }
    }, intervalMs);
    this.healthIntervals.set(pluginId, interval);
  }

  private stopHealthCheck(pluginId: string): void {
    const interval = this.healthIntervals.get(pluginId);
    if (interval) {
      clearInterval(interval);
      this.healthIntervals.delete(pluginId);
    }
  }

  // --- Queries ---

  getPlugin(pluginId: string): IPlugin | undefined {
    return this.registry.get(pluginId);
  }

  listPlugins(): IPlugin[] {
    return this.registry.list();
  }

  findByCapability(capability: string): IPlugin[] {
    return this.registry.findByCapability(capability);
  }

  // --- Shutdown ---

  async shutdown(): Promise<void> {
    const plugins = this.registry.list();
    for (const plugin of plugins) {
      try {
        await this.unloadPlugin(plugin.manifest.id);
      } catch {
        // Best-effort shutdown
      }
    }
  }

  // --- Internal ---

  private createContext(pluginId: string): PluginContext {
    return {
      ...this.defaultContext,
      pluginId,
    };
  }
}

// --- Error class ---

export class PluginSystemError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "PluginSystemError";
  }
}

// --- Factory ---

export function createPluginSystem(
  context: Omit<PluginContext, "pluginId">
): PluginSystem {
  return new PluginSystem(context);
}
