import { describe, it, expect, beforeEach } from 'vitest';
import {
    buildSessionKey,
    parseSessionKey,
    deriveSessionScope,
    SessionManager,
} from '../sessionManager';
import type { SessionMessage } from '../sessionManager';

describe('Session Key utilities', () => {
    it('buildSessionKey produces correct format', () => {
        const key = buildSessionKey({ agentId: 'grok-1', scope: 'direct', identifier: 'user-42' });
        expect(key).toBe('agent:grok-1:direct:user-42');
    });

    it('buildSessionKey with identity links resolves to canonical', () => {
        const key = buildSessionKey({
            agentId: 'grok-1',
            scope: 'direct',
            identifier: 'alt-id-99',
            identityLinks: { 'user-42': ['alt-id-99', 'alt-id-100'] },
        });
        expect(key).toBe('agent:grok-1:direct:user-42');
    });

    it('buildSessionKey without matching identity link uses original', () => {
        const key = buildSessionKey({
            agentId: 'grok-1',
            scope: 'direct',
            identifier: 'unknown-id',
            identityLinks: { 'user-42': ['alt-id-99'] },
        });
        expect(key).toBe('agent:grok-1:direct:unknown-id');
    });

    it('parseSessionKey round-trips correctly', () => {
        const key = 'agent:grok-1:channel:ch-abc';
        const parsed = parseSessionKey(key);
        expect(parsed).toEqual({ agentId: 'grok-1', scope: 'channel', identifier: 'ch-abc' });
    });

    it('parseSessionKey returns null for invalid key', () => {
        expect(parseSessionKey('invalid')).toBeNull();
        expect(parseSessionKey('agent:only-two')).toBeNull();
    });

    it('deriveSessionScope returns correct scope', () => {
        expect(deriveSessionScope('agent:x:direct:y')).toBe('direct');
        expect(deriveSessionScope('agent:x:group:y')).toBe('group');
        expect(deriveSessionScope('agent:x:api:y')).toBe('api');
    });

    it('deriveSessionScope returns unknown for invalid key', () => {
        expect(deriveSessionScope('bad')).toBe('unknown');
    });
});

describe('SessionManager', () => {
    let manager: SessionManager;

    beforeEach(() => {
        manager = new SessionManager();
    });

    it('lane concurrency: second call waits for first', async () => {
        const order: number[] = [];
        const key = 'agent:a:direct:u';

        const p1 = manager.withLane(key, async () => {
            await new Promise(r => setTimeout(r, 50));
            order.push(1);
        });
        const p2 = manager.withLane(key, async () => {
            order.push(2);
        });

        await Promise.all([p1, p2]);
        expect(order).toEqual([1, 2]);
    });

    it('lane concurrency: different sessions run in parallel', async () => {
        const order: number[] = [];

        const p1 = manager.withLane('agent:a:direct:u1', async () => {
            await new Promise(r => setTimeout(r, 50));
            order.push(1);
        });
        const p2 = manager.withLane('agent:a:direct:u2', async () => {
            order.push(2);
        });

        await Promise.all([p1, p2]);
        // u2 should finish first since it doesn't wait
        expect(order).toEqual([2, 1]);
    });

    it('compactHistory reduces messages while keeping recent + summary', async () => {
        const messages: SessionMessage[] = [
            { role: 'system', content: 'You are a helpful agent.', timestamp: new Date(), tokenEstimate: 10 },
            ...Array.from({ length: 20 }, (_, i) => ({
                role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
                content: `Message ${i}: ${'x'.repeat(100)}`,
                timestamp: new Date(Date.now() + i * 1000),
                tokenEstimate: 30,
            })),
        ];

        const result = await manager.compactHistory(messages, 200);
        expect(result.compactedTokens).toBeLessThan(result.originalTokens);
        expect(result.messagesRemoved).toBeGreaterThan(0);
        expect(result.summaryAdded).toBe(true);
        // System message is always kept
        expect(result.messages[0].role).toBe('system');
        // Last few messages kept
        const lastMsg = result.messages[result.messages.length - 1];
        expect(lastMsg.content).toContain('Message 19');
    });

    it('compactHistory keeps all messages if under token limit', async () => {
        const messages: SessionMessage[] = [
            { role: 'user', content: 'Hi', timestamp: new Date(), tokenEstimate: 2 },
            { role: 'assistant', content: 'Hello!', timestamp: new Date(), tokenEstimate: 3 },
        ];

        const result = await manager.compactHistory(messages, 1000);
        expect(result.messagesRemoved).toBe(0);
        expect(result.summaryAdded).toBe(false);
        expect(result.messages).toHaveLength(2);
    });
});
