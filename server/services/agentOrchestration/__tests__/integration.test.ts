import { describe, it, expect, beforeEach } from 'vitest';
import { HookSystem } from '../hookSystem';
import type { HookContext, HookResult } from '../hookSystem';
import { MultiAgentRouter } from '../multiAgentRouter';
import type { AgentConfig } from '../multiAgentRouter';
import { SessionManager, buildSessionKey, parseSessionKey } from '../sessionManager';
import type { SessionMessage } from '../sessionManager';
import { ToolPolicyEngine, evaluateToolPolicy, expandGroups } from '../toolPolicy';
import type { ToolPolicy } from '../toolPolicy';
import { shouldIncludeSkill, buildSkillSnapshot } from '../skillDiscovery';
import type { SkillEntry, SkillEligibilityContext } from '../skillDiscovery';
import { EnhancedExecutor, classifyError } from '../enhancedExecutor';

const defaultAgent: AgentConfig = {
    id: 'default-agent',
    name: 'Default',
    modelPrimary: 'grok-3',
    modelFallbacks: ['gemini-2.0-flash'],
    skills: [],
    toolPolicy: {},
    maxRetries: 3,
    timeoutMs: 30_000,
};

const eligibility: SkillEligibilityContext = {
    platform: 'darwin',
    availableBins: new Set(['git', 'node']),
    availableEnvVars: new Set(['HOME', 'OPENAI_API_KEY']),
};

describe('Integration: Cross-Layer Agent Orchestration', () => {
    let hookSystem: HookSystem;
    let router: MultiAgentRouter;
    let sessionManager: SessionManager;
    let policyEngine: ToolPolicyEngine;
    let executor: EnhancedExecutor;

    beforeEach(() => {
        hookSystem = new HookSystem();
        router = new MultiAgentRouter(defaultAgent);
        sessionManager = new SessionManager();
        policyEngine = new ToolPolicyEngine();
        executor = new EnhancedExecutor();
    });

    // 1. Full routing flow: PARE result → MultiAgentRouter → correct agent selected
    it('1. Full routing flow selects correct agent based on intent', () => {
        router.addBinding({
            id: 'code-binding',
            agentId: 'code-agent',
            priority: 50,
            match: { intentCategory: 'code_generation' },
            agentConfig: { ...defaultAgent, id: 'code-agent', name: 'Code Agent' },
            isActive: true,
        });

        const route = router.resolveRoute({
            userId: 'user-1',
            source: 'web',
            intentCategory: 'code_generation',
        });

        expect(route.agentId).toBe('code-agent');
        expect(route.sessionKey).toBe('agent:code-agent:direct:user-1');
        expect(route.matchedBy).toBe('intent');
    });

    // 2. Routing with hooks: before_route hook modifies routing decision
    it('2. before_route hook can influence routing by modifying context', async () => {
        const hookResults: string[] = [];

        hookSystem.register({
            id: 'route-hook',
            name: 'Route Logger',
            event: 'before_route',
            priority: 1,
            enabled: true,
            handler: async (ctx) => {
                hookResults.push(`routing:${ctx.userId}:${ctx.data.source}`);
                return { modified: true, overrides: { preferredAgent: 'vip-agent' } };
            },
        });

        const result = await hookSystem.emit({
            event: 'before_route',
            agentId: '',
            sessionKey: '',
            userId: 'user-42',
            data: { source: 'whatsapp' },
        });

        expect(hookResults).toEqual(['routing:user-42:whatsapp']);
        expect(result.modified).toBe(true);
        expect(result.overrides?.preferredAgent).toBe('vip-agent');
    });

    // 3. Tool policy enforcement: Agent's policy blocks denied tool
    it('3. Tool policy blocks denied tool before execution', () => {
        policyEngine.setPolicy('agent-1', {
            agentId: 'agent-1',
            deny: ['dangerous_tool', 'delete_*'],
            allow: ['web_*', 'code_*'],
        });

        const allowed = policyEngine.check('agent-1', 'web_search', false);
        expect(allowed.allowed).toBe(true);

        const denied = policyEngine.check('agent-1', 'dangerous_tool', false);
        expect(denied.allowed).toBe(false);
        expect(denied.reason).toBe('denied_by_policy');

        const wildcardDenied = policyEngine.check('agent-1', 'delete_user', false);
        expect(wildcardDenied.allowed).toBe(false);
    });

    // 4. Skill→Tool bridge: Discovered skill registers, policy applies
    it('4. Skill discovery + tool policy integration', () => {
        const skills: SkillEntry[] = [
            { id: 's1', name: 'web_search', description: 'Search web', source: 'bundled', enabled: true },
            { id: 's2', name: 'code_execute', description: 'Execute code', source: 'custom', enabled: true, requires: { bins: ['node'] } },
            { id: 's3', name: 'docker_build', description: 'Build Docker', source: 'bundled', enabled: true, requires: { bins: ['docker'] } },
        ];

        const snapshot = buildSkillSnapshot(skills, eligibility);
        expect(snapshot.skills).toHaveLength(2); // docker_build excluded (no docker bin)
        expect(snapshot.skills.map(s => s.name)).toEqual(['web_search', 'code_execute']);

        // Now apply policy to discovered skills
        const policy: ToolPolicy = { agentId: 'a1', allow: ['web_*'] };
        const webAllowed = evaluateToolPolicy('web_search', policy);
        const codeBlocked = evaluateToolPolicy('code_execute', policy);
        expect(webAllowed.allowed).toBe(true);
        expect(codeBlocked.allowed).toBe(false);
    });

    // 5. Session lane concurrency: Two concurrent requests serialize
    it('5. Session lane concurrency serializes same-session requests', async () => {
        const order: number[] = [];
        const key = buildSessionKey({ agentId: 'agent-1', scope: 'direct', identifier: 'user-1' });

        const p1 = sessionManager.withLane(key, async () => {
            await new Promise(r => setTimeout(r, 30));
            order.push(1);
        });
        const p2 = sessionManager.withLane(key, async () => {
            order.push(2);
        });

        await Promise.all([p1, p2]);
        expect(order).toEqual([1, 2]); // serialized: p1 finishes before p2 starts
    });

    // 6. Session compaction trigger: Long conversation triggers compaction
    it('6. Long conversation triggers session compaction', async () => {
        const messages: SessionMessage[] = [
            { role: 'system', content: 'You are an agent.', timestamp: new Date(), tokenEstimate: 5 },
            ...Array.from({ length: 30 }, (_, i) => ({
                role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
                content: `Turn ${i}: ${'lorem ipsum '.repeat(20)}`,
                timestamp: new Date(Date.now() + i * 1000),
                tokenEstimate: 60,
            })),
        ];

        const result = await sessionManager.compactHistory(messages, 300);
        expect(result.summaryAdded).toBe(true);
        expect(result.compactedTokens).toBeLessThan(result.originalTokens);
        expect(result.messagesRemoved).toBeGreaterThan(10);
        // System message preserved
        expect(result.messages[0].role).toBe('system');
    });

    // 7. Enhanced execution retry: Transient error → retry → success
    it('7. Enhanced executor retries transient errors', async () => {
        let attempts = 0;
        const result = await executor.execute(
            async () => {
                attempts++;
                if (attempts < 3) throw new Error('Request timed out');
                return 'success after retries';
            },
            { models: ['grok-3'], maxRetriesPerModel: 5, timeoutMs: 5000, maxToolResultChars: 10000 },
        );

        expect(result.success).toBe(true);
        expect(result.output).toBe('success after retries');
        expect(result.attempts.length).toBe(3);
    });

    // 8. Enhanced execution failover: Primary fails → fallback succeeds
    it('8. Enhanced executor fails over to fallback model', async () => {
        const result = await executor.execute(
            async (model) => {
                if (model === 'grok-3') throw new Error('Invalid API key for grok');
                return `Response from ${model}`;
            },
            { models: ['grok-3', 'gemini-2.0-flash', 'claude-3'], maxRetriesPerModel: 1, timeoutMs: 5000, maxToolResultChars: 10000 },
        );

        expect(result.success).toBe(true);
        expect(result.modelUsed).toBe('gemini-2.0-flash');
        expect(result.output).toBe('Response from gemini-2.0-flash');
    });

    // 9. Hook lifecycle: All events fire in correct order
    it('9. Full hook lifecycle fires events in order', async () => {
        const events: string[] = [];

        const hookEvents = [
            'before_agent_start', 'before_tool_call', 'after_tool_call', 'after_agent_complete',
        ] as const;

        for (const event of hookEvents) {
            hookSystem.register({
                id: `hook-${event}`,
                name: event,
                event,
                priority: 1,
                enabled: true,
                handler: async () => { events.push(event); return { modified: false }; },
            });
        }

        // Simulate lifecycle
        await hookSystem.emit({ event: 'before_agent_start', agentId: 'a1', sessionKey: 'k1', userId: 'u1', data: {} });
        await hookSystem.emit({ event: 'before_tool_call', agentId: 'a1', sessionKey: 'k1', userId: 'u1', data: { tool: 'web_search' } });
        await hookSystem.emit({ event: 'after_tool_call', agentId: 'a1', sessionKey: 'k1', userId: 'u1', data: { tool: 'web_search', result: 'ok' } });
        await hookSystem.emit({ event: 'after_agent_complete', agentId: 'a1', sessionKey: 'k1', userId: 'u1', data: { success: true } });

        expect(events).toEqual(['before_agent_start', 'before_tool_call', 'after_tool_call', 'after_agent_complete']);
    });

    // 10. Identity linking: Two user IDs → same session via identity links
    it('10. Identity linking maps alternate IDs to canonical session', () => {
        const links = { 'canonical-user': ['whatsapp-123', 'email-456'] };

        const key1 = buildSessionKey({ agentId: 'a1', scope: 'direct', identifier: 'whatsapp-123', identityLinks: links });
        const key2 = buildSessionKey({ agentId: 'a1', scope: 'direct', identifier: 'email-456', identityLinks: links });
        const key3 = buildSessionKey({ agentId: 'a1', scope: 'direct', identifier: 'canonical-user', identityLinks: links });

        expect(key1).toBe('agent:a1:direct:canonical-user');
        expect(key2).toBe('agent:a1:direct:canonical-user');
        expect(key3).toBe('agent:a1:direct:canonical-user');
        expect(key1).toBe(key2);
    });

    // 11. Tool policy wildcards in routing: @group expansion in allow list
    it('11. Tool policy with group expansion in agent routing context', () => {
        const codeAgent: AgentConfig = {
            ...defaultAgent,
            id: 'code-agent',
            toolPolicy: { allow: ['@code-tools', '@search-tools'], deny: ['@admin-tools'] },
        };

        // Expand and check
        const expanded = expandGroups(codeAgent.toolPolicy.allow!);
        expect(expanded).toContain('code_execute');
        expect(expanded).toContain('web_search');

        const policy: ToolPolicy = {
            agentId: 'code-agent',
            allow: codeAgent.toolPolicy.allow,
            deny: codeAgent.toolPolicy.deny,
        };

        expect(evaluateToolPolicy('code_execute', policy).allowed).toBe(true);
        expect(evaluateToolPolicy('web_search', policy).allowed).toBe(true);
        expect(evaluateToolPolicy('delete_user', policy).allowed).toBe(false); // denied by @admin-tools
        expect(evaluateToolPolicy('file_write', policy).allowed).toBe(false); // not in allow list
    });

    // 12. Abort signal propagation: Cancellation stops execution and tracks it
    it('12. Abort signal stops execution and records attempts', async () => {
        const controller = new AbortController();
        let callCount = 0;

        // Abort after first attempt
        const result = await executor.execute(
            async () => {
                callCount++;
                if (callCount === 1) {
                    controller.abort();
                    throw new Error('simulated slow operation');
                }
                return 'should not reach';
            },
            { models: ['grok-3', 'fallback'], maxRetriesPerModel: 3, timeoutMs: 5000, maxToolResultChars: 10000 },
            controller.signal,
        );

        expect(result.success).toBe(false);
        expect(result.attempts.length).toBeGreaterThanOrEqual(1);
    });
});
