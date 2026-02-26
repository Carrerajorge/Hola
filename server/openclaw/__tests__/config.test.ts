import { describe, it, expect } from 'vitest';
import { getOpenClawConfig } from '../config';

describe('OpenClaw Config', () => {
  it('returns disabled by default when env vars are not set', () => {
    const config = getOpenClawConfig();
    expect(config.gateway.enabled).toBe(false);
    expect(config.tools.enabled).toBe(false);
    expect(config.plugins.enabled).toBe(false);
    expect(config.skills.enabled).toBe(false);
    expect(config.streaming.enabled).toBe(false);
  });

  it('reads safe-bins from env', () => {
    process.env.OPENCLAW_SAFE_BINS = 'python,node,git';
    const config = getOpenClawConfig();
    expect(config.tools.safeBins).toEqual(['python', 'node', 'git']);
    delete process.env.OPENCLAW_SAFE_BINS;
  });

  it('returns default safe-bins when env is not set', () => {
    delete process.env.OPENCLAW_SAFE_BINS;
    const config = getOpenClawConfig();
    expect(config.tools.safeBins).toContain('python');
    expect(config.tools.safeBins).toContain('node');
    expect(config.tools.safeBins).toContain('git');
    expect(config.tools.safeBins.length).toBeGreaterThan(10);
  });

  it('reads gateway path from env', () => {
    process.env.OPENCLAW_WS_PATH = '/custom/ws';
    const config = getOpenClawConfig();
    expect(config.gateway.path).toBe('/custom/ws');
    delete process.env.OPENCLAW_WS_PATH;
  });

  it('reads skills extra dirs and toggles from env', () => {
    process.env.OPENCLAW_SKILLS_EXTRA_DIRS = '/tmp/s1,/tmp/s2';
    process.env.OPENCLAW_SKILLS_INCLUDE_BUILTINS = 'false';
    process.env.OPENCLAW_SKILLS_AUTO_IMPORT_CLAWI = 'false';
    process.env.OPENCLAW_SKILL_MAX_BYTES = '12345';

    const config = getOpenClawConfig();
    expect(config.skills.extraDirectories).toEqual(['/tmp/s1', '/tmp/s2']);
    expect(config.skills.includeBuiltins).toBe(false);
    expect(config.skills.autoImportClawi).toBe(false);
    expect(config.skills.maxSkillFileBytes).toBe(12345);

    delete process.env.OPENCLAW_SKILLS_EXTRA_DIRS;
    delete process.env.OPENCLAW_SKILLS_INCLUDE_BUILTINS;
    delete process.env.OPENCLAW_SKILLS_AUTO_IMPORT_CLAWI;
    delete process.env.OPENCLAW_SKILL_MAX_BYTES;
  });

  // ── Memory config ───────────────────────────────────────────────

  describe('memory', () => {
    it('returns sensible defaults when env vars are not set', () => {
      const config = getOpenClawConfig();
      expect(config.memory.enabled).toBe(false);
      expect(config.memory.embeddingProvider).toBe('gemini');
      expect(config.memory.embeddingModel).toBe('text-embedding-004');
      expect(config.memory.chunkSize).toBe(512);
      expect(config.memory.chunkOverlap).toBe(64);
      expect(config.memory.hybridSearch).toBe(true);
      expect(config.memory.vectorWeight).toBe(0.7);
      expect(config.memory.textWeight).toBe(0.3);
      expect(config.memory.mmrEnabled).toBe(true);
      expect(config.memory.mmrLambda).toBe(0.5);
      expect(config.memory.temporalDecayEnabled).toBe(false);
      expect(config.memory.temporalDecayHalfLifeDays).toBe(30);
      expect(config.memory.maxResults).toBe(10);
      expect(config.memory.minScore).toBe(0.1);
    });

    it('reads memory settings from env', () => {
      process.env.OPENCLAW_MEMORY_ENABLED = 'true';
      process.env.OPENCLAW_EMBEDDING_PROVIDER = 'openai';
      process.env.OPENCLAW_EMBEDDING_MODEL = 'text-embedding-3-small';
      process.env.OPENCLAW_MEMORY_CHUNK_SIZE = '1024';
      process.env.OPENCLAW_MEMORY_CHUNK_OVERLAP = '128';
      process.env.OPENCLAW_HYBRID_SEARCH = 'false';
      process.env.OPENCLAW_VECTOR_WEIGHT = '0.8';
      process.env.OPENCLAW_TEXT_WEIGHT = '0.2';
      process.env.OPENCLAW_MMR_ENABLED = 'false';
      process.env.OPENCLAW_MMR_LAMBDA = '0.7';
      process.env.OPENCLAW_TEMPORAL_DECAY = 'true';
      process.env.OPENCLAW_TEMPORAL_DECAY_DAYS = '60';
      process.env.OPENCLAW_MEMORY_MAX_RESULTS = '25';
      process.env.OPENCLAW_MEMORY_MIN_SCORE = '0.5';

      const config = getOpenClawConfig();
      expect(config.memory.enabled).toBe(true);
      expect(config.memory.embeddingProvider).toBe('openai');
      expect(config.memory.embeddingModel).toBe('text-embedding-3-small');
      expect(config.memory.chunkSize).toBe(1024);
      expect(config.memory.chunkOverlap).toBe(128);
      expect(config.memory.hybridSearch).toBe(false);
      expect(config.memory.vectorWeight).toBe(0.8);
      expect(config.memory.textWeight).toBe(0.2);
      expect(config.memory.mmrEnabled).toBe(false);
      expect(config.memory.mmrLambda).toBe(0.7);
      expect(config.memory.temporalDecayEnabled).toBe(true);
      expect(config.memory.temporalDecayHalfLifeDays).toBe(60);
      expect(config.memory.maxResults).toBe(25);
      expect(config.memory.minScore).toBe(0.5);

      delete process.env.OPENCLAW_MEMORY_ENABLED;
      delete process.env.OPENCLAW_EMBEDDING_PROVIDER;
      delete process.env.OPENCLAW_EMBEDDING_MODEL;
      delete process.env.OPENCLAW_MEMORY_CHUNK_SIZE;
      delete process.env.OPENCLAW_MEMORY_CHUNK_OVERLAP;
      delete process.env.OPENCLAW_HYBRID_SEARCH;
      delete process.env.OPENCLAW_VECTOR_WEIGHT;
      delete process.env.OPENCLAW_TEXT_WEIGHT;
      delete process.env.OPENCLAW_MMR_ENABLED;
      delete process.env.OPENCLAW_MMR_LAMBDA;
      delete process.env.OPENCLAW_TEMPORAL_DECAY;
      delete process.env.OPENCLAW_TEMPORAL_DECAY_DAYS;
      delete process.env.OPENCLAW_MEMORY_MAX_RESULTS;
      delete process.env.OPENCLAW_MEMORY_MIN_SCORE;
    });
  });

  // ── Model Fallback config ───────────────────────────────────────

  describe('modelFallback', () => {
    it('returns enabled by default with sensible defaults', () => {
      const config = getOpenClawConfig();
      expect(config.modelFallback.enabled).toBe(true);
      expect(config.modelFallback.cooldownMs).toBe(300_000);
      expect(config.modelFallback.maxAttempts).toBe(3);
    });

    it('reads fallback settings from env', () => {
      process.env.OPENCLAW_MODEL_FALLBACK = 'false';
      process.env.OPENCLAW_FALLBACK_COOLDOWN = '60000';
      process.env.OPENCLAW_FALLBACK_MAX_ATTEMPTS = '5';

      const config = getOpenClawConfig();
      expect(config.modelFallback.enabled).toBe(false);
      expect(config.modelFallback.cooldownMs).toBe(60_000);
      expect(config.modelFallback.maxAttempts).toBe(5);

      delete process.env.OPENCLAW_MODEL_FALLBACK;
      delete process.env.OPENCLAW_FALLBACK_COOLDOWN;
      delete process.env.OPENCLAW_FALLBACK_MAX_ATTEMPTS;
    });
  });

  // ── Routing config ──────────────────────────────────────────────

  describe('routing', () => {
    it('returns disabled by default with default agents path', () => {
      const config = getOpenClawConfig();
      expect(config.routing.enabled).toBe(false);
      expect(config.routing.agentsConfigPath).toBe('~/.iliagpt/agents.yaml');
    });

    it('reads routing settings from env', () => {
      process.env.OPENCLAW_ROUTING_ENABLED = 'true';
      process.env.OPENCLAW_AGENTS_CONFIG = '/etc/iliagpt/agents.yaml';

      const config = getOpenClawConfig();
      expect(config.routing.enabled).toBe(true);
      expect(config.routing.agentsConfigPath).toBe('/etc/iliagpt/agents.yaml');

      delete process.env.OPENCLAW_ROUTING_ENABLED;
      delete process.env.OPENCLAW_AGENTS_CONFIG;
    });
  });

  // ── Workspace config ────────────────────────────────────────────

  describe('workspace', () => {
    it('returns disabled by default with default directory', () => {
      const config = getOpenClawConfig();
      expect(config.workspace.enabled).toBe(false);
      expect(config.workspace.directory).toBe('~/.iliagpt/workspaces');
    });

    it('reads workspace settings from env', () => {
      process.env.OPENCLAW_WORKSPACES_ENABLED = 'true';
      process.env.OPENCLAW_WORKSPACES_DIR = '/var/lib/iliagpt/workspaces';

      const config = getOpenClawConfig();
      expect(config.workspace.enabled).toBe(true);
      expect(config.workspace.directory).toBe('/var/lib/iliagpt/workspaces');

      delete process.env.OPENCLAW_WORKSPACES_ENABLED;
      delete process.env.OPENCLAW_WORKSPACES_DIR;
    });
  });

  // ── Sessions config ─────────────────────────────────────────────

  describe('sessions', () => {
    it('returns disabled by default with sensible defaults', () => {
      const config = getOpenClawConfig();
      expect(config.sessions.enabled).toBe(false);
      expect(config.sessions.directory).toBe('~/.iliagpt/sessions');
      expect(config.sessions.compactionDays).toBe(30);
    });

    it('reads sessions settings from env', () => {
      process.env.OPENCLAW_SESSIONS_ENABLED = 'true';
      process.env.OPENCLAW_SESSIONS_DIR = '/tmp/sessions';
      process.env.OPENCLAW_SESSIONS_COMPACTION_DAYS = '7';

      const config = getOpenClawConfig();
      expect(config.sessions.enabled).toBe(true);
      expect(config.sessions.directory).toBe('/tmp/sessions');
      expect(config.sessions.compactionDays).toBe(7);

      delete process.env.OPENCLAW_SESSIONS_ENABLED;
      delete process.env.OPENCLAW_SESSIONS_DIR;
      delete process.env.OPENCLAW_SESSIONS_COMPACTION_DAYS;
    });
  });
});
