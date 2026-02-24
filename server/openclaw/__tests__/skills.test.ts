import { describe, it, expect } from 'vitest';
import { SkillRegistry } from '../skills/skillRegistry';

describe('Skill Registry', () => {
  it('registers and retrieves skills', () => {
    const registry = new SkillRegistry();
    registry.register({
      id: 'test-skill',
      name: 'Test Skill',
      description: 'A test skill',
      prompt: 'You are a test assistant',
      tools: ['openclaw_exec'],
    });

    const skill = registry.get('test-skill');
    expect(skill).toBeTruthy();
    expect(skill!.name).toBe('Test Skill');
  });

  it('lists all skills', () => {
    const registry = new SkillRegistry();
    registry.register({ id: 's1', name: 'S1', description: '', prompt: '', tools: [] });
    registry.register({ id: 's2', name: 'S2', description: '', prompt: '', tools: [] });
    expect(registry.list()).toHaveLength(2);
  });

  it('returns skill prompt for agent context injection', () => {
    const registry = new SkillRegistry();
    registry.register({
      id: 'coding',
      name: 'Coding Agent',
      description: 'A coding assistant',
      prompt: 'You are an expert coder. Use exec and fs tools to write and run code.',
      tools: ['openclaw_exec', 'openclaw_read', 'openclaw_write'],
    });

    const prompt = registry.getPromptForSkills(['coding']);
    expect(prompt).toContain('expert coder');
  });

  it('aggregates tools from multiple skills', () => {
    const registry = new SkillRegistry();
    registry.register({ id: 'a', name: 'A', description: '', prompt: '', tools: ['openclaw_exec', 'openclaw_read'] });
    registry.register({ id: 'b', name: 'B', description: '', prompt: '', tools: ['openclaw_read', 'openclaw_write'] });

    const tools = registry.getToolsForSkills(['a', 'b']);
    expect(tools).toContain('openclaw_exec');
    expect(tools).toContain('openclaw_read');
    expect(tools).toContain('openclaw_write');
    // No duplicates
    expect(tools.filter(t => t === 'openclaw_read')).toHaveLength(1);
  });

  it('removes skills', () => {
    const registry = new SkillRegistry();
    registry.register({ id: 'removable', name: 'R', description: '', prompt: '', tools: [] });
    expect(registry.get('removable')).toBeTruthy();

    registry.remove('removable');
    expect(registry.get('removable')).toBeUndefined();
  });
});
