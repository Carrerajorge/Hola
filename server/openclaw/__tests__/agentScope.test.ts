import { describe, it, expect } from 'vitest';
import { resolveAgentConfig, resolveDefaultAgentId, listAgentEntries } from '../routing/agentScope';
import type { AgentEntry } from '../types';

const AGENTS: AgentEntry[] = [
  {
    id: 'main',
    name: 'Main Agent',
    default: true,
    model: { primary: 'claude-sonnet-4-6', fallbacks: ['gemini-2.0-flash'] },
    skills: ['coding', 'web-scraper'],
    workspace: '~/.iliagpt/workspaces/main',
    tools: { deny: ['browser'] },
    memorySearch: { enabled: true },
    identity: { name: 'ILIA', persona: 'helpful assistant' },
  },
  {
    id: 'coder',
    name: 'Code Agent',
    model: 'claude-sonnet-4-6',
    skills: ['coding'],
  },
];

describe('resolveDefaultAgentId', () => {
  it('should return the default agent', () => {
    expect(resolveDefaultAgentId(AGENTS)).toBe('main');
  });
  it('should return first agent when no default set', () => {
    const agents = [{ id: 'only' }];
    expect(resolveDefaultAgentId(agents)).toBe('only');
  });
});

describe('listAgentEntries', () => {
  it('should return all entries', () => {
    expect(listAgentEntries(AGENTS)).toHaveLength(2);
  });
});

describe('resolveAgentConfig', () => {
  it('should resolve full config for agent with model object', () => {
    const config = resolveAgentConfig('main', AGENTS);
    expect(config).not.toBeNull();
    expect(config!.model).toBe('claude-sonnet-4-6');
    expect(config!.fallbacks).toEqual(['gemini-2.0-flash']);
    expect(config!.skills).toEqual(['coding', 'web-scraper']);
    expect(config!.memoryEnabled).toBe(true);
  });

  it('should resolve config for agent with string model', () => {
    const config = resolveAgentConfig('coder', AGENTS);
    expect(config!.model).toBe('claude-sonnet-4-6');
    expect(config!.fallbacks).toEqual([]);
  });

  it('should return null for unknown agent', () => {
    expect(resolveAgentConfig('unknown', AGENTS)).toBeNull();
  });
});
