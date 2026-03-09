import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(() => ({
    plugins: { enabled: true },
  })),
  clearConfigCache: vi.fn(),
  resolveDefaultAgentId: vi.fn(() => "main"),
  resolveAgentWorkspaceDir: vi.fn(() => "/tmp/openclaw-workspace"),
  resolveDefaultAgentWorkspaceDir: vi.fn(() => "/tmp/fallback-workspace"),
  clearPluginManifestRegistryCache: vi.fn(),
  getGlobalHookRunner: vi.fn(() => ({ getHookCount: vi.fn(() => 1) })),
  getGlobalPluginRegistry: vi.fn(() => ({ plugins: [{ id: "plugin-a" }] })),
  getActivePluginRegistryKey: vi.fn(() => "plugin-cache-key"),
  getRegisteredEventKeys: vi.fn(() => ["gateway:startup", "command:new"]),
  loadWorkspaceHookEntries: vi.fn(),
  buildWorkspaceHookStatus: vi.fn(),
  loadOpenClawPlugins: vi.fn(),
}));

vi.mock("../openclaw/src/config/config.ts", () => ({
  loadConfig: mocks.loadConfig,
  clearConfigCache: mocks.clearConfigCache,
}));

vi.mock("../openclaw/src/agents/agent-scope.ts", () => ({
  resolveDefaultAgentId: mocks.resolveDefaultAgentId,
  resolveAgentWorkspaceDir: mocks.resolveAgentWorkspaceDir,
}));

vi.mock("../openclaw/src/agents/workspace.ts", () => ({
  resolveDefaultAgentWorkspaceDir: mocks.resolveDefaultAgentWorkspaceDir,
}));

vi.mock("../openclaw/src/plugins/manifest-registry.ts", () => ({
  clearPluginManifestRegistryCache: mocks.clearPluginManifestRegistryCache,
}));

vi.mock("../openclaw/src/plugins/loader.ts", () => ({
  loadOpenClawPlugins: mocks.loadOpenClawPlugins,
}));

vi.mock("../openclaw/src/plugins/hook-runner-global.ts", () => ({
  getGlobalHookRunner: mocks.getGlobalHookRunner,
  getGlobalPluginRegistry: mocks.getGlobalPluginRegistry,
}));

vi.mock("../openclaw/src/plugins/runtime.ts", () => ({
  getActivePluginRegistryKey: mocks.getActivePluginRegistryKey,
}));

vi.mock("../openclaw/src/hooks/internal-hooks.ts", () => ({
  getRegisteredEventKeys: mocks.getRegisteredEventKeys,
}));

vi.mock("../openclaw/src/hooks/workspace.ts", () => ({
  loadWorkspaceHookEntries: mocks.loadWorkspaceHookEntries,
}));

vi.mock("../openclaw/src/hooks/hooks-status.ts", () => ({
  buildWorkspaceHookStatus: mocks.buildWorkspaceHookStatus,
}));

import { openClawExtensionRuntime } from "./openclawExtensionRuntime";

const pluginHookEntry = {
  hook: {
    name: "plugin-hook",
    description: "Plugin hook",
    source: "openclaw-plugin",
    pluginId: "plugin-a",
    filePath: "/tmp/plugin-a/hook.ts",
    baseDir: "/tmp/plugin-a",
    handlerPath: "/tmp/plugin-a/hook.ts",
  },
  frontmatter: {},
  metadata: {
    events: ["command:new"],
  },
  invocation: { enabled: true },
};

const workspaceHookEntry = {
  hook: {
    name: "workspace-hook",
    description: "Workspace hook",
    source: "/tmp/openclaw-workspace/.openclaw/hooks/workspace-hook.md",
    filePath: "/tmp/openclaw-workspace/.openclaw/hooks/workspace-hook.md",
    baseDir: "/tmp/openclaw-workspace/.openclaw/hooks",
    handlerPath: "/tmp/openclaw-workspace/.openclaw/hooks/workspace-hook.md",
  },
  frontmatter: {},
  metadata: {
    events: ["gateway:startup"],
  },
  invocation: { enabled: true },
};

function createRegistry() {
  return {
    plugins: [
      {
        id: "plugin-a",
        name: "Plugin A",
        source: "/tmp/plugin-a/index.ts",
        origin: "workspace",
        enabled: true,
        status: "loaded",
        toolNames: ["tool-a"],
        hookNames: ["plugin-hook"],
        channelIds: [],
        providerIds: [],
        gatewayMethods: ["plugin.ping"],
        cliCommands: [],
        services: [],
        commands: [],
        httpHandlers: 0,
        hookCount: 1,
        configSchema: true,
      },
      {
        id: "plugin-b",
        name: "Plugin B",
        source: "/tmp/plugin-b/index.ts",
        origin: "workspace",
        enabled: false,
        status: "disabled",
        error: "disabled by config",
        toolNames: [],
        hookNames: [],
        channelIds: [],
        providerIds: [],
        gatewayMethods: [],
        cliCommands: [],
        services: [],
        commands: [],
        httpHandlers: 0,
        hookCount: 0,
        configSchema: true,
      },
    ],
    tools: [{ pluginId: "plugin-a" }],
    hooks: [
      {
        pluginId: "plugin-a",
        entry: pluginHookEntry,
        events: ["command:new"],
        source: "/tmp/plugin-a/hook.ts",
      },
    ],
    typedHooks: [
      {
        hookName: "before_tool_call",
        pluginId: "plugin-a",
        handler: vi.fn(),
      },
      {
        hookName: "before_tool_call",
        pluginId: "plugin-a",
        handler: vi.fn(),
      },
    ],
    channels: [],
    providers: [],
    gatewayHandlers: { "plugin.ping": vi.fn() },
    httpHandlers: [],
    httpRoutes: [],
    cliRegistrars: [],
    services: [],
    commands: [],
    diagnostics: [
      { level: "warn", pluginId: "plugin-b", message: "plugin warning" },
      { level: "error", pluginId: "plugin-a", message: "plugin error" },
    ],
  };
}

describe("openClawExtensionRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadWorkspaceHookEntries.mockReturnValue([workspaceHookEntry]);
    mocks.loadOpenClawPlugins.mockReturnValue(createRegistry());
    mocks.buildWorkspaceHookStatus.mockImplementation((workspaceDir: string, opts?: any) => ({
      workspaceDir,
      managedHooksDir: "/tmp/openclaw-hooks",
      hooks: (opts?.entries ?? []).map((entry: any) => ({
        name: entry.hook.name,
        description: entry.hook.description,
        source: entry.hook.source,
        pluginId: entry.hook.pluginId,
        filePath: entry.hook.filePath,
        baseDir: entry.hook.baseDir,
        handlerPath: entry.hook.handlerPath,
        hookKey: entry.hook.name,
        events: entry.metadata?.events ?? [],
        always: false,
        disabled: false,
        eligible: entry.hook.source === "openclaw-plugin",
        managedByPlugin: entry.hook.source === "openclaw-plugin",
        requirements: { bins: [], anyBins: [], env: [], config: [], os: [] },
        missing: { bins: [], anyBins: [], env: [], config: [], os: [] },
        configChecks: [],
        install: [],
      })),
    }));
  });

  it("builds a combined extensions status snapshot", () => {
    const status = openClawExtensionRuntime.getStatus();

    expect(mocks.loadOpenClawPlugins).toHaveBeenCalledWith({
      config: { plugins: { enabled: true } },
      workspaceDir: "/tmp/openclaw-workspace",
      cache: undefined,
    });
    expect(status.summary.loadedPluginCount).toBe(1);
    expect(status.plugins.counts.typedHooks).toBe(2);
    expect(status.plugins.diagnostics.errors).toBe(1);
    expect(status.hooks.internalHookKeys).toEqual(["command:new", "gateway:startup"]);
    expect(status.hooks.counts.hooks).toBe(2);
    expect(status.hooks.counts.pluginManagedHooks).toBe(1);
    expect(status.hooks.counts.missingRequirementsHooks).toBe(1);

    const mergedEntries = mocks.buildWorkspaceHookStatus.mock.calls[0]?.[1]?.entries;
    expect(Array.isArray(mergedEntries)).toBe(true);
    expect(mergedEntries).toHaveLength(2);
  });

  it("clears config and manifest caches on reload", () => {
    const reloaded = openClawExtensionRuntime.reload();

    expect(mocks.clearConfigCache).toHaveBeenCalledTimes(1);
    expect(mocks.clearPluginManifestRegistryCache).toHaveBeenCalledTimes(1);
    expect(mocks.loadOpenClawPlugins).toHaveBeenCalledWith({
      config: { plugins: { enabled: true } },
      workspaceDir: "/tmp/openclaw-workspace",
      cache: false,
    });
    expect(reloaded.reloaded).toBe(true);
    expect(reloaded.plugins.cacheKey).toBe("plugin-cache-key");
  });
});
