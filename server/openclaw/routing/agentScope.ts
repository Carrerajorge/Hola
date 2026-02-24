import type { AgentEntry, ResolvedAgentConfig } from '../types';

export function resolveDefaultAgentId(agents: AgentEntry[]): string {
  const defaultAgent = agents.find(a => a.default);
  return defaultAgent?.id ?? agents[0]?.id ?? 'default';
}

export function listAgentEntries(agents: AgentEntry[]): AgentEntry[] {
  return [...agents];
}

export function resolveAgentConfig(agentId: string, agents: AgentEntry[]): ResolvedAgentConfig | null {
  const entry = agents.find(a => a.id === agentId);
  if (!entry) return null;

  let model: string;
  let fallbacks: string[];

  if (typeof entry.model === 'object' && entry.model !== null) {
    model = entry.model.primary ?? 'claude-sonnet-4-6';
    fallbacks = entry.model.fallbacks ?? [];
  } else if (typeof entry.model === 'string') {
    model = entry.model;
    fallbacks = [];
  } else {
    model = 'claude-sonnet-4-6';
    fallbacks = [];
  }

  return {
    id: entry.id,
    name: entry.name ?? entry.id,
    model,
    fallbacks,
    skills: entry.skills ?? [],
    workspaceDir: entry.workspace ?? `~/.iliagpt/workspaces/${entry.id}`,
    toolPolicy: entry.tools ?? {},
    memoryEnabled: entry.memorySearch?.enabled ?? false,
    identity: entry.identity ?? {},
  };
}
