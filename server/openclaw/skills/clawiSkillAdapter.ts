import type { SkillEntry } from "../src/agents/skills.js";

export function adaptSkillToClawi(skill: SkillEntry): unknown {
  return {
    id: skill.id,
    name: skill.name || skill.id,
    description: skill.description || "",
    commands: skill.commands || [],
  };
}

export function adaptClawiToSkill(clawiSkill: unknown): SkillEntry | null {
  if (!clawiSkill || typeof clawiSkill !== "object") return null;
  const obj = clawiSkill as Record<string, unknown>;
  return {
    id: String(obj.id || ""),
    name: String(obj.name || obj.id || ""),
    description: String(obj.description || ""),
    commands: Array.isArray(obj.commands) ? obj.commands : [],
  };
}

export async function initializeClawiSkills(_skillsDir?: string): Promise<void> {
  // Skills initialization is handled by the skills system in src/agents/skills.ts
}
