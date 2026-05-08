import path from "node:path";

export type OpenClawRuntimeConfig = {
  enabled: boolean;
  gateway: {
    enabled: boolean;
    path: string;
  };
  tools: {
    enabled: boolean;
    safeBins: string[];
    workspaceRoot: string;
    execTimeout: number;
    execSecurity: "warn" | "strict" | "disabled";
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
    previewMode: "partial" | "full" | "disabled";
  };
};

const OPENCLAW_DIR = path.resolve(__dirname);
const DATA_DIR = process.env.ILIAGPT_DATA_DIR || path.resolve(process.cwd(), "data");

let cached: OpenClawRuntimeConfig | null = null;

export function getOpenClawConfig(): OpenClawRuntimeConfig {
  if (cached) return cached;

  cached = {
    enabled: process.env.OPENCLAW_ENABLED !== "false",
    gateway: {
      enabled: process.env.OPENCLAW_GATEWAY_ENABLED !== "false",
      path: process.env.OPENCLAW_GATEWAY_PATH || "/ws/openclaw",
    },
    tools: {
      enabled: process.env.OPENCLAW_TOOLS_ENABLED !== "false",
      safeBins: (process.env.OPENCLAW_SAFE_BINS || "node,python3,pip3,git,ls,cat,head,tail,grep,find,wc,sort,uniq,curl,wget").split(","),
      workspaceRoot: process.env.OPENCLAW_WORKSPACE_ROOT || path.join(DATA_DIR, "openclaw-workspaces"),
      execTimeout: Number(process.env.OPENCLAW_EXEC_TIMEOUT) || 30_000,
      execSecurity: (process.env.OPENCLAW_EXEC_SECURITY as "warn" | "strict" | "disabled") || "warn",
    },
    plugins: {
      enabled: process.env.OPENCLAW_PLUGINS_ENABLED !== "false",
      directory: process.env.OPENCLAW_PLUGINS_DIR || path.join(OPENCLAW_DIR, "extensions"),
    },
    skills: {
      enabled: process.env.OPENCLAW_SKILLS_ENABLED !== "false",
      directory: process.env.OPENCLAW_SKILLS_DIR || path.join(OPENCLAW_DIR, "skills"),
      extraDirectories: (process.env.OPENCLAW_SKILLS_EXTRA_DIRS || "").split(",").filter(Boolean),
      workspaceDirectory: process.env.OPENCLAW_SKILLS_WORKSPACE || path.join(DATA_DIR, "openclaw-workspace"),
      includeBuiltins: process.env.OPENCLAW_SKILLS_INCLUDE_BUILTINS !== "false",
      autoImportClawi: process.env.OPENCLAW_SKILLS_AUTO_IMPORT_CLAWI !== "false",
      maxSkillFileBytes: Number(process.env.OPENCLAW_SKILLS_MAX_FILE_BYTES) || 256_000,
    },
    streaming: {
      enabled: process.env.OPENCLAW_STREAMING_ENABLED !== "false",
      blockMinChars: Number(process.env.OPENCLAW_STREAMING_BLOCK_MIN) || 50,
      blockMaxChars: Number(process.env.OPENCLAW_STREAMING_BLOCK_MAX) || 500,
      previewMode: (process.env.OPENCLAW_STREAMING_PREVIEW as "partial" | "full" | "disabled") || "partial",
    },
  };

  return cached;
}
