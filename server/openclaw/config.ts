import path from 'path';
import os from 'os';

export interface OpenClawConfig {
  gateway: { enabled: boolean; path: string };
  tools: {
    enabled: boolean;
    safeBins: string[];
    workspaceRoot: string;
    execTimeout: number;
    execSecurity: 'ask' | 'warn' | 'allow';
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
    previewMode: 'off' | 'partial' | 'block' | 'progress';
  };
  memory: {
    enabled: boolean;
    embeddingProvider: string;
    embeddingModel: string;
    chunkSize: number;
    chunkOverlap: number;
    hybridSearch: boolean;
    vectorWeight: number;
    textWeight: number;
    mmrEnabled: boolean;
    mmrLambda: number;
    temporalDecayEnabled: boolean;
    temporalDecayHalfLifeDays: number;
    maxResults: number;
    minScore: number;
  };
  modelFallback: {
    enabled: boolean;
    cooldownMs: number;
    maxAttempts: number;
  };
  routing: {
    enabled: boolean;
    agentsConfigPath: string;
  };
  workspace: {
    enabled: boolean;
    directory: string;
  };
  sessions: {
    enabled: boolean;
    directory: string;
    compactionDays: number;
  };
}

const DEFAULT_SAFE_BINS = [
  'python', 'python3', 'node', 'npm', 'npx', 'pnpm', 'yarn', 'bun',
  'git', 'curl', 'wget', 'jq', 'cat', 'ls', 'find', 'grep', 'sed', 'awk',
  'echo', 'mkdir', 'cp', 'mv', 'rm', 'touch', 'head', 'tail', 'wc',
  'sort', 'uniq', 'diff', 'tar', 'gzip', 'gunzip', 'zip', 'unzip',
  'docker', 'docker-compose', 'make', 'cmake',
];

function toExecSecurity(val: string | undefined): 'ask' | 'warn' | 'allow' | undefined {
  if (val === 'ask' || val === 'warn' || val === 'allow') return val;
  return undefined;
}

function toPreviewMode(val: string | undefined): 'off' | 'partial' | 'block' | 'progress' | undefined {
  if (val === 'off' || val === 'partial' || val === 'block' || val === 'progress') return val;
  return undefined;
}

export function getOpenClawConfig(): OpenClawConfig {
  const workspaceDirectory = process.env.OPENCLAW_WORKSPACE_DIR
    ? path.resolve(process.env.OPENCLAW_WORKSPACE_DIR)
    : process.cwd();
  const defaultSkillsDir = path.join(workspaceDirectory, 'server', 'openclaw', 'skills');
  const legacyHomeSkillsDir = path.join(os.homedir(), '.iliagpt', 'skills');

  return {
    gateway: {
      enabled: true,
      path: process.env.OPENCLAW_WS_PATH || '/ws/openclaw',
    },
    tools: {
      enabled: true,
      safeBins: process.env.OPENCLAW_SAFE_BINS
        ? process.env.OPENCLAW_SAFE_BINS.split(',').map(s => s.trim())
        : DEFAULT_SAFE_BINS,
      workspaceRoot: process.env.OPENCLAW_WORKSPACE_ROOT || '/tmp/openclaw-workspaces',
      execTimeout: Number(process.env.OPENCLAW_EXEC_TIMEOUT) || 120_000,
      execSecurity: toExecSecurity(process.env.OPENCLAW_EXEC_SECURITY) ?? 'warn',
    },
    plugins: {
      enabled: true,
      directory: process.env.OPENCLAW_PLUGINS_DIR || '~/.iliagpt/plugins',
    },
    skills: {
      enabled: true,
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
      enabled: true,
      blockMinChars: Number(process.env.OPENCLAW_BLOCK_MIN_CHARS) || 50,
      blockMaxChars: Number(process.env.OPENCLAW_BLOCK_MAX_CHARS) || 500,
      previewMode: toPreviewMode(process.env.OPENCLAW_PREVIEW_MODE) ?? 'partial',
    },
    memory: {
      enabled: process.env.OPENCLAW_MEMORY_ENABLED === 'true',
      embeddingProvider: process.env.OPENCLAW_EMBEDDING_PROVIDER || 'gemini',
      embeddingModel: process.env.OPENCLAW_EMBEDDING_MODEL || 'text-embedding-004',
      chunkSize: Number(process.env.OPENCLAW_MEMORY_CHUNK_SIZE) || 512,
      chunkOverlap: Number(process.env.OPENCLAW_MEMORY_CHUNK_OVERLAP) || 64,
      hybridSearch: process.env.OPENCLAW_HYBRID_SEARCH !== 'false',
      vectorWeight: Number(process.env.OPENCLAW_VECTOR_WEIGHT) || 0.7,
      textWeight: Number(process.env.OPENCLAW_TEXT_WEIGHT) || 0.3,
      mmrEnabled: process.env.OPENCLAW_MMR_ENABLED !== 'false',
      mmrLambda: Number(process.env.OPENCLAW_MMR_LAMBDA) || 0.5,
      temporalDecayEnabled: process.env.OPENCLAW_TEMPORAL_DECAY === 'true',
      temporalDecayHalfLifeDays: Number(process.env.OPENCLAW_TEMPORAL_DECAY_DAYS) || 30,
      maxResults: Number(process.env.OPENCLAW_MEMORY_MAX_RESULTS) || 10,
      minScore: Number(process.env.OPENCLAW_MEMORY_MIN_SCORE) || 0.1,
    },
    modelFallback: {
      enabled: process.env.OPENCLAW_MODEL_FALLBACK !== 'false',
      cooldownMs: Number(process.env.OPENCLAW_FALLBACK_COOLDOWN) || 300_000,
      maxAttempts: Number(process.env.OPENCLAW_FALLBACK_MAX_ATTEMPTS) || 3,
    },
    routing: {
      enabled: process.env.OPENCLAW_ROUTING_ENABLED === 'true',
      agentsConfigPath: process.env.OPENCLAW_AGENTS_CONFIG || '~/.iliagpt/agents.yaml',
    },
    workspace: {
      enabled: process.env.OPENCLAW_WORKSPACES_ENABLED === 'true',
      directory: process.env.OPENCLAW_WORKSPACES_DIR || '~/.iliagpt/workspaces',
    },
    sessions: {
      enabled: process.env.OPENCLAW_SESSIONS_ENABLED === 'true',
      directory: process.env.OPENCLAW_SESSIONS_DIR || '~/.iliagpt/sessions',
      compactionDays: Number(process.env.OPENCLAW_SESSIONS_COMPACTION_DAYS) || 30,
    },
  };
}
