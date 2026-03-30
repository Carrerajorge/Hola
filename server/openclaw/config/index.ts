import path from "node:path";
import { loadConfig } from "../../services/superIntelligence/config/config.js";

export type OpenClawConfig = {
  gateway: {
    enabled: boolean;
    path: string;
  };
  tools: {
    enabled: boolean;
    safeBins: string[];
    workspaceRoot: string;
    execTimeout: number;
    execSecurity: "warn" | "deny" | "allow";
  };
  plugins: {
    enabled: boolean;
    directory: string;
  };
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
    previewMode: "partial" | "full";
  };
};

function sanitizeStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

function buildFallbackConfig(): OpenClawConfig {
  const workspaceDirectory = process.cwd();
  return {
    gateway: {
      enabled: true,
      path: "/ws/openclaw",
    },
    tools: {
      enabled: true,
      safeBins: [],
      workspaceRoot: workspaceDirectory,
      execTimeout: 120000,
      execSecurity: "warn",
    },
    plugins: {
      enabled: false,
      directory: "",
    },
    skills: {
      enabled: true,
      directory: path.resolve(workspaceDirectory, "server/openclaw/skills"),
      extraDirectories: [],
      workspaceDirectory,
      includeBuiltins: true,
      autoImportClawi: false,
      maxSkillFileBytes: 256 * 1024,
    },
    streaming: {
      enabled: false,
      blockMinChars: 50,
      blockMaxChars: 500,
      previewMode: "partial",
    },
  };
}

export function getOpenClawConfig(): OpenClawConfig {
  const fallback = buildFallbackConfig();

  try {
    const runtimeConfig = loadConfig();
    return {
      gateway: {
        enabled: true,
        path:
          typeof runtimeConfig.gateway?.path === "string" && runtimeConfig.gateway.path.trim()
            ? runtimeConfig.gateway.path
            : fallback.gateway.path,
      },
      tools: {
        ...fallback.tools,
      },
      plugins: {
        enabled: Boolean(runtimeConfig.plugins),
        directory: fallback.plugins.directory,
      },
      skills: {
        ...fallback.skills,
        extraDirectories: sanitizeStringArray(runtimeConfig.skills?.load?.extraDirs),
        maxSkillFileBytes:
          runtimeConfig.skills?.limits?.maxSkillFileBytes ?? fallback.skills.maxSkillFileBytes,
      },
      streaming: fallback.streaming,
    };
  } catch {
    return fallback;
  }
}
