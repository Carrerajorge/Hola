export type Skill = {
  id: string;
  name: string;
  description?: string;
  prompt?: string;
  tools?: string[];
  source?: string;
  filePath?: string;
  updatedAt?: string;
};

export class SkillRegistry {
  private skills = new Map<string, Skill>();

  register(skill: Skill): void {
    this.skills.set(skill.id, skill);
  }

  registerMany(skills: Skill[]): void {
    for (const skill of skills) {
      this.register(skill);
    }
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
    return prompts.join("\n\n");
  }

  getToolsForSkills(skillIds: string[]): string[] {
    const tools = new Set<string>();
    for (const id of skillIds) {
      const skill = this.skills.get(id);
      for (const tool of skill?.tools || []) {
        tools.add(tool);
      }
    }
    return Array.from(tools);
  }

  clear(): void {
    this.skills.clear();
  }

  resolve(skillIds?: string[]): { skills: Skill[]; prompt: string; tools: string[] } {
    const selected =
      skillIds && skillIds.length > 0
        ? skillIds.map((id) => this.skills.get(id)).filter(Boolean) as Skill[]
        : this.list();

    return {
      skills: selected,
      prompt: this.getPromptForSkills(selected.map((skill) => skill.id)),
      tools: this.getToolsForSkills(selected.map((skill) => skill.id)),
    };
  }
}

export const skillRegistry = new SkillRegistry();
