import type { WsRequest } from '../types';
import { createResponse, createErrorResponse } from './protocol';
import { openclawSessionManager } from './sessionManager';
import { toolRegistry } from '../../agent/toolRegistry';
import { hookSystem } from '../plugins/hookSystem';
import { skillRegistry } from '../skills/skillRegistry';
import { getOpenClawServices } from '../index';

type RpcHandler = (req: WsRequest, ctx: { userId: string }) => Promise<any>;

const handlers = new Map<string, RpcHandler>();

handlers.set('health', async () => ({
  status: 'ok',
  uptime: process.uptime(),
  timestamp: Date.now(),
  modules: {
    gateway: true,
    tools: process.env.ENABLE_OPENCLAW_TOOLS === 'true',
    plugins: process.env.ENABLE_OPENCLAW_PLUGINS === 'true',
    skills: process.env.ENABLE_OPENCLAW_SKILLS === 'true',
    streaming: process.env.ENABLE_OPENCLAW_STREAMING === 'true',
    memory: process.env.OPENCLAW_MEMORY_ENABLED === 'true',
    modelFallback: process.env.OPENCLAW_MODEL_FALLBACK !== 'false',
    routing: process.env.OPENCLAW_ROUTING_ENABLED === 'true',
    workspace: process.env.OPENCLAW_WORKSPACES_ENABLED === 'true',
    sessions: process.env.OPENCLAW_SESSIONS_ENABLED === 'true',
  },
}));

handlers.set('sessions.list', async () => {
  return { sessions: openclawSessionManager.list() };
});

handlers.set('tools.catalog', async () => {
  const tools = toolRegistry.list().map(t => ({
    name: t.name,
    description: t.description,
  }));
  return { tools };
});

handlers.set('tools.invoke', async (req, ctx) => {
  const params = req.params as { name?: string; input?: any } | undefined;
  if (!params?.name) {
    throw Object.assign(new Error('Missing tool name'), { code: 'INVALID_PARAMS' });
  }

  await hookSystem.dispatch('before_tool_call', {
    toolName: params.name,
    toolInput: params.input,
    userId: ctx.userId,
  });

  const result = await toolRegistry.execute(params.name, params.input || {}, {
    userId: ctx.userId,
    chatId: '',
    runId: `ws-${Date.now()}`,
  });

  await hookSystem.dispatch('after_tool_call', {
    toolName: params.name,
    toolResult: result,
    userId: ctx.userId,
  });

  return result;
});

handlers.set('skills.list', async () => {
  return { skills: skillRegistry.list() };
});

// ── New RPC handlers (Tasks 27-32 wiring) ───────────────────────────

// memory.search — search the memory index
handlers.set('memory.search', async (req) => {
  const services = getOpenClawServices();
  if (!services?.memory) {
    throw Object.assign(new Error('Memory module not enabled'), { code: 'MODULE_DISABLED' });
  }

  const params = req.params as { query?: string; maxResults?: number; minScore?: number } | undefined;
  if (!params?.query) {
    throw Object.assign(new Error('Missing query parameter'), { code: 'INVALID_PARAMS' });
  }

  const results = await services.memory.search(params.query, {
    maxResults: params.maxResults,
    minScore: params.minScore,
  });

  return { results, count: results.length };
});

// memory.index — index documents into the memory store
handlers.set('memory.index', async (req) => {
  const services = getOpenClawServices();
  if (!services?.memory) {
    throw Object.assign(new Error('Memory module not enabled'), { code: 'MODULE_DISABLED' });
  }

  const params = req.params as { documents?: Array<{ path: string; content: string }> } | undefined;
  if (!params?.documents || !Array.isArray(params.documents)) {
    throw Object.assign(new Error('Missing documents array'), { code: 'INVALID_PARAMS' });
  }

  await services.memory.index(params.documents);
  const status = services.memory.status();
  return { indexed: params.documents.length, status };
});

// skills.list (enhanced) — list skills with frontmatter metadata
handlers.set('skills.list_enhanced', async () => {
  const { loadAndRegisterWorkspaceSkills } = await import('../skills/orchestratorBridge');
  const workspaceSkills = await loadAndRegisterWorkspaceSkills();

  const bundledSkills = skillRegistry.list().map(s => ({
    id: s.id,
    name: s.name,
    description: s.description,
    tools: s.tools,
    source: 'bundled' as const,
    eligible: true,
  }));

  // Merge: workspace skills override bundled by id
  const merged = new Map<string, any>();
  for (const s of bundledSkills) merged.set(s.id, s);
  for (const s of workspaceSkills) merged.set(s.id, {
    id: s.id,
    name: s.name,
    description: s.description,
    tools: s.tools,
    source: s.source,
    eligible: s.eligible,
    frontmatter: s.frontmatter,
    filePath: s.filePath,
  });

  return { skills: Array.from(merged.values()) };
});

// agents.list — list agent entries
handlers.set('agents.list', async () => {
  const services = getOpenClawServices();
  if (!services) {
    return { agents: [] };
  }
  return {
    agents: services.agents.map(a => ({
      id: a.id,
      name: a.name,
      default: a.default,
      skills: a.skills,
    })),
  };
});

// agents.resolve — resolve full agent config
handlers.set('agents.resolve', async (req) => {
  const params = req.params as { agentId?: string } | undefined;
  if (!params?.agentId) {
    throw Object.assign(new Error('Missing agentId parameter'), { code: 'INVALID_PARAMS' });
  }

  const { resolveAgentConfig } = await import('../routing/agentScope');
  const services = getOpenClawServices();
  if (!services) {
    throw Object.assign(new Error('OpenClaw services not initialized'), { code: 'NOT_INITIALIZED' });
  }

  const resolved = resolveAgentConfig(params.agentId, services.agents);
  if (!resolved) {
    throw Object.assign(new Error(`Agent '${params.agentId}' not found`), { code: 'NOT_FOUND' });
  }

  return { agent: resolved };
});

// sessions.list (enhanced) — list persisted sessions for an agent
handlers.set('sessions.list_agent', async (req) => {
  const services = getOpenClawServices();
  if (!services?.sessions) {
    throw Object.assign(new Error('Sessions module not enabled'), { code: 'MODULE_DISABLED' });
  }

  const params = req.params as { agentId?: string } | undefined;
  if (!params?.agentId) {
    throw Object.assign(new Error('Missing agentId parameter'), { code: 'INVALID_PARAMS' });
  }

  const sessions = await services.sessions.listForAgent(params.agentId);
  return {
    sessions: sessions.map(s => ({
      key: s.key,
      agentId: s.agentId,
      userId: s.userId,
      createdAt: s.createdAt,
      lastActiveAt: s.lastActiveAt,
      modelOverride: s.modelOverride,
    })),
  };
});

// models.list — list model catalog
handlers.set('models.list', async (req) => {
  const { listModels } = await import('../modelFallback/catalog');
  const params = req.params as { provider?: string; capability?: string } | undefined;
  const models = listModels({
    provider: params?.provider,
    capability: params?.capability,
  });
  return { models };
});

// models.resolve — resolve a model alias to a concrete model reference
handlers.set('models.resolve', async (req) => {
  const params = req.params as { input?: string } | undefined;
  if (!params?.input) {
    throw Object.assign(new Error('Missing input parameter'), { code: 'INVALID_PARAMS' });
  }

  const { normalizeModelRef } = await import('../modelFallback/selection');
  const { getModelInfo } = await import('../modelFallback/catalog');

  const ref = normalizeModelRef(params.input);
  const info = getModelInfo(ref.model);

  return { ref, info };
});

export function registerRpcHandler(method: string, handler: RpcHandler): void {
  handlers.set(method, handler);
}

export async function handleRpc(
  req: WsRequest,
  ctx: { userId: string },
): Promise<any> {
  const handler = handlers.get(req.method);
  if (!handler) {
    return createErrorResponse(req.id, 'METHOD_NOT_FOUND', `Unknown method: ${req.method}`);
  }

  try {
    const result = await handler(req, ctx);
    return createResponse(req.id, result);
  } catch (err: any) {
    if (err.code === 'INVALID_PARAMS') {
      return createErrorResponse(req.id, 'INVALID_PARAMS', err.message);
    }
    if (err.code === 'MODULE_DISABLED') {
      return createErrorResponse(req.id, 'MODULE_DISABLED', err.message);
    }
    if (err.code === 'NOT_FOUND') {
      return createErrorResponse(req.id, 'NOT_FOUND', err.message);
    }
    if (err.code === 'NOT_INITIALIZED') {
      return createErrorResponse(req.id, 'NOT_INITIALIZED', err.message);
    }
    return createErrorResponse(req.id, 'INTERNAL_ERROR', err.message || 'Internal error');
  }
}
