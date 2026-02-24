# OpenClaw Agentic Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate OpenClaw's agentic capabilities (WebSocket gateway, real tool execution, plugin hooks, skills, two-layer streaming) into IliaGPT as a dedicated `server/openclaw/` layer without modifying existing functionality.

**Architecture:** New `server/openclaw/` module with 5 submódules (gateway, tools, plugins, skills, streaming) that registers into existing ToolRegistry, EventBus, and Express server. Feature-flagged via environment variables.

**Tech Stack:** TypeScript, ws (WebSocket), @sinclair/typebox (protocol schemas), zod (validation), node:child_process (exec), playwright-core (browser), Express HTTP upgrade

**Design doc:** `docs/plans/2026-02-23-openclaw-integration-design.md`

---

## Task 1: OpenClaw Module Scaffold & Feature Flags

**Files:**
- Create: `server/openclaw/index.ts`
- Create: `server/openclaw/types.ts`
- Create: `server/openclaw/config.ts`
- Modify: `server/config/env.ts` (add ENABLE_OPENCLAW_* vars)
- Modify: `server/index.ts:338` (add openclaw init call)
- Test: `server/openclaw/__tests__/config.test.ts`

**Step 1: Write the failing test**

```typescript
// server/openclaw/__tests__/config.test.ts
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
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run server/openclaw/__tests__/config.test.ts`
Expected: FAIL with "Cannot find module '../config'"

**Step 3: Create the config module**

```typescript
// server/openclaw/config.ts
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
  skills: { enabled: boolean; directory: string };
  streaming: {
    enabled: boolean;
    blockMinChars: number;
    blockMaxChars: number;
    previewMode: 'off' | 'partial' | 'block' | 'progress';
  };
}

const DEFAULT_SAFE_BINS = [
  'python', 'python3', 'node', 'npm', 'npx', 'pnpm', 'yarn', 'bun',
  'git', 'curl', 'wget', 'jq', 'cat', 'ls', 'find', 'grep', 'sed', 'awk',
  'echo', 'mkdir', 'cp', 'mv', 'rm', 'touch', 'head', 'tail', 'wc',
  'sort', 'uniq', 'diff', 'tar', 'gzip', 'gunzip', 'zip', 'unzip',
  'docker', 'docker-compose', 'make', 'cmake',
];

export function getOpenClawConfig(): OpenClawConfig {
  return {
    gateway: {
      enabled: process.env.ENABLE_OPENCLAW_GATEWAY === 'true',
      path: process.env.OPENCLAW_WS_PATH || '/ws/openclaw',
    },
    tools: {
      enabled: process.env.ENABLE_OPENCLAW_TOOLS === 'true',
      safeBins: process.env.OPENCLAW_SAFE_BINS
        ? process.env.OPENCLAW_SAFE_BINS.split(',').map(s => s.trim())
        : DEFAULT_SAFE_BINS,
      workspaceRoot: process.env.OPENCLAW_WORKSPACE_ROOT || '/tmp/openclaw-workspaces',
      execTimeout: Number(process.env.OPENCLAW_EXEC_TIMEOUT) || 120_000,
      execSecurity: (process.env.OPENCLAW_EXEC_SECURITY as any) || 'warn',
    },
    plugins: {
      enabled: process.env.ENABLE_OPENCLAW_PLUGINS === 'true',
      directory: process.env.OPENCLAW_PLUGINS_DIR || '~/.iliagpt/plugins',
    },
    skills: {
      enabled: process.env.ENABLE_OPENCLAW_SKILLS === 'true',
      directory: process.env.OPENCLAW_SKILLS_DIR || '~/.iliagpt/skills',
    },
    streaming: {
      enabled: process.env.ENABLE_OPENCLAW_STREAMING === 'true',
      blockMinChars: Number(process.env.OPENCLAW_BLOCK_MIN_CHARS) || 50,
      blockMaxChars: Number(process.env.OPENCLAW_BLOCK_MAX_CHARS) || 500,
      previewMode: (process.env.OPENCLAW_PREVIEW_MODE as any) || 'partial',
    },
  };
}
```

```typescript
// server/openclaw/types.ts
export type SessionKey = `agent:${string}:${string}`;

export interface WsRequest {
  type: 'req';
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface WsResponse {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string };
}

export interface WsEvent {
  type: 'event';
  event: string;
  payload: unknown;
  timestamp: number;
}

export type WsMessage = WsRequest | WsResponse | WsEvent;

export interface ToolPolicy {
  exec: {
    security: 'ask' | 'warn' | 'allow';
    safeBins: string[];
    timeout: number;
  };
  fs: {
    workspaceOnly: boolean;
    maxFileSize: number;
    allowedPaths: string[];
  };
  browser: {
    enabled: boolean;
    timeout: number;
  };
}

export interface OpenClawPlugin {
  id: string;
  version?: string;
  title?: string;
  hooks?: Partial<Record<HookPoint, HookHandler>>;
  tools?: (ctx: any) => any[];
  setup?: (ctx: any) => Promise<void>;
  shutdown?: (ctx: any) => Promise<void>;
}

export type HookPoint =
  | 'before_model_resolve'
  | 'before_prompt_build'
  | 'before_tool_call'
  | 'after_tool_call'
  | 'agent_end'
  | 'message_received'
  | 'message_sent'
  | 'session_start'
  | 'session_end'
  | 'gateway_start'
  | 'gateway_stop'
  | 'error';

export type HookHandler = (ctx: HookContext) => Promise<void> | void;

export interface HookContext {
  runId?: string;
  sessionKey?: string;
  userId?: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: unknown;
  error?: Error;
  metadata?: Record<string, unknown>;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  prompt: string;
  tools: string[];
  bootstrap?: Record<string, string>;
}
```

```typescript
// server/openclaw/index.ts
import type { Server as HttpServer } from 'http';
import { getOpenClawConfig } from './config';
import { Logger } from '../lib/logger';

const log = new Logger('OpenClaw');

export async function initializeOpenClaw(httpServer: HttpServer): Promise<void> {
  const config = getOpenClawConfig();

  const enabledModules: string[] = [];

  if (config.gateway.enabled) {
    const { initGateway } = await import('./gateway/wsServer');
    await initGateway(httpServer, config);
    enabledModules.push('gateway');
  }

  if (config.tools.enabled) {
    const { registerOpenClawTools } = await import('./tools/adapter');
    registerOpenClawTools(config);
    enabledModules.push('tools');
  }

  if (config.plugins.enabled) {
    const { initPlugins } = await import('./plugins/pluginLoader');
    await initPlugins(config);
    enabledModules.push('plugins');
  }

  if (config.skills.enabled) {
    const { initSkills } = await import('./skills/skillLoader');
    await initSkills(config);
    enabledModules.push('skills');
  }

  if (config.streaming.enabled) {
    const { initStreaming } = await import('./streaming/adapter');
    initStreaming(config);
    enabledModules.push('streaming');
  }

  if (enabledModules.length > 0) {
    log.info(`OpenClaw initialized: [${enabledModules.join(', ')}]`);
  } else {
    log.info('OpenClaw: all modules disabled (set ENABLE_OPENCLAW_* env vars to enable)');
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run server/openclaw/__tests__/config.test.ts`
Expected: PASS

**Step 5: Wire into server/index.ts**

Add to `server/index.ts` after `registerRoutes(httpServer, app)`:

```typescript
// After line ~298: await registerRoutes(httpServer, app);
const { initializeOpenClaw } = await import('./openclaw/index');
await initializeOpenClaw(httpServer);
```

**Step 6: Commit**

```bash
git add server/openclaw/ server/index.ts
git commit -m "feat(openclaw): scaffold module with config, types, and feature flags"
```

---

## Task 2: WebSocket Gateway Server

**Files:**
- Create: `server/openclaw/gateway/wsServer.ts`
- Create: `server/openclaw/gateway/protocol.ts`
- Create: `server/openclaw/gateway/rpcHandlers.ts`
- Create: `server/openclaw/gateway/sessionManager.ts`
- Test: `server/openclaw/__tests__/gateway.test.ts`

**Step 1: Write the failing test**

```typescript
// server/openclaw/__tests__/gateway.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'http';
import WebSocket from 'ws';
import { initGateway } from '../gateway/wsServer';
import { getOpenClawConfig } from '../config';

describe('OpenClaw Gateway', () => {
  let httpServer: any;
  let port: number;

  beforeAll(async () => {
    httpServer = createServer();
    const config = { ...getOpenClawConfig(), gateway: { enabled: true, path: '/ws/openclaw' } };
    await initGateway(httpServer, config as any);
    await new Promise<void>(resolve => {
      httpServer.listen(0, () => {
        port = httpServer.address().port;
        resolve();
      });
    });
  });

  afterAll(() => { httpServer?.close(); });

  it('accepts WebSocket connections on configured path', async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/openclaw`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
      setTimeout(() => reject(new Error('timeout')), 3000);
    });
    ws.close();
  });

  it('responds to health RPC', async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/openclaw`);
    await new Promise<void>(r => ws.on('open', r));

    ws.send(JSON.stringify({ type: 'req', id: 'r1', method: 'health' }));

    const response = await new Promise<any>((resolve) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'res' && msg.id === 'r1') resolve(msg);
      });
      setTimeout(() => resolve(null), 3000);
    });

    expect(response).toBeTruthy();
    expect(response.ok).toBe(true);
    ws.close();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run server/openclaw/__tests__/gateway.test.ts`
Expected: FAIL — module not found

**Step 3: Implement gateway modules**

```typescript
// server/openclaw/gateway/protocol.ts
// Typed WS protocol messages — adapted from OpenClaw's TypeBox protocol

import type { WsRequest, WsResponse, WsEvent, WsMessage } from '../types';

export function createResponse(reqId: string, payload: unknown): WsResponse {
  return { type: 'res', id: reqId, ok: true, payload };
}

export function createErrorResponse(reqId: string, code: string, message: string): WsResponse {
  return { type: 'res', id: reqId, ok: false, error: { code, message } };
}

export function createEvent(event: string, payload: unknown): WsEvent {
  return { type: 'event', event, payload, timestamp: Date.now() };
}

export function parseMessage(raw: string): WsMessage | null {
  try {
    const msg = JSON.parse(raw);
    if (msg.type === 'req' && typeof msg.id === 'string' && typeof msg.method === 'string') {
      return msg as WsRequest;
    }
    if (msg.type === 'res' && typeof msg.id === 'string') {
      return msg as WsResponse;
    }
    if (msg.type === 'event' && typeof msg.event === 'string') {
      return msg as WsEvent;
    }
    return null;
  } catch {
    return null;
  }
}
```

```typescript
// server/openclaw/gateway/sessionManager.ts
import type { SessionKey } from '../types';
import { randomUUID } from 'crypto';

interface Session {
  key: SessionKey;
  agentId: string;
  sessionId: string;
  userId: string;
  createdAt: number;
  lastActiveAt: number;
  metadata: Record<string, unknown>;
}

class OpenClawSessionManager {
  private sessions = new Map<string, Session>();

  parseSessionKey(key: string): { agentId: string; sessionId: string } | null {
    const parts = key.split(':');
    if (parts.length !== 3 || parts[0] !== 'agent') return null;
    return { agentId: parts[1], sessionId: parts[2] };
  }

  buildSessionKey(agentId: string, sessionId: string): SessionKey {
    return `agent:${agentId}:${sessionId}`;
  }

  getOrCreate(key: SessionKey, userId: string): Session {
    let session = this.sessions.get(key);
    if (!session) {
      const parsed = this.parseSessionKey(key);
      if (!parsed) throw new Error(`Invalid session key: ${key}`);
      session = {
        key,
        agentId: parsed.agentId,
        sessionId: parsed.sessionId,
        userId,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        metadata: {},
      };
      this.sessions.set(key, session);
    }
    session.lastActiveAt = Date.now();
    return session;
  }

  get(key: string): Session | undefined {
    return this.sessions.get(key);
  }

  list(): Session[] {
    return Array.from(this.sessions.values());
  }

  remove(key: string): boolean {
    return this.sessions.delete(key);
  }
}

export const openclawSessionManager = new OpenClawSessionManager();
```

```typescript
// server/openclaw/gateway/rpcHandlers.ts
import type { WsRequest } from '../types';
import { createResponse, createErrorResponse } from './protocol';
import { openclawSessionManager } from './sessionManager';

type RpcHandler = (req: WsRequest, ctx: { userId: string }) => Promise<any>;

const handlers = new Map<string, RpcHandler>();

// Register core RPC methods
handlers.set('health', async () => ({
  status: 'ok',
  uptime: process.uptime(),
  timestamp: Date.now(),
  modules: {
    gateway: true,
    tools: !!process.env.ENABLE_OPENCLAW_TOOLS,
    plugins: !!process.env.ENABLE_OPENCLAW_PLUGINS,
    skills: !!process.env.ENABLE_OPENCLAW_SKILLS,
    streaming: !!process.env.ENABLE_OPENCLAW_STREAMING,
  },
}));

handlers.set('sessions.list', async () => {
  return { sessions: openclawSessionManager.list() };
});

handlers.set('tools.catalog', async () => {
  // Will be enriched in Task 3
  return { tools: [] };
});

export function registerRpcHandler(method: string, handler: RpcHandler): void {
  handlers.set(method, handler);
}

export async function handleRpc(
  req: WsRequest,
  ctx: { userId: string }
): Promise<any> {
  const handler = handlers.get(req.method);
  if (!handler) {
    return createErrorResponse(req.id, 'METHOD_NOT_FOUND', `Unknown method: ${req.method}`);
  }

  try {
    const result = await handler(req, ctx);
    return createResponse(req.id, result);
  } catch (err: any) {
    return createErrorResponse(req.id, 'INTERNAL_ERROR', err.message || 'Internal error');
  }
}
```

```typescript
// server/openclaw/gateway/wsServer.ts
import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer, IncomingMessage } from 'http';
import type { OpenClawConfig } from '../config';
import { parseMessage, createEvent } from './protocol';
import { handleRpc } from './rpcHandlers';
import { Logger } from '../../lib/logger';

const log = new Logger('OpenClaw:Gateway');

interface ConnectedClient {
  ws: WebSocket;
  userId: string;
  connectedAt: number;
  subscriptions: Set<string>;
}

const clients = new Map<WebSocket, ConnectedClient>();
let tickInterval: NodeJS.Timeout | null = null;

export async function initGateway(httpServer: HttpServer, config: OpenClawConfig): Promise<void> {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    if (url.pathname !== config.gateway.path) return;

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // Extract userId from query params or session (simplified for now)
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const userId = url.searchParams.get('userId') || 'anonymous';

    const client: ConnectedClient = {
      ws,
      userId,
      connectedAt: Date.now(),
      subscriptions: new Set(),
    };
    clients.set(ws, client);

    log.info(`Client connected: ${userId} (total: ${clients.size})`);

    // Send welcome event
    ws.send(JSON.stringify(createEvent('connected', {
      protocol: 1,
      timestamp: Date.now(),
    })));

    ws.on('message', async (raw) => {
      const msg = parseMessage(raw.toString());
      if (!msg || msg.type !== 'req') return;

      const response = await handleRpc(msg, { userId: client.userId });
      ws.send(JSON.stringify(response));
    });

    ws.on('close', () => {
      clients.delete(ws);
      log.info(`Client disconnected: ${userId} (total: ${clients.size})`);
    });

    ws.on('error', (err) => {
      log.error(`WebSocket error for ${userId}: ${err.message}`);
      clients.delete(ws);
    });
  });

  // Presence tick every 15s
  tickInterval = setInterval(() => {
    const event = createEvent('tick', { seq: Date.now(), clients: clients.size });
    broadcast(JSON.stringify(event));
  }, 15_000);

  log.info(`Gateway initialized on path: ${config.gateway.path}`);
}

export function broadcast(data: string, filter?: (client: ConnectedClient) => boolean): void {
  for (const [ws, client] of clients) {
    if (ws.readyState === WebSocket.OPEN && (!filter || filter(client))) {
      ws.send(data);
    }
  }
}

export function broadcastEvent(event: string, payload: unknown, filter?: (client: ConnectedClient) => boolean): void {
  broadcast(JSON.stringify(createEvent(event, payload)), filter);
}

export function getConnectedClients(): number {
  return clients.size;
}

export function shutdownGateway(): void {
  if (tickInterval) clearInterval(tickInterval);
  for (const [ws] of clients) {
    ws.close(1001, 'Server shutting down');
  }
  clients.clear();
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run server/openclaw/__tests__/gateway.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/openclaw/gateway/
git commit -m "feat(openclaw): WebSocket gateway with RPC protocol and session management"
```

---

## Task 3: Tool Execution Engine — Exec Tool

**Files:**
- Create: `server/openclaw/tools/execTool.ts`
- Create: `server/openclaw/tools/toolPolicies.ts`
- Test: `server/openclaw/__tests__/execTool.test.ts`

**Step 1: Write the failing test**

```typescript
// server/openclaw/__tests__/execTool.test.ts
import { describe, it, expect } from 'vitest';
import { createExecTool } from '../tools/execTool';
import { ToolPolicyEngine } from '../tools/toolPolicies';

describe('Exec Tool', () => {
  const policy = new ToolPolicyEngine({
    safeBins: ['echo', 'ls', 'cat', 'python3'],
    security: 'allow',
    timeout: 5000,
  });

  it('executes allowed commands', async () => {
    const tool = createExecTool(policy, '/tmp/test-workspace');
    const result = await tool.execute({ command: 'echo hello' }, {
      userId: 'test', chatId: 'c1', runId: 'r1',
    } as any);
    expect(result.success).toBe(true);
    expect(result.output).toContain('hello');
  });

  it('blocks commands not in safe-bins', async () => {
    const tool = createExecTool(policy, '/tmp/test-workspace');
    const result = await tool.execute({ command: 'rm -rf /' }, {
      userId: 'test', chatId: 'c1', runId: 'r1',
    } as any);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('BLOCKED');
  });

  it('enforces timeout', async () => {
    const shortPolicy = new ToolPolicyEngine({
      safeBins: ['sleep'],
      security: 'allow',
      timeout: 500,
    });
    const tool = createExecTool(shortPolicy, '/tmp/test-workspace');
    const result = await tool.execute({ command: 'sleep 10' }, {
      userId: 'test', chatId: 'c1', runId: 'r1',
    } as any);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('TIMEOUT');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run server/openclaw/__tests__/execTool.test.ts`
Expected: FAIL

**Step 3: Implement tool policies and exec tool**

```typescript
// server/openclaw/tools/toolPolicies.ts
import path from 'path';

export interface ExecPolicyConfig {
  safeBins: string[];
  security: 'ask' | 'warn' | 'allow';
  timeout: number;
}

export class ToolPolicyEngine {
  private safeBinsSet: Set<string>;
  private config: ExecPolicyConfig;

  constructor(config: ExecPolicyConfig) {
    this.config = config;
    this.safeBinsSet = new Set(config.safeBins.map(b => b.toLowerCase()));
  }

  get security() { return this.config.security; }
  get timeout() { return this.config.timeout; }

  isCommandAllowed(command: string): { allowed: boolean; binary: string; reason?: string } {
    const trimmed = command.trim();
    // Extract the binary name (first token, ignoring env vars)
    const tokens = trimmed.split(/\s+/);
    let binaryToken = tokens[0];

    // Handle env var prefixes like "FOO=bar command"
    let idx = 0;
    while (idx < tokens.length && tokens[idx].includes('=')) idx++;
    if (idx < tokens.length) binaryToken = tokens[idx];

    // Handle path-qualified binaries
    const binary = path.basename(binaryToken).toLowerCase();

    if (!this.safeBinsSet.has(binary)) {
      return { allowed: false, binary, reason: `Binary '${binary}' is not in safe-bins allowlist` };
    }

    // Block dangerous patterns regardless of binary
    const dangerousPatterns = [
      /rm\s+(-rf?|--recursive).*\//,  // rm -rf /
      />\s*\/dev\/sd/,                  // write to block devices
      /mkfs\./,                         // format filesystem
      /dd\s+if=/,                       // raw disk access
      /:\(\)\s*\{\s*:\|:\s*&\s*\}/,    // fork bomb
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(trimmed)) {
        return { allowed: false, binary, reason: 'Command matches a dangerous pattern' };
      }
    }

    return { allowed: true, binary };
  }

  isPathAllowed(filepath: string, workspaceRoot: string): boolean {
    const resolved = path.resolve(filepath);
    const wsResolved = path.resolve(workspaceRoot);
    return resolved.startsWith(wsResolved);
  }
}
```

```typescript
// server/openclaw/tools/execTool.ts
import { z } from 'zod';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import type { ToolDefinition, ToolContext, ToolResult } from '../../agent/toolRegistry';
import { ToolPolicyEngine } from './toolPolicies';

const ExecInputSchema = z.object({
  command: z.string().min(1).describe('Shell command to execute'),
  cwd: z.string().optional().describe('Working directory (within workspace)'),
  timeout: z.number().optional().describe('Timeout in ms (overrides default)'),
  env: z.record(z.string()).optional().describe('Additional environment variables'),
});

export function createExecTool(
  policy: ToolPolicyEngine,
  workspaceRoot: string
): ToolDefinition {
  return {
    name: 'openclaw_exec',
    description: 'Execute a shell command securely with safe-bins policy and workspace isolation. Supports python, node, git, npm, curl, and more.',
    inputSchema: ExecInputSchema,
    capabilities: [
      { name: 'executes_code', description: 'Runs shell commands' },
      { name: 'system_access', description: 'System-level operations' },
    ],
    execute: async (input: z.infer<typeof ExecInputSchema>, context: ToolContext): Promise<ToolResult> => {
      const { command, cwd, timeout: overrideTimeout, env: extraEnv } = input;

      // Policy check
      const check = policy.isCommandAllowed(command);
      if (!check.allowed) {
        return {
          success: false,
          output: null,
          error: {
            code: 'BLOCKED',
            message: `Command blocked: ${check.reason}`,
            retryable: false,
            details: { binary: check.binary, command },
          },
        };
      }

      // Ensure workspace exists
      await fs.mkdir(workspaceRoot, { recursive: true });

      // Resolve working directory within workspace
      const effectiveCwd = cwd
        ? path.resolve(workspaceRoot, cwd)
        : workspaceRoot;

      if (!effectiveCwd.startsWith(path.resolve(workspaceRoot))) {
        return {
          success: false,
          output: null,
          error: {
            code: 'BLOCKED',
            message: 'Working directory escapes workspace root',
            retryable: false,
          },
        };
      }

      await fs.mkdir(effectiveCwd, { recursive: true });

      const effectiveTimeout = overrideTimeout || policy.timeout;

      return new Promise<ToolResult>((resolve) => {
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let killed = false;

        const proc = spawn('sh', ['-c', command], {
          cwd: effectiveCwd,
          env: { ...process.env, ...extraEnv, HOME: workspaceRoot },
          timeout: effectiveTimeout,
          signal: context.signal,
        });

        const timer = setTimeout(() => {
          killed = true;
          proc.kill('SIGKILL');
        }, effectiveTimeout);

        proc.stdout.on('data', (chunk) => {
          stdout.push(chunk);
          context.onStream?.({ stream: 'stdout', chunk: chunk.toString() });
        });

        proc.stderr.on('data', (chunk) => {
          stderr.push(chunk);
          context.onStream?.({ stream: 'stderr', chunk: chunk.toString() });
        });

        proc.on('close', (exitCode, signal) => {
          clearTimeout(timer);
          const stdoutStr = Buffer.concat(stdout).toString().slice(0, 100_000); // Truncate
          const stderrStr = Buffer.concat(stderr).toString().slice(0, 50_000);
          const durationMs = Date.now() - (proc as any)._startedAt || 0;

          context.onExit?.({
            exitCode: exitCode ?? -1,
            signal: signal ?? null,
            wasKilled: killed,
            durationMs,
          });

          if (killed) {
            resolve({
              success: false,
              output: stdoutStr,
              error: {
                code: 'TIMEOUT',
                message: `Command timed out after ${effectiveTimeout}ms`,
                retryable: true,
                details: { stderr: stderrStr },
              },
              metrics: { durationMs: effectiveTimeout },
            });
            return;
          }

          resolve({
            success: exitCode === 0,
            output: stdoutStr || stderrStr,
            error: exitCode !== 0 ? {
              code: 'EXIT_CODE',
              message: `Command exited with code ${exitCode}`,
              retryable: true,
              details: { exitCode, stderr: stderrStr },
            } : undefined,
            metrics: { durationMs },
          });
        });

        proc.on('error', (err) => {
          clearTimeout(timer);
          resolve({
            success: false,
            output: null,
            error: {
              code: 'SPAWN_ERROR',
              message: err.message,
              retryable: false,
            },
          });
        });

        (proc as any)._startedAt = Date.now();
      });
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run server/openclaw/__tests__/execTool.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/openclaw/tools/
git commit -m "feat(openclaw): exec tool with safe-bins policy and workspace isolation"
```

---

## Task 4: Tool Execution Engine — FS Tool

**Files:**
- Create: `server/openclaw/tools/fsTool.ts`
- Test: `server/openclaw/__tests__/fsTool.test.ts`

**Step 1: Write the failing test**

```typescript
// server/openclaw/__tests__/fsTool.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createFsTools } from '../tools/fsTool';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('FS Tools', () => {
  let workspaceRoot: string;
  let tools: ReturnType<typeof createFsTools>;
  const ctx = { userId: 'test', chatId: 'c1', runId: 'r1' } as any;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'oclw-test-'));
    tools = createFsTools(workspaceRoot, true);
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('reads files within workspace', async () => {
    await fs.writeFile(path.join(workspaceRoot, 'test.txt'), 'hello world');
    const readTool = tools.find(t => t.name === 'openclaw_read');
    const result = await readTool!.execute({ path: 'test.txt' }, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toBe('hello world');
  });

  it('writes files within workspace', async () => {
    const writeTool = tools.find(t => t.name === 'openclaw_write');
    const result = await writeTool!.execute({ path: 'out.txt', content: 'new content' }, ctx);
    expect(result.success).toBe(true);
    const content = await fs.readFile(path.join(workspaceRoot, 'out.txt'), 'utf-8');
    expect(content).toBe('new content');
  });

  it('blocks reads outside workspace when workspaceOnly=true', async () => {
    const readTool = tools.find(t => t.name === 'openclaw_read');
    const result = await readTool!.execute({ path: '/etc/passwd' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('BLOCKED');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run server/openclaw/__tests__/fsTool.test.ts`
Expected: FAIL

**Step 3: Implement FS tools**

```typescript
// server/openclaw/tools/fsTool.ts
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import type { ToolDefinition, ToolContext, ToolResult } from '../../agent/toolRegistry';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function resolveAndCheck(filepath: string, workspaceRoot: string, workspaceOnly: boolean): { resolved: string; allowed: boolean } {
  const resolved = path.isAbsolute(filepath)
    ? filepath
    : path.resolve(workspaceRoot, filepath);

  if (workspaceOnly && !resolved.startsWith(path.resolve(workspaceRoot))) {
    return { resolved, allowed: false };
  }
  return { resolved, allowed: true };
}

export function createFsTools(workspaceRoot: string, workspaceOnly: boolean): ToolDefinition[] {
  const readTool: ToolDefinition = {
    name: 'openclaw_read',
    description: 'Read a file from the agent workspace. Supports text files up to 10MB.',
    inputSchema: z.object({
      path: z.string().describe('File path (relative to workspace or absolute if allowed)'),
      offset: z.number().optional().describe('Line offset to start reading from'),
      limit: z.number().optional().describe('Maximum lines to read'),
    }),
    execute: async (input, ctx): Promise<ToolResult> => {
      const { resolved, allowed } = resolveAndCheck(input.path, workspaceRoot, workspaceOnly);
      if (!allowed) {
        return { success: false, output: null, error: { code: 'BLOCKED', message: 'Path outside workspace', retryable: false } };
      }
      try {
        const stat = await fs.stat(resolved);
        if (stat.size > MAX_FILE_SIZE) {
          return { success: false, output: null, error: { code: 'TOO_LARGE', message: `File exceeds ${MAX_FILE_SIZE} bytes`, retryable: false } };
        }
        let content = await fs.readFile(resolved, 'utf-8');
        if (input.offset !== undefined || input.limit !== undefined) {
          const lines = content.split('\n');
          const start = input.offset || 0;
          const end = input.limit ? start + input.limit : lines.length;
          content = lines.slice(start, end).join('\n');
        }
        return { success: true, output: content };
      } catch (err: any) {
        return { success: false, output: null, error: { code: 'READ_ERROR', message: err.message, retryable: false } };
      }
    },
  };

  const writeTool: ToolDefinition = {
    name: 'openclaw_write',
    description: 'Write or create a file in the agent workspace.',
    inputSchema: z.object({
      path: z.string().describe('File path (relative to workspace)'),
      content: z.string().describe('Content to write'),
    }),
    execute: async (input, ctx): Promise<ToolResult> => {
      const { resolved, allowed } = resolveAndCheck(input.path, workspaceRoot, workspaceOnly);
      if (!allowed) {
        return { success: false, output: null, error: { code: 'BLOCKED', message: 'Path outside workspace', retryable: false } };
      }
      try {
        await fs.mkdir(path.dirname(resolved), { recursive: true });
        await fs.writeFile(resolved, input.content, 'utf-8');
        return { success: true, output: `Written ${input.content.length} bytes to ${input.path}` };
      } catch (err: any) {
        return { success: false, output: null, error: { code: 'WRITE_ERROR', message: err.message, retryable: false } };
      }
    },
  };

  const editTool: ToolDefinition = {
    name: 'openclaw_edit',
    description: 'Edit a file by replacing a string or applying a regex patch.',
    inputSchema: z.object({
      path: z.string(),
      oldText: z.string().describe('Text to find'),
      newText: z.string().describe('Replacement text'),
      replaceAll: z.boolean().optional().default(false),
    }),
    execute: async (input, ctx): Promise<ToolResult> => {
      const { resolved, allowed } = resolveAndCheck(input.path, workspaceRoot, workspaceOnly);
      if (!allowed) {
        return { success: false, output: null, error: { code: 'BLOCKED', message: 'Path outside workspace', retryable: false } };
      }
      try {
        let content = await fs.readFile(resolved, 'utf-8');
        if (!content.includes(input.oldText)) {
          return { success: false, output: null, error: { code: 'NOT_FOUND', message: 'oldText not found in file', retryable: false } };
        }
        if (input.replaceAll) {
          content = content.replaceAll(input.oldText, input.newText);
        } else {
          content = content.replace(input.oldText, input.newText);
        }
        await fs.writeFile(resolved, content, 'utf-8');
        return { success: true, output: `Edited ${input.path}` };
      } catch (err: any) {
        return { success: false, output: null, error: { code: 'EDIT_ERROR', message: err.message, retryable: false } };
      }
    },
  };

  const listTool: ToolDefinition = {
    name: 'openclaw_list',
    description: 'List files and directories in the agent workspace.',
    inputSchema: z.object({
      path: z.string().optional().default('.'),
      recursive: z.boolean().optional().default(false),
    }),
    execute: async (input, ctx): Promise<ToolResult> => {
      const { resolved, allowed } = resolveAndCheck(input.path || '.', workspaceRoot, workspaceOnly);
      if (!allowed) {
        return { success: false, output: null, error: { code: 'BLOCKED', message: 'Path outside workspace', retryable: false } };
      }
      try {
        const entries = await fs.readdir(resolved, { withFileTypes: true, recursive: input.recursive });
        const listing = entries.map(e => ({
          name: e.name,
          type: e.isDirectory() ? 'directory' : 'file',
        }));
        return { success: true, output: listing };
      } catch (err: any) {
        return { success: false, output: null, error: { code: 'LIST_ERROR', message: err.message, retryable: false } };
      }
    },
  };

  return [readTool, writeTool, editTool, listTool];
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run server/openclaw/__tests__/fsTool.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/openclaw/tools/fsTool.ts server/openclaw/__tests__/fsTool.test.ts
git commit -m "feat(openclaw): filesystem tools with workspace isolation"
```

---

## Task 5: Tool Adapter — Bridge to Existing ToolRegistry

**Files:**
- Create: `server/openclaw/tools/adapter.ts`
- Test: `server/openclaw/__tests__/adapter.test.ts`

**Step 1: Write the failing test**

```typescript
// server/openclaw/__tests__/adapter.test.ts
import { describe, it, expect, vi } from 'vitest';

// Mock toolRegistry before importing adapter
vi.mock('../../agent/toolRegistry', () => {
  const tools = new Map();
  return {
    toolRegistry: {
      register: vi.fn((tool: any) => tools.set(tool.name, tool)),
      get: vi.fn((name: string) => tools.get(name)),
      list: vi.fn(() => Array.from(tools.values())),
    },
  };
});

import { registerOpenClawTools } from '../tools/adapter';
import { toolRegistry } from '../../agent/toolRegistry';
import { getOpenClawConfig } from '../config';

describe('Tool Adapter', () => {
  it('registers openclaw tools into the existing registry', () => {
    const config = {
      ...getOpenClawConfig(),
      tools: {
        enabled: true,
        safeBins: ['echo', 'ls'],
        workspaceRoot: '/tmp/oclw-test',
        execTimeout: 5000,
        execSecurity: 'allow' as const,
      },
    };
    registerOpenClawTools(config);

    // Should have registered exec + 4 fs tools = 5 tools minimum
    expect((toolRegistry.register as any).mock.calls.length).toBeGreaterThanOrEqual(5);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run server/openclaw/__tests__/adapter.test.ts`
Expected: FAIL

**Step 3: Implement adapter**

```typescript
// server/openclaw/tools/adapter.ts
import { toolRegistry } from '../../agent/toolRegistry';
import type { OpenClawConfig } from '../config';
import { createExecTool } from './execTool';
import { createFsTools } from './fsTool';
import { ToolPolicyEngine } from './toolPolicies';
import { Logger } from '../../lib/logger';

const log = new Logger('OpenClaw:Tools');

export function registerOpenClawTools(config: OpenClawConfig): void {
  const policy = new ToolPolicyEngine({
    safeBins: config.tools.safeBins,
    security: config.tools.execSecurity,
    timeout: config.tools.execTimeout,
  });

  // Register exec tool
  const execTool = createExecTool(policy, config.tools.workspaceRoot);
  toolRegistry.register(execTool);
  log.info(`Registered tool: ${execTool.name}`);

  // Register FS tools
  const fsTools = createFsTools(config.tools.workspaceRoot, true);
  for (const tool of fsTools) {
    toolRegistry.register(tool);
    log.info(`Registered tool: ${tool.name}`);
  }

  log.info(`OpenClaw tools registered: ${1 + fsTools.length} tools total`);
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run server/openclaw/__tests__/adapter.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/openclaw/tools/adapter.ts server/openclaw/__tests__/adapter.test.ts
git commit -m "feat(openclaw): tool adapter bridges OCLW tools into existing ToolRegistry"
```

---

## Task 6: Plugin Hook System

**Files:**
- Create: `server/openclaw/plugins/hookSystem.ts`
- Create: `server/openclaw/plugins/pluginLoader.ts`
- Create: `server/openclaw/plugins/pluginRegistry.ts`
- Test: `server/openclaw/__tests__/hooks.test.ts`

**Step 1: Write the failing test**

```typescript
// server/openclaw/__tests__/hooks.test.ts
import { describe, it, expect, vi } from 'vitest';
import { HookSystem } from '../plugins/hookSystem';

describe('Hook System', () => {
  it('dispatches hooks to registered handlers', async () => {
    const hooks = new HookSystem();
    const handler = vi.fn();

    hooks.register('before_tool_call', handler);

    await hooks.dispatch('before_tool_call', {
      toolName: 'openclaw_exec',
      toolInput: { command: 'echo test' },
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].toolName).toBe('openclaw_exec');
  });

  it('supports multiple handlers per hook point', async () => {
    const hooks = new HookSystem();
    const h1 = vi.fn();
    const h2 = vi.fn();

    hooks.register('agent_end', h1);
    hooks.register('agent_end', h2);

    await hooks.dispatch('agent_end', { runId: 'r1' });

    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  it('catches handler errors without stopping dispatch', async () => {
    const hooks = new HookSystem();
    const failing = vi.fn().mockRejectedValue(new Error('boom'));
    const passing = vi.fn();

    hooks.register('before_tool_call', failing);
    hooks.register('before_tool_call', passing);

    await hooks.dispatch('before_tool_call', {});

    expect(failing).toHaveBeenCalled();
    expect(passing).toHaveBeenCalled(); // Should still run
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run server/openclaw/__tests__/hooks.test.ts`
Expected: FAIL

**Step 3: Implement hook system**

```typescript
// server/openclaw/plugins/hookSystem.ts
import type { HookPoint, HookHandler, HookContext } from '../types';
import { Logger } from '../../lib/logger';

const log = new Logger('OpenClaw:Hooks');

export class HookSystem {
  private hooks = new Map<HookPoint, HookHandler[]>();

  register(point: HookPoint, handler: HookHandler): void {
    if (!this.hooks.has(point)) {
      this.hooks.set(point, []);
    }
    this.hooks.get(point)!.push(handler);
  }

  unregister(point: HookPoint, handler: HookHandler): void {
    const handlers = this.hooks.get(point);
    if (!handlers) return;
    const idx = handlers.indexOf(handler);
    if (idx >= 0) handlers.splice(idx, 1);
  }

  async dispatch(point: HookPoint, ctx: Partial<HookContext>): Promise<void> {
    const handlers = this.hooks.get(point);
    if (!handlers || handlers.length === 0) return;

    for (const handler of handlers) {
      try {
        await handler(ctx as HookContext);
      } catch (err: any) {
        log.error(`Hook ${point} handler error: ${err.message}`);
      }
    }
  }

  getRegisteredPoints(): HookPoint[] {
    return Array.from(this.hooks.keys());
  }

  getHandlerCount(point: HookPoint): number {
    return this.hooks.get(point)?.length ?? 0;
  }

  clear(): void {
    this.hooks.clear();
  }
}

// Singleton
export const hookSystem = new HookSystem();
```

```typescript
// server/openclaw/plugins/pluginRegistry.ts
import type { OpenClawPlugin } from '../types';
import { hookSystem } from './hookSystem';
import { Logger } from '../../lib/logger';

const log = new Logger('OpenClaw:Plugins');

class PluginRegistry {
  private plugins = new Map<string, OpenClawPlugin>();

  async register(plugin: OpenClawPlugin): Promise<void> {
    if (this.plugins.has(plugin.id)) {
      log.warn(`Plugin ${plugin.id} already registered, skipping`);
      return;
    }

    // Register hooks
    if (plugin.hooks) {
      for (const [point, handler] of Object.entries(plugin.hooks)) {
        if (handler) {
          hookSystem.register(point as any, handler);
        }
      }
    }

    // Run setup
    if (plugin.setup) {
      await plugin.setup({});
    }

    this.plugins.set(plugin.id, plugin);
    log.info(`Plugin registered: ${plugin.id} (${plugin.title || 'untitled'})`);
  }

  async unregister(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;

    if (plugin.shutdown) {
      await plugin.shutdown({});
    }

    this.plugins.delete(pluginId);
    log.info(`Plugin unregistered: ${pluginId}`);
  }

  get(id: string): OpenClawPlugin | undefined {
    return this.plugins.get(id);
  }

  list(): OpenClawPlugin[] {
    return Array.from(this.plugins.values());
  }

  async shutdownAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      try {
        await plugin.shutdown?.({});
      } catch (err: any) {
        log.error(`Plugin ${plugin.id} shutdown error: ${err.message}`);
      }
    }
    this.plugins.clear();
    hookSystem.clear();
  }
}

export const pluginRegistry = new PluginRegistry();
```

```typescript
// server/openclaw/plugins/pluginLoader.ts
import type { OpenClawConfig } from '../config';
import { pluginRegistry } from './pluginRegistry';
import { Logger } from '../../lib/logger';

const log = new Logger('OpenClaw:PluginLoader');

export async function initPlugins(config: OpenClawConfig): Promise<void> {
  // Register built-in audit plugin
  await pluginRegistry.register({
    id: 'builtin-audit',
    title: 'Audit Logger',
    hooks: {
      before_tool_call: async (ctx) => {
        log.info(`[Audit] Tool call: ${ctx.toolName} by ${ctx.userId} (run: ${ctx.runId})`);
      },
      after_tool_call: async (ctx) => {
        log.info(`[Audit] Tool result: ${ctx.toolName} (run: ${ctx.runId})`);
      },
      error: async (ctx) => {
        log.error(`[Audit] Error in run ${ctx.runId}: ${ctx.error?.message}`);
      },
    },
  });

  log.info('Plugin system initialized');
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run server/openclaw/__tests__/hooks.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/openclaw/plugins/
git commit -m "feat(openclaw): plugin hook system with 12 lifecycle hook points"
```

---

## Task 7: Skill Loader System

**Files:**
- Create: `server/openclaw/skills/skillLoader.ts`
- Create: `server/openclaw/skills/skillRegistry.ts`
- Test: `server/openclaw/__tests__/skills.test.ts`

**Step 1: Write the failing test**

```typescript
// server/openclaw/__tests__/skills.test.ts
import { describe, it, expect } from 'vitest';
import { SkillRegistry } from '../skills/skillRegistry';

describe('Skill Registry', () => {
  it('registers and retrieves skills', () => {
    const registry = new SkillRegistry();
    registry.register({
      id: 'test-skill',
      name: 'Test Skill',
      description: 'A test skill',
      prompt: 'You are a test assistant',
      tools: ['openclaw_exec'],
    });

    const skill = registry.get('test-skill');
    expect(skill).toBeTruthy();
    expect(skill!.name).toBe('Test Skill');
  });

  it('lists all skills', () => {
    const registry = new SkillRegistry();
    registry.register({ id: 's1', name: 'S1', description: '', prompt: '', tools: [] });
    registry.register({ id: 's2', name: 'S2', description: '', prompt: '', tools: [] });
    expect(registry.list()).toHaveLength(2);
  });

  it('returns skill prompt for agent context injection', () => {
    const registry = new SkillRegistry();
    registry.register({
      id: 'coding',
      name: 'Coding Agent',
      description: 'A coding assistant',
      prompt: 'You are an expert coder. Use exec and fs tools to write and run code.',
      tools: ['openclaw_exec', 'openclaw_read', 'openclaw_write'],
    });

    const prompt = registry.getPromptForSkills(['coding']);
    expect(prompt).toContain('expert coder');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run server/openclaw/__tests__/skills.test.ts`
Expected: FAIL

**Step 3: Implement skill registry and loader**

```typescript
// server/openclaw/skills/skillRegistry.ts
import type { Skill } from '../types';

export class SkillRegistry {
  private skills = new Map<string, Skill>();

  register(skill: Skill): void {
    this.skills.set(skill.id, skill);
  }

  get(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  list(): Skill[] {
    return Array.from(this.skills.values());
  }

  getPromptForSkills(skillIds: string[]): string {
    const prompts: string[] = [];
    for (const id of skillIds) {
      const skill = this.skills.get(id);
      if (skill?.prompt) {
        prompts.push(`## Skill: ${skill.name}\n${skill.prompt}`);
      }
    }
    return prompts.join('\n\n');
  }

  getToolsForSkills(skillIds: string[]): string[] {
    const tools = new Set<string>();
    for (const id of skillIds) {
      const skill = this.skills.get(id);
      if (skill?.tools) {
        for (const t of skill.tools) tools.add(t);
      }
    }
    return Array.from(tools);
  }

  remove(id: string): boolean {
    return this.skills.delete(id);
  }
}

export const skillRegistry = new SkillRegistry();
```

```typescript
// server/openclaw/skills/skillLoader.ts
import type { OpenClawConfig } from '../config';
import { skillRegistry } from './skillRegistry';
import { Logger } from '../../lib/logger';

const log = new Logger('OpenClaw:Skills');

export async function initSkills(config: OpenClawConfig): Promise<void> {
  // Register built-in skills (adapted from OpenClaw's most valuable skills)

  skillRegistry.register({
    id: 'coding-agent',
    name: 'Coding Agent',
    description: 'Full programming assistant with shell, filesystem, and git capabilities',
    prompt: `You are an expert software engineer. You have access to shell execution (openclaw_exec), file reading (openclaw_read), file writing (openclaw_write), and file editing (openclaw_edit) tools.

When coding:
- Read existing files before modifying them
- Use git for version control when appropriate
- Run tests after making changes
- Handle errors gracefully
- Follow the project's existing code style`,
    tools: ['openclaw_exec', 'openclaw_read', 'openclaw_write', 'openclaw_edit', 'openclaw_list'],
  });

  skillRegistry.register({
    id: 'github',
    name: 'GitHub Operations',
    description: 'Create issues, pull requests, review code, manage repos',
    prompt: `You can interact with GitHub using the gh CLI tool via openclaw_exec.

Common operations:
- gh issue create --title "..." --body "..."
- gh pr create --title "..." --body "..."
- gh pr list
- gh repo clone owner/repo
- gh api repos/{owner}/{repo}/issues`,
    tools: ['openclaw_exec', 'openclaw_read'],
  });

  skillRegistry.register({
    id: 'data-analysis',
    name: 'Data Analysis',
    description: 'Analyze CSV/JSON data, generate charts and reports',
    prompt: `You are a data analyst. Use Python (via openclaw_exec) to analyze data files.

Approach:
- Read data with pandas
- Perform analysis (describe, groupby, pivot)
- Generate visualizations with matplotlib/seaborn
- Save outputs to workspace`,
    tools: ['openclaw_exec', 'openclaw_read', 'openclaw_write'],
  });

  skillRegistry.register({
    id: 'web-scraper',
    name: 'Web Scraper',
    description: 'Scrape and extract content from websites',
    prompt: `You can scrape web content using curl or Python (requests/beautifulsoup).

Approach:
- Use curl for simple fetches
- Use Python with requests + BeautifulSoup for complex scraping
- Respect robots.txt
- Handle rate limiting`,
    tools: ['openclaw_exec', 'openclaw_write'],
  });

  skillRegistry.register({
    id: 'devops',
    name: 'DevOps Assistant',
    description: 'Docker, deployment, CI/CD, infrastructure management',
    prompt: `You are a DevOps engineer. You can manage containers, deployments, and infrastructure.

Tools available:
- docker / docker-compose for containerization
- git for version control
- curl for API calls
- Shell commands for system management

Always be careful with destructive operations.`,
    tools: ['openclaw_exec', 'openclaw_read', 'openclaw_write', 'openclaw_list'],
  });

  log.info(`Skills loaded: ${skillRegistry.list().length} skills registered`);
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run server/openclaw/__tests__/skills.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/openclaw/skills/
git commit -m "feat(openclaw): skill system with 5 built-in skills (coding, github, data, web, devops)"
```

---

## Task 8: Two-Layer Streaming System

**Files:**
- Create: `server/openclaw/streaming/blockStreaming.ts`
- Create: `server/openclaw/streaming/previewStreaming.ts`
- Create: `server/openclaw/streaming/adapter.ts`
- Test: `server/openclaw/__tests__/streaming.test.ts`

**Step 1: Write the failing test**

```typescript
// server/openclaw/__tests__/streaming.test.ts
import { describe, it, expect, vi } from 'vitest';
import { BlockStreamAccumulator } from '../streaming/blockStreaming';

describe('Block Streaming', () => {
  it('accumulates text and emits blocks when threshold is reached', () => {
    const onBlock = vi.fn();
    const acc = new BlockStreamAccumulator({ minChars: 10, maxChars: 50, onBlock });

    acc.push('Hello ');
    expect(onBlock).not.toHaveBeenCalled();

    acc.push('World! This is a test.');
    expect(onBlock).toHaveBeenCalledOnce();
    expect(onBlock.mock.calls[0][0]).toContain('Hello World!');
  });

  it('flushes remaining text on end', () => {
    const onBlock = vi.fn();
    const acc = new BlockStreamAccumulator({ minChars: 100, maxChars: 500, onBlock });

    acc.push('Short text');
    expect(onBlock).not.toHaveBeenCalled();

    acc.end();
    expect(onBlock).toHaveBeenCalledOnce();
    expect(onBlock.mock.calls[0][0]).toBe('Short text');
  });

  it('respects sentence boundaries for block breaks', () => {
    const onBlock = vi.fn();
    const acc = new BlockStreamAccumulator({ minChars: 10, maxChars: 50, onBlock });

    acc.push('First sentence. Second sentence. Third sentence.');
    acc.end();

    // Should break at sentence boundaries
    for (const call of onBlock.mock.calls) {
      const text = call[0] as string;
      expect(text.trimEnd().endsWith('.') || text.length < 10).toBe(true);
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run server/openclaw/__tests__/streaming.test.ts`
Expected: FAIL

**Step 3: Implement streaming modules**

```typescript
// server/openclaw/streaming/blockStreaming.ts
export interface BlockStreamConfig {
  minChars: number;
  maxChars: number;
  onBlock: (text: string, index: number) => void;
}

export class BlockStreamAccumulator {
  private buffer = '';
  private blockIndex = 0;
  private config: BlockStreamConfig;

  constructor(config: BlockStreamConfig) {
    this.config = config;
  }

  push(text: string): void {
    this.buffer += text;
    this.tryEmit();
  }

  end(): void {
    if (this.buffer.length > 0) {
      this.config.onBlock(this.buffer, this.blockIndex++);
      this.buffer = '';
    }
  }

  private tryEmit(): void {
    while (this.buffer.length >= this.config.minChars) {
      const breakPoint = this.findBreakPoint();
      if (breakPoint <= 0) break;

      const block = this.buffer.slice(0, breakPoint);
      this.buffer = this.buffer.slice(breakPoint);
      this.config.onBlock(block, this.blockIndex++);
    }

    // Force emit if over max
    if (this.buffer.length >= this.config.maxChars) {
      const block = this.buffer.slice(0, this.config.maxChars);
      this.buffer = this.buffer.slice(this.config.maxChars);
      this.config.onBlock(block, this.blockIndex++);
    }
  }

  private findBreakPoint(): number {
    // Prefer sentence boundaries
    const sentenceBreaks = ['. ', '! ', '? ', '.\n', '!\n', '?\n'];
    let bestBreak = -1;

    for (const sep of sentenceBreaks) {
      const idx = this.buffer.indexOf(sep, this.config.minChars - sep.length);
      if (idx >= 0 && idx + sep.length <= this.config.maxChars) {
        bestBreak = Math.max(bestBreak, idx + sep.length);
      }
    }

    if (bestBreak > 0) return bestBreak;

    // Fall back to newline boundaries
    const newlineIdx = this.buffer.indexOf('\n', this.config.minChars);
    if (newlineIdx >= 0 && newlineIdx < this.config.maxChars) {
      return newlineIdx + 1;
    }

    // Fall back to word boundaries
    if (this.buffer.length >= this.config.maxChars) {
      const spaceIdx = this.buffer.lastIndexOf(' ', this.config.maxChars);
      if (spaceIdx > this.config.minChars) return spaceIdx + 1;
      return this.config.maxChars;
    }

    return -1; // Not enough text yet
  }

  get bufferedLength(): number {
    return this.buffer.length;
  }
}
```

```typescript
// server/openclaw/streaming/previewStreaming.ts
import { broadcastEvent } from '../gateway/wsServer';

export type PreviewMode = 'off' | 'partial' | 'block' | 'progress';

export class PreviewStream {
  private mode: PreviewMode;
  private runId: string;
  private accumulated = '';

  constructor(runId: string, mode: PreviewMode) {
    this.runId = runId;
    this.mode = mode;
  }

  push(delta: string): void {
    if (this.mode === 'off') return;

    this.accumulated += delta;

    if (this.mode === 'partial') {
      // Send full accumulated text (client replaces content)
      broadcastEvent('chat.preview', {
        runId: this.runId,
        mode: 'replace',
        content: this.accumulated,
      });
    } else if (this.mode === 'block') {
      // Send only the delta (client appends)
      broadcastEvent('chat.preview', {
        runId: this.runId,
        mode: 'append',
        content: delta,
      });
    } else if (this.mode === 'progress') {
      // Send progress indicator
      broadcastEvent('chat.preview', {
        runId: this.runId,
        mode: 'progress',
        chars: this.accumulated.length,
      });
    }
  }

  end(): void {
    if (this.mode === 'off') return;
    broadcastEvent('chat.preview', {
      runId: this.runId,
      mode: 'done',
      content: this.accumulated,
    });
  }

  get totalChars(): number {
    return this.accumulated.length;
  }
}
```

```typescript
// server/openclaw/streaming/adapter.ts
import type { OpenClawConfig } from '../config';
import { BlockStreamAccumulator } from './blockStreaming';
import { PreviewStream } from './previewStreaming';
import { broadcastEvent } from '../gateway/wsServer';
import { agentEventBus } from '../../agent/eventBus';
import { Logger } from '../../lib/logger';

const log = new Logger('OpenClaw:Streaming');

export function initStreaming(config: OpenClawConfig): void {
  // Bridge: when agentEventBus emits streaming events, pipe through block+preview
  agentEventBus.on('trace', (event: any) => {
    if (event.event_type === 'stream_chunk' && event.runId) {
      // Forward through WebSocket gateway
      broadcastEvent('agent.stream', {
        runId: event.runId,
        delta: event.output_snippet || '',
        timestamp: event.timestamp,
      });
    }
  });

  log.info(`Streaming initialized: block(${config.streaming.blockMinChars}-${config.streaming.blockMaxChars}), preview(${config.streaming.previewMode})`);
}

export function createStreamingPair(
  runId: string,
  config: OpenClawConfig
): { block: BlockStreamAccumulator; preview: PreviewStream } {
  const preview = new PreviewStream(runId, config.streaming.previewMode);

  const block = new BlockStreamAccumulator({
    minChars: config.streaming.blockMinChars,
    maxChars: config.streaming.blockMaxChars,
    onBlock: (text, index) => {
      broadcastEvent('chat.delta', {
        runId,
        blockIndex: index,
        content: text,
        timestamp: Date.now(),
      });
    },
  });

  return { block, preview };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run server/openclaw/__tests__/streaming.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/openclaw/streaming/
git commit -m "feat(openclaw): two-layer streaming (block + preview) with SSE bridge"
```

---

## Task 9: Wire Hooks into AgentOrchestrator

**Files:**
- Modify: `server/agent/agentOrchestrator.ts` (add hook dispatch at key lifecycle points)
- Test: `server/openclaw/__tests__/integration.test.ts`

**Step 1: Write the failing integration test**

```typescript
// server/openclaw/__tests__/integration.test.ts
import { describe, it, expect, vi } from 'vitest';
import { hookSystem } from '../plugins/hookSystem';

describe('Hook Integration', () => {
  it('hookSystem is importable and functional', () => {
    const handler = vi.fn();
    hookSystem.register('before_tool_call', handler);
    hookSystem.dispatch('before_tool_call', { toolName: 'test' });
    expect(handler).toHaveBeenCalled();
    hookSystem.clear();
  });
});
```

**Step 2: Run test to verify it passes** (this should pass since we already implemented it)

Run: `npx vitest run server/openclaw/__tests__/integration.test.ts`
Expected: PASS

**Step 3: Add hook dispatch to AgentOrchestrator**

In `server/agent/agentOrchestrator.ts`, add hook dispatches at the key lifecycle points. This is a non-breaking enhancement — hooks only fire if the plugin system is enabled:

Find the `executeStep` method and add `before_tool_call` / `after_tool_call` hooks around tool execution. Find the completion path and add `agent_end` hook.

Add this import at top:
```typescript
import { hookSystem } from '../openclaw/plugins/hookSystem';
```

Before each `toolRegistry.execute(...)` call, add:
```typescript
await hookSystem.dispatch('before_tool_call', {
  runId: this.runId,
  userId: this.userId,
  toolName: step.toolName,
  toolInput: step.input,
});
```

After each tool result, add:
```typescript
await hookSystem.dispatch('after_tool_call', {
  runId: this.runId,
  userId: this.userId,
  toolName: step.toolName,
  toolResult: result,
});
```

In the completion/done path, add:
```typescript
await hookSystem.dispatch('agent_end', {
  runId: this.runId,
  userId: this.userId,
});
```

**Step 4: Run full test suite to verify no regressions**

Run: `npx vitest run server/openclaw/`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add server/agent/agentOrchestrator.ts server/openclaw/__tests__/integration.test.ts
git commit -m "feat(openclaw): wire hooks into AgentOrchestrator lifecycle"
```

---

## Task 10: Gateway RPC Handlers for Agent & Tools

**Files:**
- Modify: `server/openclaw/gateway/rpcHandlers.ts` (add agent, tools.invoke, chat RPCs)
- Test: `server/openclaw/__tests__/rpc.test.ts`

**Step 1: Write the failing test**

```typescript
// server/openclaw/__tests__/rpc.test.ts
import { describe, it, expect } from 'vitest';
import { handleRpc } from '../gateway/rpcHandlers';

describe('RPC Handlers', () => {
  it('handles health check', async () => {
    const res = await handleRpc(
      { type: 'req', id: 'r1', method: 'health' },
      { userId: 'test' }
    );
    expect(res.ok).toBe(true);
    expect(res.payload.status).toBe('ok');
  });

  it('handles tools.catalog', async () => {
    const res = await handleRpc(
      { type: 'req', id: 'r2', method: 'tools.catalog' },
      { userId: 'test' }
    );
    expect(res.ok).toBe(true);
    expect(res.payload).toHaveProperty('tools');
  });

  it('returns error for unknown methods', async () => {
    const res = await handleRpc(
      { type: 'req', id: 'r3', method: 'nonexistent' },
      { userId: 'test' }
    );
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('METHOD_NOT_FOUND');
  });
});
```

**Step 2: Run test to verify it fails for tools.invoke**

Run: `npx vitest run server/openclaw/__tests__/rpc.test.ts`
Expected: Partial pass (health works, tools.invoke may fail)

**Step 3: Enhance RPC handlers**

Add to `server/openclaw/gateway/rpcHandlers.ts`:

```typescript
// Add agent and tools.invoke handlers
import { toolRegistry } from '../../agent/toolRegistry';
import { skillRegistry } from '../skills/skillRegistry';
import { hookSystem } from '../plugins/hookSystem';

handlers.set('tools.catalog', async () => {
  const tools = toolRegistry.list().map(t => ({
    name: t.name,
    description: t.description,
  }));
  return { tools };
});

handlers.set('tools.invoke', async (req, ctx) => {
  const { name, input } = req.params as { name: string; input: any };
  if (!name) return createErrorResponse(req.id, 'INVALID_PARAMS', 'Missing tool name');

  await hookSystem.dispatch('before_tool_call', { toolName: name, toolInput: input, userId: ctx.userId });

  const result = await toolRegistry.execute(name, input, {
    userId: ctx.userId,
    chatId: '',
    runId: `ws-${Date.now()}`,
  });

  await hookSystem.dispatch('after_tool_call', { toolName: name, toolResult: result, userId: ctx.userId });

  return result;
});

handlers.set('skills.list', async () => {
  return { skills: skillRegistry.list() };
});
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run server/openclaw/__tests__/rpc.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/openclaw/gateway/rpcHandlers.ts server/openclaw/__tests__/rpc.test.ts
git commit -m "feat(openclaw): RPC handlers for tools.invoke, tools.catalog, skills.list"
```

---

## Task 11: Environment Variables Documentation & Final Wiring

**Files:**
- Modify: `.env.example` (add OPENCLAW_* variables)
- Modify: `server/index.ts` (ensure openclaw init is properly wired)
- Test: Run all openclaw tests together

**Step 1: Add env vars to .env.example**

```bash
# OpenClaw Integration (all disabled by default)
ENABLE_OPENCLAW_GATEWAY=false
ENABLE_OPENCLAW_TOOLS=false
ENABLE_OPENCLAW_PLUGINS=false
ENABLE_OPENCLAW_SKILLS=false
ENABLE_OPENCLAW_STREAMING=false

# OpenClaw Tool Policies
OPENCLAW_SAFE_BINS=python,python3,node,npm,npx,git,curl,ls,cat,echo,mkdir,cp,mv
OPENCLAW_WORKSPACE_ROOT=/tmp/openclaw-workspaces
OPENCLAW_EXEC_TIMEOUT=120000
OPENCLAW_EXEC_SECURITY=warn
OPENCLAW_WS_PATH=/ws/openclaw

# OpenClaw Streaming
OPENCLAW_BLOCK_MIN_CHARS=50
OPENCLAW_BLOCK_MAX_CHARS=500
OPENCLAW_PREVIEW_MODE=partial
```

**Step 2: Run all OpenClaw tests**

Run: `npx vitest run server/openclaw/`
Expected: ALL PASS

**Step 3: Run existing project tests to verify no regressions**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: No new failures

**Step 4: Commit**

```bash
git add .env.example server/index.ts server/openclaw/
git commit -m "feat(openclaw): complete integration — gateway, tools, plugins, skills, streaming"
```

---

## Summary

| Task | Module | Files | Tests |
|------|--------|-------|-------|
| 1 | Scaffold + Config | 3 create, 2 modify | config.test.ts |
| 2 | WebSocket Gateway | 4 create | gateway.test.ts |
| 3 | Exec Tool | 2 create | execTool.test.ts |
| 4 | FS Tools | 1 create | fsTool.test.ts |
| 5 | Tool Adapter | 1 create | adapter.test.ts |
| 6 | Plugin Hooks | 3 create | hooks.test.ts |
| 7 | Skill System | 2 create | skills.test.ts |
| 8 | Streaming | 3 create | streaming.test.ts |
| 9 | Hook Wiring | 1 modify | integration.test.ts |
| 10 | RPC Handlers | 1 modify | rpc.test.ts |
| 11 | Final Wiring | 2 modify | full suite |

**Total: ~20 new files, 3 modified files, 10 test files**

Each task follows strict TDD: write failing test → implement → verify pass → commit.
