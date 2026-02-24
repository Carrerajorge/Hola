import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Module imports
import { getOpenClawConfig } from '../config';
import { MemoryIndexManager } from '../memory/indexManager';
import { loadWorkspaceSkills } from '../skills/workspace';
import { filterSkillsForAgent } from '../skills/filter';
import { normalizeModelRef, resolveModelAlias } from '../modelFallback/selection';
import { runWithModelFallback, clearCooldowns } from '../modelFallback/fallback';
import { getModelInfo, listModels } from '../modelFallback/catalog';
import { buildMainSessionKey, parseSessionKey } from '../routing/sessionKey';
import { resolveAgentConfig, resolveDefaultAgentId } from '../routing/agentScope';
import { resolveRoute } from '../routing/resolver';
import { WorkspaceManager } from '../workspace/manager';
import { loadBootstrapFiles } from '../workspace/bootstrap';
import { FileCache } from '../workspace/fileCache';
import { getToolProfile } from '../tools/toolProfiles';
import { buildPolicyPipeline, applyPolicyPipeline } from '../tools/policyPipeline';
import { SessionStore } from '../sessions/persistence';
import { applySessionOverride } from '../sessions/overrides';
import { compactSessions } from '../sessions/compaction';
import { createInternalHooks } from '../plugins/internalHooks';
import { definePlugin, validatePlugin } from '../plugins/pluginSDK';
import { discoverPlugins } from '../plugins/pluginFsLoader';
import type { AgentEntry, SessionKey, PersistedSession } from '../types';

describe('OpenClaw Integration Test', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'openclaw-integration-'));
    clearCooldowns();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── 1. Config ────────────────────────────────────────────────────────

  it('full config loads with all module sections', () => {
    const config = getOpenClawConfig();
    expect(config.memory).toBeDefined();
    expect(config.modelFallback).toBeDefined();
    expect(config.routing).toBeDefined();
    expect(config.workspace).toBeDefined();
    expect(config.sessions).toBeDefined();
    expect(config.tools).toBeDefined();
    expect(config.plugins).toBeDefined();
    expect(config.skills).toBeDefined();
    expect(config.streaming).toBeDefined();
  });

  // ── 2. Memory / RAG ─────────────────────────────────────────────────

  it('Memory/RAG: index -> search pipeline works end-to-end', async () => {
    const mgr = await MemoryIndexManager.create({
      embeddingProvider: null,
      config: {
        chunkSize: 100,
        chunkOverlap: 10,
        maxResults: 5,
        minScore: 0,
        vectorWeight: 0.7,
        textWeight: 0.3,
        mmrEnabled: false,
        mmrLambda: 0.5,
        temporalDecayEnabled: false,
        temporalDecayHalfLifeDays: 30,
      },
    });

    await mgr.index([
      { path: 'auth.md', content: 'JWT authentication with refresh tokens and session management' },
      { path: 'deploy.md', content: 'Kubernetes deployment with Helm charts and auto-scaling' },
      { path: 'db.md', content: 'PostgreSQL database with Drizzle ORM and pgvector extension' },
    ]);

    const results = await mgr.search('authentication tokens');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toBe('auth.md');
    expect(mgr.status().documentCount).toBe(3);
  });

  // ── 3. Skills ────────────────────────────────────────────────────────

  it('Skills: load from workspace -> filter by agent', async () => {
    const skillsDir = join(tempDir, 'skills');
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(
      join(skillsDir, 'coding.md'),
      '---\nname: Coding\ndescription: Code helper\n---\nHelp with code',
    );
    writeFileSync(
      join(skillsDir, 'web.md'),
      '---\nname: Web Scraper\ndescription: Scrape web\nos: [darwin, linux]\n---\nScrape things',
    );

    const skills = await loadWorkspaceSkills(skillsDir);
    expect(skills.length).toBe(2);

    const filtered = filterSkillsForAgent(skills, { allow: ['coding'] });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('coding');
  });

  // ── 4. Model Fallback ───────────────────────────────────────────────

  it('Model Fallback: alias -> resolve -> fallback chain', async () => {
    // Resolve aliases
    const best = resolveModelAlias('best');
    expect(best.provider).toBeDefined();
    expect(best.model).toBeDefined();

    // Normalize
    const normalized = normalizeModelRef('opus-4.6');
    expect(normalized.model).toBe('claude-opus-4-6');

    // Catalog lookup
    const info = getModelInfo('claude-opus-4-6');
    expect(info).not.toBeNull();
    expect(info!.contextWindow).toBeGreaterThan(100000);

    // List models with filter
    const anthropicModels = listModels({ provider: 'anthropic' });
    expect(anthropicModels.length).toBeGreaterThan(0);
    expect(anthropicModels.every(m => m.provider === 'anthropic')).toBe(true);

    // Verify 5 Grok models in catalog
    const xaiModels = listModels({ provider: 'xai' });
    expect(xaiModels).toHaveLength(5);
    const grokIds = xaiModels.map(m => m.id).sort();
    expect(grokIds).toEqual([
      'grok-3',
      'grok-3-fast',
      'grok-4-0709',
      'grok-4-1-fast-non-reasoning',
      'grok-4-1-fast-reasoning',
    ]);

    // Verify Grok alias resolution
    const grokRef = normalizeModelRef('grok');
    expect(grokRef.model).toBe('grok-4-1-fast-non-reasoning');

    // Fallback chain
    let attempts = 0;
    const result = await runWithModelFallback({
      candidates: [
        { provider: 'primary', model: 'model-a' },
        { provider: 'fallback', model: 'model-b' },
      ],
      execute: async (ref) => {
        attempts++;
        if (attempts === 1) throw new Error('primary down');
        return `success-from-${ref.provider}`;
      },
      cooldownMs: 1000,
    });
    expect(result.result).toBe('success-from-fallback');
    expect(result.attempts).toHaveLength(2);
  });

  // ── 5. Routing ──────────────────────────────────────────────────────

  it('Routing: agent scope -> session key -> route resolution', () => {
    const agents: AgentEntry[] = [
      {
        id: 'main',
        name: 'Main Agent',
        default: true,
        model: { primary: 'claude-sonnet-4-6', fallbacks: ['gemini-2.0-flash'] },
        skills: ['coding'],
      },
      { id: 'support', name: 'Support Agent', model: 'gpt-4o' },
    ];

    // Default agent
    expect(resolveDefaultAgentId(agents)).toBe('main');

    // Resolve config
    const config = resolveAgentConfig('main', agents);
    expect(config).not.toBeNull();
    expect(config!.model).toBe('claude-sonnet-4-6');
    expect(config!.fallbacks).toEqual(['gemini-2.0-flash']);

    // Session keys
    const key = buildMainSessionKey('main', 'user123');
    expect(key).toContain('agent:main:main:user123');
    const parsed = parseSessionKey(key);
    expect(parsed).not.toBeNull();
    expect(parsed!.agentId).toBe('main');

    // Route resolution — peer route via channel binding
    const route = resolveRoute(
      { channel: 'slack', accountId: 'user1', peerId: 'chan-general' },
      agents,
      [{ channel: 'slack', agentId: 'support' }],
    );
    expect(route.agentId).toBe('support');
    expect(route.sessionKey).toContain('peer');
  });

  // ── 6. Workspace ────────────────────────────────────────────────────

  it('Workspace: create -> load bootstrap -> file cache', () => {
    const mgr = new WorkspaceManager(tempDir);
    const wsDir = mgr.ensureWorkspace('test-agent');
    writeFileSync(join(wsDir, 'SOUL.md'), 'You are helpful.');

    const files = loadBootstrapFiles(wsDir);
    const soul = files.find(f => f.name === 'SOUL.md');
    expect(soul?.content).toBe('You are helpful.');
    expect(soul?.missing).toBe(false);

    // Missing bootstrap files are reported correctly
    const identity = files.find(f => f.name === 'IDENTITY.md');
    expect(identity?.missing).toBe(true);
    expect(identity?.content).toBeNull();

    // File cache
    const cache = new FileCache();
    expect(cache.read(join(wsDir, 'SOUL.md'))).toBe('You are helpful.');
    expect(cache.size).toBe(1);
    // Second read hits cache
    expect(cache.read(join(wsDir, 'SOUL.md'))).toBe('You are helpful.');
    expect(cache.size).toBe(1);
  });

  // ── 7. Tool Policy ──────────────────────────────────────────────────

  it('Tool Policy: profile -> pipeline -> decision', () => {
    const profile = getToolProfile('coding');
    expect(profile.allow).toContain('read_file');

    const pipeline = buildPolicyPipeline([
      { label: 'profile', policy: profile },
      { label: 'agent', policy: { deny: ['exec_command'] } },
    ]);

    expect(applyPolicyPipeline('read_file', pipeline).allowed).toBe(true);
    expect(applyPolicyPipeline('exec_command', pipeline).allowed).toBe(false);
    expect(applyPolicyPipeline('unknown_tool', pipeline).allowed).toBe(false);

    // Full profile allows everything
    const fullProfile = getToolProfile('full');
    const fullPipeline = buildPolicyPipeline([{ label: 'full', policy: fullProfile }]);
    expect(applyPolicyPipeline('any_tool', fullPipeline).allowed).toBe(true);
  });

  // ── 8. Session Persistence ──────────────────────────────────────────

  it('Sessions: save -> load -> override -> compact', async () => {
    const store = new SessionStore(join(tempDir, 'sessions'));

    const session: PersistedSession = {
      key: 'agent:main:main:user1' as SessionKey,
      agentId: 'main',
      userId: 'user1',
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      transcript: [{ role: 'user', content: 'hello' }],
      metadata: { source: 'test' },
    };

    await store.save(session);
    const loaded = await store.load('main', session.key);
    expect(loaded).not.toBeNull();
    expect(loaded!.transcript).toHaveLength(1);

    // Override
    const overridden = applySessionOverride(loaded!, { modelOverride: 'gpt-4o' });
    expect(overridden.modelOverride).toBe('gpt-4o');
    expect(overridden.metadata.source).toBe('test');

    // Save old session for compaction
    const oldSession: PersistedSession = {
      key: 'agent:main:main:old' as SessionKey,
      agentId: 'main',
      userId: 'old',
      createdAt: Date.now() - 60 * 86400000,
      lastActiveAt: Date.now() - 60 * 86400000,
      transcript: [],
      metadata: {},
    };
    await store.save(oldSession);

    const removed = await compactSessions(store, 'main', 30);
    expect(removed).toBe(1);
    const remaining = await store.listForAgent('main');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].userId).toBe('user1');
  });

  // ── 9. Plugin System ────────────────────────────────────────────────

  it('Plugin system: define -> validate -> discover', () => {
    const plugin = definePlugin({
      id: 'test-plugin',
      version: '1.0.0',
      hooks: { session_start: async () => {} },
    });
    expect(validatePlugin(plugin).valid).toBe(true);
    expect(validatePlugin({} as any).valid).toBe(false);

    // Invalid hook point
    const badPlugin = definePlugin({
      id: 'bad-plugin',
      hooks: { nonexistent_hook: async () => {} } as any,
    });
    const badResult = validatePlugin(badPlugin);
    expect(badResult.valid).toBe(false);
    expect(badResult.errors.length).toBeGreaterThan(0);

    // Internal hooks
    const internal = createInternalHooks();
    expect(internal.hooks?.session_start).toBeDefined();
    expect(internal.hooks?.before_tool_call).toBeDefined();
    expect(internal.hooks?.error).toBeDefined();
    expect(validatePlugin(internal).valid).toBe(true);

    // Discover plugins from filesystem
    const pluginsDir = join(tempDir, 'plugins');
    mkdirSync(join(pluginsDir, 'my-plugin'), { recursive: true });
    writeFileSync(
      join(pluginsDir, 'my-plugin', 'index.js'),
      'module.exports = { id: "my-plugin" }',
    );
    const discovered = discoverPlugins(pluginsDir);
    expect(discovered).toHaveLength(1);
    expect(discovered[0].id).toBe('my-plugin');
  });

  // ── 10. Cross-module wiring ─────────────────────────────────────────

  it('cross-module: agent config feeds into tool policy and session key', () => {
    const agents: AgentEntry[] = [
      {
        id: 'coder',
        name: 'Coding Agent',
        default: true,
        model: { primary: 'claude-sonnet-4-6' },
        tools: { allow: ['read_file', 'write_file'], deny: ['exec_command'] },
      },
    ];

    // Resolve agent config
    const agentCfg = resolveAgentConfig('coder', agents)!;
    expect(agentCfg).not.toBeNull();

    // Feed tool policy from agent config into pipeline
    const pipeline = buildPolicyPipeline([
      { label: 'profile', policy: getToolProfile('coding') },
      { label: 'agent', policy: agentCfg.toolPolicy },
    ]);
    expect(applyPolicyPipeline('read_file', pipeline).allowed).toBe(true);
    expect(applyPolicyPipeline('exec_command', pipeline).allowed).toBe(false);

    // Build session key from resolved agent
    const sessionKey = buildMainSessionKey(agentCfg.id, 'user-42');
    expect(sessionKey).toBe('agent:coder:main:user-42');

    // Route falls back to default agent
    const route = resolveRoute(
      { channel: 'web', accountId: 'user-42' },
      agents,
      [],
    );
    expect(route.agentId).toBe('coder');
    expect(route.sessionKey).toBe('agent:coder:main:user-42');
  });
});
