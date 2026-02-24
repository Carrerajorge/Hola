import type { WsRequest } from '../types';
import { createResponse, createErrorResponse } from './protocol';
import { openclawSessionManager } from './sessionManager';
import { toolRegistry } from '../../agent/toolRegistry';
import { hookSystem } from '../plugins/hookSystem';
import { skillRegistry } from '../skills/skillRegistry';

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
    return createErrorResponse(req.id, 'INTERNAL_ERROR', err.message || 'Internal error');
  }
}
