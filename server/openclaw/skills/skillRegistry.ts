export type RuntimeSkill = {
  id: string;
  name: string;
  description?: string;
  prompt?: string;
  tools?: string[];
  source?: string;
  filePath?: string;
  updatedAt?: string;
};

export type SkillResolveResult = {
  skills: RuntimeSkill[];
  prompt: string;
  tools: string[];
};

const CATALOG_PROMPT_LIMIT = 4000;
const DETAILED_PROMPT_LIMIT = 6000;
const DETAILED_SECTION_LIMIT = 1200;

function normalizeId(value: string): string {
  return String(value || "").trim().toLowerCase();
}

function uniqueTools(skills: RuntimeSkill[]): string[] {
  const tools = new Set<string>();
  for (const skill of skills) {
    for (const tool of skill.tools ?? []) {
      const normalized = String(tool || "").trim();
      if (normalized.length > 0) {
        tools.add(normalized);
      }
    }
  }
  return Array.from(tools);
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars - 16)}\n...(truncated)`;
}

function buildCatalogPrompt(skills: RuntimeSkill[]): string {
  const lines = skills.map((skill) => {
    const description = (skill.description ?? "").trim();
    return description.length > 0
      ? `- ${skill.name} (${skill.id}): ${description}`
      : `- ${skill.name} (${skill.id})`;
  });
  return truncate(lines.join("\n"), CATALOG_PROMPT_LIMIT);
}

function buildDetailedPrompt(skills: RuntimeSkill[]): string {
  const sections = skills.map((skill) => {
    const body = truncate(
      (skill.prompt ?? skill.description ?? "No additional prompt available.").trim(),
      DETAILED_SECTION_LIMIT,
    );
    return `## ${skill.name} (${skill.id})\n${body}`;
  });
  return truncate(sections.join("\n\n"), DETAILED_PROMPT_LIMIT);
}

class SkillRegistry {
  private readonly skills = new Map<string, RuntimeSkill>();

  register(skill: RuntimeSkill): void {
    const id = normalizeId(skill.id);
    if (!id) {
      return;
    }
    this.skills.set(id, { ...skill, id });
  }

  get(id: string): RuntimeSkill | undefined {
    return this.skills.get(normalizeId(id));
  }

  list(): RuntimeSkill[] {
    return Array.from(this.skills.values());
  }

  clear(): void {
    this.skills.clear();
  }

  resolve(skillIds?: string[]): SkillResolveResult {
    const requestedIds = Array.isArray(skillIds)
      ? Array.from(new Set(skillIds.map(normalizeId).filter((id) => id.length > 0)))
      : [];

    const selected =
      requestedIds.length > 0
        ? requestedIds.map((id) => this.skills.get(id)).filter((skill): skill is RuntimeSkill => Boolean(skill))
        : this.list();

    return {
      skills: selected,
      prompt: requestedIds.length > 0 ? buildDetailedPrompt(selected) : buildCatalogPrompt(selected),
      tools: uniqueTools(selected),
    };
  }
}

export const skillRegistry = new SkillRegistry();
