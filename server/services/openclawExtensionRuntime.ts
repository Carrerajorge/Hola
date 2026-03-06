import {
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "../openclaw/src/agents/agent-scope.ts";
import { resolveDefaultAgentWorkspaceDir } from "../openclaw/src/agents/workspace.ts";
import { clearConfigCache, loadConfig } from "../openclaw/src/config/config.ts";
import { getRegisteredEventKeys } from "../openclaw/src/hooks/internal-hooks.ts";
import {
  buildWorkspaceHookStatus,
  type HookStatusEntry,
} from "../openclaw/src/hooks/hooks-status.ts";
import type { HookEntry } from "../openclaw/src/hooks/types.ts";
import { loadWorkspaceHookEntries } from "../openclaw/src/hooks/workspace.ts";
import { clearPluginManifestRegistryCache } from "../openclaw/src/plugins/manifest-registry.ts";
import { loadOpenClawPlugins } from "../openclaw/src/plugins/loader.ts";
import {
  getGlobalHookRunner,
  getGlobalPluginRegistry,
} from "../openclaw/src/plugins/hook-runner-global.ts";
import type { PluginDiagnostic } from "../openclaw/src/plugins/types.ts";
import { getActivePluginRegistryKey } from "../openclaw/src/plugins/runtime.ts";
import type { PluginRecord, PluginRegistry } from "../openclaw/src/plugins/registry.ts";

type HookCountMap = Record<string, number>;

type RuntimeContext = {
  config: ReturnType<typeof loadConfig>;
  workspaceDir: string;
  registry: PluginRegistry;
};

export type OpenClawPluginRuntimeStatus = {
  workspaceDir: string;
  pluginsEnabled: boolean;
  cacheKey: string | null;
  globalRegistryLoaded: boolean;
  hookRunnerInitialized: boolean;
  counts: {
    plugins: number;
    loadedPlugins: number;
    disabledPlugins: number;
    failedPlugins: number;
    tools: number;
    hooks: number;
    typedHooks: number;
    channels: number;
    providers: number;
    gatewayHandlers: number;
    httpHandlers: number;
    httpRoutes: number;
    cliRegistrars: number;
    services: number;
    commands: number;
  };
  diagnostics: {
    total: number;
    warnings: number;
    errors: number;
    entries: PluginDiagnostic[];
  };
  activePluginIds: string[];
  typedHookCounts: HookCountMap;
  plugins: PluginRecord[];
};

export type OpenClawHookRuntimeStatus = {
  workspaceDir: string;
  managedHooksDir: string;
  hookRunnerInitialized: boolean;
  globalRegistryLoaded: boolean;
  internalHookKeys: string[];
  typedHookCounts: HookCountMap;
  counts: {
    hooks: number;
    pluginManagedHooks: number;
    workspaceManagedHooks: number;
    eligibleHooks: number;
    disabledHooks: number;
    missingRequirementsHooks: number;
    internalHookKeys: number;
    typedHookNames: number;
  };
  hooks: HookStatusEntry[];
};

export type OpenClawExtensionsSummary = {
  workspaceDir: string;
  pluginsEnabled: boolean;
  pluginCount: number;
  loadedPluginCount: number;
  failedPluginCount: number;
  pluginDiagnostics: number;
  pluginErrors: number;
  hookCount: number;
  eligibleHookCount: number;
  internalHookKeyCount: number;
  typedHookNames: string[];
  hookRunnerInitialized: boolean;
};

export type OpenClawExtensionsStatus = {
  summary: OpenClawExtensionsSummary;
  plugins: OpenClawPluginRuntimeStatus;
  hooks: OpenClawHookRuntimeStatus;
};

function resolveWorkspaceDir(config: ReturnType<typeof loadConfig>): string {
  return (
    resolveAgentWorkspaceDir(config, resolveDefaultAgentId(config)) ??
    resolveDefaultAgentWorkspaceDir()
  );
}

function loadRuntimeContext(options?: { cache?: boolean }): RuntimeContext {
  const config = loadConfig();
  const workspaceDir = resolveWorkspaceDir(config);
  const registry = loadOpenClawPlugins({
    config,
    workspaceDir,
    cache: options?.cache,
  });
  return { config, workspaceDir, registry };
}

function countDiagnostics(diagnostics: PluginDiagnostic[]) {
  const warnings = diagnostics.filter((entry) => entry.level === "warn").length;
  const errors = diagnostics.filter((entry) => entry.level === "error").length;
  return {
    total: diagnostics.length,
    warnings,
    errors,
    entries: diagnostics,
  };
}

function countTypedHooks(registry: PluginRegistry): HookCountMap {
  const counts = new Map<string, number>();
  for (const hook of registry.typedHooks) {
    const name = String(hook.hookName);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function mergeHookEntries(pluginEntries: HookEntry[], workspaceEntries: HookEntry[]): HookEntry[] {
  const merged = new Map<string, HookEntry>();
  for (const entry of pluginEntries) {
    merged.set(entry.hook.name, entry);
  }
  for (const entry of workspaceEntries) {
    merged.set(entry.hook.name, entry);
  }
  return [...merged.values()].sort((a, b) => a.hook.name.localeCompare(b.hook.name));
}

function buildPluginStatus(context: RuntimeContext): OpenClawPluginRuntimeStatus {
  const diagnostics = countDiagnostics(context.registry.diagnostics);
  const loadedPlugins = context.registry.plugins.filter((plugin) => plugin.status === "loaded");
  const disabledPlugins = context.registry.plugins.filter((plugin) => plugin.status === "disabled");
  const failedPlugins = context.registry.plugins.filter((plugin) => plugin.status === "error");
  const typedHookCounts = countTypedHooks(context.registry);

  return {
    workspaceDir: context.workspaceDir,
    pluginsEnabled: context.config.plugins?.enabled === true,
    cacheKey: getActivePluginRegistryKey(),
    globalRegistryLoaded: Boolean(getGlobalPluginRegistry()),
    hookRunnerInitialized: Boolean(getGlobalHookRunner()),
    counts: {
      plugins: context.registry.plugins.length,
      loadedPlugins: loadedPlugins.length,
      disabledPlugins: disabledPlugins.length,
      failedPlugins: failedPlugins.length,
      tools: context.registry.tools.length,
      hooks: context.registry.hooks.length,
      typedHooks: context.registry.typedHooks.length,
      channels: context.registry.channels.length,
      providers: context.registry.providers.length,
      gatewayHandlers: Object.keys(context.registry.gatewayHandlers).length,
      httpHandlers: context.registry.httpHandlers.length,
      httpRoutes: context.registry.httpRoutes.length,
      cliRegistrars: context.registry.cliRegistrars.length,
      services: context.registry.services.length,
      commands: context.registry.commands.length,
    },
    diagnostics,
    activePluginIds: loadedPlugins.map((plugin) => plugin.id),
    typedHookCounts,
    plugins: context.registry.plugins,
  };
}

function buildHookStatus(context: RuntimeContext): OpenClawHookRuntimeStatus {
  const pluginEntries = context.registry.hooks.map((hook) => hook.entry);
  const workspaceEntries = loadWorkspaceHookEntries(context.workspaceDir, {
    config: context.config,
  });
  const hooksReport = buildWorkspaceHookStatus(context.workspaceDir, {
    config: context.config,
    entries: mergeHookEntries(pluginEntries, workspaceEntries),
  });
  const internalHookKeys = getRegisteredEventKeys().sort();
  const typedHookCounts = countTypedHooks(context.registry);
  const pluginManagedHooks = hooksReport.hooks.filter((hook) => hook.managedByPlugin).length;
  const disabledHooks = hooksReport.hooks.filter((hook) => hook.disabled).length;
  const eligibleHooks = hooksReport.hooks.filter((hook) => hook.eligible).length;
  const missingRequirementsHooks = hooksReport.hooks.filter(
    (hook) => !hook.disabled && !hook.eligible,
  ).length;

  return {
    workspaceDir: context.workspaceDir,
    managedHooksDir: hooksReport.managedHooksDir,
    hookRunnerInitialized: Boolean(getGlobalHookRunner()),
    globalRegistryLoaded: Boolean(getGlobalPluginRegistry()),
    internalHookKeys,
    typedHookCounts,
    counts: {
      hooks: hooksReport.hooks.length,
      pluginManagedHooks,
      workspaceManagedHooks: hooksReport.hooks.length - pluginManagedHooks,
      eligibleHooks,
      disabledHooks,
      missingRequirementsHooks,
      internalHookKeys: internalHookKeys.length,
      typedHookNames: Object.keys(typedHookCounts).length,
    },
    hooks: hooksReport.hooks,
  };
}

function buildSummary(params: {
  workspaceDir: string;
  config: RuntimeContext["config"];
  plugins: OpenClawPluginRuntimeStatus;
  hooks: OpenClawHookRuntimeStatus;
}): OpenClawExtensionsSummary {
  return {
    workspaceDir: params.workspaceDir,
    pluginsEnabled: params.config.plugins?.enabled === true,
    pluginCount: params.plugins.counts.plugins,
    loadedPluginCount: params.plugins.counts.loadedPlugins,
    failedPluginCount: params.plugins.counts.failedPlugins,
    pluginDiagnostics: params.plugins.diagnostics.total,
    pluginErrors: params.plugins.diagnostics.errors,
    hookCount: params.hooks.counts.hooks,
    eligibleHookCount: params.hooks.counts.eligibleHooks,
    internalHookKeyCount: params.hooks.counts.internalHookKeys,
    typedHookNames: Object.keys(params.hooks.typedHookCounts),
    hookRunnerInitialized: params.hooks.hookRunnerInitialized,
  };
}

function collectStatus(options?: { cache?: boolean }): OpenClawExtensionsStatus {
  const context = loadRuntimeContext({ cache: options?.cache });
  const plugins = buildPluginStatus(context);
  const hooks = buildHookStatus(context);
  return {
    summary: buildSummary({
      workspaceDir: context.workspaceDir,
      config: context.config,
      plugins,
      hooks,
    }),
    plugins,
    hooks,
  };
}

export const openClawExtensionRuntime = {
  getSummary(): OpenClawExtensionsSummary {
    const context = loadRuntimeContext();
    const plugins = buildPluginStatus(context);
    const hooks = buildHookStatus(context);
    return buildSummary({
      workspaceDir: context.workspaceDir,
      config: context.config,
      plugins,
      hooks,
    });
  },

  getStatus(): OpenClawExtensionsStatus {
    return collectStatus();
  },

  getPluginStatus(): OpenClawPluginRuntimeStatus {
    return buildPluginStatus(loadRuntimeContext());
  },

  getHookStatus(): OpenClawHookRuntimeStatus {
    return buildHookStatus(loadRuntimeContext());
  },

  reload(): OpenClawExtensionsStatus & { reloaded: true; reloadedAt: string } {
    clearConfigCache();
    clearPluginManifestRegistryCache();
    const status = collectStatus({ cache: false });
    return {
      reloaded: true,
      reloadedAt: new Date().toISOString(),
      ...status,
    };
  },
};
