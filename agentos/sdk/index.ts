// AgentOS SDK - Main exports

// Core
export { Agent, AgentBuilder, createAgent, runMission, AgentSDKError } from "./core/agent-sdk";
export type {
  AgentConfig,
  RetryPolicy,
  MissionConfig,
  MissionRun,
  MissionContext,
  AgentEvent,
} from "./core/agent-sdk";

// Plugin system
export { PluginSystem, PluginRegistry, PluginSystemError, createPluginSystem } from "./plugins/plugin-system";

// Plugin types
export type {
  PluginKind,
  PluginState,
  PluginManifest,
  PluginCapability,
  PluginPermission,
  PluginConfigField,
  PluginDependency,
  PluginContext,
  PluginLogger,
  PluginMetrics,
  PluginExecutionResult,
  PluginError,
  PluginHealthStatus,
  PluginDiscoverySource,
  PluginLifecycleHooks,
  IPlugin,
  IPluginLoader,
  IPluginRegistry,
  JsonSchema,
} from "./plugins/plugin-types";

// WASM runtime
export { WasmPlugin, WasmPluginLoader, WasmRuntimeError, createWasmLoader } from "./wasm/wasm-runtime";
export type { WasmRuntimeConfig, HostFunction, HostFunctionMap } from "./wasm/wasm-runtime";

// gRPC bridge
export { GrpcPlugin, GrpcPluginLoader, GrpcBridgeError, createGrpcLoader } from "./grpc/grpc-bridge";
export type { GrpcBridgeConfig, GrpcEndpoint } from "./grpc/grpc-bridge";
