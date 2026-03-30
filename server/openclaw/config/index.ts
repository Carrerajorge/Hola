import path from "node:path";

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (typeof raw !== "string") {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
}

function readNonEmptyEnv(name: string, fallback: string): string {
  const raw = process.env[name];
  if (typeof raw !== "string") {
    return fallback;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export type OpenClawRuntimeConfig = {
  enabled: boolean;
  skills: {
    enabled: boolean;
    directory: string;
  };
  tools: {
    enabled: boolean;
  };
  gateway: {
    enabled: boolean;
    path: string;
  };
};

export function getOpenClawConfig(): OpenClawRuntimeConfig {
  const runtimeRoot = path.resolve(process.cwd(), "server", "openclaw");
  const defaultSkillsDirectory = path.join(runtimeRoot, "skills");

  return {
    enabled: readBooleanEnv("ENABLE_OPENCLAW_GATEWAY", true),
    skills: {
      enabled: readBooleanEnv("ENABLE_OPENCLAW_SKILLS", true),
      directory: readNonEmptyEnv("OPENCLAW_SKILLS_DIRECTORY", defaultSkillsDirectory),
    },
    tools: {
      enabled: readBooleanEnv("ENABLE_OPENCLAW_TOOLS", true),
    },
    gateway: {
      enabled: readBooleanEnv("ENABLE_OPENCLAW_GATEWAY", true),
      path: readNonEmptyEnv("OPENCLAW_GATEWAY_PATH", "/api/openclaw/runtime"),
    },
  };
}
