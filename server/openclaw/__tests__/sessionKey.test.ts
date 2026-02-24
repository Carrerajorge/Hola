import { describe, it, expect } from 'vitest';
import { buildMainSessionKey, buildPeerSessionKey, parseSessionKey, normalizeAgentId } from '../routing/sessionKey';

describe('normalizeAgentId', () => {
  it('should lowercase and trim', () => {
    expect(normalizeAgentId(' MyAgent ')).toBe('myagent');
  });
  it('should replace spaces with hyphens', () => {
    expect(normalizeAgentId('my cool agent')).toBe('my-cool-agent');
  });
});

describe('buildMainSessionKey', () => {
  it('should build agent:id:main:key format', () => {
    const key = buildMainSessionKey('default', 'user123');
    expect(key).toBe('agent:default:main:user123');
  });
});

describe('buildPeerSessionKey', () => {
  it('should build agent:id:peer:kind:peerId format', () => {
    const key = buildPeerSessionKey('default', 'slack', 'channel-general');
    expect(key).toBe('agent:default:peer:slack:channel-general');
  });
});

describe('parseSessionKey', () => {
  it('should parse main session key', () => {
    const parsed = parseSessionKey('agent:default:main:user123');
    expect(parsed).toEqual({ agentId: 'default', type: 'main', identifier: 'user123' });
  });
  it('should parse peer session key', () => {
    const parsed = parseSessionKey('agent:default:peer:slack:channel-general');
    expect(parsed).toEqual({ agentId: 'default', type: 'peer', kind: 'slack', identifier: 'channel-general' });
  });
  it('should return null for invalid key', () => {
    expect(parseSessionKey('invalid')).toBeNull();
  });
});
