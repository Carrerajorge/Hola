// AgentOS SDK - WASM Plugin Runtime
// Loads .wasm modules with sandboxed execution, memory limits, and host function bindings

import type {
  IPlugin,
  IPluginLoader,
  PluginManifest,
  PluginContext,
  PluginState,
  PluginExecutionResult,
  PluginHealthStatus,
  PluginCapability,
  PluginKind,
} from "../plugins/plugin-types";

// --- Types ---

export interface WasmRuntimeConfig {
  maxMemoryPages: number;        // Max WebAssembly memory pages (64KB each)
  maxExecutionTimeMs: number;    // Per-invocation timeout
  enableSIMD: boolean;
  enableThreads: boolean;
  hostFunctions?: HostFunctionMap;
}

export type HostFunction = (...args: number[]) => number | void;
export type HostFunctionMap = Record<string, Record<string, HostFunction>>;

interface WasmModuleInstance {
  instance: WebAssembly.Instance;
  memory: WebAssembly.Memory;
  module: WebAssembly.Module;
  exports: Record<string, WebAssembly.ExportValue>;
}

// --- WASM Plugin ---

export class WasmPlugin implements IPlugin {
  private _state: PluginState = "discovered";
  private moduleInstance: WasmModuleInstance | null = null;
  private executionCount = 0;
  private totalExecutionMs = 0;

  constructor(
    public readonly manifest: PluginManifest,
    private runtimeConfig: WasmRuntimeConfig
  ) {}

  get state(): PluginState {
    return this._state;
  }

  async load(context: PluginContext): Promise<void> {
    this._state = "loading";
    context.logger.info(`Loading WASM module: ${this.manifest.entrypoint}`);

    try {
      const memory = new WebAssembly.Memory({
        initial: 16,
        maximum: this.runtimeConfig.maxMemoryPages,
      });

      const hostImports = this.buildHostImports(memory, context);

      const wasmBinary = await this.fetchModule(this.manifest.entrypoint, context);
      const module = await WebAssembly.compile(wasmBinary);
      const instance = await WebAssembly.instantiate(module, hostImports);

      this.moduleInstance = {
        instance,
        memory,
        module,
        exports: instance.exports as Record<string, WebAssembly.ExportValue>,
      };

      this._state = "loaded";
      context.logger.info(`WASM module loaded: ${this.manifest.id}`);
    } catch (err) {
      this._state = "error";
      throw new WasmRuntimeError(
        `Failed to load WASM module "${this.manifest.id}": ${String(err)}`,
        "LOAD_FAILED"
      );
    }
  }

  async validate(): Promise<boolean> {
    this._state = "validating";

    if (!this.moduleInstance) {
      this._state = "error";
      return false;
    }

    // Verify all declared capabilities have corresponding exports
    for (const cap of this.manifest.capabilities) {
      const exportName = this.capabilityToExport(cap.name);
      if (typeof this.moduleInstance.exports[exportName] !== "function") {
        this._state = "error";
        return false;
      }
    }

    // Check for required init/cleanup exports
    if (this.moduleInstance.exports["_initialize"] &&
        typeof this.moduleInstance.exports["_initialize"] !== "function") {
      this._state = "error";
      return false;
    }

    this._state = "validated";
    return true;
  }

  async execute<TIn, TOut>(
    capability: string,
    input: TIn,
    context: PluginContext
  ): Promise<PluginExecutionResult<TOut>> {
    if (!this.moduleInstance) {
      return {
        success: false,
        error: { code: "NOT_LOADED", message: "WASM module not loaded", retryable: false },
        durationMs: 0,
      };
    }

    this._state = "executing";
    const start = performance.now();

    try {
      const exportName = this.capabilityToExport(capability);
      const fn = this.moduleInstance.exports[exportName];

      if (typeof fn !== "function") {
        throw new WasmRuntimeError(`Export "${exportName}" is not a function`, "INVALID_EXPORT");
      }

      // Serialize input to WASM memory
      const inputBytes = new TextEncoder().encode(JSON.stringify(input));
      const inputPtr = this.allocateMemory(inputBytes.length);
      const memoryView = new Uint8Array(this.moduleInstance.memory.buffer);
      memoryView.set(inputBytes, inputPtr);

      // Execute with timeout
      const result = await this.executeWithTimeout(
        () => (fn as Function)(inputPtr, inputBytes.length),
        this.runtimeConfig.maxExecutionTimeMs
      );

      // Read output from WASM memory
      const output = this.readOutput<TOut>(result);

      const durationMs = performance.now() - start;
      this.executionCount++;
      this.totalExecutionMs += durationMs;
      this._state = "registered";

      context.metrics.timing("wasm.execution_time", durationMs, { plugin: this.manifest.id });
      context.metrics.increment("wasm.executions", 1, { plugin: this.manifest.id });

      return { success: true, data: output, durationMs };
    } catch (err) {
      const durationMs = performance.now() - start;
      this._state = "registered";

      return {
        success: false,
        error: {
          code: err instanceof WasmRuntimeError ? err.code : "EXECUTION_ERROR",
          message: String(err),
          retryable: !(err instanceof WasmRuntimeError && err.code === "TIMEOUT"),
        },
        durationMs,
      };
    }
  }

  async healthCheck(): Promise<PluginHealthStatus> {
    const healthy = this.moduleInstance !== null && this._state !== "error";
    return {
      healthy,
      lastCheck: Date.now(),
      latencyMs: this.executionCount > 0 ? this.totalExecutionMs / this.executionCount : 0,
      consecutiveFailures: 0,
      message: healthy ? "OK" : "Module not loaded or in error state",
    };
  }

  async unload(): Promise<void> {
    this._state = "unloading";

    if (this.moduleInstance) {
      // Call cleanup export if available
      const cleanup = this.moduleInstance.exports["_cleanup"];
      if (typeof cleanup === "function") {
        try {
          (cleanup as Function)();
        } catch {
          // Best effort cleanup
        }
      }
      this.moduleInstance = null;
    }

    this._state = "unloaded";
  }

  // --- Internal helpers ---

  private buildHostImports(
    memory: WebAssembly.Memory,
    context: PluginContext
  ): WebAssembly.Imports {
    const imports: WebAssembly.Imports = {
      env: {
        memory,
        log_message: (ptr: number, len: number) => {
          const bytes = new Uint8Array(memory.buffer, ptr, len);
          const message = new TextDecoder().decode(bytes);
          context.logger.info(`[WASM] ${message}`);
        },
        get_time: () => Date.now(),
        abort: (msgPtr: number, filePtr: number, line: number, col: number) => {
          throw new WasmRuntimeError(`WASM abort at ${line}:${col}`, "WASM_ABORT");
        },
      },
    };

    // Merge user-provided host functions
    if (this.runtimeConfig.hostFunctions) {
      for (const [ns, fns] of Object.entries(this.runtimeConfig.hostFunctions)) {
        if (!imports[ns]) imports[ns] = {};
        Object.assign(imports[ns] as Record<string, HostFunction>, fns);
      }
    }

    return imports;
  }

  private async fetchModule(entrypoint: string, context: PluginContext): Promise<ArrayBuffer> {
    if (entrypoint.startsWith("data:")) {
      const base64 = entrypoint.split(",")[1];
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes.buffer;
    }

    const response = await fetch(entrypoint, { signal: context.abortSignal });
    if (!response.ok) {
      throw new WasmRuntimeError(`Failed to fetch WASM module: ${response.status}`, "FETCH_FAILED");
    }
    return response.arrayBuffer();
  }

  private allocateMemory(size: number): number {
    if (!this.moduleInstance) throw new WasmRuntimeError("Module not loaded", "NOT_LOADED");
    const alloc = this.moduleInstance.exports["allocate"];
    if (typeof alloc === "function") {
      return (alloc as Function)(size) as number;
    }
    // Fallback: simple bump allocator at end of used memory
    return 1024;
  }

  private readOutput<T>(resultPtr: unknown): T {
    if (!this.moduleInstance) throw new WasmRuntimeError("Module not loaded", "NOT_LOADED");

    if (typeof resultPtr === "number" && resultPtr > 0) {
      try {
        const view = new Uint8Array(this.moduleInstance.memory.buffer);
        // Read length prefix (4 bytes LE)
        const len = view[resultPtr] | (view[resultPtr + 1] << 8) |
                    (view[resultPtr + 2] << 16) | (view[resultPtr + 3] << 24);
        const bytes = view.slice(resultPtr + 4, resultPtr + 4 + len);
        const json = new TextDecoder().decode(bytes);
        return JSON.parse(json) as T;
      } catch {
        return resultPtr as unknown as T;
      }
    }

    return resultPtr as unknown as T;
  }

  private executeWithTimeout<T>(fn: () => T, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new WasmRuntimeError("WASM execution timed out", "TIMEOUT"));
      }, timeoutMs);

      try {
        const result = fn();
        clearTimeout(timer);
        resolve(result);
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  private capabilityToExport(capability: string): string {
    return capability.replace(/[^a-zA-Z0-9_]/g, "_");
  }
}

// --- WASM Plugin Loader ---

export class WasmPluginLoader implements IPluginLoader {
  readonly kind: PluginKind = "wasm";

  constructor(private defaultConfig: Partial<WasmRuntimeConfig> = {}) {}

  canLoad(manifest: PluginManifest): boolean {
    return manifest.kind === "wasm" && !!manifest.entrypoint;
  }

  async load(manifest: PluginManifest, context: PluginContext): Promise<IPlugin> {
    const config: WasmRuntimeConfig = {
      maxMemoryPages: this.defaultConfig.maxMemoryPages ?? 256,
      maxExecutionTimeMs: this.defaultConfig.maxExecutionTimeMs ?? 30_000,
      enableSIMD: this.defaultConfig.enableSIMD ?? false,
      enableThreads: this.defaultConfig.enableThreads ?? false,
      hostFunctions: this.defaultConfig.hostFunctions,
    };

    const plugin = new WasmPlugin(manifest, config);
    await plugin.load(context);
    return plugin;
  }
}

// --- Error ---

export class WasmRuntimeError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "WasmRuntimeError";
  }
}

// --- Factory ---

export function createWasmLoader(config?: Partial<WasmRuntimeConfig>): WasmPluginLoader {
  return new WasmPluginLoader(config);
}
