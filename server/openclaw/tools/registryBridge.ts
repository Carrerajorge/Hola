// server/openclaw/tools/registryBridge.ts
//
// Bridge between the OpenClaw tool policy pipeline and the existing
// tool registry. Provides a function that runs a tool name through
// the OpenClaw policy pipeline (agent-level allow/deny + profile) before
// the existing policyEngine check runs.
//
// This is an additive layer: the existing policyEngine remains the
// authority; this bridge adds OpenClaw-specific restrictions on top.

import { getOpenClawServices } from '../index';
import { buildPolicyPipeline, applyPolicyPipeline } from './policyPipeline';
import { getToolProfile } from './toolProfiles';
import type { ToolPolicyStep, ToolProfileId } from '../types';

/**
 * Check if a tool is allowed by the OpenClaw policy pipeline.
 *
 * The pipeline layers:
 *  1. Agent-level allow/deny (from agent config)
 *  2. Tool profile (from agent or default)
 *
 * @returns { allowed: true } if no OpenClaw restrictions apply,
 *          { allowed: false, deniedBy } if the tool is blocked.
 */
export function checkOpenClawToolPolicy(
  toolName: string,
  opts?: { agentId?: string; profileId?: ToolProfileId },
): { allowed: boolean; deniedBy?: string } {
  const services = getOpenClawServices();
  if (!services?.config.tools.enabled) {
    // OpenClaw tools module not enabled — allow everything
    return { allowed: true };
  }

  const steps: ToolPolicyStep[] = [];

  // Layer 1: Agent-level policy (allow/deny from agent config)
  if (opts?.agentId) {
    const agent = services.agents.find(a => a.id === opts.agentId);
    if (agent?.tools) {
      steps.push({
        label: `agent:${agent.id}`,
        policy: agent.tools,
      });
    }
  }

  // Layer 2: Tool profile
  if (opts?.profileId) {
    const profile = getToolProfile(opts.profileId);
    steps.push({
      label: `profile:${opts.profileId}`,
      policy: profile,
    });
  }

  // If no steps, nothing to check
  if (steps.length === 0) {
    return { allowed: true };
  }

  const pipeline = buildPolicyPipeline(steps);
  return applyPolicyPipeline(toolName, pipeline);
}

/**
 * Build a full policy pipeline for a given agent configuration.
 * Returns a reusable pipeline that can be applied to multiple tool names.
 */
export function buildAgentPolicyPipeline(agentId: string, profileId?: ToolProfileId): ToolPolicyStep[] {
  const services = getOpenClawServices();
  if (!services) return [];

  const steps: ToolPolicyStep[] = [];

  const agent = services.agents.find(a => a.id === agentId);
  if (agent?.tools) {
    steps.push({
      label: `agent:${agent.id}`,
      policy: agent.tools,
    });
  }

  if (profileId) {
    const profile = getToolProfile(profileId);
    steps.push({
      label: `profile:${profileId}`,
      policy: profile,
    });
  }

  return buildPolicyPipeline(steps);
}
