/**
 * Tool Policy Layer
 *
 * Per-agent tool access control with allow/deny lists, wildcard matching,
 * and owner-only enforcement. Ported from OpenClaw's tool-policy.ts,
 * combined with ILIAGPT's circuit breaker integration point.
 */

export interface ToolPolicy {
    agentId: string;
    allow?: string[];
    deny?: string[];
    ownerOnlyTools?: string[];
}

export interface ToolPolicyCheckResult {
    allowed: boolean;
    reason?: 'allowed' | 'denied_by_policy' | 'owner_only' | 'not_in_allowlist';
    toolName: string;
}

const TOOL_GROUPS: Record<string, string[]> = {
    '@search-tools': ['web_search', 'search_semantic', 'memory_retrieve'],
    '@file-tools': ['file_write', 'file_read', 'list_files'],
    '@code-tools': ['code_execute', 'code_generate', 'code_review'],
    '@admin-tools': ['create_user', 'delete_user', 'update_user', 'change_role'],
};

/**
 * Expand group references (e.g. `@search-tools`) into individual tool names.
 */
export function expandGroups(list: string[]): string[] {
    const expanded: string[] = [];
    for (const item of list) {
        if (item.startsWith('@') && TOOL_GROUPS[item]) {
            expanded.push(...TOOL_GROUPS[item]);
        } else {
            expanded.push(item);
        }
    }
    return expanded;
}

/**
 * Check if a tool name matches a pattern (supports wildcards).
 */
export function matchesPattern(toolName: string, pattern: string): boolean {
    if (!pattern.includes('*')) return toolName === pattern;
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return regex.test(toolName);
}

function matchesAnyPattern(toolName: string, patterns: string[]): boolean {
    return expandGroups(patterns).some(p => matchesPattern(toolName, p));
}

/**
 * Evaluate whether a tool is allowed under the given policy.
 *
 * Order (ported from OpenClaw):
 * 1. Deny list (deny always wins)
 * 2. Owner-only check
 * 3. Allow list (if present, tool must match)
 * 4. Default: allow
 */
export function evaluateToolPolicy(
    toolName: string,
    policy: ToolPolicy,
    isOwner: boolean = false,
): ToolPolicyCheckResult {
    // 1. Check deny list first
    if (policy.deny && matchesAnyPattern(toolName, policy.deny)) {
        return { allowed: false, reason: 'denied_by_policy', toolName };
    }

    // 2. Check owner-only
    if (policy.ownerOnlyTools && matchesAnyPattern(toolName, policy.ownerOnlyTools)) {
        if (!isOwner) {
            return { allowed: false, reason: 'owner_only', toolName };
        }
    }

    // 3. Check allow list (if specified, must match)
    if (policy.allow) {
        if (matchesAnyPattern(toolName, policy.allow)) {
            return { allowed: true, reason: 'allowed', toolName };
        }
        return { allowed: false, reason: 'not_in_allowlist', toolName };
    }

    // 4. No allow list → allow by default
    return { allowed: true, reason: 'allowed', toolName };
}

export class ToolPolicyEngine {
    private policies: Map<string, ToolPolicy> = new Map();

    setPolicy(agentId: string, policy: ToolPolicy): void {
        this.policies.set(agentId, policy);
    }

    getPolicy(agentId: string): ToolPolicy | undefined {
        return this.policies.get(agentId);
    }

    check(agentId: string, toolName: string, isOwner: boolean): ToolPolicyCheckResult {
        const policy = this.policies.get(agentId);
        if (!policy) return { allowed: true, reason: 'allowed', toolName };
        return evaluateToolPolicy(toolName, policy, isOwner);
    }

    removePolicy(agentId: string): void {
        this.policies.delete(agentId);
    }
}

export const toolPolicyEngine = new ToolPolicyEngine();
