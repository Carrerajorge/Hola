// server/openclaw/skills/filter.ts
import type { EnhancedSkill } from '../types';

interface SkillFilterConfig {
  allow?: string[];
  deny?: string[];
}

export function filterSkillsForAgent(
  skills: EnhancedSkill[],
  filter: SkillFilterConfig,
): EnhancedSkill[] {
  let filtered = skills.filter(s => s.eligible);

  if (filter.allow && filter.allow.length > 0) {
    filtered = filtered.filter(s => filter.allow!.includes(s.id));
  }

  if (filter.deny && filter.deny.length > 0) {
    filtered = filtered.filter(s => !filter.deny!.includes(s.id));
  }

  return filtered;
}
