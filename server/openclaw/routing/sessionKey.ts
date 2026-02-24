import type { SessionKey } from '../types';

export function normalizeAgentId(id: string): string {
  return id.trim().toLowerCase().replace(/\s+/g, '-');
}

export function buildMainSessionKey(agentId: string, userId: string): SessionKey {
  return `agent:${normalizeAgentId(agentId)}:main:${userId}` as SessionKey;
}

export function buildPeerSessionKey(agentId: string, kind: string, peerId: string): SessionKey {
  return `agent:${normalizeAgentId(agentId)}:peer:${kind}:${peerId}` as SessionKey;
}

interface ParsedMainKey { agentId: string; type: 'main'; identifier: string; }
interface ParsedPeerKey { agentId: string; type: 'peer'; kind: string; identifier: string; }

export function parseSessionKey(key: string): ParsedMainKey | ParsedPeerKey | null {
  const parts = key.split(':');
  if (parts[0] !== 'agent' || parts.length < 4) return null;

  const agentId = parts[1];

  if (parts[2] === 'main') {
    return { agentId, type: 'main', identifier: parts.slice(3).join(':') };
  }

  if (parts[2] === 'peer' && parts.length >= 5) {
    return { agentId, type: 'peer', kind: parts[3], identifier: parts.slice(4).join(':') };
  }

  return null;
}
