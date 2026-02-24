// server/openclaw/skills/orchestratorBridge.ts
//
// Bridge between OpenClaw skills/hooks modules and the AgentOrchestrator.
// Provides functions to:
// - Load workspace skills into the skill registry
// - Build a skill-augmented system prompt fragment
// - Dispatch hook events at lifecycle points

import { getOpenClawServices } from '../index';
import { skillRegistry } from './skillRegistry';
import { hookSystem } from '../plugins/hookSystem';
import { loadWorkspaceSkills } from './workspace';
import { filterSkillsForAgent } from './filter';
import type { EnhancedSkill, HookContext } from '../types';
import { Logger } from '../../lib/logger';

let _workspaceSkillsLoaded = false;
let _cachedWorkspaceSkills: EnhancedSkill[] = [];

/**
 * Load workspace skills from disk and register them in the skill registry.
 * Safe to call multiple times — will only load once unless force=true.
 */
export async function loadAndRegisterWorkspaceSkills(opts?: { force?: boolean }): Promise<EnhancedSkill[]> {
  if (_workspaceSkillsLoaded && !opts?.force) {
    return _cachedWorkspaceSkills;
  }

  const services = getOpenClawServices();
  if (!services?.config.skills.enabled) {
    return [];
  }

  try {
    const skills = await loadWorkspaceSkills(services.config.skills.directory);

    for (const skill of skills) {
      if (skill.eligible) {
        skillRegistry.register(skill);
      }
    }

    _workspaceSkillsLoaded = true;
    _cachedWorkspaceSkills = skills;
    Logger.info(`[OpenClaw:Skills] Loaded ${skills.length} workspace skills (${skills.filter(s => s.eligible).length} eligible)`);
    return skills;
  } catch (err: any) {
    Logger.warn(`[OpenClaw:Skills] Failed to load workspace skills: ${err.message}`);
    return [];
  }
}

/**
 * Build a system prompt fragment containing skill instructions for
 * the given set of skill IDs. If no IDs are provided, uses all
 * registered eligible skills.
 */
export function buildSkillPromptFragment(skillIds?: string[]): string | null {
  const services = getOpenClawServices();
  if (!services?.config.skills.enabled) return null;

  const ids = skillIds ?? skillRegistry.list().map(s => s.id);
  if (ids.length === 0) return null;

  const prompt = skillRegistry.getPromptForSkills(ids);
  return prompt || null;
}

/**
 * Get the filtered list of skills for a given agent configuration.
 */
export function getSkillsForAgent(agentId: string): EnhancedSkill[] {
  const services = getOpenClawServices();
  if (!services) return [];

  const agent = services.agents.find(a => a.id === agentId);
  if (!agent) return _cachedWorkspaceSkills.filter(s => s.eligible);

  return filterSkillsForAgent(_cachedWorkspaceSkills, {
    allow: agent.skills,
    deny: [],
  });
}

// ── Hook dispatch helpers ───────────────────────────────────────────

/**
 * Dispatch a session_start hook event.
 */
export async function dispatchSessionStart(ctx: {
  runId: string;
  userId: string;
  sessionKey?: string;
}): Promise<void> {
  await hookSystem.dispatch('session_start', {
    runId: ctx.runId,
    userId: ctx.userId,
    sessionKey: ctx.sessionKey,
  });
}

/**
 * Dispatch an agent_end hook event.
 */
export async function dispatchAgentEnd(ctx: {
  runId: string;
  userId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await hookSystem.dispatch('agent_end', {
    runId: ctx.runId,
    userId: ctx.userId,
    metadata: ctx.metadata,
  });
}

/**
 * Dispatch an error hook event.
 */
export async function dispatchError(ctx: {
  runId?: string;
  userId?: string;
  sessionKey?: string;
  error: Error;
}): Promise<void> {
  await hookSystem.dispatch('error', {
    runId: ctx.runId,
    userId: ctx.userId,
    sessionKey: ctx.sessionKey,
    error: ctx.error,
  });
}
