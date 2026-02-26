import type { Server as HttpServer } from 'http';
import { getOpenClawConfig } from './config';
import { Logger } from '../lib/logger';

export async function initializeOpenClaw(httpServer: HttpServer): Promise<void> {
  const config = getOpenClawConfig();

  const enabledModules: string[] = [];

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

  if (config.commands.enabled) {
    const { registerBuiltinCommands } = await import('./commands/builtinCommands');
    registerBuiltinCommands();
    enabledModules.push('commands');
  }

  if (config.streaming.enabled) {
    const { initStreaming } = await import('./streaming/adapter');
    initStreaming(config);
    enabledModules.push('streaming');
  }

  if (config.sandbox.enabled) {
    const { initSandbox } = await import('./sandbox/index');
    initSandbox(config);
    enabledModules.push('sandbox');
  }

  if (config.advancedMemory.enabled) {
    const { initAdvancedMemory } = await import('./memory/index');
    await initAdvancedMemory(config);
    enabledModules.push('advancedMemory');
  }

  if (config.media.enabled) {
    const { initMedia } = await import('./media/index');
    initMedia(config);
    enabledModules.push('media');
  }

  if (config.mediaUnderstanding.enabled) {
    const { initMediaUnderstanding } = await import('./mediaUnderstanding/index');
    initMediaUnderstanding(config);
    enabledModules.push('mediaUnderstanding');
  }

  if (config.authProfiles.enabled) {
    const { initAuthProfiles } = await import('./authProfiles/index');
    await initAuthProfiles(config);
    enabledModules.push('authProfiles');
  }

  if (enabledModules.length > 0) {
    Logger.info(`[OpenClaw] Initialized: [${enabledModules.join(', ')}]`);
  } else {
    Logger.info('[OpenClaw] All modules disabled (set ENABLE_OPENCLAW_* env vars to enable)');
  }
}
