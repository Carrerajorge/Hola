import fs from "node:fs/promises";
import path from "node:path";
import { BUNDLED_SKILLS } from "../../data/bundledSkills";
import type { OpenClawRuntimeConfig } from "../config";
import { skillRegistry, type RuntimeSkill } from "./skillRegistry";

type FrontmatterFields = {
  name?: string;
  description?: string;
};

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function humanizeId(id: string): string {
  return id
    .split(/[-_]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseFrontmatter(markdown: string): { fields: FrontmatterFields; body: string } {
  const normalized = String(markdown || "");
  if (!normalized.startsWith("---\n")) {
    return { fields: {}, body: normalized.trim() };
  }

  const closingIndex = normalized.indexOf("\n---", 4);
  if (closingIndex === -1) {
    return { fields: {}, body: normalized.trim() };
  }

  const rawFrontmatter = normalized.slice(4, closingIndex).trim();
  const body = normalized.slice(closingIndex + 4).trim();
  const fields: FrontmatterFields = {};

  for (const line of rawFrontmatter.split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
    if (!match) {
      continue;
    }
    const [, key, value] = match;
    if (key === "name" || key === "description") {
      fields[key] = unquote(value);
    }
  }

  return { fields, body };
}

function extractFallbackPrompt(description?: string, features?: string[]): string {
  const lines = [String(description || "").trim()].filter((line) => line.length > 0);
  const featureLines = (features ?? [])
    .map((feature) => String(feature || "").trim())
    .filter((feature) => feature.length > 0)
    .map((feature) => `- ${feature}`);

  if (featureLines.length > 0) {
    lines.push("Features:", ...featureLines);
  }

  return lines.join("\n");
}

async function loadRuntimeSkillFromFile(skillId: string, filePath: string): Promise<RuntimeSkill> {
  const [markdown, stats] = await Promise.all([
    fs.readFile(filePath, "utf8"),
    fs.stat(filePath),
  ]);
  const { fields, body } = parseFrontmatter(markdown);
  const bundledMeta = BUNDLED_SKILLS.find((skill) => skill.id === skillId);

  return {
    id: skillId,
    name: fields.name || bundledMeta?.name || humanizeId(skillId),
    description: fields.description || bundledMeta?.description || "",
    prompt: body || extractFallbackPrompt(bundledMeta?.description, bundledMeta?.features),
    tools: [],
    source: "openclaw-bundled",
    filePath,
    updatedAt: stats.mtime.toISOString(),
  };
}

async function listSkillMarkdownFiles(skillsDirectory: string): Promise<Array<{ id: string; filePath: string }>> {
  try {
    const entries = await fs.readdir(skillsDirectory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        id: entry.name,
        filePath: path.join(skillsDirectory, entry.name, "SKILL.md"),
      }));
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function initSkills(config: OpenClawRuntimeConfig): Promise<void> {
  skillRegistry.clear();

  if (!config.enabled || !config.skills.enabled) {
    return;
  }

  const runtimeSkills: RuntimeSkill[] = [];
  const discovered = await listSkillMarkdownFiles(config.skills.directory);
  const seen = new Set<string>();

  for (const entry of discovered) {
    seen.add(entry.id);
    try {
      await fs.access(entry.filePath);
      runtimeSkills.push(await loadRuntimeSkillFromFile(entry.id, entry.filePath));
    } catch (error) {
      console.warn(
        `[OpenClaw] Failed to load bundled skill ${entry.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  for (const bundled of BUNDLED_SKILLS) {
    if (seen.has(bundled.id)) {
      continue;
    }

    runtimeSkills.push({
      id: bundled.id,
      name: bundled.name || humanizeId(bundled.id),
      description: bundled.description,
      prompt: extractFallbackPrompt(bundled.description, bundled.features),
      tools: [],
      source: "openclaw-bundled",
      filePath: path.join(config.skills.directory, bundled.id, "SKILL.md"),
      updatedAt: new Date(0).toISOString(),
    });
  }

  for (const skill of runtimeSkills) {
    skillRegistry.register(skill);
  }
}
