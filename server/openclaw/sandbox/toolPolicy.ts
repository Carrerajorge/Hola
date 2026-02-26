/**
 * Sandbox tool policy engine.
 * Ported from upstream OpenClaw v2026.2.24: src/agents/sandbox/tool-policy.ts
 *
 * Glob-based allow/deny lists for commands inside sandboxed containers.
 * Complements (does NOT replace) our existing ToolPolicyEngine in tools/toolPolicies.ts.
 */

import type { SandboxToolPolicy } from './types';

/**
 * Simple glob matcher supporting * and ? wildcards.
 * No external dependencies — upstream used a separate glob-pattern module.
 */
function globMatch(pattern: string, input: string): boolean {
  // Convert glob pattern to regex
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // escape regex special chars
    .replace(/\*/g, '.*')                    // * → .*
    .replace(/\?/g, '.');                    // ? → .
  return new RegExp(`^${escaped}$`, 'i').test(input);
}

/**
 * Check if a tool/command name is allowed by the sandbox policy.
 *
 * Resolution order:
 * 1. If deny list has a match → blocked (deny wins over allow)
 * 2. If allow list exists and has a match → allowed
 * 3. If allow list exists but NO match → blocked (allowlist acts as whitelist)
 * 4. If no allow list → allowed (open by default)
 */
export function isToolAllowed(policy: SandboxToolPolicy, toolName: string): boolean {
  // Step 1: Check deny list first (deny always wins)
  if (policy.deny && policy.deny.length > 0) {
    if (policy.deny.some(pattern => globMatch(pattern, toolName))) {
      return false;
    }
  }

  // Step 2-4: Check allow list
  if (policy.allow && policy.allow.length > 0) {
    return policy.allow.some(pattern => globMatch(pattern, toolName));
  }

  // No allow list = open policy
  return true;
}

/**
 * Resolve the effective tool policy from multiple layers.
 * More specific policies (agent-level) override broader ones (global).
 *
 * @param agentPolicy - Agent-specific policy (most specific)
 * @param globalPolicy - Global sandbox policy (fallback)
 * @returns Merged policy (agent overrides global)
 */
export function resolveToolPolicy(
  agentPolicy?: SandboxToolPolicy,
  globalPolicy?: SandboxToolPolicy,
): SandboxToolPolicy {
  if (!agentPolicy && !globalPolicy) {
    return {}; // no restrictions
  }

  if (!agentPolicy) {
    return globalPolicy!;
  }

  if (!globalPolicy) {
    return agentPolicy;
  }

  // Merge: agent-specific lists extend global lists
  return {
    allow: agentPolicy.allow ?? globalPolicy.allow,
    deny: [
      ...(globalPolicy.deny ?? []),
      ...(agentPolicy.deny ?? []),
    ],
  };
}

/**
 * Filter a list of tool names through a policy, returning only allowed ones.
 */
export function filterAllowedTools(policy: SandboxToolPolicy, toolNames: string[]): string[] {
  return toolNames.filter(name => isToolAllowed(policy, name));
}
