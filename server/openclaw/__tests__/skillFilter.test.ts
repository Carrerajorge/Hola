import { describe, it, expect } from 'vitest';
import { filterSkillsForAgent } from '../skills/filter';
import type { EnhancedSkill } from '../types';

const mockSkills: EnhancedSkill[] = [
  { id: 'coding', name: 'Coding', description: '', prompt: '', tools: [], source: 'bundled', eligible: true },
  { id: 'web-scraper', name: 'Web', description: '', prompt: '', tools: [], source: 'bundled', eligible: true },
  { id: 'github', name: 'GitHub', description: '', prompt: '', tools: [], source: 'workspace', eligible: true },
  { id: 'broken', name: 'Broken', description: '', prompt: '', tools: [], source: 'workspace', eligible: false },
];

describe('filterSkillsForAgent', () => {
  it('should return all eligible skills when no filter specified', () => {
    const result = filterSkillsForAgent(mockSkills, {});
    expect(result).toHaveLength(3); // excludes 'broken' (not eligible)
  });

  it('should apply allowlist', () => {
    const result = filterSkillsForAgent(mockSkills, { allow: ['coding', 'github'] });
    expect(result).toHaveLength(2);
    expect(result.map(s => s.id)).toEqual(['coding', 'github']);
  });

  it('should apply denylist', () => {
    const result = filterSkillsForAgent(mockSkills, { deny: ['web-scraper'] });
    expect(result).toHaveLength(2); // coding + github (broken excluded by eligibility)
    expect(result.find(s => s.id === 'web-scraper')).toBeUndefined();
  });

  it('should apply both (allowlist takes precedence)', () => {
    const result = filterSkillsForAgent(mockSkills, { allow: ['coding', 'web-scraper'], deny: ['web-scraper'] });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('coding');
  });
});
