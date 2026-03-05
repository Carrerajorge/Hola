/**
 * SuperAgent Module — Entry Point
 *
 * The SuperAgent transforms ILIAGPT into a first-class AI agency platform
 * that can do anything: background tasks, browser automation, tool integration,
 * content creation, and multi-model orchestration.
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────┐
 * │              SuperAgent Orchestrator                 │
 * │         (Opus 4.6 as main brain)                    │
 * ├─────────┬──────────┬──────────┬──────────┬─────────┤
 * │ Research│  Speed   │  Memory  │  Image   │  Video  │
 * │ Gemini  │  Grok    │ ChatGPT  │  Nano    │  Veo    │
 * │ 2.5 Pro │  3       │  5.2     │ Banana   │  3.1    │
 * ├─────────┴──────────┴──────────┴──────────┴─────────┤
 * │              Core Engines                           │
 * │ ┌────────────┐ ┌──────────────┐ ┌────────────────┐ │
 * │ │ Background │ │   Browser    │ │     Tool       │ │
 * │ │   Tasks    │ │  Automation  │ │  Connectors    │ │
 * │ └────────────┘ └──────────────┘ └────────────────┘ │
 * │ ┌────────────┐ ┌──────────────┐ ┌────────────────┐ │
 * │ │  Creation  │ │  Open Source │ │   OpenClaw     │ │
 * │ │  Engine    │ │ Integrations │ │   v2026.3.2    │ │
 * │ └────────────┘ └──────────────┘ └────────────────┘ │
 * └─────────────────────────────────────────────────────┘
 *
 * @version 2.3.0-superagent
 * @license MIT
 */

import { Logger } from '../../lib/logger';
import { FEATURE_FLAGS, OPENCLAW_CONFIG } from '../../openclaw.config';

import { multiModelOrchestrator, type TaskRequest } from './multiModelOrchestrator';
import { backgroundTaskEngine, type BackgroundTask } from './backgroundTaskEngine';
import { browserAutomationEngine, type ResearchQuery } from './browserAutomationEngine';
import { toolConnectorFramework } from './toolConnectorFramework';
import { creationEngine, type CreationRequest } from './creationEngine';
import { openSourceRegistry } from './openSourceIntegrations';

export interface SuperAgentStatus {
  version: string;
  openclawVersion: string;
  enabled: boolean;
  engines: {
    multiModel: ReturnType<typeof multiModelOrchestrator.getStats>;
    backgroundTasks: ReturnType<typeof backgroundTaskEngine.getStats>;
    browserAutomation: ReturnType<typeof browserAutomationEngine.getStats>;
    toolConnectors: ReturnType<typeof toolConnectorFramework.getStats>;
    creationEngine: ReturnType<typeof creationEngine.getStats>;
    openSourceIntegrations: ReturnType<typeof openSourceRegistry.getStats>;
  };
  features: typeof FEATURE_FLAGS;
}

export async function initSuperAgent(): Promise<void> {
  const enabledEngines: string[] = [];

  if (FEATURE_FLAGS.ENABLE_MULTI_MODEL_ORCHESTRATION) {
    enabledEngines.push(`multiModel(${Object.keys(OPENCLAW_CONFIG.models).length} models)`);
  }

  if (FEATURE_FLAGS.ENABLE_BACKGROUND_TASKS) {
    enabledEngines.push('backgroundTasks');
  }

  if (FEATURE_FLAGS.ENABLE_BROWSER_AUTOMATION) {
    enabledEngines.push('browserAutomation');
  }

  if (FEATURE_FLAGS.ENABLE_TOOL_CONNECTORS) {
    const connectors = toolConnectorFramework.listConnectors();
    enabledEngines.push(`toolConnectors(${connectors.length} connectors)`);
  }

  if (FEATURE_FLAGS.ENABLE_CREATION_ENGINE) {
    enabledEngines.push('creationEngine');
  }

  if (FEATURE_FLAGS.ENABLE_IMAGE_GENERATION) {
    enabledEngines.push('imageGen(nano-banana)');
  }

  if (FEATURE_FLAGS.ENABLE_VIDEO_GENERATION) {
    enabledEngines.push('videoGen(veo-3.1)');
  }

  if (FEATURE_FLAGS.ENABLE_LONG_TERM_MEMORY) {
    enabledEngines.push('longTermMemory(chatgpt-5.2)');
  }

  const ossIntegrated = openSourceRegistry.listByStatus('integrated');
  enabledEngines.push(`openSource(${ossIntegrated.length} integrated)`);

  Logger.info(`[SuperAgent] v${OPENCLAW_CONFIG.version} initialized with OpenClaw v${OPENCLAW_CONFIG.openclawVersion}`);
  Logger.info(`[SuperAgent] Engines: [${enabledEngines.join(', ')}]`);
}

export function getSuperAgentStatus(): SuperAgentStatus {
  return {
    version: OPENCLAW_CONFIG.version,
    openclawVersion: OPENCLAW_CONFIG.openclawVersion,
    enabled: true,
    engines: {
      multiModel: multiModelOrchestrator.getStats(),
      backgroundTasks: backgroundTaskEngine.getStats(),
      browserAutomation: browserAutomationEngine.getStats(),
      toolConnectors: toolConnectorFramework.getStats(),
      creationEngine: creationEngine.getStats(),
      openSourceIntegrations: openSourceRegistry.getStats(),
    },
    features: FEATURE_FLAGS,
  };
}

// Re-export all engines for direct access
export { multiModelOrchestrator } from './multiModelOrchestrator';
export { backgroundTaskEngine } from './backgroundTaskEngine';
export { browserAutomationEngine } from './browserAutomationEngine';
export { toolConnectorFramework } from './toolConnectorFramework';
export { creationEngine } from './creationEngine';
export { openSourceRegistry } from './openSourceIntegrations';

// Re-export types
export type { TaskRequest, TaskResult, TaskType } from './multiModelOrchestrator';
export type { BackgroundTask, TaskExecution, ScheduleType } from './backgroundTaskEngine';
export type { ResearchQuery, ResearchResult, BrowserSession } from './browserAutomationEngine';
export type { ConnectorDefinition, ConnectorCategory, ConnectorExecution } from './toolConnectorFramework';
export type { CreationRequest, CreationResult, CreationType } from './creationEngine';
export type { OpenSourceProject, IntegrationCategory } from './openSourceIntegrations';
