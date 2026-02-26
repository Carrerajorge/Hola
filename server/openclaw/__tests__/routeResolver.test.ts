import { describe, it, expect } from 'vitest';
import { resolveRoute } from '../routing/resolver';
import type { AgentEntry } from '../types';

const agents: AgentEntry[] = [
  { id: 'main', default: true },
  { id: 'support', name: 'Support' },
];

describe('resolveRoute', () => {
  it('should resolve to default agent for unbound channel', () => {
    const route = resolveRoute({ channel: 'web', accountId: 'user1' }, agents, []);
    expect(route.agentId).toBe('main');
    expect(route.sessionKey).toContain('agent:main');
  });

  it('should resolve to bound agent for matched binding', () => {
    const bindings = [{ channel: 'slack', agentId: 'support' }];
    const route = resolveRoute({ channel: 'slack', accountId: 'user1' }, agents, bindings);
    expect(route.agentId).toBe('support');
  });

  it('should include peer info in session key', () => {
    const route = resolveRoute({ channel: 'slack', accountId: 'user1', peerId: 'chan-general' }, agents, []);
    expect(route.sessionKey).toContain('peer');
    expect(route.sessionKey).toContain('chan-general');
  });
});
