# OpenClaw Agentic Fusion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fuse all agentic functionality from OpenClaw into ILIAGPT — Memory/RAG, dynamic skills, model fallback, multi-agent routing, workspaces, tool policies, plugin SDK, and session persistence — without UI changes.

**Architecture:** ILIAGPT's `agentOrchestrator` remains the execution engine. OpenClaw modules become services injected into the orchestrator via `server/openclaw/`. Each module is feature-flagged and initialized in `index.ts`. No new API routes; functionality is consumed internally by the agent system.

**Tech Stack:** TypeScript, PostgreSQL + pgvector, Zod validation, Node.js fs/path, existing Gemini/OpenAI/xAI SDKs.

---

## Phase 1: Foundation — Config & Types Extension

### Task 1: Extend OpenClaw Config with New Module Flags

**Files:**
- Modify: `server/openclaw/config.ts`
- Test: `server/openclaw/__tests__/config.test.ts`

**Step 1: Write the failing test**

Add to existing test file:

```typescript
describe('new module configs', () => {
  it('should return memory config from env vars', () => {
    process.env.OPENCLAW_MEMORY_ENABLED = 'true';
    process.env.OPENCLAW_EMBEDDING_PROVIDER = 'gemini';
    process.env.OPENCLAW_EMBEDDING_MODEL = 'text-embedding-004';
    process.env.OPENCLAW_MEMORY_CHUNK_SIZE = '512';
    process.env.OPENCLAW_MEMORY_CHUNK_OVERLAP = '64';
    const config = getOpenClawConfig();
    expect(config.memory.enabled).toBe(true);
    expect(config.memory.embeddingProvider).toBe('gemini');
    expect(config.memory.embeddingModel).toBe('text-embedding-004');
    expect(config.memory.chunkSize).toBe(512);
    expect(config.memory.chunkOverlap).toBe(64);
  });

  it('should return modelFallback config', () => {
    process.env.OPENCLAW_MODEL_FALLBACK = 'true';
    process.env.OPENCLAW_FALLBACK_COOLDOWN = '300000';
    const config = getOpenClawConfig();
    expect(config.modelFallback.enabled).toBe(true);
    expect(config.modelFallback.cooldownMs).toBe(300000);
  });

  it('should return routing config', () => {
    process.env.OPENCLAW_ROUTING_ENABLED = 'true';
    process.env.OPENCLAW_AGENTS_CONFIG = '/tmp/agents.yaml';
    const config = getOpenClawConfig();
    expect(config.routing.enabled).toBe(true);
    expect(config.routing.agentsConfigPath).toBe('/tmp/agents.yaml');
  });

  it('should return workspace config', () => {
    process.env.OPENCLAW_WORKSPACES_ENABLED = 'true';
    process.env.OPENCLAW_WORKSPACES_DIR = '/tmp/workspaces';
    const config = getOpenClawConfig();
    expect(config.workspace.enabled).toBe(true);
    expect(config.workspace.directory).toBe('/tmp/workspaces');
  });

  it('should return sessions config', () => {
    process.env.OPENCLAW_SESSIONS_ENABLED = 'true';
    process.env.OPENCLAW_SESSIONS_DIR = '/tmp/sessions';
    const config = getOpenClawConfig();
    expect(config.sessions.enabled).toBe(true);
    expect(config.sessions.directory).toBe('/tmp/sessions');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run server/openclaw/__tests__/config.test.ts`
Expected: FAIL — `config.memory` is undefined

**Step 3: Implement config extension**

In `server/openclaw/config.ts`, extend the `OpenClawConfig` interface and `getOpenClawConfig()`:

```typescript
export interface OpenClawConfig {
  // ... existing fields ...
  memory: {
    enabled: boolean;
    embeddingProvider: 'openai' | 'gemini' | 'voyage' | 'mistral' | 'local';
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
```

Add env var parsing for each new section in `getOpenClawConfig()`.

**Step 4: Run test to verify it passes**

Run: `npx vitest run server/openclaw/__tests__/config.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/openclaw/config.ts server/openclaw/__tests__/config.test.ts
git commit -m "feat(openclaw): extend config with memory, fallback, routing, workspace, sessions"
```

---

### Task 2: Extend Types with New Module Interfaces

**Files:**
- Modify: `server/openclaw/types.ts`

**Step 1: Add new interfaces**

```typescript
// ── Memory/RAG types ──
export interface MemorySearchResult {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
  score: number;
  source: 'memory' | 'sessions';
  vectorScore?: number;
  textScore?: number;
}

export interface EmbeddingProvider {
  embedQuery(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  dimensions: number;
}

export interface MemorySearchManager {
  search(query: string, opts?: { maxResults?: number; minScore?: number }): Promise<MemorySearchResult[]>;
  index(docs: { path: string; content: string }[]): Promise<void>;
  status(): { vectorAvailable: boolean; ftsAvailable: boolean; documentCount: number };
}

// ── Model Fallback types ──
export interface ModelRef {
  provider: string;
  model: string;
}

export interface ModelFallbackResult<T> {
  result: T;
  provider: string;
  model: string;
  attempts: ModelFallbackAttempt[];
}

export interface ModelFallbackAttempt {
  provider: string;
  model: string;
  error?: Error;
  durationMs: number;
}

// ── Routing types ──
export type SessionKey = `agent:${string}:${string}`;

export interface AgentEntry {
  id: string;
  name?: string;
  default?: boolean;
  model?: string | { primary?: string; fallbacks?: string[] };
  skills?: string[];
  workspace?: string;
  tools?: { allow?: string[]; deny?: string[] };
  memorySearch?: { enabled?: boolean; provider?: string };
  identity?: { name?: string; persona?: string };
}

export interface ResolvedAgentConfig {
  id: string;
  name: string;
  model: string;
  fallbacks: string[];
  skills: string[];
  workspaceDir: string;
  toolPolicy: { allow?: string[]; deny?: string[] };
  memoryEnabled: boolean;
  identity: { name?: string; persona?: string };
}

// ── Workspace types ──
export type BootstrapFileName = 'SOUL.md' | 'IDENTITY.md' | 'TOOLS.md' | 'MEMORY.md' | 'AGENTS.md' | 'BOOTSTRAP.md';

export interface WorkspaceBootstrapFile {
  name: BootstrapFileName;
  path: string;
  content: string | null;
  missing: boolean;
}

// ── Session Persistence types ──
export interface PersistedSession {
  key: SessionKey;
  agentId: string;
  userId: string;
  createdAt: number;
  lastActiveAt: number;
  modelOverride?: string;
  transcript: unknown[];
  metadata: Record<string, unknown>;
}

// ── Skill (enhanced) types ──
export interface SkillFrontmatter {
  name?: string;
  description?: string;
  emoji?: string;
  homepage?: string;
  os?: string[];
  requires?: { id: string; version?: string }[];
  install?: { brew?: string; npm?: string; go?: string }[];
  userInvocable?: boolean;
  disableModelInvocation?: boolean;
}

export interface EnhancedSkill extends Skill {
  source: 'bundled' | 'workspace' | 'plugin';
  frontmatter?: SkillFrontmatter;
  eligible: boolean;
  filePath?: string;
}

// ── Tool Policy Pipeline types ──
export interface ToolPolicyStep {
  label: string;
  policy: { allow?: string[]; deny?: string[] } | null;
}

export type ToolProfileId = 'minimal' | 'coding' | 'messaging' | 'full';
```

**Step 2: Commit**

```bash
git add server/openclaw/types.ts
git commit -m "feat(openclaw): add types for memory, fallback, routing, workspace, sessions, policies"
```

---

## Phase 2: Memory/RAG Hybrid System

### Task 3: Embeddings Provider Factory

**Files:**
- Create: `server/openclaw/memory/embeddings.ts`
- Test: `server/openclaw/__tests__/embeddings.test.ts`

**Step 1: Write failing tests**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createEmbeddingProvider, sanitizeAndNormalizeEmbedding } from '../memory/embeddings';

describe('sanitizeAndNormalizeEmbedding', () => {
  it('should normalize to unit vector', () => {
    const vec = sanitizeAndNormalizeEmbedding([3, 4]);
    expect(vec[0]).toBeCloseTo(0.6);
    expect(vec[1]).toBeCloseTo(0.8);
  });

  it('should replace NaN/Infinity with 0', () => {
    const vec = sanitizeAndNormalizeEmbedding([NaN, Infinity, 3, 4]);
    expect(vec[0]).toBe(0);
    expect(vec[1]).toBe(0);
  });

  it('should handle zero vector', () => {
    const vec = sanitizeAndNormalizeEmbedding([0, 0, 0]);
    expect(vec).toEqual([0, 0, 0]);
  });
});

describe('createEmbeddingProvider', () => {
  it('should create gemini provider when API key exists', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const provider = await createEmbeddingProvider({
      provider: 'gemini',
      model: 'text-embedding-004',
    });
    expect(provider).not.toBeNull();
    expect(provider!.dimensions).toBeGreaterThan(0);
  });

  it('should return null when no API key available', async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const provider = await createEmbeddingProvider({
      provider: 'gemini',
      model: 'text-embedding-004',
    });
    expect(provider).toBeNull();
  });
});
```

**Step 2: Run to verify fail**

Run: `npx vitest run server/openclaw/__tests__/embeddings.test.ts`

**Step 3: Implement embeddings.ts**

```typescript
// server/openclaw/memory/embeddings.ts
import { EmbeddingProvider } from '../types';
import { logger } from '../../lib/logger';

export function sanitizeAndNormalizeEmbedding(vec: number[]): number[] {
  const sanitized = vec.map(v => Number.isFinite(v) ? v : 0);
  const magnitude = Math.sqrt(sanitized.reduce((sum, v) => sum + v * v, 0));
  if (magnitude < 1e-10) return sanitized;
  return sanitized.map(v => v / magnitude);
}

export async function createEmbeddingProvider(opts: {
  provider: string;
  model: string;
  fallback?: string;
}): Promise<EmbeddingProvider | null> {
  const providers: Array<{ name: string; factory: () => Promise<EmbeddingProvider> }> = [];

  if (opts.provider === 'gemini' || opts.provider === 'auto') {
    providers.push({ name: 'gemini', factory: () => createGeminiEmbedder(opts.model) });
  }
  if (opts.provider === 'openai' || opts.provider === 'auto') {
    providers.push({ name: 'openai', factory: () => createOpenAIEmbedder(opts.model) });
  }
  if (opts.fallback && opts.fallback !== opts.provider) {
    providers.push({ name: opts.fallback, factory: () => createProviderByName(opts.fallback!, opts.model) });
  }

  for (const p of providers) {
    try {
      return await p.factory();
    } catch (err: any) {
      if (err.message?.includes('API key')) {
        logger.warn(`Embedding provider ${p.name}: missing API key, trying next`);
        continue;
      }
      throw err;
    }
  }
  logger.warn('No embedding provider available, falling back to FTS-only');
  return null;
}

async function createGeminiEmbedder(model: string): Promise<EmbeddingProvider> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Missing GEMINI_API_KEY — API key required for Gemini embeddings');
  const { GoogleGenAI } = await import('@google/genai');
  const genai = new GoogleGenAI({ apiKey });
  const dimensions = model.includes('004') ? 768 : 256;

  return {
    dimensions,
    async embedQuery(text: string): Promise<number[]> {
      const result = await genai.models.embedContent({ model, contents: text });
      return sanitizeAndNormalizeEmbedding(result.embeddings?.[0]?.values ?? []);
    },
    async embedBatch(texts: string[]): Promise<number[][]> {
      const results = await Promise.all(texts.map(t => this.embedQuery(t)));
      return results;
    },
  };
}

async function createOpenAIEmbedder(model: string): Promise<EmbeddingProvider> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY — API key required for OpenAI embeddings');
  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({ apiKey });
  const dimensions = model.includes('large') ? 3072 : 1536;

  return {
    dimensions,
    async embedQuery(text: string): Promise<number[]> {
      const res = await client.embeddings.create({ model: model || 'text-embedding-3-small', input: text });
      return sanitizeAndNormalizeEmbedding(res.data[0].embedding);
    },
    async embedBatch(texts: string[]): Promise<number[][]> {
      const res = await client.embeddings.create({ model: model || 'text-embedding-3-small', input: texts });
      return res.data.map(d => sanitizeAndNormalizeEmbedding(d.embedding));
    },
  };
}

async function createProviderByName(name: string, model: string): Promise<EmbeddingProvider> {
  switch (name) {
    case 'gemini': return createGeminiEmbedder(model);
    case 'openai': return createOpenAIEmbedder(model);
    default: throw new Error(`Unknown embedding provider: ${name}`);
  }
}
```

**Step 4: Run tests**

Run: `npx vitest run server/openclaw/__tests__/embeddings.test.ts`

**Step 5: Commit**

```bash
git add server/openclaw/memory/embeddings.ts server/openclaw/__tests__/embeddings.test.ts
git commit -m "feat(openclaw): embeddings provider factory with Gemini + OpenAI + fallback"
```

---

### Task 4: Query Expansion (Keyword Extraction)

**Files:**
- Create: `server/openclaw/memory/queryExpansion.ts`
- Test: `server/openclaw/__tests__/queryExpansion.test.ts`

**Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { extractKeywords, buildFtsQuery } from '../memory/queryExpansion';

describe('extractKeywords', () => {
  it('should extract meaningful keywords from English text', () => {
    const kws = extractKeywords('how to create a database migration');
    expect(kws).toContain('create');
    expect(kws).toContain('database');
    expect(kws).toContain('migration');
    expect(kws).not.toContain('how');
    expect(kws).not.toContain('to');
    expect(kws).not.toContain('a');
  });

  it('should handle Spanish stop words', () => {
    const kws = extractKeywords('como crear una migracion de base de datos');
    expect(kws).toContain('crear');
    expect(kws).toContain('migracion');
    expect(kws).not.toContain('como');
    expect(kws).not.toContain('una');
    expect(kws).not.toContain('de');
  });

  it('should return empty for stop-words-only input', () => {
    const kws = extractKeywords('the a an is are');
    expect(kws).toHaveLength(0);
  });

  it('should deduplicate keywords', () => {
    const kws = extractKeywords('test test test unique');
    expect(kws.filter(k => k === 'test')).toHaveLength(1);
  });
});

describe('buildFtsQuery', () => {
  it('should build AND query from tokens', () => {
    expect(buildFtsQuery('database migration')).toBe('"database" AND "migration"');
  });

  it('should return null for empty input', () => {
    expect(buildFtsQuery('')).toBeNull();
  });
});
```

**Step 2: Implement**

```typescript
// server/openclaw/memory/queryExpansion.ts
const EN_STOP_WORDS = new Set([
  'a','an','the','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','shall','should','may','might','must','can','could',
  'i','me','my','we','our','you','your','he','him','his','she','her','it','its','they','them','their',
  'this','that','these','those','what','which','who','whom','where','when','why','how',
  'of','in','on','at','to','for','with','from','by','about','into','through','during','before','after',
  'above','below','between','under','over','up','down','out','off','then','than','so','if','or','and',
  'but','not','no','nor','all','each','every','both','few','more','most','other','some','such','only',
]);

const ES_STOP_WORDS = new Set([
  'el','la','los','las','un','una','unos','unas','de','del','al','a','en','con','por','para',
  'sin','sobre','entre','como','pero','mas','se','su','sus','este','esta','estos','estas',
  'ese','esa','esos','esas','que','y','o','ni','es','son','fue','ser','estar','hay','tiene',
]);

const ALL_STOP_WORDS = new Set([...EN_STOP_WORDS, ...ES_STOP_WORDS]);

export function extractKeywords(query: string): string[] {
  const tokens = query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  const seen = new Set<string>();
  const keywords: string[] = [];

  for (const token of tokens) {
    if (token.length < 2) continue;
    if (/^\d+$/.test(token)) continue;
    if (ALL_STOP_WORDS.has(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    keywords.push(token);
  }

  return keywords;
}

export function buildFtsQuery(raw: string): string | null {
  const tokens = raw.match(/[\p{L}\p{N}_]+/gu);
  if (!tokens || tokens.length === 0) return null;
  return tokens.map(t => `"${t}"`).join(' AND ');
}
```

**Step 3: Test & commit**

```bash
npx vitest run server/openclaw/__tests__/queryExpansion.test.ts
git add server/openclaw/memory/queryExpansion.ts server/openclaw/__tests__/queryExpansion.test.ts
git commit -m "feat(openclaw): query expansion with multilingual keyword extraction"
```

---

### Task 5: Hybrid Search Engine (BM25 + Vector Merge)

**Files:**
- Create: `server/openclaw/memory/hybridSearch.ts`
- Test: `server/openclaw/__tests__/hybridSearch.test.ts`

**Step 1: Write failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { mergeHybridResults, bm25RankToScore } from '../memory/hybridSearch';

describe('bm25RankToScore', () => {
  it('should convert rank 0 to score 1', () => {
    expect(bm25RankToScore(0)).toBe(1);
  });
  it('should convert rank 1 to score 0.5', () => {
    expect(bm25RankToScore(1)).toBe(0.5);
  });
});

describe('mergeHybridResults', () => {
  it('should merge vector and keyword results by score', () => {
    const vectorResults = [
      { id: 'a', path: 'a.md', snippet: 'alpha', vectorScore: 0.9, startLine: 0, endLine: 10, source: 'memory' as const },
    ];
    const keywordResults = [
      { id: 'a', path: 'a.md', snippet: 'alpha', textScore: 0.7, startLine: 0, endLine: 10, source: 'memory' as const },
      { id: 'b', path: 'b.md', snippet: 'beta', textScore: 0.8, startLine: 0, endLine: 5, source: 'memory' as const },
    ];
    const merged = mergeHybridResults(vectorResults, keywordResults, { vectorWeight: 0.7, textWeight: 0.3 });
    expect(merged[0].id).toBe('a'); // 0.7*0.9 + 0.3*0.7 = 0.84
    expect(merged[1].id).toBe('b'); // 0.7*0 + 0.3*0.8 = 0.24
    expect(merged[0].score).toBeCloseTo(0.84);
  });

  it('should deduplicate by ID keeping highest scores', () => {
    const vectorResults = [{ id: 'x', path: 'x.md', snippet: 'x', vectorScore: 0.5, startLine: 0, endLine: 1, source: 'memory' as const }];
    const keywordResults = [{ id: 'x', path: 'x.md', snippet: 'x', textScore: 0.6, startLine: 0, endLine: 1, source: 'memory' as const }];
    const merged = mergeHybridResults(vectorResults, keywordResults, { vectorWeight: 0.5, textWeight: 0.5 });
    expect(merged).toHaveLength(1);
    expect(merged[0].score).toBeCloseTo(0.55);
  });
});
```

**Step 2: Implement**

```typescript
// server/openclaw/memory/hybridSearch.ts
import type { MemorySearchResult } from '../types';

export function bm25RankToScore(rank: number): number {
  const normalized = Number.isFinite(rank) ? Math.max(0, rank) : 999;
  return 1 / (1 + normalized);
}

interface VectorResult {
  id: string; path: string; snippet: string; vectorScore: number;
  startLine: number; endLine: number; source: 'memory' | 'sessions';
}

interface KeywordResult {
  id: string; path: string; snippet: string; textScore: number;
  startLine: number; endLine: number; source: 'memory' | 'sessions';
}

interface MergeOptions {
  vectorWeight: number;
  textWeight: number;
}

export function mergeHybridResults(
  vectorResults: VectorResult[],
  keywordResults: KeywordResult[],
  opts: MergeOptions,
): MemorySearchResult[] {
  const byId = new Map<string, {
    id: string; path: string; snippet: string;
    vectorScore: number; textScore: number;
    startLine: number; endLine: number; source: 'memory' | 'sessions';
  }>();

  for (const vr of vectorResults) {
    byId.set(vr.id, { ...vr, textScore: 0 });
  }

  for (const kr of keywordResults) {
    const existing = byId.get(kr.id);
    if (existing) {
      existing.textScore = Math.max(existing.textScore, kr.textScore);
    } else {
      byId.set(kr.id, { ...kr, vectorScore: 0 });
    }
  }

  const results: MemorySearchResult[] = [];
  for (const entry of byId.values()) {
    const score = opts.vectorWeight * entry.vectorScore + opts.textWeight * entry.textScore;
    results.push({
      id: entry.id,
      path: entry.path,
      snippet: entry.snippet,
      score,
      vectorScore: entry.vectorScore,
      textScore: entry.textScore,
      startLine: entry.startLine,
      endLine: entry.endLine,
      source: entry.source,
    });
  }

  return results.sort((a, b) => b.score - a.score);
}

export function applyMMR(
  results: MemorySearchResult[],
  queryVec: number[],
  docVecs: Map<string, number[]>,
  lambda: number,
  topK: number,
): MemorySearchResult[] {
  if (results.length <= 1) return results;
  const selected: MemorySearchResult[] = [results[0]];
  const remaining = results.slice(1);

  while (selected.length < topK && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      const candVec = docVecs.get(candidate.id);
      const relevance = candidate.score;
      let maxSim = 0;

      for (const sel of selected) {
        const selVec = docVecs.get(sel.id);
        if (candVec && selVec) {
          maxSim = Math.max(maxSim, cosineSimilarity(candVec, selVec));
        }
      }

      const mmrScore = lambda * relevance - (1 - lambda) * maxSim;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }

    selected.push(remaining.splice(bestIdx, 1)[0]);
  }

  return selected;
}

export function applyTemporalDecay(
  results: MemorySearchResult[],
  halfLifeDays: number,
  now: number = Date.now(),
): MemorySearchResult[] {
  const halfLifeMs = halfLifeDays * 86400000;
  return results.map(r => {
    // Use last segment of path as proxy for freshness (can be enhanced with mtime)
    const decay = 1; // default: no decay without file stats
    return { ...r, score: r.score * decay };
  }).sort((a, b) => b.score - a.score);
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom < 1e-10 ? 0 : dot / denom;
}
```

**Step 3: Test & commit**

```bash
npx vitest run server/openclaw/__tests__/hybridSearch.test.ts
git add server/openclaw/memory/hybridSearch.ts server/openclaw/__tests__/hybridSearch.test.ts
git commit -m "feat(openclaw): hybrid search engine with BM25 + vector merge + MMR"
```

---

### Task 6: Document Chunker

**Files:**
- Create: `server/openclaw/memory/chunker.ts`
- Test: `server/openclaw/__tests__/chunker.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { chunkDocument } from '../memory/chunker';

describe('chunkDocument', () => {
  it('should split document into overlapping chunks', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${i}`);
    const doc = lines.join('\n');
    const chunks = chunkDocument(doc, 'test.md', { chunkSize: 20, chunkOverlap: 5 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].startLine).toBe(0);
    expect(chunks[1].startLine).toBeLessThan(chunks[0].endLine); // overlap
  });

  it('should return single chunk for small document', () => {
    const chunks = chunkDocument('small doc', 'small.md', { chunkSize: 100, chunkOverlap: 10 });
    expect(chunks).toHaveLength(1);
  });
});
```

**Step 2: Implement**

```typescript
// server/openclaw/memory/chunker.ts
export interface DocumentChunk {
  id: string;
  path: string;
  content: string;
  startLine: number;
  endLine: number;
}

export function chunkDocument(
  content: string,
  path: string,
  opts: { chunkSize: number; chunkOverlap: number },
): DocumentChunk[] {
  const lines = content.split('\n');
  if (lines.length <= opts.chunkSize) {
    return [{ id: `${path}:0-${lines.length}`, path, content, startLine: 0, endLine: lines.length }];
  }

  const chunks: DocumentChunk[] = [];
  const step = Math.max(1, opts.chunkSize - opts.chunkOverlap);

  for (let start = 0; start < lines.length; start += step) {
    const end = Math.min(start + opts.chunkSize, lines.length);
    const chunkLines = lines.slice(start, end);
    chunks.push({
      id: `${path}:${start}-${end}`,
      path,
      content: chunkLines.join('\n'),
      startLine: start,
      endLine: end,
    });
    if (end >= lines.length) break;
  }

  return chunks;
}
```

**Step 3: Test & commit**

```bash
npx vitest run server/openclaw/__tests__/chunker.test.ts
git add server/openclaw/memory/chunker.ts server/openclaw/__tests__/chunker.test.ts
git commit -m "feat(openclaw): document chunker with configurable size and overlap"
```

---

### Task 7: Memory Index Manager (Orchestrates RAG)

**Files:**
- Create: `server/openclaw/memory/indexManager.ts`
- Create: `server/openclaw/memory/types.ts`
- Test: `server/openclaw/__tests__/indexManager.test.ts`

**Step 1: Write failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryIndexManager } from '../memory/indexManager';

describe('MemoryIndexManager', () => {
  it('should create instance via factory', async () => {
    const mgr = await MemoryIndexManager.create({
      workspaceDir: '/tmp/test-workspace',
      embeddingProvider: null, // FTS-only mode
      config: { chunkSize: 20, chunkOverlap: 5, maxResults: 10, minScore: 0.1,
        vectorWeight: 0.7, textWeight: 0.3, mmrEnabled: false, mmrLambda: 0.5,
        temporalDecayEnabled: false, temporalDecayHalfLifeDays: 30 },
    });
    expect(mgr).toBeDefined();
    expect(mgr.status().vectorAvailable).toBe(false);
    expect(mgr.status().ftsAvailable).toBe(true);
  });

  it('should index and search documents (FTS mode)', async () => {
    const mgr = await MemoryIndexManager.create({
      workspaceDir: '/tmp/test-workspace-' + Date.now(),
      embeddingProvider: null,
      config: { chunkSize: 100, chunkOverlap: 10, maxResults: 10, minScore: 0,
        vectorWeight: 0.7, textWeight: 0.3, mmrEnabled: false, mmrLambda: 0.5,
        temporalDecayEnabled: false, temporalDecayHalfLifeDays: 30 },
    });
    await mgr.index([
      { path: 'auth.md', content: 'Authentication uses JWT tokens for secure access control' },
      { path: 'db.md', content: 'Database schema uses PostgreSQL with Drizzle ORM' },
    ]);
    const results = await mgr.search('authentication JWT');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toBe('auth.md');
  });
});
```

**Step 2: Implement index manager**

The full implementation uses PostgreSQL pgvector for vector storage + built-in FTS for keyword search. The search method orchestrates: query expansion → parallel BM25+vector → hybrid merge → optional MMR → optional temporal decay → top-K results.

Implementation in `server/openclaw/memory/indexManager.ts` — approximately 250 lines. Uses `drizzle` ORM for pgvector queries and `extractKeywords` + `mergeHybridResults` from previous tasks.

**Step 3: Test & commit**

```bash
npx vitest run server/openclaw/__tests__/indexManager.test.ts
git add server/openclaw/memory/ server/openclaw/__tests__/indexManager.test.ts
git commit -m "feat(openclaw): memory index manager with hybrid search orchestration"
```

---

## Phase 3: Dynamic Skills System

### Task 8: YAML Frontmatter Parser

**Files:**
- Create: `server/openclaw/skills/frontmatter.ts`
- Test: `server/openclaw/__tests__/frontmatter.test.ts`

**Step 1: Test**

```typescript
import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from '../skills/frontmatter';

describe('parseFrontmatter', () => {
  it('should parse YAML frontmatter from markdown', () => {
    const content = `---
name: My Skill
description: Does things
emoji: "🔧"
os: [darwin, linux]
---
# My Skill
Content here`;
    const result = parseFrontmatter(content);
    expect(result.attributes.name).toBe('My Skill');
    expect(result.attributes.emoji).toBe('🔧');
    expect(result.attributes.os).toEqual(['darwin', 'linux']);
    expect(result.body).toContain('# My Skill');
  });

  it('should return empty attributes for no frontmatter', () => {
    const result = parseFrontmatter('# Just markdown\nNo frontmatter');
    expect(result.attributes).toEqual({});
    expect(result.body).toContain('# Just markdown');
  });
});
```

**Step 2: Implement**

```typescript
// server/openclaw/skills/frontmatter.ts
import yaml from 'yaml';

export interface ParsedFrontmatter {
  attributes: Record<string, unknown>;
  body: string;
}

export function parseFrontmatter(content: string): ParsedFrontmatter {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { attributes: {}, body: content };
  try {
    const attributes = yaml.parse(match[1]) ?? {};
    return { attributes: typeof attributes === 'object' ? attributes : {}, body: match[2] };
  } catch {
    return { attributes: {}, body: content };
  }
}
```

**Step 3: Test & commit**

```bash
npx vitest run server/openclaw/__tests__/frontmatter.test.ts
git add server/openclaw/skills/frontmatter.ts server/openclaw/__tests__/frontmatter.test.ts
git commit -m "feat(openclaw): YAML frontmatter parser for skill files"
```

---

### Task 9: Skill Eligibility Checker

**Files:**
- Create: `server/openclaw/skills/eligibility.ts`
- Test: `server/openclaw/__tests__/eligibility.test.ts`

Checks OS compatibility and binary availability before loading a skill.

**Step 1: Test, Step 2: Implement, Step 3: Commit**

```bash
git commit -m "feat(openclaw): skill eligibility checker (OS, binary, env requirements)"
```

---

### Task 10: Workspace Skill Loader (Dynamic from Filesystem)

**Files:**
- Create: `server/openclaw/skills/workspace.ts`
- Modify: `server/openclaw/skills/skillLoader.ts`
- Test: `server/openclaw/__tests__/workspaceSkills.test.ts`

Loads `.md` skill files from `~/.iliagpt/skills/`, parses frontmatter, checks eligibility, registers in skillRegistry.

**Step 1: Test, Step 2: Implement, Step 3: Commit**

```bash
git commit -m "feat(openclaw): dynamic skill loading from filesystem with frontmatter"
```

---

### Task 11: Skill Filter (Per-Agent Allowlist/Denylist)

**Files:**
- Create: `server/openclaw/skills/filter.ts`
- Test: `server/openclaw/__tests__/skillFilter.test.ts`

Filters skills by agent configuration (allowlist/denylist of skill IDs).

```bash
git commit -m "feat(openclaw): per-agent skill filtering with allowlist/denylist"
```

---

## Phase 4: Model Selection + Fallback Chain

### Task 12: Model Alias Resolution

**Files:**
- Create: `server/openclaw/modelFallback/selection.ts`
- Test: `server/openclaw/__tests__/modelSelection.test.ts`

Implements `normalizeModelRef()`, `parseModelRef()`, `resolveModelRefFromAlias()`. Maps aliases like "best" → most capable model, "fast" → cheapest model, "opus-4.6" → "claude-opus-4-6".

```bash
git commit -m "feat(openclaw): model alias resolution and normalization"
```

---

### Task 13: Fallback Chain Execution

**Files:**
- Create: `server/openclaw/modelFallback/fallback.ts`
- Test: `server/openclaw/__tests__/modelFallback.test.ts`

Implements `runWithModelFallback()` — tries primary model, on failure tries fallbacks in order. Tracks cooldown per provider (skip for N ms after repeated failures). Includes `resolveFallbackCandidates()`.

```bash
git commit -m "feat(openclaw): model fallback chain with cooldown tracking"
```

---

### Task 14: Model Catalog

**Files:**
- Create: `server/openclaw/modelFallback/catalog.ts`
- Test: `server/openclaw/__tests__/modelCatalog.test.ts`

Static catalog of model metadata: context window, pricing tier, capabilities (vision, function calling, streaming).

```bash
git commit -m "feat(openclaw): model catalog with metadata and capabilities"
```

---

## Phase 5: Multi-Agent Routing

### Task 15: Session Key Builder

**Files:**
- Create: `server/openclaw/routing/sessionKey.ts`
- Test: `server/openclaw/__tests__/sessionKey.test.ts`

Implements `normalizeAgentId()`, `buildAgentMainSessionKey()`, `buildAgentPeerSessionKey()`, `parseAgentSessionKey()`.

```bash
git commit -m "feat(openclaw): hierarchical session key builder and parser"
```

---

### Task 16: Agent Scope Resolver

**Files:**
- Create: `server/openclaw/routing/agentScope.ts`
- Test: `server/openclaw/__tests__/agentScope.test.ts`

Implements `resolveAgentConfig()`, `resolveDefaultAgentId()`, `listAgentEntries()`. Reads agent list from YAML config.

```bash
git commit -m "feat(openclaw): agent scope resolver for multi-agent config"
```

---

### Task 17: Route Resolver

**Files:**
- Create: `server/openclaw/routing/resolver.ts`
- Test: `server/openclaw/__tests__/routeResolver.test.ts`

Maps (channel, accountId, peer) → agentId + sessionKey using bindings priority.

```bash
git commit -m "feat(openclaw): route resolver for channel-to-agent binding"
```

---

## Phase 6: Agent Workspace

### Task 18: File Cache with mtime Invalidation

**Files:**
- Create: `server/openclaw/workspace/fileCache.ts`
- Test: `server/openclaw/__tests__/fileCache.test.ts`

```bash
git commit -m "feat(openclaw): file cache with mtime-based invalidation"
```

---

### Task 19: Workspace Manager + Bootstrap Files

**Files:**
- Create: `server/openclaw/workspace/manager.ts`
- Create: `server/openclaw/workspace/bootstrap.ts`
- Test: `server/openclaw/__tests__/workspace.test.ts`

Creates workspace directories, writes bootstrap files (SOUL.md, IDENTITY.md, TOOLS.md, MEMORY.md), loads them with caching.

```bash
git commit -m "feat(openclaw): workspace manager with bootstrap file loading"
```

---

## Phase 7: Tool Policy Pipeline

### Task 20: Tool Profiles

**Files:**
- Create: `server/openclaw/tools/toolProfiles.ts`
- Test: `server/openclaw/__tests__/toolProfiles.test.ts`

Defines 4 profiles: minimal (session_status only), coding (read/write/exec/memory), messaging (message/sessions), full (unrestricted).

```bash
git commit -m "feat(openclaw): tool profiles (minimal, coding, messaging, full)"
```

---

### Task 21: Policy Pipeline Composition

**Files:**
- Create: `server/openclaw/tools/policyPipeline.ts`
- Test: `server/openclaw/__tests__/policyPipeline.test.ts`

Implements `buildToolPolicyPipelineSteps()` and `applyToolPolicyPipeline()`. Stacks: profile → global → agent → group policies.

```bash
git commit -m "feat(openclaw): composable tool policy pipeline"
```

---

## Phase 8: Plugin System Enhancement

### Task 22: Internal Hooks (Session Memory, Command Logger)

**Files:**
- Create: `server/openclaw/plugins/internalHooks.ts`
- Test: `server/openclaw/__tests__/internalHooks.test.ts`

Built-in hooks: session_start → init workspace, before_tool_call → log command, agent_end → persist session memory.

```bash
git commit -m "feat(openclaw): internal hooks for session memory and command logging"
```

---

### Task 23: Plugin SDK (Public API for Extensions)

**Files:**
- Create: `server/openclaw/plugins/pluginSDK.ts`
- Test: `server/openclaw/__tests__/pluginSDK.test.ts`

Public API: `definePlugin()`, `defineToolFactory()`, `defineHookHandler()`. Validates plugin structure and registers via pluginRegistry.

```bash
git commit -m "feat(openclaw): plugin SDK for external plugin development"
```

---

### Task 24: Filesystem Plugin Loader

**Files:**
- Modify: `server/openclaw/plugins/pluginLoader.ts`
- Test: `server/openclaw/__tests__/pluginFsLoader.test.ts`

Scans `~/.iliagpt/plugins/` for `index.ts`/`index.js` files, dynamically imports them, validates via SDK, registers.

```bash
git commit -m "feat(openclaw): load plugins from filesystem directory"
```

---

## Phase 9: Session Persistence

### Task 25: Session Transcript Storage

**Files:**
- Create: `server/openclaw/sessions/persistence.ts`
- Test: `server/openclaw/__tests__/sessionPersistence.test.ts`

Saves session transcripts to `~/.iliagpt/sessions/<agent>/<key>.json`. Reads with atomic writes.

```bash
git commit -m "feat(openclaw): session transcript persistence to filesystem"
```

---

### Task 26: Session Overrides + Compaction

**Files:**
- Create: `server/openclaw/sessions/overrides.ts`
- Create: `server/openclaw/sessions/compaction.ts`
- Test: `server/openclaw/__tests__/sessionOverrides.test.ts`

Per-session model overrides. Compaction deletes sessions older than `compactionDays`.

```bash
git commit -m "feat(openclaw): session overrides and automatic compaction"
```

---

## Phase 10: Wiring — Connect Everything to Agent System

### Task 27: Extend initializeOpenClaw() with New Modules

**Files:**
- Modify: `server/openclaw/index.ts`

Add initialization for: memory, modelFallback, routing, workspace, sessions modules (all feature-flagged).

```bash
git commit -m "feat(openclaw): wire new modules into initialization with feature flags"
```

---

### Task 28: Inject Memory/RAG into agentExecutor

**Files:**
- Modify: `server/agent/agentExecutor.ts` (around line 460, before Gemini API call)

Before the LLM call, if memory is enabled:
1. Call `memoryIndexManager.search(userMessage)`
2. Format results as system context
3. Prepend to messages array

```bash
git commit -m "feat(openclaw): inject RAG context into agent executor before LLM calls"
```

---

### Task 29: Wire Model Fallback into llmGateway

**Files:**
- Modify: `server/lib/llmGateway.ts` (around line 881, the fallback chain)

Wrap the existing provider selection with `runWithModelFallback()` to add automatic cooldown-based fallback.

```bash
git commit -m "feat(openclaw): wire model fallback chain into LLM gateway"
```

---

### Task 30: Wire Skills + Hooks into agentOrchestrator

**Files:**
- Modify: `server/agent/agentOrchestrator.ts` (around line 873, generatePlan)

Before plan generation:
1. Load workspace bootstrap files
2. Get skill snapshot for agent
3. Inject skill prompts into system context
4. Fire `before_prompt_build` hook

```bash
git commit -m "feat(openclaw): wire skills and hooks into agent orchestrator lifecycle"
```

---

### Task 31: Wire Tool Policy Pipeline into toolRegistry

**Files:**
- Modify: `server/agent/toolRegistry.ts` (around line 814, policy check)

Before tool execution, run through `applyToolPolicyPipeline()` to filter allowed tools based on agent profile + policies.

```bash
git commit -m "feat(openclaw): wire tool policy pipeline into tool registry"
```

---

### Task 32: Wire RPC Handlers for New Modules

**Files:**
- Modify: `server/openclaw/gateway/rpcHandlers.ts`

Add RPC methods: `memory.search`, `memory.status`, `agents.list`, `agents.resolve`, `sessions.persist`, `workspace.bootstrap`.

```bash
git commit -m "feat(openclaw): add RPC handlers for memory, agents, sessions, workspace"
```

---

### Task 33: Integration Test — Full Agent Flow with RAG + Skills + Fallback

**Files:**
- Modify: `server/openclaw/__tests__/integration.test.ts`

End-to-end test: index documents → create agent with skills → execute query → verify RAG context was injected → verify skill prompt present → verify model fallback attempted.

```bash
git commit -m "test(openclaw): integration test for full agentic flow with RAG and skills"
```

---

### Task 34: Update .env.example with New Variables

**Files:**
- Modify: `.env.example`

Add all new `OPENCLAW_*` environment variables with documentation comments.

```bash
git commit -m "docs: add OpenClaw fusion environment variables to .env.example"
```

---

## Summary

| Phase | Tasks | What it delivers |
|-------|-------|-----------------|
| 1. Foundation | 1-2 | Config + types for all new modules |
| 2. Memory/RAG | 3-7 | Hybrid search with embeddings, chunking, MMR |
| 3. Skills | 8-11 | Dynamic skill loading from filesystem |
| 4. Model Fallback | 12-14 | Automatic model fallback with cooldown |
| 5. Routing | 15-17 | Multi-agent session routing |
| 6. Workspace | 18-19 | Agent workspace isolation + bootstrap |
| 7. Tool Policies | 20-21 | Composable policy pipeline |
| 8. Plugins | 22-24 | SDK + filesystem loader + internal hooks |
| 9. Sessions | 25-26 | Persistent sessions with compaction |
| 10. Wiring | 27-34 | Connect everything to existing agent system |

**Total: 34 tasks, ~170 steps**
