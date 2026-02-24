export type SessionKey = `agent:${string}`;

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

// ── Memory / RAG types ──────────────────────────────────────────────

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

// ── Model Fallback types ────────────────────────────────────────────

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

// ── Routing types ───────────────────────────────────────────────────

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

// ── Workspace types ─────────────────────────────────────────────────

export type BootstrapFileName = 'SOUL.md' | 'IDENTITY.md' | 'TOOLS.md' | 'MEMORY.md' | 'AGENTS.md' | 'BOOTSTRAP.md';

export interface WorkspaceBootstrapFile {
  name: BootstrapFileName;
  path: string;
  content: string | null;
  missing: boolean;
}

// ── Session Persistence types ───────────────────────────────────────

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

// ── Enhanced Skill types ────────────────────────────────────────────

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

// ── Tool Policy Pipeline types ──────────────────────────────────────

export interface ToolPolicyStep {
  label: string;
  policy: { allow?: string[]; deny?: string[] } | null;
}

export type ToolProfileId = 'minimal' | 'coding' | 'messaging' | 'full';
