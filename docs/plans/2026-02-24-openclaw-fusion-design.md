# OpenClaw Agentic Fusion Design

**Date:** 2026-02-24
**Status:** Approved
**Approach:** Hybrid Adaptive Fusion

## Goal

Fuse all agentic functionality from OpenClaw (clawi) into ILIAGPT without adding UI elements, without API connections — direct code fusion into existing architecture.

## Architecture Principle

ILIAGPT's `agentOrchestrator` remains the brain. OpenClaw modules become services the orchestrator consumes. No parallel runtime.

## Modules to Fuse

### 1. Memory/RAG Hybrid (`server/openclaw/memory/`)

**New files:**
- `indexManager.ts` — Coordinates RAG system. Uses PostgreSQL + pgvector (already enabled). Manages embedding providers, vector + keyword indexing.
- `hybridSearch.ts` — BM25 keyword search + vector similarity merge. Configurable weights.
- `embeddings.ts` — Multi-provider factory: OpenAI, Gemini, Voyage, Mistral, local. Batch processing with retry. Fallback chain.
- `queryExpansion.ts` — Expands user queries with synonyms/keywords for better recall.
- `mmr.ts` — Maximal Marginal Relevance for result diversity.
- `temporalDecay.ts` — Recent documents ranked higher via configurable decay function.
- `chunker.ts` — Split documents into chunks with configurable size + overlap.
- `sessionMemory.ts` — Auto-indexes session transcripts for future retrieval.
- `types.ts` — Shared interfaces (MemorySearchResult, MemorySource, ProviderStatus).

**Integration point:** `agentExecutor.ts` calls `indexManager.search()` before each response to inject RAG context into the system prompt.

**Search flow:**
```
Query → queryExpansion → [BM25, Vector] → hybridMerge → temporalDecay → MMR → Top-K
```

### 2. Dynamic Skills (`server/openclaw/skills/`)

**Enhanced files:**
- `skillLoader.ts` — Load from disk + plugins + bundled. Scan `~/.iliagpt/skills/` for `.md` files.
- `skillRegistry.ts` — Frontmatter support, eligibility checks, skill snapshots for prompts.

**New files:**
- `workspace.ts` — Scan filesystem for skill files, multi-source loading.
- `frontmatter.ts` — Parse YAML frontmatter from skill markdown files.
- `eligibility.ts` — Check OS, binaries, env vars for skill availability.
- `filter.ts` — Per-agent skill allowlist/denylist filtering.

**Skill format:** Markdown files with YAML frontmatter containing metadata (install specs, requirements, emoji, homepage).

### 3. Model Selection + Fallback (`server/openclaw/modelFallback/`)

**New files:**
- `selection.ts` — Model alias resolution (e.g., "best" → most capable available model).
- `fallback.ts` — Chain execution: primary → fallback1 → fallback2. Cooldown per-provider (skip for N minutes after repeated failures).
- `catalog.ts` — Model metadata: context window, pricing, capabilities.
- `authProfiles.ts` — API key rotation, OAuth refresh, cooldown tracking.

**Integration point:** Wraps `llmGateway.ts` calls with automatic fallback and retry.

### 4. Multi-Agent Routing (`server/openclaw/routing/`)

**New files:**
- `sessionKey.ts` — Hierarchical session keys: `agent:<id>:main:<key>` or `agent:<id>:peer:<kind>:<peerId>`.
- `resolver.ts` — Route resolution: (channel, accountId, peer, roles) → agentId + sessionKey.
- `agentScope.ts` — Agent configuration resolution from config. Multi-agent support.

**Enables:** Multiple agents with distinct roles, routing by context, sub-agent spawning with depth limits.

### 5. Agent Workspace (`server/openclaw/workspace/`)

**New files:**
- `bootstrap.ts` — Load SOUL/IDENTITY/TOOLS/MEMORY bootstrap files from workspace directory.
- `fileCache.ts` — mtime-based file cache with invalidation.
- `manager.ts` — Workspace lifecycle: create, ensure, clean.

**Each agent gets:** Isolated workspace at `~/.iliagpt/workspace-<agentId>/` with bootstrap files defining personality, tools, memory.

### 6. Tool Policy Pipeline (`server/openclaw/tools/`)

**New files:**
- `policyPipeline.ts` — Compose multiple policy layers: owner-only → profile → global → agent-specific → group.
- `toolProfiles.ts` — Predefined profiles: minimal, coding, messaging, full.

**Enhanced:** `toolPolicies.ts` — More dangerous patterns, better binary detection.

### 7. Advanced Plugin System (`server/openclaw/plugins/`)

**Enhanced files:**
- `hookSystem.ts` — 12 hook points + filesystem loading.
- `pluginLoader.ts` — Load plugins from `~/.iliagpt/plugins/`.
- `pluginRegistry.ts` — Full lifecycle (setup → run → shutdown).

**New files:**
- `pluginSDK.ts` — Public API for creating plugins (tool registration, hook registration, HTTP endpoints).
- `internalHooks.ts` — Built-in hooks: session memory sync, command logger, bootstrap.

### 8. Session Persistence (`server/openclaw/sessions/`)

**New files:**
- `persistence.ts` — Transcript storage to disk: `~/.iliagpt/sessions/<agent>/<channel>/<key>.json`.
- `overrides.ts` — Per-session model and logging overrides.
- `compaction.ts` — Automatic cleanup of old sessions.
- `labels.ts` — Human-readable session labels.

### 9. Enhanced Config (`server/openclaw/config.ts`)

**New environment variables:**

| Variable | Default | Purpose |
|----------|---------|---------|
| `OPENCLAW_MEMORY_ENABLED` | `false` | Enable RAG/Memory |
| `OPENCLAW_MEMORY_PROVIDER` | `pgvector` | Memory backend |
| `OPENCLAW_EMBEDDING_PROVIDER` | `gemini` | Embedding provider |
| `OPENCLAW_EMBEDDING_MODEL` | `text-embedding-004` | Embedding model |
| `OPENCLAW_MEMORY_CHUNK_SIZE` | `512` | Chunk size (tokens) |
| `OPENCLAW_MEMORY_CHUNK_OVERLAP` | `64` | Chunk overlap |
| `OPENCLAW_AGENTS_CONFIG` | `~/.iliagpt/agents.yaml` | Multi-agent config |
| `OPENCLAW_WORKSPACES_DIR` | `~/.iliagpt/workspaces` | Workspace root |
| `OPENCLAW_SESSIONS_DIR` | `~/.iliagpt/sessions` | Session storage |
| `OPENCLAW_MODEL_FALLBACK` | `true` | Enable fallback chain |
| `OPENCLAW_FALLBACK_COOLDOWN` | `300000` | Provider cooldown (ms) |

## What Does NOT Change

- **Frontend:** Zero UI modifications. No new buttons or panels.
- **agentOrchestrator.ts:** Remains the brain — only receives new service injections.
- **Routes/Middleware:** No changes to HTTP API surface.
- **Database schema:** Only uses existing pgvector extension.
- **Existing integrations:** Slack, GitHub, Notion connectors untouched.

## File Structure After Fusion

```
server/openclaw/
├── index.ts                    # (enhanced: init new modules)
├── config.ts                   # (enhanced: new env vars)
├── types.ts                    # (enhanced: new interfaces)
├── gateway/                    # (existing, no changes)
├── tools/                      # (enhanced: policy pipeline + profiles)
│   ├── adapter.ts
│   ├── execTool.ts
│   ├── fsTool.ts
│   ├── toolPolicies.ts
│   ├── policyPipeline.ts       # NEW
│   └── toolProfiles.ts         # NEW
├── plugins/                    # (enhanced: SDK + internal hooks)
│   ├── hookSystem.ts
│   ├── pluginLoader.ts
│   ├── pluginRegistry.ts
│   ├── pluginSDK.ts            # NEW
│   └── internalHooks.ts        # NEW
├── skills/                     # (enhanced: dynamic loading)
│   ├── skillLoader.ts
│   ├── skillRegistry.ts
│   ├── workspace.ts            # NEW
│   ├── frontmatter.ts          # NEW
│   ├── eligibility.ts          # NEW
│   └── filter.ts               # NEW
├── memory/                     # NEW MODULE
│   ├── indexManager.ts
│   ├── hybridSearch.ts
│   ├── embeddings.ts
│   ├── queryExpansion.ts
│   ├── mmr.ts
│   ├── temporalDecay.ts
│   ├── chunker.ts
│   ├── sessionMemory.ts
│   └── types.ts
├── modelFallback/              # NEW MODULE
│   ├── selection.ts
│   ├── fallback.ts
│   ├── catalog.ts
│   └── authProfiles.ts
├── routing/                    # NEW MODULE
│   ├── sessionKey.ts
│   ├── resolver.ts
│   └── agentScope.ts
├── workspace/                  # NEW MODULE
│   ├── bootstrap.ts
│   ├── fileCache.ts
│   └── manager.ts
├── sessions/                   # NEW MODULE
│   ├── persistence.ts
│   ├── overrides.ts
│   ├── compaction.ts
│   └── labels.ts
├── streaming/                  # (existing, no changes)
└── __tests__/                  # (enhanced: tests for new modules)
```

## Integration Wiring

1. `server/openclaw/index.ts` initializes all modules based on feature flags
2. `agentOrchestrator.ts` receives memory, skills, model-fallback services via dependency injection
3. `agentExecutor.ts` calls memory search before prompt construction
4. `toolRegistry.ts` receives policy pipeline for tool access control
5. Hook system fires at orchestrator lifecycle points
6. Routing resolves agent + session before orchestrator call
