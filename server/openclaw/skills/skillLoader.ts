export async function loadSkill(_skillPath: string): Promise<unknown> {
  return null;
}

export async function loadSkills(_skillsDir: string): Promise<Map<string, unknown>> {
  return new Map();
}

export function getSkillManifest(_skillPath: string): unknown {
  return null;
}

export async function initSkills(_skillsDir?: string): Promise<void> {
  // Skills initialization is handled by the skills system in src/agents/skills.ts
}
