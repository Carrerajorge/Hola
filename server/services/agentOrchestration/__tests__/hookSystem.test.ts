import { describe, it, expect, beforeEach } from 'vitest';
import { HookSystem } from '../hookSystem';
import type { HookContext, HookResult, RegisteredHook } from '../hookSystem';

function makeContext(overrides: Partial<HookContext> = {}): HookContext {
    return {
        event: 'before_tool_call',
        agentId: 'agent-1',
        sessionKey: 'agent:agent-1:direct:user-1',
        userId: 'user-1',
        data: {},
        ...overrides,
    };
}

function makeHook(overrides: Partial<RegisteredHook> = {}): RegisteredHook {
    return {
        id: `hook-${Math.random().toString(36).slice(2, 8)}`,
        name: 'test-hook',
        event: 'before_tool_call',
        priority: 100,
        handler: async () => ({ modified: false }),
        enabled: true,
        ...overrides,
    };
}

describe('HookSystem', () => {
    let system: HookSystem;

    beforeEach(() => {
        system = new HookSystem();
    });

    it('registers a hook and stores it', () => {
        const hook = makeHook({ id: 'h1' });
        system.register(hook);
        const hooks = system.getHooksForEvent('before_tool_call');
        expect(hooks).toHaveLength(1);
        expect(hooks[0].id).toBe('h1');
    });

    it('emits event and hooks execute in priority order', async () => {
        const order: number[] = [];
        system.register(makeHook({
            id: 'h-high', priority: 200,
            handler: async () => { order.push(200); return { modified: false }; },
        }));
        system.register(makeHook({
            id: 'h-low', priority: 10,
            handler: async () => { order.push(10); return { modified: false }; },
        }));
        system.register(makeHook({
            id: 'h-mid', priority: 50,
            handler: async () => { order.push(50); return { modified: false }; },
        }));

        await system.emit(makeContext());
        expect(order).toEqual([10, 50, 200]); // ascending priority
    });

    it('hook can modify context via overrides', async () => {
        system.register(makeHook({
            id: 'h-modify',
            handler: async () => ({
                modified: true,
                overrides: { model: 'gpt-4o', temperature: 0.7 },
            }),
        }));

        const result = await system.emit(makeContext());
        expect(result.modified).toBe(true);
        expect(result.overrides).toEqual({ model: 'gpt-4o', temperature: 0.7 });
    });

    it('hook can abort execution', async () => {
        const secondRan = { value: false };
        system.register(makeHook({
            id: 'h-abort', priority: 1,
            handler: async () => ({
                modified: false,
                abort: true,
                abortReason: 'Rate limited',
            }),
        }));
        system.register(makeHook({
            id: 'h-second', priority: 2,
            handler: async () => { secondRan.value = true; return { modified: false }; },
        }));

        const result = await system.emit(makeContext());
        expect(result.abort).toBe(true);
        expect(result.abortReason).toBe('Rate limited');
        expect(secondRan.value).toBe(false);
    });

    it('disabled hooks do not execute', async () => {
        const ran = { value: false };
        system.register(makeHook({
            id: 'h-disabled',
            enabled: false,
            handler: async () => { ran.value = true; return { modified: false }; },
        }));

        await system.emit(makeContext());
        expect(ran.value).toBe(false);
    });

    it('non-matching events do not trigger hooks', async () => {
        const ran = { value: false };
        system.register(makeHook({
            id: 'h-other-event',
            event: 'after_agent_complete',
            handler: async () => { ran.value = true; return { modified: false }; },
        }));

        await system.emit(makeContext({ event: 'before_tool_call' }));
        expect(ran.value).toBe(false);
    });

    it('unregisters a hook', () => {
        system.register(makeHook({ id: 'h-remove' }));
        expect(system.getHooksForEvent('before_tool_call')).toHaveLength(1);
        system.unregister('h-remove');
        expect(system.getHooksForEvent('before_tool_call')).toHaveLength(0);
    });

    it('clear removes all hooks', () => {
        system.register(makeHook({ id: 'h1' }));
        system.register(makeHook({ id: 'h2', event: 'after_tool_call' }));
        system.clear();
        expect(system.getHooksForEvent('before_tool_call')).toHaveLength(0);
        expect(system.getHooksForEvent('after_tool_call')).toHaveLength(0);
    });

    it('merges overrides from multiple hooks', async () => {
        system.register(makeHook({
            id: 'h1', priority: 1,
            handler: async () => ({ modified: true, overrides: { a: 1 } }),
        }));
        system.register(makeHook({
            id: 'h2', priority: 2,
            handler: async () => ({ modified: true, overrides: { b: 2 } }),
        }));

        const result = await system.emit(makeContext());
        expect(result.modified).toBe(true);
        expect(result.overrides).toEqual({ a: 1, b: 2 });
    });
});
