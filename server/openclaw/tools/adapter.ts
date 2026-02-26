import { toolRegistry } from '../../agent/toolRegistry';
import type { OpenClawConfig } from '../config';
import { createExecTool } from './execTool';
import { createFsTools } from './fsTool';
import { createAgenticTools } from './agenticTools';
import { createDocumentIngestTool, createDocumentBatchIngestTool } from './documentIngestTool';
import { createBrowserTools } from './browserTool';
import { createCronTool } from './cronTool';
import { createMemoryTool } from './memoryTool';
import { createSessionTools } from './sessionTools';
import { createMessageRoutingTool } from './messageRoutingTool';
import { createAdvancedMemoryTools } from './advancedMemoryTools';
import { createMediaUnderstandingTools } from './mediaUnderstandingTools';
import { createAuthProfileTools } from './authProfileTools';
import { ToolPolicyEngine } from './toolPolicies';
import { Logger } from '../../lib/logger';

export function registerOpenClawTools(config: OpenClawConfig): void {
  const policy = new ToolPolicyEngine({
    safeBins: config.tools.safeBins,
    security: config.tools.execSecurity,
    timeout: config.tools.execTimeout,
  });

  let registered = 0;

  const safeRegister = (tool: any) => {
    try {
      toolRegistry.register(tool);
      registered++;
      Logger.info(`[OpenClaw:Tools] Registered: ${tool.name}`);
    } catch (err) {
      Logger.warn(`[OpenClaw:Tools] Failed to register ${tool.name}: ${(err as Error).message}`);
    }
  };

  // Core: exec + filesystem
  safeRegister(createExecTool(policy, config.tools.workspaceRoot));
  for (const tool of createFsTools(config.tools.workspaceRoot, true)) {
    safeRegister(tool);
  }

  // Agentic: subagents + RAG bridge
  for (const tool of createAgenticTools()) {
    safeRegister(tool);
  }

  // Document ingestion (single + batch)
  safeRegister(createDocumentIngestTool());
  safeRegister(createDocumentBatchIngestTool());

  // Browser automation
  for (const tool of createBrowserTools()) {
    safeRegister(tool);
  }

  // Cron/Scheduling
  safeRegister(createCronTool());

  // Persistent Memory
  safeRegister(createMemoryTool());

  // Session Management (list, spawn, send, history)
  for (const tool of createSessionTools()) {
    safeRegister(tool);
  }

  // Message Routing (channel-agnostic)
  safeRegister(createMessageRoutingTool());

  // Advanced Memory (hybrid vector+FTS search, indexing, stats)
  if (config.advancedMemory.enabled) {
    for (const tool of createAdvancedMemoryTools()) {
      safeRegister(tool);
    }
  }

  // Media Understanding (image description, audio transcription, video description)
  if (config.mediaUnderstanding.enabled) {
    for (const tool of createMediaUnderstandingTools()) {
      safeRegister(tool);
    }
  }

  // Auth Profiles (credential rotation, cooldown management)
  if (config.authProfiles.enabled) {
    for (const tool of createAuthProfileTools()) {
      safeRegister(tool);
    }
  }

  Logger.info(`[OpenClaw:Tools] ${registered} tools registered successfully`);
}
