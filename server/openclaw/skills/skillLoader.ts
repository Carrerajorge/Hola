import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../../services/superIntelligence/config/config.js";
import { loadWorkspaceSkillEntries } from "../../services/superIntelligence/agents/skills/workspace.js";
import { resolveSkillKey } from "../../services/superIntelligence/agents/skills/frontmatter.js";
import type { OpenClawConfig } from "../config";
import { skillRegistry, type Skill } from "./skillRegistry";

const DEFAULT_SKILL_TOOLS = [
  "openclaw_exec",
  "openclaw_read",
  "openclaw_write",
  "openclaw_edit",
  "openclaw_list",
] as const;

function normalizeSkillId(raw: string): string {
  const normalized = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "skill";
}

function unique(values: Array<string | undefined | null>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

function buildRuntimeConfig(legacyConfig?: OpenClawConfig) {
  const runtimeConfig = loadConfig();
  const extraDirs = unique([
    ...(runtimeConfig.skills?.load?.extraDirs || []),
    ...(legacyConfig?.skills.extraDirectories || []),
  ]);

  return {
    ...runtimeConfig,
    skills: {
      ...runtimeConfig.skills,
      enabled: legacyConfig?.skills.enabled ?? true,
      load: {
        ...runtimeConfig.skills?.load,
        extraDirs,
      },
      limits: {
        ...runtimeConfig.skills?.limits,
        maxSkillFileBytes:
          legacyConfig?.skills.maxSkillFileBytes ?? runtimeConfig.skills?.limits?.maxSkillFileBytes,
      },
    },
  };
}

function readUpdatedAt(filePath?: string): string | undefined {
  if (!filePath) return undefined;
  try {
    return fs.statSync(filePath).mtime.toISOString();
  } catch {
    return undefined;
  }
}

function toLegacySkill(entry: any): Skill {
  const resolvedId = normalizeSkillId(resolveSkillKey(entry.skill, entry));
  const prompt = typeof entry.skill?.prompt === "string" ? entry.skill.prompt.trim() : "";
  const filePath =
    typeof entry.skill?.filePath === "string" && entry.skill.filePath.trim()
      ? entry.skill.filePath
      : path.join(entry.skill?.baseDir || "", "SKILL.md");
  const tools = Array.isArray(entry.skill?.tools)
    ? entry.skill.tools.filter((value: unknown) => typeof value === "string" && value.trim())
    : [];

  return {
    id: resolvedId,
    name: entry.skill?.name || resolvedId,
    description:
      typeof entry.skill?.description === "string" ? entry.skill.description : undefined,
    prompt,
    tools: tools.length > 0 ? tools : [...DEFAULT_SKILL_TOOLS],
    source: typeof entry.skill?.source === "string" ? entry.skill.source : "workspace",
    filePath,
    updatedAt: readUpdatedAt(filePath),
  };
}

export async function initSkills(config?: OpenClawConfig): Promise<void> {
  if (config?.skills.enabled === false) {
    skillRegistry.clear();
    return;
  }

  const runtimeConfig = buildRuntimeConfig(config);
  const workspaceDir = config?.skills.workspaceDirectory || process.cwd();
  const entries = loadWorkspaceSkillEntries(workspaceDir, { config: runtimeConfig }).filter(
    (entry) => config?.skills.includeBuiltins !== false || entry.skill?.source !== "openclaw-bundled",
  );

  skillRegistry.clear();
  skillRegistry.registerMany(entries.map(toLegacySkill));

  console.info(`[OpenClaw:Skills] Registered ${skillRegistry.list().length} compatibility skills`);
}
