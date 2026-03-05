# OpenClaw Agentic Integration Design

**Date:** 2026-02-23
**Status:** Approved
**Approach:** A — OpenClaw Layer (extract & fuse into `server/openclaw/`)

## Summary

Integrate OpenClaw's agentic capabilities into IliaGPT by creating a dedicated integration layer at `server/openclaw/`. This preserves 100% of existing functionality while adding: WebSocket gateway, real shell/fs/browser tool execution, plugin hook system, 70+ skills, and two-layer streaming.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Integration mode | Extract & fuse | Full control, no external dependency |
| Agent loop | Keep LangGraph, enrich with OCLW tools | Preserves existing work |
| Tool execution | Real with policies (safe-bins, approval) | Maximum agent power |
| Architecture | Dedicated `server/openclaw/` layer | Zero contamination of existing code |
| Priority | All 4 modules (gateway, tools, plugins, skills+streaming) | User wants full capability |

## Architecture

```
IliaGPT Server (Express :5000)
├── Existing Stack (preserved 100%)
│   ├── routes/              ← 90+ API endpoints (untouched)
│   ├── agent/langgraph/     ← LangGraph agents (enhanced)
│   ├── agent/agentOrchestrator.ts (enhanced with hooks)
│   ├── agent/toolRegistry.ts (enhanced with OCLW tools)
│   ├── services/            ← Business logic (untouched)
│   └── middleware/          ← Auth, security (untouched)
│
├── NEW: server/openclaw/      ← OpenClaw Integration Layer
│   ├── gateway/
│   │   ├── wsServer.ts         ← WebSocket server (HTTP upgrade, same port)
│   │   ├── protocol.ts         ← Typed WS protocol (TypeBox schemas)
│   │   ├── sessionManager.ts   ← Session routing & isolation
│   │   └── rpcHandlers.ts      ← agent, chat, tools, health RPCs
│   ├── tools/
│   │   ├── execTool.ts         ← Shell execution (safe-bins, approval)
│   │   ├── fsTool.ts           ← Filesystem (workspace isolation)
│   │   ├── browserTool.ts      ← Playwright enhanced (CDP bridge)
│   │   ├── canvasTool.ts       ← Agent-editable HTML/CSS/JS UI
│   │   ├── toolPolicies.ts     ← Per-agent per-tool access policies
│   │   └── adapter.ts          ← Bridges OCLW tools → IliaGPT ToolRegistry
│   ├── plugins/
│   │   ├── hookSystem.ts       ← 12+ lifecycle hook points
│   │   ├── pluginLoader.ts     ← npm package plugin loading
│   │   ├── pluginRegistry.ts   ← Plugin discovery & management
│   │   └── hooks/              ← Built-in hooks (logging, metrics)
│   ├── skills/
│   │   ├── skillLoader.ts      ← Load skills (tools + prompts + bootstrap)
│   │   ├── skillRegistry.ts    ← Skill discovery & management
│   │   └── catalog/            ← Ported skills
│   ├── streaming/
│   │   ├── blockStreaming.ts    ← Chunked progressive output
│   │   ├── previewStreaming.ts  ← Live preview (edit-in-place)
│   │   ├── coalescing.ts       ← Merge blocks with idle gaps
│   │   └── adapter.ts          ← Bridges to existing SSE routes
│   └── index.ts                ← Module initialization
│
└── Enhanced Existing
    ├── agent/agentOrchestrator.ts  ← + hook dispatch at key points
    ├── agent/toolRegistry.ts       ← + OCLW tools registered
    └── server/index.ts             ← + WS upgrade + openclaw init
```

## Module 1: Gateway WebSocket

**Purpose:** Real-time bidirectional control plane replacing HTTP polling for agent operations.

**Mount point:** `ws://localhost:5000/ws/openclaw` via HTTP upgrade on existing Express server.

**Authentication:** Reuses existing JWT/session tokens from Express middleware.

**Protocol:** JSON-RPC over WebSocket with typed schemas (TypeBox).

### RPC Methods

| Method | Direction | Purpose |
|--------|-----------|---------|
| `agent` | client→server | Run agent with message |
| `agent.wait` | client→server | Wait for agent completion |
| `agent.abort` | client→server | Cancel in-flight run |
| `chat.send` | client→server | Send message to channel |
| `chat.list` | client→server | Get conversation history |
| `tools.invoke` | client→server | Direct tool execution |
| `tools.catalog` | client→server | List available tools |
| `health` | client→server | Server health check |

### Event Streams (server→client)

| Event | Payload | Purpose |
|-------|---------|---------|
| `agent.lifecycle` | { runId, phase: start/end/error } | Agent state changes |
| `agent.stream` | { runId, delta, blockIndex } | Assistant token streaming |
| `agent.tool` | { runId, toolName, phase, result } | Tool execution progress |
| `chat.delta` | { messageId, delta } | Message updates |
| `chat.preview` | { messageId, html } | Live preview updates |
| `presence` | { clients: [...] } | Connected clients |

### Session Key Format

```
agent:<agentId>:<sessionKey>
```

Sessions are isolated per-agent with separate workspace, history, and tool policies.

## Module 2: Tool Execution Engine

**Purpose:** Real shell, filesystem, and browser execution with security policies.

### Exec Tool

- **Safe-bins allowlist:** Only permitted commands execute (python, node, git, npm, curl, etc.)
- **Workspace isolation:** Agent operates within `~/.iliagpt/workspaces/<agentId>/`, cannot escape
- **Approval system:** Dangerous commands require user approval via WebSocket event
- **Timeout:** 120s default, configurable per-agent
- **Output sanitization:** Truncate large outputs before passing to LLM context

### FS Tool

- **Operations:** read, write, edit (patch), list, search
- **Workspace-only mode:** Cannot access files outside agent workspace
- **Max file size:** Configurable (default 10MB)
- **Binary detection:** Refuse to read/write binary files

### Browser Tool (Playwright enhanced)

- **CDP bridge:** Full Chrome DevTools Protocol access
- **Profile isolation:** Separate browser profiles per agent
- **Snapshot mode:** Accessibility tree for LLM consumption
- **Actions:** navigate, click, type, scroll, screenshot, upload, evaluate JS
- **Timeout:** 30s per action

### Tool Policies

```typescript
interface ToolPolicy {
  exec: {
    security: 'ask' | 'warn' | 'allow';
    safeBins: string[];    // e.g. ['python', 'node', 'git']
    timeout: number;       // ms
  };
  fs: {
    workspaceOnly: boolean;
    maxFileSize: string;   // e.g. '10MB'
    allowedPaths: string[];
  };
  browser: {
    enabled: boolean;
    timeout: number;
    profiles: string[];
  };
}
```

### Integration with existing ToolRegistry

OCLW tools register themselves via `toolRegistry.register()` with:
- Zod schema validation
- Policy-based access control (ties into existing user plan system)
- Audit logging via existing logging infrastructure
- Metrics collection via existing Prometheus metrics

## Module 3: Plugin Hook System

**Purpose:** Extensibility through lifecycle hooks at key agent execution points.

### Hook Points

| Hook | When | Use Cases |
|------|------|-----------|
| `before_model_resolve` | Before selecting LLM | Override model, A/B testing |
| `before_prompt_build` | Before assembling prompt | Inject context, RAG |
| `before_tool_call` | Before tool executes | Logging, validation, blocking |
| `after_tool_call` | After tool returns | Transform results, metrics |
| `agent_end` | After agent completes | Post-processing, notifications |
| `message_received` | Channel message in | Filtering, routing |
| `message_sent` | Channel message out | Logging, analytics |
| `session_start` | New session created | Initialization, context loading |
| `session_end` | Session closed | Cleanup, summarization |
| `gateway_start` | Server starts | Resource allocation |
| `gateway_stop` | Server stops | Cleanup |
| `error` | Any error occurs | Error reporting, recovery |

### Plugin Format

```typescript
// ~/.iliagpt/plugins/my-plugin/index.ts
export default {
  id: "my-plugin",
  version: "1.0.0",
  title: "My Plugin",
  hooks: {
    before_tool_call: async (ctx) => { /* intercept */ },
    agent_end: async (ctx) => { /* post-process */ },
  },
  tools: (ctx) => [/* custom tools */],
  setup: async (ctx) => { /* init */ },
  shutdown: async (ctx) => { /* cleanup */ },
}
```

### Integration with existing EventBus

Hook dispatches are bridged to the existing `agent/eventBus.ts` so that:
- Existing event listeners continue working
- New hooks are additive, not replacing
- Plugins load from `~/.iliagpt/plugins/` directory or config

## Module 4: Skills System

**Purpose:** Packaged bundles of tools + prompts + context for specialized agent behaviors.

### Skill Structure

```
skill/
├── manifest.json      ← name, description, required tools, config
├── prompt.md          ← system prompt injected when skill is active
├── tools.ts           ← skill-specific tool implementations
└── bootstrap/         ← context files (docs, examples, templates)
```

### Priority Skills to Port from OpenClaw

| Skill | Purpose | Tools Used |
|-------|---------|------------|
| `coding-agent` | Full programming assistant | exec, fs, browser |
| `github` | GitHub operations | exec (git, gh CLI) |
| `browser-clipper` | Web content capture & analysis | browser |
| `obsidian` | Knowledge management | fs |
| `apple-reminders` | Task management | exec |
| `1password` | Credential retrieval | exec (op CLI) |

### Skill Loading

Skills are loaded at agent initialization and:
1. Inject their `prompt.md` into the system prompt
2. Register their tools into the agent's tool catalog
3. Load bootstrap context as available references
4. Respect per-agent skill filters (agent config specifies which skills are active)

## Module 5: Two-Layer Streaming

**Purpose:** Progressive output delivery that's faster and more responsive than basic SSE.

### Block Streaming

Accumulates output into blocks and streams each block when complete:
- Configurable: `minChars`, `maxChars`, `breakPreference` (sentence, paragraph)
- Channel-aware: different chunking for web UI vs Telegram vs Slack
- Coalescing: merge rapid blocks with configurable idle gap

### Preview Streaming

Live-edits a temporary message while the agent generates:
- Modes: `off`, `partial` (replace content), `block` (append), `progress` (show %)
- Works over WebSocket for web UI
- Falls back to SSE for existing HTTP clients

### Integration

Both streaming layers emit events over the WebSocket gateway. For backwards compatibility, they also bridge to existing SSE endpoints so the current React UI works without changes during migration.

## Feature Flags

All modules are gated behind environment variables:

```bash
ENABLE_OPENCLAW_GATEWAY=true    # WebSocket gateway
ENABLE_OPENCLAW_TOOLS=true      # exec/fs/browser tools
ENABLE_OPENCLAW_PLUGINS=true    # Plugin hook system
ENABLE_OPENCLAW_SKILLS=true     # Skills loader
ENABLE_OPENCLAW_STREAMING=true  # Two-layer streaming
```

Default: all `false` until explicitly enabled. This ensures zero impact on existing deployments.

## Data Flow

```
1. Client connects via WebSocket (or existing HTTP)
2. Sends agent request with message + session key
3. Gateway resolves session → agent config → tool policies
4. Dispatches to agentOrchestrator (existing LangGraph)
5. Hook: before_prompt_build → inject skill prompts + context
6. LangGraph runs agent loop with enhanced tool catalog
7. Hook: before_tool_call → policy check → execute → after_tool_call
8. Streaming: block accumulator → WS events + SSE bridge
9. Hook: agent_end → post-processing
10. Final response sent to client
```

## Security Model

- **Auth:** Shared with Express (JWT/session)
- **Tool policies:** Per-user-plan, per-agent, per-tool
- **Exec safe-bins:** Allowlist of permitted shell commands
- **Workspace isolation:** Agents cannot escape their workspace directory
- **Approval system:** Dangerous operations require user confirmation
- **Audit trail:** All tool calls logged with params/results
- **Rate limiting:** Shared with existing rate limiter middleware
