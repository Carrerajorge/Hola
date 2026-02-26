# OpenClaw-ILIAGPT Agentic Fusion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fuse OpenClaw's multi-agent routing, enhanced execution, skill discovery, tool policy, hook system, and session management into ILIAGPT as 6 independent, testable layers under `server/services/agentOrchestration/`.

**Architecture:** Each layer is a standalone module with its own types, logic, and tests. Layers connect to ILIAGPT's existing extension points (PARE, ToolRegistry, OrchestrationEngine). New DB tables live in `shared/schema/agentOrchestration.ts`. No breaking changes to existing code — all new code is additive.

**Tech Stack:** TypeScript, PostgreSQL + Drizzle ORM, Vitest, Express.js

**Reference:** Design doc at `docs/plans/2026-02-24-openclaw-fusion-design.md`

---

## Task 1: Database Schema for Agent Orchestration

**Files:**
- Create: `shared/schema/agentOrchestration.ts`
- Modify: `shared/schema/index.ts` (add export)

**Step 1: Create the schema file**

Create `shared/schema/agentOrchestration.ts` with three tables:

```typescript
import { sql } from "drizzle-orm";
import {
    pgTable, text, varchar, integer, timestamp, jsonb,
    index, boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// 1. Agent Bindings — multi-agent routing config
export const agentBindings = pgTable("agent_bindings", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    agentId: varchar("agent_id", { length: 100 }).notNull(),
    priority: integer("priority").notNull().default(0),
    matchSource: varchar("match_source", { length: 50 }),  // web, api, whatsapp, email
    matchUserId: varchar("match_user_id"),
    matchIntent: varchar("match_intent", { length: 100 }),
    matchTags: text("match_tags").array().default([]),
    agentConfig: jsonb("agent_config").notNull().default({}),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table: any) => [
    index("agent_bindings_agent_idx").on(table.agentId),
    index("agent_bindings_source_idx").on(table.matchSource),
    index("agent_bindings_active_idx").on(table.isActive),
]);

export const insertAgentBindingSchema = createInsertSchema(agentBindings).omit({
    id: true, createdAt: true, updatedAt: true,
});
export type InsertAgentBinding = z.infer<typeof insertAgentBindingSchema>;
export type AgentBinding = typeof agentBindings.$inferSelect;

// 2. Agent Tool Policies — per-agent allow/deny
export const agentToolPolicies = pgTable("agent_tool_policies", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    agentId: varchar("agent_id", { length: 100 }).notNull(),
    allowTools: text("allow_tools").array().default([]),
    denyTools: text("deny_tools").array().default([]),
    ownerOnlyTools: text("owner_only_tools").array().default([]),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table: any) => [
    index("agent_tool_policies_agent_idx").on(table.agentId),
]);

export const insertToolPolicySchema = createInsertSchema(agentToolPolicies).omit({
    id: true, createdAt: true,
});
export type InsertToolPolicy = z.infer<typeof insertToolPolicySchema>;
export type AgentToolPolicy = typeof agentToolPolicies.$inferSelect;

// 3. Agent Hooks — lifecycle event handlers
export const agentHooks = pgTable("agent_hooks", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    name: varchar("name", { length: 200 }).notNull(),
    event: varchar("event", { length: 50 }).notNull(), // before_route, before_agent_start, etc.
    priority: integer("priority").notNull().default(100),
    handlerModule: text("handler_module").notNull(), // module path or inline code
    enabled: boolean("enabled").default(true),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table: any) => [
    index("agent_hooks_event_idx").on(table.event),
    index("agent_hooks_enabled_idx").on(table.enabled),
]);

export const insertAgentHookSchema = createInsertSchema(agentHooks).omit({
    id: true, createdAt: true,
});
export type InsertAgentHook = z.infer<typeof insertAgentHookSchema>;
export type AgentHook = typeof agentHooks.$inferSelect;
```

**Step 2: Add export to shared/schema/index.ts**

Add `export * from "./agentOrchestration";` to `shared/schema/index.ts`.

**Step 3: Commit**

```bash
git add shared/schema/agentOrchestration.ts shared/schema/index.ts
git commit -m "feat(schema): add agent orchestration tables (bindings, tool policies, hooks)"
```

---

## Task 2: Hook/Lifecycle System

**Files:**
- Create: `server/services/agentOrchestration/hookSystem.ts`
- Create: `server/services/agentOrchestration/__tests__/hookSystem.test.ts`

**Why first:** Other layers emit hooks, so this must exist before them.

**Step 1: Write tests**

Test:
- Register a hook and verify it's stored
- Emit an event and verify matching hooks execute in priority order
- Hook can modify context via `overrides`
- Hook can abort execution
- Disabled hooks don't execute
- Non-matching events don't trigger hooks

**Step 2: Implement hookSystem.ts**

```typescript
export type HookEvent = 'before_route' | 'before_agent_start' | 'before_tool_call' | 'after_tool_call' | 'after_agent_complete';

export interface HookContext {
    event: HookEvent;
    agentId: string;
    sessionKey: string;
    userId: string;
    data: Record<string, unknown>;
}

export interface HookResult {
    modified: boolean;
    overrides?: Record<string, unknown>;
    abort?: boolean;
    abortReason?: string;
}

export type HookHandler = (context: HookContext) => Promise<HookResult>;

export interface RegisteredHook {
    id: string;
    name: string;
    event: HookEvent;
    priority: number;
    handler: HookHandler;
    enabled: boolean;
}

export class HookSystem {
    private hooks: Map<string, RegisteredHook> = new Map();

    register(hook: RegisteredHook): void { ... }
    unregister(hookId: string): void { ... }
    async emit(context: HookContext): Promise<HookResult> { ... }
    getHooksForEvent(event: HookEvent): RegisteredHook[] { ... }
    clear(): void { ... }
}

export const hookSystem = new HookSystem();
```

The `emit()` method runs all matching hooks sorted by priority (ascending). If any hook returns `abort: true`, stop and return that result. Otherwise, merge all overrides.

**Step 3: Run tests, commit**

```bash
npx vitest run server/services/agentOrchestration/__tests__/hookSystem.test.ts
git add server/services/agentOrchestration/hookSystem.ts server/services/agentOrchestration/__tests__/hookSystem.test.ts
git commit -m "feat(orchestration): add lifecycle hook system with priority-ordered execution"
```

---

## Task 3: Session Manager

**Files:**
- Create: `server/services/agentOrchestration/sessionManager.ts`
- Create: `server/services/agentOrchestration/__tests__/sessionManager.test.ts`

**Step 1: Write tests**

Test:
- `buildSessionKey()` produces correct format `agent:{agentId}:{scope}:{identifier}`
- `parseSessionKey()` round-trips correctly
- `deriveSessionScope()` returns correct scope from key
- Lane concurrency: second call for same session waits for first to complete
- Lane concurrency: calls for different sessions run in parallel
- `compactHistory()` reduces messages while keeping recent ones + summary
- Identity linking maps alternate IDs to canonical session key

**Step 2: Implement sessionManager.ts**

Key functions ported from OpenClaw's `session-key.ts` and `server-lanes.ts`:

```typescript
export interface SessionKey {
    agentId: string;
    scope: 'direct' | 'group' | 'channel' | 'api';
    identifier: string;
}

export function buildSessionKey(params: {
    agentId: string;
    scope: SessionKey['scope'];
    identifier: string;
    identityLinks?: Record<string, string[]>;
}): string { ... }

export function parseSessionKey(key: string): SessionKey | null { ... }
export function deriveSessionScope(key: string): SessionKey['scope'] | 'unknown' { ... }

export class SessionManager {
    private lanes: Map<string, Promise<void>> = new Map();

    // Lane concurrency: ensures one execution at a time per session
    async withLane<T>(sessionKey: string, fn: () => Promise<T>): Promise<T> { ... }

    // Session compaction: compress old messages
    async compactHistory(messages: SessionMessage[], maxTokens: number): Promise<CompactionResult> { ... }
}

export interface SessionMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    timestamp: Date;
    tokenEstimate?: number;
}

export interface CompactionResult {
    messages: SessionMessage[];
    originalTokens: number;
    compactedTokens: number;
    messagesRemoved: number;
    summaryAdded: boolean;
}

export const sessionManager = new SessionManager();
```

**Compaction algorithm** (ported from OpenClaw):
1. Keep system message (always)
2. Keep last N messages (recent context)
3. Summarize removed messages into a single "context summary" message
4. Return compacted history

**Lane concurrency** (ported from OpenClaw's `server-lanes.ts`):
- Each session key has at most one active execution
- New calls queue behind the current one via chained promises
- Clean up lane entry when queue drains

**Step 3: Run tests, commit**

```bash
npx vitest run server/services/agentOrchestration/__tests__/sessionManager.test.ts
git add server/services/agentOrchestration/sessionManager.ts server/services/agentOrchestration/__tests__/sessionManager.test.ts
git commit -m "feat(orchestration): add session manager with lane concurrency and compaction"
```

---

## Task 4: Tool Policy Layer

**Files:**
- Create: `server/services/agentOrchestration/toolPolicy.ts`
- Create: `server/services/agentOrchestration/__tests__/toolPolicy.test.ts`

**Step 1: Write tests**

Test:
- Tool allowed when in allow list
- Tool denied when in deny list
- Deny list takes precedence over allow list
- Wildcard matching: `web_*` matches `web_search`, `web_browse`
- Owner-only tool blocked for non-owner
- Owner-only tool allowed for owner
- Empty policy allows everything
- Group expansion: `@search-tools` expands to individual tool names

**Step 2: Implement toolPolicy.ts**

```typescript
export interface ToolPolicy {
    agentId: string;
    allow?: string[];
    deny?: string[];
    ownerOnlyTools?: string[];
}

export interface ToolPolicyCheckResult {
    allowed: boolean;
    reason?: 'allowed' | 'denied_by_policy' | 'owner_only' | 'not_in_allowlist';
    toolName: string;
}

// Tool groups for expansion
const TOOL_GROUPS: Record<string, string[]> = {
    '@search-tools': ['web_search', 'search_semantic', 'memory_retrieve'],
    '@file-tools': ['file_write', 'file_read', 'list_files'],
    '@code-tools': ['code_execute', 'code_generate', 'code_review'],
    '@admin-tools': ['create_user', 'delete_user', 'update_user', 'change_role'],
};

export function expandGroups(list: string[]): string[] { ... }

export function matchesPattern(toolName: string, pattern: string): boolean {
    // Support wildcards: "web_*" matches "web_search"
    if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return regex.test(toolName);
    }
    return toolName === pattern;
}

export function evaluateToolPolicy(
    toolName: string,
    policy: ToolPolicy,
    isOwner: boolean = false,
): ToolPolicyCheckResult { ... }

export class ToolPolicyEngine {
    private policies: Map<string, ToolPolicy> = new Map();

    setPolicy(agentId: string, policy: ToolPolicy): void { ... }
    getPolicy(agentId: string): ToolPolicy | undefined { ... }
    check(agentId: string, toolName: string, isOwner: boolean): ToolPolicyCheckResult { ... }
    removePolicy(agentId: string): void { ... }
}

export const toolPolicyEngine = new ToolPolicyEngine();
```

Evaluation order (ported from OpenClaw's `tool-policy.ts`):
1. Check deny list first (deny always wins)
2. Check owner-only (block if not owner)
3. Check allow list (if present, tool must be in it)
4. If no allow list, allow by default

**Step 3: Run tests, commit**

```bash
npx vitest run server/services/agentOrchestration/__tests__/toolPolicy.test.ts
git add server/services/agentOrchestration/toolPolicy.ts server/services/agentOrchestration/__tests__/toolPolicy.test.ts
git commit -m "feat(orchestration): add tool policy engine with allow/deny lists and wildcards"
```

---

## Task 5: Skill Discovery

**Files:**
- Create: `server/services/agentOrchestration/skillDiscovery.ts`
- Create: `server/services/agentOrchestration/__tests__/skillDiscovery.test.ts`

**Step 1: Write tests**

Test:
- Discovers skills from bundled source
- Discovers skills from DB CustomSkills
- DB skills override bundled skills with same name
- `shouldIncludeSkill()` excludes disabled skills
- `shouldIncludeSkill()` excludes skills with missing required env vars
- `shouldIncludeSkill()` excludes skills with missing required binaries
- `buildSkillSnapshot()` respects max limits (150 skills, 30KB)
- `buildSkillSnapshot()` returns formatted prompt string
- Skills register as tools in registry

**Step 2: Implement skillDiscovery.ts**

```typescript
export interface SkillEntry {
    id: string;
    name: string;
    description: string;
    source: 'bundled' | 'workspace' | 'custom';
    enabled: boolean;
    requires?: {
        bins?: string[];
        env?: string[];
        apis?: string[];
    };
    parameters?: Array<{ name: string; type: string; description: string; required: boolean }>;
    actions?: Array<{ id: string; type: string; name: string; config: Record<string, unknown> }>;
}

export interface SkillEligibilityContext {
    platform: string;
    availableBins: Set<string>;
    availableEnvVars: Set<string>;
}

export interface SkillSnapshot {
    skills: SkillEntry[];
    prompt: string;
    totalChars: number;
    filteredCount: number;
}

const MAX_SKILLS_IN_PROMPT = 150;
const MAX_SKILLS_PROMPT_CHARS = 30_000;

export function shouldIncludeSkill(
    entry: SkillEntry,
    eligibility: SkillEligibilityContext,
): boolean { ... }

export function buildSkillSnapshot(
    skills: SkillEntry[],
    eligibility: SkillEligibilityContext,
    filter?: string[],
): SkillSnapshot { ... }

export class SkillDiscovery {
    // Load from bundled directory
    loadBundledSkills(directory: string): SkillEntry[] { ... }
    // Load from DB
    async loadCustomSkills(userId: string): Promise<SkillEntry[]> { ... }
    // Merge all sources (later wins on name collision)
    async discoverAll(userId: string, bundledDir?: string): Promise<SkillEntry[]> { ... }
    // Build snapshot with eligibility filtering
    async buildSnapshot(userId: string, eligibility: SkillEligibilityContext): Promise<SkillSnapshot> { ... }
}

export const skillDiscovery = new SkillDiscovery();
```

**Eligibility checking** (ported from OpenClaw's `shouldIncludeSkill`):
- If `enabled === false`, exclude
- If `requires.bins` specified, check all are in `availableBins`
- If `requires.env` specified, check all are in `availableEnvVars`
- Platform check if `requires.platform` specified

**Snapshot building** (ported from OpenClaw limits):
- Sort by source precedence (bundled < workspace < custom)
- Deduplicate by name (later source wins)
- Truncate to MAX_SKILLS_IN_PROMPT
- Truncate prompt to MAX_SKILLS_PROMPT_CHARS

**Step 3: Run tests, commit**

```bash
npx vitest run server/services/agentOrchestration/__tests__/skillDiscovery.test.ts
git add server/services/agentOrchestration/skillDiscovery.ts server/services/agentOrchestration/__tests__/skillDiscovery.test.ts
git commit -m "feat(orchestration): add unified skill discovery with eligibility checking"
```

---

## Task 6: Multi-Agent Router

**Files:**
- Create: `server/services/agentOrchestration/multiAgentRouter.ts`
- Create: `server/services/agentOrchestration/__tests__/multiAgentRouter.test.ts`

**Step 1: Write tests**

Test:
- Routes to specific agent when user binding matches
- Routes to intent-specific agent when intent binding matches
- Routes to source-specific agent when source binding matches
- Falls back to default agent when no binding matches
- Higher priority binding wins over lower priority
- Inactive bindings are ignored
- Session key is constructed correctly for matched agent
- Integrates with PARE `RobustRouteResult` for intent context

**Step 2: Implement multiAgentRouter.ts**

```typescript
import type { RobustRouteResult } from "../../pare/orchestrator";

export interface AgentConfig {
    id: string;
    name: string;
    modelPrimary: string;
    modelFallbacks: string[];
    skills: string[];
    toolPolicy: { allow?: string[]; deny?: string[] };
    maxRetries: number;
    timeoutMs: number;
}

export interface RouteInput {
    userId: string;
    source: string;          // web, api, whatsapp, email
    pareResult?: RobustRouteResult;
    tags?: string[];
}

export interface AgentRoute {
    agentId: string;
    sessionKey: string;
    matchedBy: string;
    agentConfig: AgentConfig;
}

export class MultiAgentRouter {
    private defaultAgent: AgentConfig;
    private bindingCache: Map<string, AgentRoute> = new Map();
    private readonly CACHE_LIMIT = 2000;

    constructor(defaultAgent: AgentConfig) { ... }

    // Main routing function — ported from OpenClaw's resolveAgentRoute
    async resolveRoute(input: RouteInput): Promise<AgentRoute> {
        // Tier 1: User-specific binding
        // Tier 2: Intent-specific binding
        // Tier 3: Source-specific binding
        // Tier 4: Tag-based binding
        // Tier 5: Default agent
    }

    // Load bindings from DB
    async loadBindings(): Promise<void> { ... }

    clearCache(): void { ... }
}
```

**Routing algorithm** (adapted from OpenClaw's `resolve-route.ts`):
1. Check binding cache first (LRU with 2000-entry limit)
2. Query `agentBindings` table for active bindings, sorted by priority DESC
3. Evaluate matching tiers in order: userId → intent → source → tags → default
4. Build session key using `buildSessionKey()` from sessionManager
5. Cache result and return

**Step 3: Run tests, commit**

```bash
npx vitest run server/services/agentOrchestration/__tests__/multiAgentRouter.test.ts
git add server/services/agentOrchestration/multiAgentRouter.ts server/services/agentOrchestration/__tests__/multiAgentRouter.test.ts
git commit -m "feat(orchestration): add multi-agent router with binding-based routing"
```

---

## Task 7: Enhanced Executor

**Files:**
- Create: `server/services/agentOrchestration/enhancedExecutor.ts`
- Create: `server/services/agentOrchestration/__tests__/enhancedExecutor.test.ts`

**Step 1: Write tests**

Test:
- Successful execution returns result on first attempt
- Retries on transient errors up to max retries
- Classifies errors correctly (context_overflow, auth_error, rate_limit, timeout)
- Model failover: switches to fallback after primary fails
- Session compaction triggered on context overflow
- Tool result truncation when result exceeds max size
- Usage accumulator tracks total and last-call separately
- Abort signal cancels execution
- Timeout causes error classification as 'timeout'

**Step 2: Implement enhancedExecutor.ts**

```typescript
export type ErrorKind = 'context_overflow' | 'auth_error' | 'rate_limit' | 'timeout' | 'model_error' | 'unknown';

export interface ExecutionAttempt {
    provider: string;
    model: string;
    retryCount: number;
    error?: { kind: ErrorKind; message: string };
    durationMs: number;
}

export interface TokenUsage {
    input: number;
    output: number;
    cacheRead: number;
    total: number;
}

export interface ExecutionResult {
    success: boolean;
    output: string;
    attempts: ExecutionAttempt[];
    totalUsage: TokenUsage;
    modelUsed: string;
    compactionCount: number;
}

export interface ExecutorConfig {
    models: string[];           // primary + fallbacks in order
    maxRetriesPerModel: number; // default: 8 (from OpenClaw)
    timeoutMs: number;          // per-attempt timeout
    maxToolResultChars: number; // truncation limit
    onAttempt?: (attempt: ExecutionAttempt) => void;
}

export function classifyError(error: unknown): ErrorKind {
    const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (msg.includes('context') || msg.includes('token') || msg.includes('length')) return 'context_overflow';
    if (msg.includes('auth') || msg.includes('api key') || msg.includes('401')) return 'auth_error';
    if (msg.includes('rate') || msg.includes('429') || msg.includes('quota')) return 'rate_limit';
    if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('ETIMEDOUT')) return 'timeout';
    return 'model_error';
}

export function truncateToolResult(result: string, maxChars: number): string {
    if (result.length <= maxChars) return result;
    // Binary search for max prefix (ported from OpenClaw)
    return result.slice(0, maxChars) + `\n... [truncated ${result.length - maxChars} chars]`;
}

export class EnhancedExecutor {
    // Main execution with retry + failover
    async execute(
        fn: (model: string) => Promise<string>,
        config: ExecutorConfig,
        abortSignal?: AbortSignal,
    ): Promise<ExecutionResult> { ... }
}

export const enhancedExecutor = new EnhancedExecutor();
```

**Retry + failover algorithm** (ported from OpenClaw's `run.ts`):
```
for each model in config.models:
  for retry = 0 to config.maxRetriesPerModel:
    if abortSignal?.aborted: throw AbortError
    try:
      result = await fn(model) with timeout
      return success
    catch:
      errorKind = classifyError(error)
      if errorKind == 'context_overflow': attempt compaction, retry
      if errorKind == 'auth_error' or 'rate_limit': break to next model
      if errorKind == 'timeout': retry same model
      else: retry same model
return failure with all attempts
```

**Step 3: Run tests, commit**

```bash
npx vitest run server/services/agentOrchestration/__tests__/enhancedExecutor.test.ts
git add server/services/agentOrchestration/enhancedExecutor.ts server/services/agentOrchestration/__tests__/enhancedExecutor.test.ts
git commit -m "feat(orchestration): add enhanced executor with retry, failover, and compaction"
```

---

## Task 8: Barrel Export + Wire to ILIAGPT

**Files:**
- Create: `server/services/agentOrchestration/index.ts`
- Modify: `server/services/orchestrationEngine.ts` (import enhancedExecutor)
- Modify: `server/services/pare/orchestrator.ts` (import multiAgentRouter hook)

**Step 1: Create barrel export**

```typescript
// server/services/agentOrchestration/index.ts
export { HookSystem, hookSystem } from './hookSystem';
export type { HookEvent, HookContext, HookResult, HookHandler, RegisteredHook } from './hookSystem';

export { SessionManager, sessionManager, buildSessionKey, parseSessionKey, deriveSessionScope } from './sessionManager';
export type { SessionKey, SessionMessage, CompactionResult } from './sessionManager';

export { ToolPolicyEngine, toolPolicyEngine, evaluateToolPolicy, matchesPattern, expandGroups } from './toolPolicy';
export type { ToolPolicy, ToolPolicyCheckResult } from './toolPolicy';

export { SkillDiscovery, skillDiscovery, shouldIncludeSkill, buildSkillSnapshot } from './skillDiscovery';
export type { SkillEntry, SkillSnapshot, SkillEligibilityContext } from './skillDiscovery';

export { MultiAgentRouter } from './multiAgentRouter';
export type { AgentConfig, RouteInput, AgentRoute } from './multiAgentRouter';

export { EnhancedExecutor, enhancedExecutor, classifyError, truncateToolResult } from './enhancedExecutor';
export type { ExecutionResult, ExecutionAttempt, ExecutorConfig, ErrorKind, TokenUsage } from './enhancedExecutor';
```

**Step 2: Wire EnhancedExecutor into OrchestrationEngine**

In `server/services/orchestrationEngine.ts`, add an optional integration point. Do NOT replace existing logic — add alongside it:

```typescript
import { enhancedExecutor, classifyError } from './agentOrchestration';
```

Add a new method `executeWithEnhancedRetry` that wraps `executeSubtask` with the enhanced executor's retry/failover logic. The existing `executeSubtask` continues to work unchanged.

**Step 3: Wire hook emission into agent routes**

In `server/routes/agentRoutes.ts`, add hook emissions at the run lifecycle points:
- `hookSystem.emit({ event: 'before_agent_start', ... })` before run starts
- `hookSystem.emit({ event: 'after_agent_complete', ... })` after run finishes

These are additive — they don't change the existing route logic.

**Step 4: Commit**

```bash
npx vitest run server/services/agentOrchestration/
git add server/services/agentOrchestration/index.ts server/services/orchestrationEngine.ts server/routes/agentRoutes.ts
git commit -m "feat(orchestration): wire agent orchestration layers into ILIAGPT"
```

---

## Task 9: Integration Tests

**Files:**
- Create: `server/services/agentOrchestration/__tests__/integration.test.ts`

**Step 1: Write 12 integration tests**

These test cross-layer flows:

1. **Full routing flow**: PARE result → MultiAgentRouter → correct agent selected
2. **Routing with hooks**: `before_route` hook modifies routing decision
3. **Tool policy enforcement**: Agent's policy blocks denied tool before execution
4. **Skill→Tool bridge**: Discovered skill registers as tool, tool policy applies to it
5. **Session lane concurrency**: Two concurrent requests for same session execute sequentially
6. **Session compaction trigger**: Long conversation triggers automatic compaction
7. **Enhanced execution retry**: Transient error → retry → success
8. **Enhanced execution failover**: Primary model fails → fallback model succeeds
9. **Hook lifecycle**: before_agent_start → before_tool_call → after_tool_call → after_agent_complete all fire in order
10. **Identity linking**: Two different user IDs map to same session via identity links
11. **Tool policy wildcards in routing**: Agent with `@search-tools` group in allow list
12. **Abort signal propagation**: Cancellation stops execution and emits after_agent_complete hook

**Step 2: Run all tests**

```bash
npx vitest run server/services/agentOrchestration/
```

Expected: All tests pass (unit + integration).

**Step 3: Commit**

```bash
git add server/services/agentOrchestration/__tests__/integration.test.ts
git commit -m "test(orchestration): add 12 integration tests for cross-layer agent orchestration"
```

---

## Task 10: Verification & Checklist

**Step 1: Run full test suite**

```bash
npx vitest run server/services/agentOrchestration/
npx vitest run server/services/rag/
```

Verify ALL tests pass.

**Step 2: Verify server starts without errors**

```bash
npx tsx server/index.ts
```

Check for:
- No import errors
- No schema errors
- All tool registrations complete

**Step 3: Generate verification checklist**

Create a summary of what was built, what was tested, and what the user should verify manually.

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(orchestration): complete OpenClaw-ILIAGPT agentic fusion (6 layers + 12 integration tests)"
```

---

## Summary of Files

| # | File | Type |
|---|------|------|
| 1 | `shared/schema/agentOrchestration.ts` | Schema |
| 2 | `server/services/agentOrchestration/hookSystem.ts` | Layer 5 |
| 3 | `server/services/agentOrchestration/sessionManager.ts` | Layer 6 |
| 4 | `server/services/agentOrchestration/toolPolicy.ts` | Layer 4 |
| 5 | `server/services/agentOrchestration/skillDiscovery.ts` | Layer 3 |
| 6 | `server/services/agentOrchestration/multiAgentRouter.ts` | Layer 1 |
| 7 | `server/services/agentOrchestration/enhancedExecutor.ts` | Layer 2 |
| 8 | `server/services/agentOrchestration/index.ts` | Barrel |
| 9 | 6 unit test files | Tests |
| 10 | 1 integration test file (12 tests) | Tests |
| 11 | `shared/schema/index.ts` | Modified |
| 12 | `server/services/orchestrationEngine.ts` | Modified |
| 13 | `server/routes/agentRoutes.ts` | Modified |
