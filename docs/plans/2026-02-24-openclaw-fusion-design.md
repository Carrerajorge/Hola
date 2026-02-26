# OpenClaw-ILIAGPT Agentic Fusion Design

## Goal

Fuse OpenClaw's agentic capabilities (multi-agent routing, skill discovery, tool policy, hook system, session management, enhanced execution) into ILIAGPT's existing architecture. ILIAGPT remains the base; OpenClaw is the "logic donor." No API bridges — all code is fused directly.

## Architecture

ILIAGPT has a mature PARE orchestrator, tool registry, and agent runner. OpenClaw has sophisticated multi-agent routing, skill discovery, tool policies, and execution patterns. We port OpenClaw's loosely-coupled logic as new modules under `server/services/agentOrchestration/` that plug into ILIAGPT's existing extension points.

## Tech Stack

- TypeScript (Express.js server)
- PostgreSQL + Drizzle ORM
- Vitest for testing
- Existing ILIAGPT patterns (services, schemas, routes)

---

## Layer 1: Multi-Agent Router

**New file**: `server/services/agentOrchestration/multiAgentRouter.ts`
**New schema**: `shared/schema/agentOrchestration.ts` (agentBindings, agentToolPolicies tables)

### Purpose

Route incoming requests to the appropriate agent based on configurable bindings. Sits between PARE (which classifies intent) and agent execution.

### Design

```
User Request → PARE (intent) → MultiAgentRouter → Selected Agent + Session Key
```

**Ported from OpenClaw** (`resolve-route.ts`, `bindings.ts`, `session-key.ts`):
- Binding-based matching with priority tiers: user-specific > intent-specific > source-specific > default
- Session key construction: `agent:{agentId}:{scope}:{identifier}`
- Identity linking: map multiple user identities to one canonical session
- Binding cache with size limit (prevent memory leaks)

**Adapted for ILIAGPT**:
- Bindings stored in PostgreSQL (`agentBindings` table) instead of YAML config
- "Channels" are request sources: `web`, `api`, `whatsapp`, `email`, `internal`
- "Peers" are user IDs from our auth system
- Integrates with PARE's `RobustRouteResult` for intent-aware routing

### Key Types

```typescript
interface AgentBinding {
  id: string;
  agentId: string;
  priority: number;
  match: {
    source?: string;         // web, api, whatsapp, email
    userId?: string;         // specific user
    intentCategory?: string; // from PARE classification
    tags?: string[];         // custom matching tags
  };
}

interface AgentRoute {
  agentId: string;
  sessionKey: string;
  matchedBy: string;       // binding tier that matched
  agentConfig: AgentConfig;
}

interface AgentConfig {
  id: string;
  name: string;
  modelPrimary: string;
  modelFallbacks: string[];
  skills: string[];         // skill allowlist
  toolPolicy: { allow?: string[]; deny?: string[] };
  maxRetries: number;
  timeoutMs: number;
}
```

---

## Layer 2: Enhanced Agent Execution Engine

**New file**: `server/services/agentOrchestration/enhancedExecutor.ts`

### Purpose

Wrap individual tool/LLM calls with production-grade execution patterns ported from OpenClaw's `run.ts`.

### Design

```
OrchestrationEngine (parallel waves) → EnhancedExecutor (retry, failover, compaction) → LLM/Tool
```

**Ported from OpenClaw** (`pi-embedded-runner/run.ts`):
1. **Retry with backoff** — Up to 8 retries per auth profile, error classification (context_overflow, auth_error, rate_limit, timeout, unknown)
2. **Model failover** — Primary → fallback chain (e.g., Grok → Gemini → OpenAI)
3. **Session compaction** — When context exceeds token limit, compress old messages keeping recent + summary
4. **Tool result truncation** — Binary search for max prefix that fits context budget
5. **Usage accumulator** — Track total + last-call token usage separately

**Adapted for ILIAGPT**:
- Uses ILIAGPT's `llmGateway` for model calls (not Pi-agent)
- Error classification maps to our LLM providers (xAI, Gemini, Anthropic)
- Compaction stores compressed context in `agentContext` table
- Integrates with `OrchestrationEngine.executeSubtask()` as the execution backend

### Key Types

```typescript
interface ExecutionAttempt {
  provider: string;
  model: string;
  retryCount: number;
  error?: { kind: ErrorKind; message: string };
  usage?: TokenUsage;
  durationMs: number;
}

type ErrorKind = 'context_overflow' | 'auth_error' | 'rate_limit' | 'timeout' | 'model_error' | 'unknown';

interface ExecutionResult {
  success: boolean;
  output: string;
  attempts: ExecutionAttempt[];
  totalUsage: TokenUsage;
  modelUsed: string;
  compactionCount: number;
}

interface CompactionResult {
  originalTokens: number;
  compactedTokens: number;
  messagesRemoved: number;
  summaryAdded: boolean;
}
```

---

## Layer 3: Unified Skill Discovery

**New file**: `server/services/agentOrchestration/skillDiscovery.ts`

### Purpose

Discover and register skills from multiple sources with eligibility checking. Bridge between OpenClaw's skill format and ILIAGPT's CustomSkills DB.

### Design

**Sources** (in precedence order, later wins):
1. Bundled skills (shipped with ILIAGPT)
2. Workspace skills (`.md` files in workspace directory, like OpenClaw)
3. DB CustomSkills (user-created via UI)

**Ported from OpenClaw** (`skills/workspace.ts`, `skills/config.ts`, `skills/types.ts`):
- `shouldIncludeSkill()` eligibility checker (OS, binaries, env vars, API keys)
- Skill precedence resolution (later sources override earlier)
- Limits enforcement: max 150 skills in prompt, max 30KB skill descriptions
- Skill→Tool bridge: each eligible skill registers as a callable tool

**Adapted for ILIAGPT**:
- DB CustomSkills are first-class citizens (highest precedence)
- Bundled skills stored in `server/skills/` directory
- Integration with ToolRegistry for tool execution

### Key Types

```typescript
interface SkillEntry {
  id: string;
  name: string;
  description: string;
  source: 'bundled' | 'workspace' | 'custom';
  enabled: boolean;
  requires?: {
    bins?: string[];     // required system binaries
    env?: string[];      // required environment variables
    apis?: string[];     // required API keys
  };
  parameters?: SkillParameter[];
  actions?: SkillAction[];
}

interface SkillSnapshot {
  skills: SkillEntry[];
  prompt: string;           // formatted skill descriptions for LLM
  totalChars: number;
  filteredCount: number;    // skills excluded by eligibility
}

interface SkillEligibilityContext {
  platform: string;         // darwin, linux, win32
  availableBins: string[];
  availableEnvVars: string[];
  availableApiKeys: string[];
}
```

---

## Layer 4: Tool Policy Layer

**New file**: `server/services/agentOrchestration/toolPolicy.ts`
**New schema extension**: `agentToolPolicies` table in `shared/schema/agentOrchestration.ts`

### Purpose

Per-agent tool access control combining OpenClaw's allow/deny lists with ILIAGPT's circuit breaker.

### Design

```
Tool Request → Policy Check (allow/deny) → Circuit Breaker → Cache Check → Execute → Metrics
```

**Ported from OpenClaw** (`tool-policy.ts`):
- Allow/deny list evaluation with wildcard support
- Owner-only tool enforcement (certain tools restricted to admin users)
- Group expansion (e.g., `@admin-tools` expands to specific tool list)

**Combined with ILIAGPT**:
- Circuit breaker from existing `ToolExecutionEngine`
- Execution caching (TTL: 5 minutes)
- Health metrics per tool

### Key Types

```typescript
interface ToolPolicy {
  agentId: string;
  allow?: string[];    // wildcards supported: "web_*", "@search-tools"
  deny?: string[];
  ownerOnlyTools?: string[];
}

interface ToolPolicyResult {
  allowed: boolean;
  reason?: string;     // 'denied_by_policy' | 'owner_only' | 'circuit_open'
  toolName: string;
}
```

---

## Layer 5: Hook/Lifecycle System

**New file**: `server/services/agentOrchestration/hookSystem.ts`

### Purpose

Event-driven lifecycle hooks for agent execution. Allows intercepting and modifying behavior at key points.

### Design

**Ported from OpenClaw** (`hooks/types.ts`, `plugins/hook-runner-global.ts`):
- Event-based hook registration
- Hook metadata with eligibility context
- Ordered execution (priority-based)

**Events**:
| Event | Timing | Can Modify |
|-------|--------|------------|
| `before_route` | Before agent selection | Route decision |
| `before_agent_start` | Before execution | Model selection |
| `before_tool_call` | Before tool runs | Tool input, can block |
| `after_tool_call` | After tool completes | Logging only |
| `after_agent_complete` | After run finishes | Logging, feedback |

### Key Types

```typescript
type HookEvent = 'before_route' | 'before_agent_start' | 'before_tool_call' | 'after_tool_call' | 'after_agent_complete';

interface Hook {
  id: string;
  name: string;
  event: HookEvent;
  priority: number;       // lower = runs first
  handler: HookHandler;
  enabled: boolean;
}

type HookHandler = (context: HookContext) => Promise<HookResult>;

interface HookContext {
  event: HookEvent;
  agentId: string;
  sessionKey: string;
  userId: string;
  data: Record<string, unknown>;  // event-specific data
}

interface HookResult {
  modified: boolean;
  overrides?: Record<string, unknown>;  // fields to override
  abort?: boolean;                      // stop execution
  abortReason?: string;
}
```

---

## Layer 6: Session Manager

**New file**: `server/services/agentOrchestration/sessionManager.ts`

### Purpose

Manage agent sessions with multi-dimensional keys, lane concurrency control, and automatic compaction.

### Design

**Ported from OpenClaw** (`session-key.ts`, `session-key-utils.ts`, `server-lanes.ts`):
- Session key format: `agent:{agentId}:{scope}:{identifier}`
- Lane concurrency: one active execution per session (queue others)
- Compaction: compress when history exceeds token limit
- Identity linking: map multiple user accounts to one session

**Adapted for ILIAGPT**:
- Session state stored in `agentSessionState` table (existing, extended)
- Compaction persists to `agentContext` table
- Lane state is in-memory (Map<sessionKey, Promise>)

### Key Types

```typescript
interface SessionKey {
  agentId: string;
  scope: 'direct' | 'group' | 'channel' | 'api';
  identifier: string;       // userId or channelId
}

interface SessionState {
  key: string;
  agentId: string;
  history: SessionMessage[];
  tokenCount: number;
  maxTokens: number;
  compactionCount: number;
  lastActivity: Date;
}

interface SessionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}
```

---

## Barrel Export

**New file**: `server/services/agentOrchestration/index.ts`

Re-exports all layers:
```typescript
export { MultiAgentRouter, resolveAgentRoute } from './multiAgentRouter';
export { EnhancedExecutor, executeWithRetry } from './enhancedExecutor';
export { SkillDiscovery, discoverSkills } from './skillDiscovery';
export { ToolPolicyEngine, evaluateToolPolicy } from './toolPolicy';
export { HookSystem, registerHook, emitHookEvent } from './hookSystem';
export { SessionManager, buildSessionKey } from './sessionManager';
```

---

## Database Schema Extensions

**New file additions to**: `shared/schema/agentOrchestration.ts`

```sql
-- Agent bindings for multi-agent routing
CREATE TABLE agent_bindings (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id VARCHAR NOT NULL,
  priority INTEGER DEFAULT 0,
  match_source VARCHAR,
  match_user_id VARCHAR,
  match_intent VARCHAR,
  match_tags TEXT[],
  agent_config JSONB NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tool policies per agent
CREATE TABLE agent_tool_policies (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id VARCHAR NOT NULL,
  allow_tools TEXT[],
  deny_tools TEXT[],
  owner_only_tools TEXT[],
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Hooks registry
CREATE TABLE agent_hooks (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR NOT NULL,
  event VARCHAR NOT NULL,
  priority INTEGER DEFAULT 100,
  handler_path TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Integration Points (How Layers Connect to ILIAGPT)

1. **PARE → MultiAgentRouter**: After PARE classifies intent, pass result to router for agent selection
2. **OrchestrationEngine → EnhancedExecutor**: Replace direct tool calls with retry-aware execution
3. **ToolRegistry → SkillDiscovery**: Skills register themselves as tools at startup
4. **ToolExecutionEngine → ToolPolicy**: Policy check before circuit breaker
5. **Agent Routes → HookSystem**: Emit events at run lifecycle points
6. **AgentSessionState → SessionManager**: Session manager wraps the existing table

---

## Testing Strategy

Each layer gets its own test file:
- `server/services/agentOrchestration/__tests__/multiAgentRouter.test.ts`
- `server/services/agentOrchestration/__tests__/enhancedExecutor.test.ts`
- `server/services/agentOrchestration/__tests__/skillDiscovery.test.ts`
- `server/services/agentOrchestration/__tests__/toolPolicy.test.ts`
- `server/services/agentOrchestration/__tests__/hookSystem.test.ts`
- `server/services/agentOrchestration/__tests__/sessionManager.test.ts`

Plus 6 integration tests covering cross-layer flows.

## Files Summary

| File | Type | Purpose |
|------|------|---------|
| `server/services/agentOrchestration/multiAgentRouter.ts` | New | Multi-agent routing with bindings |
| `server/services/agentOrchestration/enhancedExecutor.ts` | New | Retry, failover, compaction |
| `server/services/agentOrchestration/skillDiscovery.ts` | New | Unified skill loading + eligibility |
| `server/services/agentOrchestration/toolPolicy.ts` | New | Allow/deny + circuit breaker |
| `server/services/agentOrchestration/hookSystem.ts` | New | Lifecycle hooks |
| `server/services/agentOrchestration/sessionManager.ts` | New | Session keys + compaction + lanes |
| `server/services/agentOrchestration/index.ts` | New | Barrel exports |
| `shared/schema/agentOrchestration.ts` | New | DB tables for bindings, policies, hooks |
| 6 test files | New | Unit tests per layer |
| 6 integration tests | New | Cross-layer tests |
