import os from "node:os";
import path from "node:path";
import { loadConfig } from "../services/superIntelligence/config/config.js";
import { resolveBundledSkillsDir } from "../services/superIntelligence/agents/skills/bundled-dir.js";

export interface OpenClawConfig {
  gateway: { enabled: boolean; path: string };
  tools: {
    enabled: boolean;
    safeBins: string[];
    workspaceRoot: string;
    execTimeout: number;
    execSecurity: "ask" | "warn" | "allow";
  };
  plugins: { enabled: boolean; directory: string };
  skills: {
    enabled: boolean;
    directory: string;
    extraDirectories: string[];
    workspaceDirectory: string;
    includeBuiltins: boolean;
    autoImportClawi: boolean;
    maxSkillFileBytes: number;
  };
  streaming: {
    enabled: boolean;
    blockMinChars: number;
    blockMaxChars: number;
    previewMode: "off" | "partial" | "block" | "progress";
  };
}

const DEFAULT_SAFE_BINS = [
  "python",
  "python3",
  "node",
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "bun",
  "git",
  "curl",
  "wget",
  "jq",
  "cat",
  "ls",
  "find",
  "grep",
  "sed",
  "awk",
  "echo",
  "mkdir",
  "cp",
  "mv",
  "rm",
  "touch",
  "head",
  "tail",
  "wc",
  "sort",
  "uniq",
  "diff",
  "tar",
  "gzip",
  "gunzip",
  "zip",
  "unzip",
  "docker",
  "docker-compose",
  "make",
  "cmake",
] as const;

function resolveExecSecurity(rawSecurity?: string): OpenClawConfig["tools"]["execSecurity"] {
  const normalized = String(rawSecurity || "").trim().toLowerCase();
  if (normalized === "full") return "allow";
  if (normalized === "allowlist") return "warn";
  if (normalized === "deny") return "ask";
  const fallback = String(process.env.OPENCLAW_EXEC_SECURITY || "").trim().toLowerCase();
  if (fallback === "allow") return "allow";
  if (fallback === "ask") return "ask";
  return "warn";
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

function fallbackConfig(): OpenClawConfig {
  const workspaceDirectory = process.env.OPENCLAW_WORKSPACE_DIR
    ? path.resolve(process.env.OPENCLAW_WORKSPACE_DIR)
    : process.cwd();
  const bundledSkillsDir =
    resolveBundledSkillsDir({ cwd: workspaceDirectory }) ||
    path.join(workspaceDirectory, "server", "openclaw", "skills");
  const extraDirectories = unique([
    ...(process.env.OPENCLAW_SKILLS_EXTRA_DIRS || "")
      .split(",")
      .map((value) => value.trim()),
    path.join(os.homedir(), ".iliagpt", "skills"),
  ]);

  return {
    gateway: {
      enabled: process.env.ENABLE_OPENCLAW_GATEWAY === "true",
      path: process.env.OPENCLAW_WS_PATH || "/ws/openclaw",
    },
    tools: {
      enabled: process.env.ENABLE_OPENCLAW_TOOLS === "true",
      safeBins: process.env.OPENCLAW_SAFE_BINS
        ? process.env.OPENCLAW_SAFE_BINS.split(",").map((value) => value.trim()).filter(Boolean)
        : [...DEFAULT_SAFE_BINS],
      workspaceRoot: process.env.OPENCLAW_WORKSPACE_ROOT || "/tmp/openclaw-workspaces",
      execTimeout: Number(process.env.OPENCLAW_EXEC_TIMEOUT) || 120_000,
      execSecurity: resolveExecSecurity(process.env.OPENCLAW_EXEC_SECURITY),
    },
    plugins: {
      enabled: process.env.ENABLE_OPENCLAW_PLUGINS === "true",
      directory:
        process.env.OPENCLAW_PLUGINS_DIR || path.join(os.homedir(), ".openclaw", "extensions"),
    },
    skills: {
      enabled: process.env.ENABLE_OPENCLAW_SKILLS === "true",
      directory: bundledSkillsDir,
      extraDirectories,
      workspaceDirectory,
      includeBuiltins: process.env.OPENCLAW_SKILLS_INCLUDE_BUILTINS !== "false",
      autoImportClawi: process.env.OPENCLAW_SKILLS_AUTO_IMPORT_CLAWI !== "false",
      maxSkillFileBytes: Number(process.env.OPENCLAW_SKILL_MAX_BYTES) || 256_000,
    },
    streaming: {
      enabled: process.env.ENABLE_OPENCLAW_STREAMING === "true",
      blockMinChars: Number(process.env.OPENCLAW_BLOCK_MIN_CHARS) || 50,
      blockMaxChars: Number(process.env.OPENCLAW_BLOCK_MAX_CHARS) || 500,
      previewMode:
        (process.env.OPENCLAW_PREVIEW_MODE as OpenClawConfig["streaming"]["previewMode"]) ||
        "partial",
    },
  };
}

export function getOpenClawConfig(): OpenClawConfig {
  try {
    const runtime = loadConfig();
    const fallback = fallbackConfig();
    const exec = runtime.tools?.exec;
    const skillsLoad = runtime.skills?.load;

    return {
      gateway: {
        enabled: runtime.gateway?.enabled ?? fallback.gateway.enabled,
        path: runtime.gateway?.path || fallback.gateway.path,
      },
      tools: {
        enabled: fallback.tools.enabled,
        safeBins: exec?.safeBins?.length ? exec.safeBins.slice() : fallback.tools.safeBins,
        workspaceRoot: fallback.tools.workspaceRoot,
        execTimeout:
          typeof exec?.timeoutSec === "number" && Number.isFinite(exec.timeoutSec)
            ? Math.max(1, Math.trunc(exec.timeoutSec * 1000))
            : fallback.tools.execTimeout,
        execSecurity: resolveExecSecurity(exec?.security),
      },
      plugins: {
        enabled: runtime.plugins?.enabled ?? fallback.plugins.enabled,
        directory:
          runtime.plugins?.load?.paths?.find((value) => typeof value === "string" && value.trim()) ||
          fallback.plugins.directory,
      },
      skills: {
        enabled: runtime.skills?.enabled ?? fallback.skills.enabled,
        directory: resolveBundledSkillsDir({ cwd: fallback.skills.workspaceDirectory }) || fallback.skills.directory,
        extraDirectories: unique([
          ...(skillsLoad?.extraDirs || []),
          ...fallback.skills.extraDirectories,
        ]),
        workspaceDirectory: fallback.skills.workspaceDirectory,
        includeBuiltins: fallback.skills.includeBuiltins,
        autoImportClawi: fallback.skills.autoImportClawi,
        maxSkillFileBytes:
          runtime.skills?.limits?.maxSkillFileBytes ?? fallback.skills.maxSkillFileBytes,
      },
      streaming: fallback.streaming,
    };
  } catch {
    return fallbackConfig();
  }
}
