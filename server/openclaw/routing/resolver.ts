import type { AgentEntry, SessionKey } from '../types';
import { resolveDefaultAgentId } from './agentScope';
import { buildMainSessionKey, buildPeerSessionKey } from './sessionKey';

interface RouteRequest {
  channel: string;
  accountId: string;
  peerId?: string;
  roles?: string[];
}

interface ChannelBinding {
  channel: string;
  agentId: string;
}

interface ResolvedRoute {
  agentId: string;
  sessionKey: SessionKey;
}

export function resolveRoute(
  req: RouteRequest,
  agents: AgentEntry[],
  bindings: ChannelBinding[],
): ResolvedRoute {
  // Check channel bindings first
  const binding = bindings.find(b => b.channel === req.channel);
  const agentId = binding?.agentId ?? resolveDefaultAgentId(agents);

  // Build session key
  const sessionKey = req.peerId
    ? buildPeerSessionKey(agentId, req.channel, req.peerId)
    : buildMainSessionKey(agentId, req.accountId);

  return { agentId, sessionKey };
}
