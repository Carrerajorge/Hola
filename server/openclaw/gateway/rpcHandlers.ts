import type { WsRequest } from '../types';
import { createResponse, createErrorResponse } from './protocol';
import { openclawSessionManager } from './sessionManager';
import { toolRegistry } from '../../agent/toolRegistry';
import { hookSystem } from '../plugins/hookSystem';
import { skillRegistry } from '../skills/skillRegistry';
import { openclawSubagentService } from '../agents/subagentService';
import { getStatePersistence } from '../persistence/statePersistence';
import { activeStreamCount } from '../streaming/adapter';
import { getOpenClawConfig } from '../config';
import { addClientSubscription, removeClientSubscription, getClientByUserId } from './wsServer';
import { getStreamingProgress } from '../../lib/streamingSeq';

type RpcHandler = (req: WsRequest, ctx: { userId: string }) => Promise<any>;

const handlers = new Map<string, RpcHandler>();

// ── Health & System ───────────────────────────────────────────────────────

handlers.set('health', async () => {
  const config = getOpenClawConfig();
  return {
    status: 'ok',
    uptime: process.uptime(),
    timestamp: Date.now(),
    modules: {
      gateway: config.gateway.enabled,
      tools: config.tools.enabled,
      plugins: config.plugins.enabled,
      skills: config.skills.enabled,
      streaming: config.streaming.enabled,
      sandbox: config.sandbox.enabled,
      advancedMemory: config.advancedMemory.enabled,
      media: config.media.enabled,
      mediaUnderstanding: config.mediaUnderstanding.enabled,
      authProfiles: config.authProfiles.enabled,
    },
    activeStreams: activeStreamCount(),
    registeredTools: toolRegistry.list().length,
    registeredSkills: skillRegistry.list().length,
  };
});

handlers.set('sessions.list', async () => {
  return { sessions: openclawSessionManager.list() };
});

// ── Tools ─────────────────────────────────────────────────────────────────

handlers.set('tools.catalog', async () => {
  const tools = toolRegistry.list().map(t => ({
    name: t.name,
    description: t.description,
  }));
  return { tools, count: tools.length };
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

// ── Skills ────────────────────────────────────────────────────────────────

handlers.set('skills.list', async () => {
  const skills = skillRegistry.list().map(skill => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    tools: skill.tools || [],
    source: skill.source || 'builtin',
    filePath: skill.filePath,
    updatedAt: skill.updatedAt,
  }));
  return { skills, count: skills.length };
});

handlers.set('skills.reload', async () => {
  const { initSkills } = await import('../skills/skillLoader');
  const config = getOpenClawConfig();
  await initSkills(config);
  return {
    reloaded: true,
    count: skillRegistry.list().length,
  };
});

handlers.set('skills.prompt', async (req) => {
  const params = req.params as { skillIds?: string[] } | undefined;
  const resolved = skillRegistry.resolve(params?.skillIds);
  return {
    prompt: resolved.prompt,
    tools: resolved.tools,
    skills: resolved.skills.map(skill => ({
      id: skill.id,
      name: skill.name,
      source: skill.source || 'builtin',
    })),
  };
});

handlers.set('skills.resolve', async (req) => {
  const params = req.params as { skillIds?: string[] } | undefined;
  const selectedIds = Array.isArray(params?.skillIds)
    ? params?.skillIds.map(id => String(id).trim()).filter(Boolean)
    : undefined;
  const resolved = skillRegistry.resolve(selectedIds);
  return {
    prompt: resolved.prompt,
    tools: resolved.tools,
    count: resolved.skills.length,
    skills: resolved.skills.map(skill => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      tools: skill.tools || [],
      source: skill.source || 'builtin',
      filePath: skill.filePath,
    })),
  };
});

// ── Subagents ─────────────────────────────────────────────────────────────

handlers.set('subagents.spawn', async (req, ctx) => {
  const params = req.params as {
    objective?: string;
    planHint?: string[];
    parentRunId?: string;
  } | undefined;

  const objective = params?.objective?.trim();
  if (!objective) {
    throw Object.assign(new Error('Missing subagent objective'), { code: 'INVALID_PARAMS' });
  }

  const run = openclawSubagentService.spawn({
    requesterUserId: ctx.userId,
    objective,
    planHint: Array.isArray(params?.planHint)
      ? params?.planHint.map(step => String(step).trim()).filter(Boolean)
      : [],
    parentRunId: params?.parentRunId,
  });

  return run;
});

handlers.set('subagents.list', async (req, ctx) => {
  const params = req.params as { parentRunId?: string; status?: any; limit?: number } | undefined;
  const runs = openclawSubagentService.list({
    requesterUserId: ctx.userId,
    parentRunId: params?.parentRunId,
    status: params?.status,
    limit: params?.limit,
  });
  return { runs, count: runs.length };
});

handlers.set('subagents.get', async (req, ctx) => {
  const params = req.params as { runId?: string } | undefined;
  if (!params?.runId) {
    throw Object.assign(new Error('Missing runId'), { code: 'INVALID_PARAMS' });
  }
  const run = openclawSubagentService.get(params.runId);
  if (!run || run.requesterUserId !== ctx.userId) {
    throw Object.assign(new Error('Subagent run not found'), { code: 'NOT_FOUND' });
  }
  return run;
});

handlers.set('subagents.cancel', async (req, ctx) => {
  const params = req.params as { runId?: string } | undefined;
  if (!params?.runId) {
    throw Object.assign(new Error('Missing runId'), { code: 'INVALID_PARAMS' });
  }
  const run = openclawSubagentService.get(params.runId);
  if (!run || run.requesterUserId !== ctx.userId) {
    throw Object.assign(new Error('Subagent run not found'), { code: 'NOT_FOUND' });
  }
  const cancelled = openclawSubagentService.cancel(params.runId);
  return { runId: params.runId, cancelled };
});

// ── Stream Subscription & Resume ──────────────────────────────────────────

handlers.set('stream.subscribe', async (req, ctx) => {
  const params = req.params as { runId?: string } | undefined;
  if (!params?.runId) {
    throw Object.assign(new Error('Missing runId'), { code: 'INVALID_PARAMS' });
  }
  const ws = getClientByUserId(ctx.userId);
  if (!ws) {
    throw Object.assign(new Error('WebSocket client not found'), { code: 'NOT_FOUND' });
  }
  const added = addClientSubscription(ws, params.runId);
  return { subscribed: added, runId: params.runId };
});

handlers.set('stream.unsubscribe', async (req, ctx) => {
  const params = req.params as { runId?: string } | undefined;
  if (!params?.runId) {
    throw Object.assign(new Error('Missing runId'), { code: 'INVALID_PARAMS' });
  }
  const ws = getClientByUserId(ctx.userId);
  if (!ws) {
    throw Object.assign(new Error('WebSocket client not found'), { code: 'NOT_FOUND' });
  }
  const removed = removeClientSubscription(ws, params.runId);
  return { unsubscribed: removed, runId: params.runId };
});

handlers.set('stream.resume', async (req) => {
  const params = req.params as { runId?: string } | undefined;
  if (!params?.runId) {
    throw Object.assign(new Error('Missing runId'), { code: 'INVALID_PARAMS' });
  }
  const progress = await getStreamingProgress(params.runId);
  if (!progress) {
    return { found: false, runId: params.runId };
  }
  return {
    found: true,
    runId: params.runId,
    lastSeq: progress.lastSeq,
    content: progress.content,
    status: progress.status,
    updatedAt: progress.updatedAt,
  };
});

// ── Subagent Shared Context ───────────────────────────────────────────────

handlers.set('subagents.context.set', async (req, ctx) => {
  const params = req.params as { runId?: string; key?: string; value?: unknown } | undefined;
  if (!params?.runId || !params?.key) {
    throw Object.assign(new Error('Missing runId or key'), { code: 'INVALID_PARAMS' });
  }
  openclawSubagentService.setSharedValue(params.runId, params.key, params.value);
  return { set: true, runId: params.runId, key: params.key };
});

handlers.set('subagents.context.get', async (req, ctx) => {
  const params = req.params as { runId?: string; key?: string } | undefined;
  if (!params?.runId) {
    throw Object.assign(new Error('Missing runId'), { code: 'INVALID_PARAMS' });
  }
  if (params.key) {
    const value = openclawSubagentService.getSharedValue(params.runId, params.key);
    return { runId: params.runId, key: params.key, value };
  }
  const entries = openclawSubagentService.getSharedEntries(params.runId);
  return { runId: params.runId, entries };
});

handlers.set('subagents.await', async (req, ctx) => {
  const params = req.params as { parentRunId?: string; timeoutMs?: number } | undefined;
  if (!params?.parentRunId) {
    throw Object.assign(new Error('Missing parentRunId'), { code: 'INVALID_PARAMS' });
  }
  const result = await openclawSubagentService.awaitChildren(params.parentRunId, {
    timeoutMs: params.timeoutMs,
  });
  return result;
});

// ── RAG ───────────────────────────────────────────────────────────────────

handlers.set('rag.search', async (req, ctx) => {
  const params = req.params as {
    query?: string;
    limit?: number;
    chatId?: string;
    minScore?: number;
  } | undefined;

  const query = params?.query?.trim();
  if (!query) {
    throw Object.assign(new Error('Missing query'), { code: 'INVALID_PARAMS' });
  }

  const { RAGService } = await import('../../services/ragService');
  const ragService = new RAGService();
  const results = await ragService.search(ctx.userId, query, {
    limit: params?.limit,
    chatId: params?.chatId,
    minScore: params?.minScore,
  });
  return { results };
});

handlers.set('rag.context', async (req, ctx) => {
  const params = req.params as { message?: string; currentChatId?: string } | undefined;
  const message = params?.message?.trim();
  if (!message) {
    throw Object.assign(new Error('Missing message'), { code: 'INVALID_PARAMS' });
  }

  const { RAGService } = await import('../../services/ragService');
  const ragService = new RAGService();
  const contextBlock = await ragService.getContextForMessage(ctx.userId, message, params?.currentChatId);
  return { context: contextBlock };
});

// ── Chat (NEW) ────────────────────────────────────────────────────────────

handlers.set('chat.send', async (req, ctx) => {
  const params = req.params as {
    message?: string;
    chatId?: string;
    model?: string;
    skillIds?: string[];
  } | undefined;

  const message = params?.message?.trim();
  if (!message) {
    throw Object.assign(new Error('Missing message'), { code: 'INVALID_PARAMS' });
  }

  const chatId = params?.chatId || `ws-chat-${Date.now()}`;

  // Resolve skills if provided
  let skillPrompt = '';
  if (params?.skillIds?.length) {
    const resolved = skillRegistry.resolve(params.skillIds);
    skillPrompt = resolved.prompt;
  }

  await hookSystem.dispatch('message_received', {
    userId: ctx.userId,
    metadata: { chatId, message, model: params?.model },
  });

  // Use the LLM gateway for a simple completion
  const { llmGateway } = await import('../../lib/llmGateway');
  const messages: Array<{ role: string; content: string }> = [];

  if (skillPrompt) {
    messages.push({ role: 'system', content: skillPrompt });
  }
  messages.push({ role: 'user', content: message });

  const response = await llmGateway.chat({
    messages: messages as any,
    model: params?.model,
    userId: ctx.userId,
  });

  const assistantContent = response?.content || response?.message?.content || '';

  await hookSystem.dispatch('message_sent', {
    userId: ctx.userId,
    metadata: { chatId, response: assistantContent.slice(0, 200) },
  });

  return {
    chatId,
    message: assistantContent,
    model: params?.model || 'default',
    timestamp: Date.now(),
  };
});

handlers.set('chat.list', async (_req, ctx) => {
  try {
    const { storage } = await import('../../storage');
    const chats = await storage.getConversations(ctx.userId, 20);
    return {
      chats: chats.map((c: any) => ({
        id: c.id,
        title: c.title,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        messageCount: c.messageCount || 0,
      })),
    };
  } catch {
    return { chats: [] };
  }
});

handlers.set('chat.history', async (req, ctx) => {
  const params = req.params as { chatId?: string; limit?: number } | undefined;
  if (!params?.chatId) {
    throw Object.assign(new Error('Missing chatId'), { code: 'INVALID_PARAMS' });
  }

  try {
    const { storage } = await import('../../storage');
    const messages = await storage.getMessages(params.chatId, params.limit || 50);
    return { chatId: params.chatId, messages };
  } catch {
    return { chatId: params.chatId, messages: [] };
  }
});

// ── Orchestrator ──────────────────────────────────────────────────────────

handlers.set('orchestrator.plan', async (req) => {
  const params = req.params as { objective?: string; complexity?: number } | undefined;
  const objective = params?.objective?.trim();
  if (!objective) {
    throw Object.assign(new Error('Missing objective'), { code: 'INVALID_PARAMS' });
  }
  const complexity = Number.isFinite(Number(params?.complexity))
    ? Number(params?.complexity)
    : Math.min(10, Math.max(1, Math.ceil(objective.length / 120)));

  const { orchestrationEngine } = await import('../../services/orchestrationEngine');
  const subtasks = await orchestrationEngine.decomposeTask(objective, complexity);
  const plan = orchestrationEngine.buildExecutionPlan(subtasks);
  return { subtasks, plan };
});

handlers.set('orchestrator.run', async (req, ctx) => {
  const params = req.params as {
    objective?: string;
    subtasks?: string[];
    maxParallel?: number;
    timeoutMs?: number;
  } | undefined;

  const objective = params?.objective?.trim();
  if (!objective) {
    throw Object.assign(new Error('Missing objective'), { code: 'INVALID_PARAMS' });
  }

  // Determine subtask objectives — either from explicit list or auto-decompose
  let subtaskObjectives: string[];
  if (params?.subtasks?.length) {
    subtaskObjectives = params.subtasks.map(s => s.trim()).filter(Boolean);
  } else {
    // Auto-decompose: use the legacy engine for planning, then map to objectives
    const { orchestrationEngine } = await import('../../services/orchestrationEngine');
    const subtasks = await orchestrationEngine.decomposeTask(objective, 3);
    subtaskObjectives = subtasks.map(st => st.description);
  }

  if (subtaskObjectives.length === 0) {
    subtaskObjectives = [objective];
  }

  // Spawn a parent run to coordinate
  const parentRun = openclawSubagentService.spawn({
    requesterUserId: ctx.userId,
    objective: `Orchestrate: ${objective}`,
    planHint: subtaskObjectives,
  });

  // Spawn children in parallel under the parent
  const childRuns = subtaskObjectives.map(subObj =>
    openclawSubagentService.spawn({
      requesterUserId: ctx.userId,
      objective: subObj,
      planHint: [],
      parentRunId: parentRun.id,
    }),
  );

  // Wait for children (up to timeout)
  const timeoutMs = params?.timeoutMs || 120_000;
  const result = await openclawSubagentService.awaitChildren(parentRun.id, { timeoutMs });

  return {
    parentRunId: parentRun.id,
    subtasks: childRuns.map(r => ({
      runId: r.id,
      objective: r.objective,
      status: openclawSubagentService.get(r.id)?.status || r.status,
    })),
    result: {
      allDone: result.allDone,
      completed: result.completed.length,
      failed: result.failed.length,
      aggregatedResults: result.aggregatedResults,
      sharedContext: result.sharedContext,
    },
  };
});

// ── Agent Run (NEW) ───────────────────────────────────────────────────────

handlers.set('agent.run', async (req, ctx) => {
  const params = req.params as {
    objective?: string;
    planHint?: string[];
    maxSteps?: number;
  } | undefined;

  const objective = params?.objective?.trim();
  if (!objective) {
    throw Object.assign(new Error('Missing objective'), { code: 'INVALID_PARAMS' });
  }

  // Run as a subagent with real execution
  const run = openclawSubagentService.spawn({
    requesterUserId: ctx.userId,
    objective,
    planHint: params?.planHint || [],
  });

  return {
    runId: run.id,
    status: run.status,
    objective: run.objective,
    message: 'Agent run started. Poll subagents.get for status updates.',
  };
});

handlers.set('agent.status', async (req, ctx) => {
  const params = req.params as { runId?: string } | undefined;
  if (!params?.runId) {
    throw Object.assign(new Error('Missing runId'), { code: 'INVALID_PARAMS' });
  }

  // Check in-memory first
  const run = openclawSubagentService.get(params.runId);
  if (run && run.requesterUserId === ctx.userId) {
    return run;
  }

  // Fallback to persistence
  const persistence = getStatePersistence();
  const persisted = await persistence.getRun(params.runId);
  if (persisted && persisted.userId === ctx.userId) {
    return persisted;
  }

  throw Object.assign(new Error('Agent run not found'), { code: 'NOT_FOUND' });
});

// ── Persistence (NEW) ────────────────────────────────────────────────────

handlers.set('persistence.runs', async (req, ctx) => {
  const params = req.params as { status?: any; limit?: number } | undefined;
  const persistence = getStatePersistence();
  const runs = await persistence.listRuns({
    userId: ctx.userId,
    status: params?.status,
    limit: params?.limit || 50,
  });
  return { runs, count: runs.length };
});

handlers.set('persistence.checkpoint', async (req) => {
  const params = req.params as { runId?: string } | undefined;
  if (!params?.runId) {
    throw Object.assign(new Error('Missing runId'), { code: 'INVALID_PARAMS' });
  }
  const persistence = getStatePersistence();
  const checkpoint = await persistence.getCheckpoint(params.runId);
  if (!checkpoint) {
    throw Object.assign(new Error('Checkpoint not found'), { code: 'NOT_FOUND' });
  }
  return checkpoint;
});

// ── Commands ──────────────────────────────────────────────────────────────

handlers.set('commands.list', async () => {
  const { listCommands } = await import('../commands/registry');
  const commands = listCommands();
  return {
    commands: commands.map(c => ({
      key: c.key,
      aliases: c.textAliases,
      description: c.description,
      category: c.category,
      scope: c.scope,
      acceptsArgs: c.acceptsArgs,
    })),
    count: commands.length,
  };
});

handlers.set('commands.execute', async (req, ctx) => {
  const params = req.params as { command?: string } | undefined;
  if (!params?.command?.trim()) {
    throw Object.assign(new Error('Missing command'), { code: 'INVALID_PARAMS' });
  }

  const { executeCommand } = await import('../commands/registry');
  const result = await executeCommand(params.command, {
    userId: ctx.userId,
  });

  if (!result) {
    throw Object.assign(new Error(`Unknown command: ${params.command}`), { code: 'NOT_FOUND' });
  }

  return result;
});

// ── Cron/Scheduling ───────────────────────────────────────────────────────

handlers.set('cron.list', async (_req, ctx) => {
  const { _getJobStore } = await import('../tools/cronTool');
  const jobs = [..._getJobStore().values()].filter(j => j.userId === ctx.userId);
  return {
    jobs: jobs.map(j => ({
      id: j.id,
      text: j.text.substring(0, 100),
      schedule: j.schedule,
      mode: j.mode,
      enabled: j.enabled,
      runCount: j.runCount,
      nextRunAt: j.nextRunAt,
    })),
    count: jobs.length,
  };
});

handlers.set('cron.add', async (req, ctx) => {
  const params = req.params as { text?: string; schedule?: string; mode?: string } | undefined;
  if (!params?.text || !params?.schedule) {
    throw Object.assign(new Error('Missing text or schedule'), { code: 'INVALID_PARAMS' });
  }

  const result = await toolRegistry.execute('openclaw_cron', {
    action: 'add',
    text: params.text,
    schedule: params.schedule,
    mode: params.mode || 'once',
  }, { userId: ctx.userId, chatId: '', runId: `rpc-${Date.now()}` });

  return result;
});

// ── Memory ────────────────────────────────────────────────────────────────

handlers.set('memory.save', async (req, ctx) => {
  const params = req.params as { key?: string; content?: string; tags?: string[] } | undefined;
  if (!params?.key || !params?.content) {
    throw Object.assign(new Error('Missing key or content'), { code: 'INVALID_PARAMS' });
  }

  const result = await toolRegistry.execute('openclaw_memory', {
    action: 'save',
    key: params.key,
    content: params.content,
    tags: params.tags,
  }, { userId: ctx.userId, chatId: '', runId: `rpc-${Date.now()}` });

  return result;
});

handlers.set('memory.get', async (req, ctx) => {
  const params = req.params as { key?: string } | undefined;
  if (!params?.key) {
    throw Object.assign(new Error('Missing key'), { code: 'INVALID_PARAMS' });
  }

  const result = await toolRegistry.execute('openclaw_memory', {
    action: 'get',
    key: params.key,
  }, { userId: ctx.userId, chatId: '', runId: `rpc-${Date.now()}` });

  return result;
});

handlers.set('memory.search', async (req, ctx) => {
  const params = req.params as { query?: string } | undefined;
  if (!params?.query) {
    throw Object.assign(new Error('Missing query'), { code: 'INVALID_PARAMS' });
  }

  const result = await toolRegistry.execute('openclaw_memory', {
    action: 'search',
    query: params.query,
  }, { userId: ctx.userId, chatId: '', runId: `rpc-${Date.now()}` });

  return result;
});

handlers.set('memory.list', async (_req, ctx) => {
  const result = await toolRegistry.execute('openclaw_memory', {
    action: 'list',
  }, { userId: ctx.userId, chatId: '', runId: `rpc-${Date.now()}` });
  return result;
});

// ── Sessions (Agent) ──────────────────────────────────────────────────────

handlers.set('agent.sessions.list', async (_req, ctx) => {
  const { listSessions } = await import('../tools/sessionTools');
  const sessions = listSessions(ctx.userId);
  return {
    sessions: sessions.map(s => ({
      key: s.key,
      agentId: s.agentId,
      status: s.status,
      messageCount: s.messageCount,
      lastActiveAt: s.lastActiveAt,
    })),
    count: sessions.length,
  };
});

handlers.set('agent.sessions.spawn', async (req, ctx) => {
  const params = req.params as { agentId?: string; initialMessage?: string; objective?: string } | undefined;

  const result = await toolRegistry.execute('openclaw_sessions_spawn', {
    agentId: params?.agentId,
    initialMessage: params?.initialMessage,
    objective: params?.objective,
  }, { userId: ctx.userId, chatId: '', runId: `rpc-${Date.now()}` });

  return result;
});

handlers.set('agent.sessions.send', async (req, ctx) => {
  const params = req.params as { sessionKey?: string; message?: string } | undefined;
  if (!params?.sessionKey || !params?.message) {
    throw Object.assign(new Error('Missing sessionKey or message'), { code: 'INVALID_PARAMS' });
  }

  const result = await toolRegistry.execute('openclaw_sessions_send', {
    sessionKey: params.sessionKey,
    message: params.message,
  }, { userId: ctx.userId, chatId: '', runId: `rpc-${Date.now()}` });

  return result;
});

// ── Tool Profiles ─────────────────────────────────────────────────────────

handlers.set('tools.profiles', async () => {
  const { getToolCatalog, listSections } = await import('../tools/toolProfiles');
  return {
    catalog: getToolCatalog(),
    sections: listSections(),
  };
});

handlers.set('tools.profile', async (req) => {
  const params = req.params as { profile?: string } | undefined;
  if (!params?.profile) {
    throw Object.assign(new Error('Missing profile'), { code: 'INVALID_PARAMS' });
  }
  const { getToolIdsByProfile } = await import('../tools/toolProfiles');
  const ids = getToolIdsByProfile(params.profile as any);
  return { profile: params.profile, toolIds: ids, count: ids.length };
});

handlers.set('tools.resolve', async (req) => {
  const params = req.params as { profile?: string; allow?: string[]; deny?: string[] } | undefined;
  if (!params?.profile) {
    throw Object.assign(new Error('Missing profile'), { code: 'INVALID_PARAMS' });
  }
  const { resolveToolPolicy } = await import('../tools/toolProfiles');
  const ids = resolveToolPolicy({
    profile: params.profile as any,
    allow: params.allow,
    deny: params.deny,
  });
  return { profile: params.profile, resolvedToolIds: ids, count: ids.length };
});

// ── Message Routing ───────────────────────────────────────────────────────

handlers.set('message.route', async (req, ctx) => {
  const params = req.params as {
    channel?: string;
    target?: string;
    content?: string;
    metadata?: Record<string, unknown>;
  } | undefined;

  if (!params?.channel || !params?.target || !params?.content) {
    throw Object.assign(new Error('Missing channel, target, or content'), { code: 'INVALID_PARAMS' });
  }

  const result = await toolRegistry.execute('openclaw_message_route', {
    channel: params.channel,
    target: params.target,
    content: params.content,
    metadata: params.metadata,
  }, { userId: ctx.userId, chatId: '', runId: `rpc-${Date.now()}` });

  return result;
});

// ── Sandbox ───────────────────────────────────────────────────────────────

handlers.set('sandbox.config', async () => {
  const { getSandboxConfig } = await import('../sandbox/index');
  const cfg = getSandboxConfig();
  if (!cfg) {
    return { enabled: false };
  }
  return {
    enabled: cfg.enabled,
    networkMode: cfg.docker.networkMode,
    readonlyRootfs: cfg.docker.readonlyRootfs,
    blockApiKeyLeak: cfg.blockApiKeyLeak,
    capDrop: cfg.docker.capDrop,
    securityOpt: cfg.docker.securityOpt,
  };
});

handlers.set('sandbox.validate', async (req) => {
  const { getSandboxConfig, validateSandboxSecurity, validateBindMounts } = await import('../sandbox/index');
  const cfg = getSandboxConfig();
  if (!cfg) {
    return { enabled: false, report: null };
  }

  // If caller provides bind mounts to check, validate those too
  const binds: string[] = req.params?.binds ?? [];
  const bindIssues = binds.length > 0 ? validateBindMounts(binds) : [];
  const report = validateSandboxSecurity(cfg);

  return {
    enabled: true,
    report: {
      ...report,
      issues: [...report.issues, ...bindIssues],
      passed: report.passed && bindIssues.every(i => i.severity !== 'error'),
    },
  };
});

// ── Advanced Memory ───────────────────────────────────────────────────────

handlers.set('memory.search.advanced', async (req) => {
  const { getAdvancedMemoryService } = await import('../memory/index');
  const service = getAdvancedMemoryService();
  if (!service) return { error: 'Advanced memory module is not enabled' };

  const p = req.params ?? {};
  if (!p.query) throw Object.assign(new Error('query is required'), { code: 'INVALID_PARAMS' });

  return service.search(p.query, {
    maxResults: p.maxResults,
    minScore: p.minScore,
    sources: p.sources,
    vectorWeight: p.vectorWeight,
    textWeight: p.textWeight,
    enableMMR: p.enableMMR,
    enableTemporalDecay: p.enableTemporalDecay,
  });
});

handlers.set('memory.index', async (req) => {
  const { getAdvancedMemoryService } = await import('../memory/index');
  const service = getAdvancedMemoryService();
  if (!service) return { error: 'Advanced memory module is not enabled' };

  const p = req.params ?? {};
  if (!p.filePath || !p.content || !p.source) {
    throw Object.assign(new Error('filePath, content, and source are required'), { code: 'INVALID_PARAMS' });
  }

  return service.indexDocument({ filePath: p.filePath, content: p.content, source: p.source });
});

handlers.set('memory.stats', async () => {
  const { getAdvancedMemoryService } = await import('../memory/index');
  const service = getAdvancedMemoryService();
  if (!service) return { error: 'Advanced memory module is not enabled' };
  return service.getStats();
});

handlers.set('memory.delete.source', async (req) => {
  const { getAdvancedMemoryService } = await import('../memory/index');
  const service = getAdvancedMemoryService();
  if (!service) return { error: 'Advanced memory module is not enabled' };

  const p = req.params ?? {};
  if (!p.filePath || !p.source) {
    throw Object.assign(new Error('filePath and source are required'), { code: 'INVALID_PARAMS' });
  }

  const deleted = await service.deleteSource(p.filePath, p.source);
  return { deleted };
});

// ── Media ─────────────────────────────────────────────────────────────────

handlers.set('media.info', async (req) => {
  const { detectMime, getMediaKind } = await import('../media/index');
  const p = req.params ?? {};
  if (!p.filename) throw Object.assign(new Error('filename is required'), { code: 'INVALID_PARAMS' });

  const buffer = p.data ? Buffer.from(p.data, 'base64') : undefined;
  const mimeType = detectMime({ buffer, filename: p.filename, contentType: p.contentType });
  const kind = getMediaKind(mimeType);

  return { mimeType, kind, size: buffer?.length ?? 0, filename: p.filename };
});

handlers.set('media.fetch', async (req) => {
  const { fetchMedia, detectMime, getMediaKind, getMediaStore } = await import('../media/index');
  const p = req.params ?? {};
  if (!p.url) throw Object.assign(new Error('url is required'), { code: 'INVALID_PARAMS' });

  const config = getOpenClawConfig();
  const { buffer, contentType, url } = await fetchMedia(p.url, {
    maxSizeBytes: config.media.maxFileSizeMb * 1024 * 1024,
    allowPrivateIps: !config.media.ssrfBlockPrivateIps,
  });

  const mimeType = detectMime({ buffer, filename: url, contentType: contentType ?? undefined });
  const kind = getMediaKind(mimeType);
  const info = { mimeType, extension: '', kind, size: buffer.length };

  // Store if media store is available
  const store = getMediaStore();
  const storeId = store ? store.store(buffer, info) : undefined;

  return { url, mimeType, kind, size: buffer.length, storeId };
});

handlers.set('media.process', async (req) => {
  const { resizeImage, getMediaStore } = await import('../media/index');
  const p = req.params ?? {};
  if (!p.storeId && !p.data) throw Object.assign(new Error('storeId or data required'), { code: 'INVALID_PARAMS' });

  let buffer: Buffer;
  const store = getMediaStore();

  if (p.storeId && store) {
    const entry = store.get(p.storeId);
    if (!entry) throw Object.assign(new Error('Media entry not found or expired'), { code: 'NOT_FOUND' });
    buffer = entry.data;
  } else if (p.data) {
    buffer = Buffer.from(p.data, 'base64');
  } else {
    throw Object.assign(new Error('No data available'), { code: 'INVALID_PARAMS' });
  }

  const processed = await resizeImage(buffer, {
    maxWidth: p.maxWidth ?? 2048,
    maxHeight: p.maxHeight ?? 2048,
    format: p.format ?? 'jpeg',
    quality: p.quality ?? 85,
  });

  if (!processed) return { error: 'Image processing not available (sharp not installed)' };

  return {
    size: processed.length,
    originalSize: buffer.length,
    reduction: Math.round((1 - processed.length / buffer.length) * 100),
    data: processed.toString('base64'),
  };
});

// ── Media Understanding ───────────────────────────────────────────────────

handlers.set('media.describe.image', async (req) => {
  const { runCapability } = await import('../mediaUnderstanding/index');
  const p = req.params ?? {};
  if (!p.data) throw Object.assign(new Error('data (base64) is required'), { code: 'INVALID_PARAMS' });

  return runCapability({
    capability: 'describe-image',
    data: Buffer.from(p.data, 'base64'),
    mimeType: p.mimeType ?? 'image/jpeg',
    options: { prompt: p.prompt, language: p.language },
  });
});

handlers.set('media.transcribe.audio', async (req) => {
  const { runCapability } = await import('../mediaUnderstanding/index');
  const p = req.params ?? {};
  if (!p.data) throw Object.assign(new Error('data (base64) is required'), { code: 'INVALID_PARAMS' });

  return runCapability({
    capability: 'transcribe-audio',
    data: Buffer.from(p.data, 'base64'),
    mimeType: p.mimeType ?? 'audio/mpeg',
    options: { prompt: p.prompt, language: p.language },
  });
});

handlers.set('media.describe.video', async (req) => {
  const { runCapability } = await import('../mediaUnderstanding/index');
  const p = req.params ?? {};
  if (!p.data) throw Object.assign(new Error('data (base64) is required'), { code: 'INVALID_PARAMS' });

  return runCapability({
    capability: 'describe-video',
    data: Buffer.from(p.data, 'base64'),
    mimeType: p.mimeType ?? 'video/mp4',
    options: { prompt: p.prompt, language: p.language },
  });
});

handlers.set('media.providers', async () => {
  const { getProviderStatuses } = await import('../mediaUnderstanding/index');
  return { providers: await getProviderStatuses() };
});

// ── Auth Profiles ─────────────────────────────────────────────────────────

handlers.set('auth.profiles.list', async (req) => {
  const { getAuthProfileService } = await import('../authProfiles/index');
  const p = req.params ?? {};
  if (!p.provider) throw Object.assign(new Error('provider is required'), { code: 'INVALID_PARAMS' });

  const service = getAuthProfileService();
  return { profiles: await service.listProfiles(p.provider) };
});

handlers.set('auth.profiles.add', async (req) => {
  const { getAuthProfileService } = await import('../authProfiles/index');
  const p = req.params ?? {};
  if (!p.provider) throw Object.assign(new Error('provider is required'), { code: 'INVALID_PARAMS' });
  if (!p.credential) throw Object.assign(new Error('credential is required'), { code: 'INVALID_PARAMS' });

  const service = getAuthProfileService();
  const profile = await service.addProfile(p.provider, p.credential);
  return { id: profile.id, provider: profile.provider };
});

handlers.set('auth.profiles.remove', async (req) => {
  const { getAuthProfileService } = await import('../authProfiles/index');
  const p = req.params ?? {};
  if (!p.id) throw Object.assign(new Error('id is required'), { code: 'INVALID_PARAMS' });

  const service = getAuthProfileService();
  const removed = await service.removeProfile(p.id);
  return { removed };
});

handlers.set('auth.profiles.status', async () => {
  const { getAuthProfileService } = await import('../authProfiles/index');
  const service = getAuthProfileService();
  return service.getStatus();
});

handlers.set('auth.profiles.pin', async (req) => {
  const { pinProfileToSession, getSessionOverride } = await import('../authProfiles/index');
  const p = req.params ?? {};
  if (!p.sessionId) throw Object.assign(new Error('sessionId is required'), { code: 'INVALID_PARAMS' });
  if (!p.provider) throw Object.assign(new Error('provider is required'), { code: 'INVALID_PARAMS' });
  if (!p.profileId) throw Object.assign(new Error('profileId is required'), { code: 'INVALID_PARAMS' });

  const override = pinProfileToSession(p.sessionId, p.provider, p.profileId, 'user');
  return { pinned: true, expiresAt: override.expiresAt };
});

// ── Method Catalog ────────────────────────────────────────────────────────

handlers.set('methods.list', async () => {
  return {
    methods: Array.from(handlers.keys()).sort(),
    count: handlers.size,
  };
});

// ── Registration & Dispatch ──────────────────────────────────────────────

export function registerRpcHandler(method: string, handler: RpcHandler): void {
  handlers.set(method, handler);
}

export async function handleRpc(
  req: WsRequest,
  ctx: { userId: string },
): Promise<any> {
  const handler = handlers.get(req.method);
  if (!handler) {
    return createErrorResponse(req.id, 'METHOD_NOT_FOUND', `Unknown method: ${req.method}. Use methods.list to see available methods.`);
  }

  try {
    const result = await handler(req, ctx);
    return createResponse(req.id, result);
  } catch (err: any) {
    if (err.code === 'INVALID_PARAMS') {
      return createErrorResponse(req.id, 'INVALID_PARAMS', err.message);
    }
    if (err.code === 'NOT_FOUND') {
      return createErrorResponse(req.id, 'NOT_FOUND', err.message);
    }
    return createErrorResponse(req.id, 'INTERNAL_ERROR', err.message || 'Internal error');
  }
}
