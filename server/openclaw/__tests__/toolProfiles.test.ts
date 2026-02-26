import { describe, it, expect } from 'vitest';
import {
  getToolsForProfile,
  getToolIdsByProfile,
  isToolAllowedByProfile,
  getToolCatalog,
  getToolsBySection,
  listSections,
  expandToolGroup,
  resolveToolPolicy,
} from '../tools/toolProfiles';

describe('Tool Profiles', () => {
  it('minimal profile includes only status tools', () => {
    const tools = getToolIdsByProfile('minimal');
    expect(tools.length).toBeGreaterThanOrEqual(2);
    expect(tools).toContain('openclaw_subagent_status');
    expect(tools).toContain('openclaw_subagent_list');
    // Should NOT include execution tools
    expect(tools).not.toContain('openclaw_spawn_subagent');
    expect(tools).not.toContain('openclaw_code_execute');
  });

  it('coding profile includes execution and memory tools', () => {
    const tools = getToolIdsByProfile('coding');
    expect(tools).toContain('openclaw_spawn_subagent');
    expect(tools).toContain('openclaw_memory');
    expect(tools).toContain('openclaw_cron');
    expect(tools).toContain('openclaw_rag_search');
    expect(tools).toContain('openclaw_document_ingest');
  });

  it('messaging profile includes session and routing tools', () => {
    const tools = getToolIdsByProfile('messaging');
    expect(tools).toContain('openclaw_sessions_list');
    expect(tools).toContain('openclaw_sessions_spawn');
    expect(tools).toContain('openclaw_sessions_send');
    expect(tools).toContain('openclaw_message_route');
  });

  it('full profile includes everything', () => {
    const full = getToolIdsByProfile('full');
    const catalog = getToolCatalog();
    expect(full.length).toBe(catalog.length);
  });

  it('isToolAllowedByProfile returns correct values', () => {
    expect(isToolAllowedByProfile('openclaw_subagent_status', 'minimal')).toBe(true);
    expect(isToolAllowedByProfile('openclaw_spawn_subagent', 'minimal')).toBe(false);
    expect(isToolAllowedByProfile('openclaw_spawn_subagent', 'coding')).toBe(true);
    expect(isToolAllowedByProfile('unknown_tool', 'minimal')).toBe(true); // Unknown = allowed
  });

  it('getToolsBySection returns tools for a section', () => {
    const subagentTools = getToolsBySection('subagents');
    expect(subagentTools.length).toBeGreaterThanOrEqual(3);
    expect(subagentTools.every(t => t.section === 'subagents')).toBe(true);
  });

  it('listSections returns all sections with counts', () => {
    const sections = listSections();
    expect(sections.length).toBeGreaterThanOrEqual(5);
    expect(sections.some(s => s.section === 'subagents')).toBe(true);
    expect(sections.some(s => s.section === 'memory')).toBe(true);
    expect(sections.some(s => s.section === 'sessions')).toBe(true);
  });

  it('expandToolGroup expands group references', () => {
    const subagents = expandToolGroup('group:subagents');
    expect(subagents.length).toBeGreaterThanOrEqual(3);
    expect(subagents).toContain('openclaw_spawn_subagent');
  });

  it('expandToolGroup returns single ID for non-group', () => {
    const result = expandToolGroup('openclaw_memory');
    expect(result).toEqual(['openclaw_memory']);
  });

  it('resolveToolPolicy applies allow list', () => {
    const resolved = resolveToolPolicy({
      profile: 'minimal',
      allow: ['openclaw_memory'],
    });
    expect(resolved).toContain('openclaw_subagent_status'); // From minimal
    expect(resolved).toContain('openclaw_memory'); // From allow
  });

  it('resolveToolPolicy applies deny list', () => {
    const resolved = resolveToolPolicy({
      profile: 'full',
      deny: ['openclaw_browser_navigate'],
    });
    expect(resolved).not.toContain('openclaw_browser_navigate');
    expect(resolved).toContain('openclaw_memory'); // Not denied
  });

  it('resolveToolPolicy expands group in deny', () => {
    const resolved = resolveToolPolicy({
      profile: 'full',
      deny: ['group:sessions'],
    });
    expect(resolved).not.toContain('openclaw_sessions_list');
    expect(resolved).not.toContain('openclaw_sessions_spawn');
    expect(resolved).toContain('openclaw_memory'); // Not in sessions group
  });
});
