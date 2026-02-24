import { describe, it, expect, beforeEach } from 'vitest';
import { MultiAgentRouter } from '../multiAgentRouter';
import type { AgentConfig, AgentBinding, RouteInput } from '../multiAgentRouter';

const defaultAgent: AgentConfig = {
    id: 'default-agent',
    name: 'Default Agent',
    modelPrimary: 'grok-3',
    modelFallbacks: ['gemini-2.0-flash'],
    skills: [],
    toolPolicy: {},
    maxRetries: 3,
    timeoutMs: 30_000,
};

function makeBinding(overrides: Partial<AgentBinding> = {}): AgentBinding {
    return {
        id: `binding-${Math.random().toString(36).slice(2, 8)}`,
        agentId: 'agent-1',
        priority: 0,
        match: {},
        agentConfig: {
            id: 'agent-1',
            name: 'Agent One',
            modelPrimary: 'grok-3',
            modelFallbacks: [],
            skills: ['search'],
            toolPolicy: {},
            maxRetries: 3,
            timeoutMs: 30_000,
        },
        isActive: true,
        ...overrides,
    };
}

describe('MultiAgentRouter', () => {
    let router: MultiAgentRouter;

    beforeEach(() => {
        router = new MultiAgentRouter(defaultAgent);
    });

    it('falls back to default agent when no bindings match', () => {
        const route = router.resolveRoute({ userId: 'u1', source: 'web' });
        expect(route.agentId).toBe('default-agent');
        expect(route.matchedBy).toBe('default');
    });

    it('routes to user-specific binding', () => {
        router.addBinding(makeBinding({
            agentId: 'personal-agent',
            priority: 100,
            match: { userId: 'user-42' },
            agentConfig: { ...defaultAgent, id: 'personal-agent', name: 'Personal' },
        }));

        const route = router.resolveRoute({ userId: 'user-42', source: 'web' });
        expect(route.agentId).toBe('personal-agent');
        expect(route.matchedBy).toBe('userId');
    });

    it('routes to intent-specific binding', () => {
        router.addBinding(makeBinding({
            agentId: 'code-agent',
            priority: 50,
            match: { intentCategory: 'code_generation' },
            agentConfig: { ...defaultAgent, id: 'code-agent', name: 'Code Agent' },
        }));

        const route = router.resolveRoute({
            userId: 'u1',
            source: 'web',
            intentCategory: 'code_generation',
        });
        expect(route.agentId).toBe('code-agent');
        expect(route.matchedBy).toBe('intent');
    });

    it('routes to source-specific binding', () => {
        router.addBinding(makeBinding({
            agentId: 'whatsapp-agent',
            priority: 30,
            match: { source: 'whatsapp' },
            agentConfig: { ...defaultAgent, id: 'whatsapp-agent', name: 'WhatsApp Agent' },
        }));

        const route = router.resolveRoute({ userId: 'u1', source: 'whatsapp' });
        expect(route.agentId).toBe('whatsapp-agent');
        expect(route.matchedBy).toBe('source');
    });

    it('higher priority binding wins', () => {
        router.addBinding(makeBinding({
            agentId: 'low-pri',
            priority: 10,
            match: { source: 'web' },
            agentConfig: { ...defaultAgent, id: 'low-pri' },
        }));
        router.addBinding(makeBinding({
            agentId: 'high-pri',
            priority: 100,
            match: { source: 'web' },
            agentConfig: { ...defaultAgent, id: 'high-pri' },
        }));

        const route = router.resolveRoute({ userId: 'u1', source: 'web' });
        expect(route.agentId).toBe('high-pri');
    });

    it('inactive bindings are ignored', () => {
        router.addBinding(makeBinding({
            agentId: 'inactive-agent',
            priority: 200,
            match: { source: 'web' },
            isActive: false,
            agentConfig: { ...defaultAgent, id: 'inactive-agent' },
        }));

        const route = router.resolveRoute({ userId: 'u1', source: 'web' });
        expect(route.agentId).toBe('default-agent');
    });

    it('constructs session key correctly for matched agent', () => {
        router.addBinding(makeBinding({
            agentId: 'agent-x',
            match: { source: 'api' },
            agentConfig: { ...defaultAgent, id: 'agent-x' },
        }));

        const route = router.resolveRoute({ userId: 'user-7', source: 'api' });
        expect(route.sessionKey).toBe('agent:agent-x:direct:user-7');
    });

    it('routes via tag matching', () => {
        router.addBinding(makeBinding({
            agentId: 'tag-agent',
            priority: 20,
            match: { tags: ['vip', 'enterprise'] },
            agentConfig: { ...defaultAgent, id: 'tag-agent' },
        }));

        const route = router.resolveRoute({ userId: 'u1', source: 'web', tags: ['vip'] });
        expect(route.agentId).toBe('tag-agent');
        expect(route.matchedBy).toBe('tags');
    });

    it('tag matching requires at least one overlap', () => {
        router.addBinding(makeBinding({
            agentId: 'tag-agent',
            match: { tags: ['vip'] },
            agentConfig: { ...defaultAgent, id: 'tag-agent' },
        }));

        const route = router.resolveRoute({ userId: 'u1', source: 'web', tags: ['basic'] });
        expect(route.agentId).toBe('default-agent');
    });

    it('cache returns same result for same input', () => {
        router.addBinding(makeBinding({
            agentId: 'cached',
            match: { source: 'web' },
            agentConfig: { ...defaultAgent, id: 'cached' },
        }));

        const r1 = router.resolveRoute({ userId: 'u1', source: 'web' });
        const r2 = router.resolveRoute({ userId: 'u1', source: 'web' });
        expect(r1).toEqual(r2);
    });

    it('clearCache invalidates cache', () => {
        router.addBinding(makeBinding({
            agentId: 'a',
            match: { source: 'web' },
            agentConfig: { ...defaultAgent, id: 'a' },
        }));

        router.resolveRoute({ userId: 'u1', source: 'web' });
        router.clearCache();
        // After adding a new higher-priority binding and clearing cache,
        // the new binding should take effect
        router.addBinding(makeBinding({
            agentId: 'b',
            priority: 999,
            match: { source: 'web' },
            agentConfig: { ...defaultAgent, id: 'b' },
        }));
        router.clearCache();
        const route = router.resolveRoute({ userId: 'u1', source: 'web' });
        expect(route.agentId).toBe('b');
    });
});
