import path from 'path';
import os from 'os';

export type ToolProfile = 'minimal' | 'coding' | 'messaging' | 'full';

export interface OpenClawConfig {
  gateway: { enabled: boolean; path: string };
  tools: {
    enabled: boolean;
    safeBins: string[];
    workspaceRoot: string;
    execTimeout: number;
    execSecurity: 'ask' | 'warn' | 'allow';
    defaultProfile: ToolProfile;
  };
  commands: { enabled: boolean };
  cron: { enabled: boolean; maxJobsPerUser: number };
  memory: { enabled: boolean; directory: string };
  sessions: { enabled: boolean; maxPerUser: number };
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
    previewMode: 'off' | 'partial' | 'block' | 'progress';
  };
  sandbox: {
    enabled: boolean;
    defaultNetworkMode: 'none' | 'bridge';
    blockApiKeyLeak: boolean;
    readonlyRootfs: boolean;
  };
  advancedMemory: {
    enabled: boolean;
    vectorWeight: number;
    textWeight: number;
    temporalDecayHalfLifeDays: number;
    mmrLambda: number;
  };
  media: {
    enabled: boolean;
    maxFileSizeMb: number;
    storeTtlMinutes: number;
    ssrfBlockPrivateIps: boolean;
  };
  mediaUnderstanding: {
    enabled: boolean;
    whisperModel: string;
    geminiVideoModel: string;
  };
  authProfiles: {
    enabled: boolean;
    maxProfilesPerProvider: number;
    cooldownBaseMinutes: number;
    billingCooldownHours: number;
  };
}

const DEFAULT_SAFE_BINS = [
  'python', 'python3', 'node', 'npm', 'npx', 'pnpm', 'yarn', 'bun',
  'git', 'curl', 'wget', 'jq', 'cat', 'ls', 'find', 'grep', 'sed', 'awk',
  'echo', 'mkdir', 'cp', 'mv', 'rm', 'touch', 'head', 'tail', 'wc',
  'sort', 'uniq', 'diff', 'tar', 'gzip', 'gunzip', 'zip', 'unzip',
  'docker', 'docker-compose', 'make', 'cmake',
];

/**
 * Returns OpenClaw configuration.
 * All modules are ENABLED by default (opt-out via ENABLE_OPENCLAW_*=false).
 * In test environments all modules are disabled unless explicitly enabled.
 */
export function getOpenClawConfig(): OpenClawConfig {
  const isTest = process.env.NODE_ENV === 'test' || !!process.env.VITEST;

  const workspaceDirectory = process.env.OPENCLAW_WORKSPACE_DIR
    ? path.resolve(process.env.OPENCLAW_WORKSPACE_DIR)
    : process.cwd();
  const defaultSkillsDir = path.join(workspaceDirectory, 'server', 'openclaw', 'skills');
  const legacyHomeSkillsDir = path.join(os.homedir(), '.iliagpt', 'skills');

  // Helper: in production defaults to true (opt-out), in tests defaults to false (opt-in)
  const featureEnabled = (envVar: string): boolean => {
    const val = process.env[envVar];
    if (val === 'true') return true;
    if (val === 'false') return false;
    return !isTest; // default: enabled in prod, disabled in test
  };

  return {
    gateway: {
      enabled: featureEnabled('ENABLE_OPENCLAW_GATEWAY'),
      path: process.env.OPENCLAW_WS_PATH || '/ws/openclaw',
    },
    tools: {
      enabled: featureEnabled('ENABLE_OPENCLAW_TOOLS'),
      safeBins: process.env.OPENCLAW_SAFE_BINS
        ? process.env.OPENCLAW_SAFE_BINS.split(',').map(s => s.trim())
        : DEFAULT_SAFE_BINS,
      workspaceRoot: process.env.OPENCLAW_WORKSPACE_ROOT || '/tmp/openclaw-workspaces',
      execTimeout: Number(process.env.OPENCLAW_EXEC_TIMEOUT) || 120_000,
      execSecurity: (process.env.OPENCLAW_EXEC_SECURITY as any) || 'warn',
      defaultProfile: (process.env.OPENCLAW_TOOL_PROFILE as ToolProfile) || 'full',
    },
    commands: {
      enabled: featureEnabled('ENABLE_OPENCLAW_COMMANDS'),
    },
    cron: {
      enabled: featureEnabled('ENABLE_OPENCLAW_CRON'),
      maxJobsPerUser: Number(process.env.OPENCLAW_MAX_CRON_JOBS) || 100,
    },
    memory: {
      enabled: featureEnabled('ENABLE_OPENCLAW_MEMORY'),
      directory: process.env.OPENCLAW_MEMORY_DIR || '/tmp/openclaw-memory',
    },
    sessions: {
      enabled: featureEnabled('ENABLE_OPENCLAW_SESSIONS'),
      maxPerUser: Number(process.env.OPENCLAW_MAX_SESSIONS) || 50,
    },
    plugins: {
      enabled: featureEnabled('ENABLE_OPENCLAW_PLUGINS'),
      directory: process.env.OPENCLAW_PLUGINS_DIR || '~/.iliagpt/plugins',
    },
    skills: {
      enabled: featureEnabled('ENABLE_OPENCLAW_SKILLS'),
      directory: process.env.OPENCLAW_SKILLS_DIR
        ? path.resolve(process.env.OPENCLAW_SKILLS_DIR)
        : defaultSkillsDir,
      extraDirectories: process.env.OPENCLAW_SKILLS_EXTRA_DIRS
        ? process.env.OPENCLAW_SKILLS_EXTRA_DIRS.split(',').map(s => s.trim()).filter(Boolean)
        : [legacyHomeSkillsDir],
      workspaceDirectory,
      includeBuiltins: process.env.OPENCLAW_SKILLS_INCLUDE_BUILTINS !== 'false',
      autoImportClawi: process.env.OPENCLAW_SKILLS_AUTO_IMPORT_CLAWI !== 'false',
      maxSkillFileBytes: Number(process.env.OPENCLAW_SKILL_MAX_BYTES) || 256_000,
    },
    streaming: {
      enabled: featureEnabled('ENABLE_OPENCLAW_STREAMING'),
      blockMinChars: Number(process.env.OPENCLAW_BLOCK_MIN_CHARS) || 50,
      blockMaxChars: Number(process.env.OPENCLAW_BLOCK_MAX_CHARS) || 500,
      previewMode: (process.env.OPENCLAW_PREVIEW_MODE as any) || 'partial',
    },
    sandbox: {
      enabled: featureEnabled('ENABLE_OPENCLAW_SANDBOX'),
      defaultNetworkMode: (process.env.OPENCLAW_SANDBOX_NETWORK as any) || 'none',
      blockApiKeyLeak: process.env.OPENCLAW_SANDBOX_BLOCK_API_LEAK !== 'false',
      readonlyRootfs: process.env.OPENCLAW_SANDBOX_READONLY_ROOTFS === 'true',
    },
    advancedMemory: {
      enabled: featureEnabled('ENABLE_OPENCLAW_ADVANCED_MEMORY'),
      vectorWeight: Number(process.env.OPENCLAW_MEMORY_VECTOR_WEIGHT) || 0.7,
      textWeight: Number(process.env.OPENCLAW_MEMORY_TEXT_WEIGHT) || 0.3,
      temporalDecayHalfLifeDays: Number(process.env.OPENCLAW_MEMORY_DECAY_HALF_LIFE) || 14,
      mmrLambda: Number(process.env.OPENCLAW_MEMORY_MMR_LAMBDA) || 0.7,
    },
    media: {
      enabled: featureEnabled('ENABLE_OPENCLAW_MEDIA'),
      maxFileSizeMb: Number(process.env.OPENCLAW_MEDIA_MAX_SIZE_MB) || 50,
      storeTtlMinutes: Number(process.env.OPENCLAW_MEDIA_STORE_TTL) || 60,
      ssrfBlockPrivateIps: process.env.OPENCLAW_MEDIA_SSRF_BLOCK !== 'false',
    },
    mediaUnderstanding: {
      enabled: featureEnabled('ENABLE_OPENCLAW_MEDIA_UNDERSTANDING'),
      whisperModel: process.env.OPENCLAW_WHISPER_MODEL || 'whisper-1',
      geminiVideoModel: process.env.OPENCLAW_GEMINI_VIDEO_MODEL || 'gemini-2.0-flash',
    },
    authProfiles: {
      enabled: featureEnabled('ENABLE_OPENCLAW_AUTH_PROFILES'),
      maxProfilesPerProvider: Number(process.env.OPENCLAW_AUTH_MAX_PROFILES) || 5,
      cooldownBaseMinutes: Number(process.env.OPENCLAW_AUTH_COOLDOWN_BASE) || 1,
      billingCooldownHours: Number(process.env.OPENCLAW_AUTH_BILLING_COOLDOWN) || 5,
    },
  };
}
