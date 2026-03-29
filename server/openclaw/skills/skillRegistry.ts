import type { SkillEntry } from "../src/agents/skills.js";

const _skillRegistry = new Map<string, SkillEntry>();

export const skillRegistry = _skillRegistry;

export function registerSkill(skillId: string, entry: SkillEntry): void {
  _skillRegistry.set(skillId, entry);
}

export function getSkill(skillId: string): SkillEntry | undefined {
  return _skillRegistry.get(skillId);
}

export function getAllSkills(): Map<string, SkillEntry> {
  return _skillRegistry;
}

export function clearSkills(): void {
  _skillRegistry.clear();
}
