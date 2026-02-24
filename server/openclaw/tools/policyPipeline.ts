import type { ToolPolicyStep } from '../types';

interface PolicyDecision {
  allowed: boolean;
  deniedBy?: string;
}

export function buildPolicyPipeline(steps: ToolPolicyStep[]): ToolPolicyStep[] {
  return steps.filter(s => s.policy !== null);
}

export function applyPolicyPipeline(toolName: string, pipeline: ToolPolicyStep[]): PolicyDecision {
  for (const step of pipeline) {
    if (!step.policy) continue;

    // Check denylist first
    if (step.policy.deny && step.policy.deny.includes(toolName)) {
      return { allowed: false, deniedBy: step.label };
    }

    // Check allowlist (if present, tool must be in it)
    if (step.policy.allow && !step.policy.allow.includes(toolName)) {
      return { allowed: false, deniedBy: step.label };
    }
  }

  return { allowed: true };
}
