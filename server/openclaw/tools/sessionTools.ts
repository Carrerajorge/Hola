import { z } from 'zod';
import type { ToolContext, ToolDefinition, ToolResult } from '../../agent/toolRegistry';
import { Logger } from '../../lib/logger';
import { openclawEventBus } from '../events';
import { openclawSubagentService } from '../agents/subagentService';

/**
 * OpenClaw Session Management Tools
 *
 * Adapted from upstream openclaw sessions-*.ts tools.
 * Provides agents with session lifecycle management:
 *   - List active sessions
 *   - Spawn isolated sub-sessions
 *   - Send messages between sessions
 *   - Get session history and status
 */

// ── In-Memory Session Store ──────────────────────────────────────────────

export interface AgentSession {
  key: string;
  userId: string;
  agentId?: string;
  createdAt: string;
  lastActiveAt: string;
  messageCount: number;
  status: 'active' | 'idle' | 'archived';
  metadata?: Record<string, unknown>;
  history: Array<{ role: 'user' | 'assistant' | 'system'; content: string; timestamp: string }>;
}

const sessions = new Map<string, AgentSession>();
let sessionCounter = 0;

function generateSessionKey(): string {
  return `session_${Date.now()}_${++sessionCounter}`;
}

function ok(output: unknown): ToolResult {
  return { success: true, output };
}

function fail(code: string, message: string, retryable = false): ToolResult {
  return { success: false, output: null, error: { code, message, retryable } };
}

// ── Session CRUD ─────────────────────────────────────────────────────────

export function getSession(key: string): AgentSession | undefined {
  return sessions.get(key);
}

export function createSession(userId: string, opts?: {
  agentId?: string;
  metadata?: Record<string, unknown>;
}): AgentSession {
  const session: AgentSession = {
    key: generateSessionKey(),
    userId,
    agentId: opts?.agentId,
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    messageCount: 0,
    status: 'active',
    metadata: opts?.metadata,
    history: [],
  };
  sessions.set(session.key, session);
  return session;
}

export function listSessions(userId: string, opts?: {
  status?: 'active' | 'idle' | 'archived';
  limit?: number;
}): AgentSession[] {
  let result = [...sessions.values()].filter(s => s.userId === userId);
  if (opts?.status) {
    result = result.filter(s => s.status === opts.status);
  }
  result.sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime());
  return result.slice(0, opts?.limit || 50);
}

export function addMessageToSession(
  key: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
): boolean {
  const session = sessions.get(key);
  if (!session) return false;

  session.history.push({ role, content, timestamp: new Date().toISOString() });
  session.messageCount++;
  session.lastActiveAt = new Date().toISOString();
  session.status = 'active';

  // Cap history at 200 messages
  if (session.history.length > 200) {
    session.history = session.history.slice(-200);
  }

  return true;
}

// ── Tool Definitions ─────────────────────────────────────────────────────

export function createSessionListTool(): ToolDefinition {
  return {
    name: 'openclaw_sessions_list',
    description: 'List active agent sessions for the current user.',
    inputSchema: z.object({
      status: z.enum(['active', 'idle', 'archived']).optional(),
      limit: z.number().int().min(1).max(100).optional().default(20),
    }),
    execute: async (input: any, context: ToolContext): Promise<ToolResult> => {
      const result = listSessions(context.userId, {
        status: input.status,
        limit: input.limit,
      });
      return ok(
        result.map(s => ({
          key: s.key,
          agentId: s.agentId,
          status: s.status,
          messageCount: s.messageCount,
          lastActiveAt: s.lastActiveAt,
          createdAt: s.createdAt,
        })),
      );
    },
  };
}

export function createSessionSpawnTool(): ToolDefinition {
  return {
    name: 'openclaw_sessions_spawn',
    description:
      'Spawn a new isolated agent session. The new session gets its own conversation ' +
      'context and can run independently. Optionally start it with an initial message.',
    inputSchema: z.object({
      agentId: z.string().optional().describe('Agent ID to use for the session'),
      initialMessage: z.string().optional().describe('Optional first message to send'),
      objective: z.string().optional().describe('High-level objective for the session'),
      metadata: z.record(z.unknown()).optional(),
    }),
    capabilities: ['long_running'],
    execute: async (input: any, context: ToolContext): Promise<ToolResult> => {
      const session = createSession(context.userId, {
        agentId: input.agentId,
        metadata: input.metadata,
      });

      Logger.info(`[OpenClaw:Session] Spawned session ${session.key} for user ${context.userId}`);

      // If there's an initial message, add it and optionally spawn a subagent
      if (input.initialMessage) {
        addMessageToSession(session.key, 'user', input.initialMessage);

        if (input.objective) {
          const run = openclawSubagentService.spawn({
            requesterUserId: context.userId,
            objective: input.objective || input.initialMessage,
            parentRunId: context.runId,
          });

          openclawEventBus.emit('session:spawned', {
            sessionKey: session.key,
            userId: context.userId,
            runId: run.id,
          });

          return ok({
            sessionKey: session.key,
            runId: run.id,
            status: 'running',
          });
        }
      }

      openclawEventBus.emit('session:spawned', {
        sessionKey: session.key,
        userId: context.userId,
      });

      return ok({ sessionKey: session.key, status: session.status });
    },
  };
}

export function createSessionSendTool(): ToolDefinition {
  return {
    name: 'openclaw_sessions_send',
    description: 'Send a message to an existing agent session.',
    inputSchema: z.object({
      sessionKey: z.string().min(1),
      message: z.string().min(1),
      role: z.enum(['user', 'assistant', 'system']).optional().default('user'),
    }),
    execute: async (input: any, context: ToolContext): Promise<ToolResult> => {
      const session = getSession(input.sessionKey);
      if (!session || session.userId !== context.userId) {
        return fail('NOT_FOUND', `Session not found: ${input.sessionKey}`);
      }

      const added = addMessageToSession(input.sessionKey, input.role || 'user', input.message);
      if (!added) {
        return fail('SEND_FAILED', 'Failed to add message to session');
      }

      openclawEventBus.emit('session:message', {
        sessionKey: input.sessionKey,
        role: input.role || 'user',
        content: input.message,
        userId: context.userId,
      });

      return ok({
        sessionKey: input.sessionKey,
        messageCount: session.messageCount,
        delivered: true,
      });
    },
  };
}

export function createSessionHistoryTool(): ToolDefinition {
  return {
    name: 'openclaw_sessions_history',
    description: 'Get conversation history from a session.',
    inputSchema: z.object({
      sessionKey: z.string().min(1),
      limit: z.number().int().min(1).max(100).optional().default(50),
    }),
    execute: async (input: any, context: ToolContext): Promise<ToolResult> => {
      const session = getSession(input.sessionKey);
      if (!session || session.userId !== context.userId) {
        return fail('NOT_FOUND', `Session not found: ${input.sessionKey}`);
      }

      const history = session.history.slice(-input.limit);
      return ok({
        sessionKey: input.sessionKey,
        messageCount: session.messageCount,
        messages: history,
      });
    },
  };
}

export function createSessionTools(): ToolDefinition[] {
  return [
    createSessionListTool(),
    createSessionSpawnTool(),
    createSessionSendTool(),
    createSessionHistoryTool(),
  ];
}

// ── Exports for testing ──────────────────────────────────────────────────

export function _getSessionStore(): Map<string, AgentSession> {
  return sessions;
}

export function _clearAllSessions(): void {
  sessions.clear();
  sessionCounter = 0;
}
