import type { Skill } from '../types';

export class SkillRegistry {
  private skills = new Map<string, Skill>();

  register(skill: Skill): void {
    this.skills.set(skill.id, skill);
  }

  get(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  list(): Skill[] {
    return Array.from(this.skills.values());
  }

  getPromptForSkills(skillIds: string[]): string {
    const prompts: string[] = [];
    for (const id of skillIds) {
      const skill = this.skills.get(id);
      if (skill?.prompt) {
        prompts.push(`## Skill: ${skill.name}\n${skill.prompt}`);
      }
    }
    return prompts.join('\n\n');
  }

  getToolsForSkills(skillIds: string[]): string[] {
    const tools = new Set<string>();
    for (const id of skillIds) {
      const skill = this.skills.get(id);
      if (skill?.tools) {
        for (const t of skill.tools) tools.add(t);
      }
    }
    return Array.from(tools);
  }

  remove(id: string): boolean {
    return this.skills.delete(id);
  }
}

export const skillRegistry = new SkillRegistry();
