import type { Server as HttpServer } from 'http';
import { getOpenClawConfig, type OpenClawConfig } from './config';
import { Logger } from '../lib/logger';
import type { MemorySearchManager, AgentEntry } from './types';
import type { WorkspaceManager } from './workspace/manager';
import type { SessionStore } from './sessions/persistence';

// ── Module-level singleton for cross-module access ──────────────────
export interface OpenClawServices {
  config: OpenClawConfig;
  memory: MemorySearchManager | null;
  workspace: WorkspaceManager | null;
  sessions: SessionStore | null;
  agents: AgentEntry[];
}

let _services: OpenClawServices | null = null;

export function getOpenClawServices(): OpenClawServices | null {
  return _services;
}

// ── Initialization ──────────────────────────────────────────────────
export async function initializeOpenClaw(httpServer: HttpServer): Promise<void> {
  const config = getOpenClawConfig();

  const enabledModules: string[] = [];

  // ── Core gateway ────────────────────────────────────────────────
  if (config.gateway.enabled) {
    const { initGateway } = await import('./gateway/wsServer');
    await initGateway(httpServer, config);
    enabledModules.push('gateway');
  }

  if (config.tools.enabled) {
    const { registerOpenClawTools } = await import('./tools/adapter');
    registerOpenClawTools(config);
    enabledModules.push('tools');
  }

  if (config.plugins.enabled) {
    const { initPlugins } = await import('./plugins/pluginLoader');
    await initPlugins(config);
    enabledModules.push('plugins');
  }

  if (config.skills.enabled) {
    const { initSkills } = await import('./skills/skillLoader');
    await initSkills(config);
    enabledModules.push('skills');
  }

  if (config.streaming.enabled) {
    const { initStreaming } = await import('./streaming/adapter');
    initStreaming(config);
    enabledModules.push('streaming');
  }

  // ── New modules (feature-flagged) ──────────────────────────────

  // 1. Memory / RAG
  let memoryManager: MemorySearchManager | null = null;
  if (config.memory.enabled) {
    try {
      const { createEmbeddingProvider } = await import('./memory/embeddings');
      const { MemoryIndexManager } = await import('./memory/indexManager');

      const embeddingProvider = await createEmbeddingProvider({
        provider: config.memory.embeddingProvider,
        model: config.memory.embeddingModel,
      });

      memoryManager = await MemoryIndexManager.create({
        embeddingProvider,
        config: {
          chunkSize: config.memory.chunkSize,
          chunkOverlap: config.memory.chunkOverlap,
          maxResults: config.memory.maxResults,
          minScore: config.memory.minScore,
          vectorWeight: config.memory.vectorWeight,
          textWeight: config.memory.textWeight,
          mmrEnabled: config.memory.mmrEnabled,
          mmrLambda: config.memory.mmrLambda,
          temporalDecayEnabled: config.memory.temporalDecayEnabled,
          temporalDecayHalfLifeDays: config.memory.temporalDecayHalfLifeDays,
        },
      });

      enabledModules.push('memory');
    } catch (err: any) {
      Logger.warn(`[OpenClaw] Memory module failed to initialize: ${err.message}`);
    }
  }

  // 2. Model Fallback — prepare chain config (runtime wiring in gatewayBridge)
  if (config.modelFallback.enabled) {
    // The fallback module is stateless; config is read at call-time.
    // This flag just signals that the gateway bridge should wrap calls.
    enabledModules.push('modelFallback');
  }

  // 3. Routing — load agent entries (placeholder for YAML loading)
  let agents: AgentEntry[] = [];
  if (config.routing.enabled) {
    try {
      // In the future, load from config.routing.agentsConfigPath (YAML).
      // For now, provide a default agent entry.
      agents = [{
        id: 'default',
        name: 'Default Agent',
        default: true,
        model: 'gemini-2.0-flash',
        skills: [],
        tools: {},
        memorySearch: { enabled: config.memory.enabled },
        identity: { name: 'Sira', persona: 'helpful assistant' },
      }];
      enabledModules.push('routing');
    } catch (err: any) {
      Logger.warn(`[OpenClaw] Routing module failed to initialize: ${err.message}`);
    }
  }

  // 4. Workspace
  let workspaceManager: WorkspaceManager | null = null;
  if (config.workspace.enabled) {
    try {
      const { WorkspaceManager: WM } = await import('./workspace/manager');
      workspaceManager = new WM(config.workspace.directory);
      enabledModules.push('workspace');
    } catch (err: any) {
      Logger.warn(`[OpenClaw] Workspace module failed to initialize: ${err.message}`);
    }
  }

  // 5. Sessions
  let sessionStore: SessionStore | null = null;
  if (config.sessions.enabled) {
    try {
      const { SessionStore: SS } = await import('./sessions/persistence');
      sessionStore = new SS(config.sessions.directory);
      enabledModules.push('sessions');
    } catch (err: any) {
      Logger.warn(`[OpenClaw] Sessions module failed to initialize: ${err.message}`);
    }
  }

  // 6. Register internal hooks plugin
  try {
    const { createInternalHooks } = await import('./plugins/internalHooks');
    const { pluginRegistry } = await import('./plugins/pluginRegistry');
    const internalPlugin = createInternalHooks();
    await pluginRegistry.register(internalPlugin);
  } catch (err: any) {
    Logger.warn(`[OpenClaw] Internal hooks registration failed: ${err.message}`);
  }

  // 7. Discover and load filesystem plugins
  if (config.plugins.enabled) {
    try {
      const { discoverPlugins } = await import('./plugins/pluginFsLoader');
      const { pluginRegistry } = await import('./plugins/pluginRegistry');
      const discovered = discoverPlugins(config.plugins.directory);
      for (const d of discovered) {
        try {
          // Dynamic import of plugin entry point
          const pluginModule = await import(d.entryPoint);
          const plugin = pluginModule.default ?? pluginModule;
          if (plugin && typeof plugin === 'object' && plugin.id) {
            await pluginRegistry.register(plugin);
          }
        } catch (err: any) {
          Logger.warn(`[OpenClaw] Failed to load plugin ${d.id}: ${err.message}`);
        }
      }
    } catch (err: any) {
      Logger.warn(`[OpenClaw] Plugin filesystem discovery failed: ${err.message}`);
    }
  }

  // ── Store services singleton ──────────────────────────────────
  _services = {
    config,
    memory: memoryManager,
    workspace: workspaceManager,
    sessions: sessionStore,
    agents,
  };

  if (enabledModules.length > 0) {
    Logger.info(`[OpenClaw] Initialized: [${enabledModules.join(', ')}]`);
  } else {
    Logger.info('[OpenClaw] All modules disabled (set ENABLE_OPENCLAW_* env vars to enable)');
  }
}
