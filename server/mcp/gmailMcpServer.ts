import { Router, Request, Response } from 'express';
import { gmail_v1 } from 'googleapis';
import { z } from 'zod';
import { storage } from '../storage';
import {
  GMAIL_SCOPES,
  getGmailClient,
  gmailSearch,
  gmailFetchThread,
  gmailSend,
  gmailMarkRead,
  gmailLabels,
} from '../integrations/gmailApi';
import type { GmailOAuthToken } from '@shared/schema';
import { getUserId } from '../types/express';
import { aiLimiter } from '../middleware/rateLimiter';
import { sanitizeSearchQuery, sanitizePlainText } from '../lib/textSanitizers';
import { createLogger } from '../utils/logger';
import { sanitizeText } from '../lib/pythonToolsClient';

interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpRequest {
  jsonrpc: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface McpResponse {
  jsonrpc: string;
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

type GmailToolName = 'gmail_search' | 'gmail_fetch' | 'gmail_send' | 'gmail_mark_read' | 'gmail_labels';

const logger = createLogger("gmail-mcp");

const mcpRequestSchema = z.object({
  jsonrpc: z.literal("2.0").or(z.string().transform(() => "2.0" as const)),
  id: z.union([z.string().min(1), z.number().int(), z.null()]).optional(),
  method: z.enum(["tools/list", "tools/call"]),
  params: z.record(z.unknown()).optional(),
});

const toolCallSchema = z.object({
  tool: z.string().trim().min(1).max(48).optional(),
  name: z.string().trim().min(1).max(48).optional(),
  arguments: z.record(z.unknown()).optional().default({}),
}).strict()
  .refine((value) => Boolean(value.tool || value.name), {
    message: "tool or name is required",
  })
  .transform((value) => ({
    tool: value.tool || value.name!,
    arguments: value.arguments || {},
  }));

const gmailSearchSchema = z.object({
  query: z.string().trim().min(1).max(500),
  maxResults: z.coerce.number().int().min(1).max(100).optional(),
});

const gmailFetchSchema = z.object({
  threadId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
});

const gmailSendSchema = z.object({
  to: z.string().trim().min(1).max(500),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(30_000),
  threadId: z.string().trim().max(128).optional(),
});

const gmailMarkReadSchema = z.object({
  messageId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
});

const gmailLabelsSchema = z.object({}).strict();

const gmailToolSchemas: Record<GmailToolName, z.ZodTypeAny> = {
  gmail_search: gmailSearchSchema,
  gmail_fetch: gmailFetchSchema,
  gmail_send: gmailSendSchema,
  gmail_mark_read: gmailMarkReadSchema,
  gmail_labels: gmailLabelsSchema,
};

const EMAIL_SAFE_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sanitizeMcpText(value: string, maxLen: number): string {
  return sanitizePlainText(value, { maxLen, collapseWs: true }).slice(0, maxLen);
}

function normalizeQuery(raw: string): string {
  return sanitizeSearchQuery(raw, 500);
}

function validateEmail(raw: string): string {
  const sanitized = sanitizeMcpText(raw, 254);
  if (!EMAIL_SAFE_REGEX.test(sanitized)) {
    throw new Error(`Invalid email address`);
  }
  return sanitized;
}

function parseEmailList(raw: string): string[] {
  const addresses = raw
    .split(/[;,]/)
    .map((value) => sanitizeMcpText(value, 254))
    .map((value) => value.trim())
    .filter(Boolean);

  if (addresses.length === 0) {
    throw new Error('Recipient list is empty');
  }

  for (const address of addresses) {
    validateEmail(address);
  }

  return addresses;
}

function validateToolArgs(toolName: GmailToolName, args: Record<string, unknown>): unknown {
  return gmailToolSchemas[toolName].parse(args);
}

function extractToolErrorMessage(error: unknown, fallback: string): string {
  const rawMessage = typeof error?.message === "string" ? error.message : fallback;
  const sanitized = sanitizeText(rawMessage);
  return sanitized.length > 0 ? sanitized : sanitizeText(fallback);
}

function isToolCallInputError(message: string): boolean {
  return message.includes("tool or name is required") || message.includes("Unknown tool");
}

const MCP_TOOLS: McpTool[] = [
  {
    name: 'gmail_search',
    description: 'Search emails in Gmail inbox with a query',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail search query (e.g., "is:unread", "from:example@gmail.com")' },
        maxResults: { type: 'number', description: 'Maximum number of results (default: 20)' }
      },
      required: ['query']
    }
  },
  {
    name: 'gmail_fetch',
    description: 'Fetch a specific email thread by ID',
    inputSchema: {
      type: 'object',
      properties: {
        threadId: { type: 'string', description: 'The Gmail thread ID to fetch' }
      },
      required: ['threadId']
    }
  },
  {
    name: 'gmail_send',
    description: 'Send an email',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Email body (plain text)' },
        threadId: { type: 'string', description: 'Optional thread ID for replies' }
      },
      required: ['to', 'subject', 'body']
    }
  },
  {
    name: 'gmail_mark_read',
    description: 'Mark an email as read',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'The message ID to mark as read' }
      },
      required: ['messageId']
    }
  },
  {
    name: 'gmail_labels',
    description: 'Get all Gmail labels',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];

async function handleToolCall(
  toolName: string,
  args: Record<string, unknown>,
  gmail: gmail_v1.Gmail
): Promise<unknown> {
  if (!Object.prototype.hasOwnProperty.call(gmailToolSchemas, toolName)) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  const validatedTool = toolName as GmailToolName;
  const sanitizedArgs = validateToolArgs(validatedTool, args);

  switch (toolName) {
    case 'gmail_search': {
      const { query, maxResults } = sanitizedArgs as z.infer<typeof gmailSearchSchema>;
      const safeQuery = normalizeQuery(query);
      return gmailSearch(gmail, { query: safeQuery, maxResults });
    }

    case 'gmail_fetch': {
      const { threadId } = sanitizedArgs as z.infer<typeof gmailFetchSchema>;
      return gmailFetchThread(gmail, { threadId });
    }

    case 'gmail_send': {
      const {
        to,
        subject,
        body,
        threadId,
      } = sanitizedArgs as z.infer<typeof gmailSendSchema>;

      const safeThreadId = threadId && sanitizeMcpText(threadId, 128);
      const recipients = parseEmailList(to).join(", ");
      const safeSubject = sanitizeMcpText(subject, 200);
      const safeBody = sanitizeMcpText(body, 30_000);
      return gmailSend(gmail, { to: recipients, subject: safeSubject, body: safeBody, threadId: safeThreadId });
    }

    case 'gmail_mark_read': {
      const { messageId } = sanitizedArgs as z.infer<typeof gmailMarkReadSchema>;
      return gmailMarkRead(gmail, { messageId });
    }

    case 'gmail_labels': {
      return gmailLabels(gmail);
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

/*
  NOTE: gmailMcpServer previously inlined raw RFC822 encoding.
  That logic now lives in integrations/gmailApi.ts.
*/

// (removed duplicated legacy gmail tool implementation; see integrations/gmailApi.ts)

export function createGmailMcpRouter(): Router {
  const router = Router();

  const resolveAuthenticatedUserId = (req: Request): string | null => {
    const userId = getUserId(req);
    if (!userId) return null;
    const normalized = String(userId);
    if (normalized.startsWith("anon_")) return null;
    return normalized;
  };

  router.get('/sse', async (req: Request, res: Response) => {
    const userId = resolveAuthenticatedUserId(req);
    
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const token = await storage.getGmailOAuthToken(userId);
    if (!token) {
      res.status(403).json({ error: 'Gmail not connected' });
      return;
    }

    logger.info('MCP Gmail SSE session started', {
      userId: sanitizeText(String(userId)),
      correlationId: sanitizeText((req.headers['x-request-id'] as string) || (req.headers['x-correlation-id'] as string) || ''),
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent('capabilities', {
      tools: MCP_TOOLS.map(t => ({ name: t.name, description: t.description }))
    });

    const heartbeat = setInterval(() => {
      sendEvent('heartbeat', { timestamp: Date.now() });
    }, 30000);

    req.on('close', () => {
      clearInterval(heartbeat);
    });
  });

  router.post('/tools/call', aiLimiter, async (req: Request, res: Response) => {
    const userId = resolveAuthenticatedUserId(req);

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const token = await storage.getGmailOAuthToken(userId);
    if (!token) {
      res.status(403).json({ error: 'Gmail not connected' });
      return;
    }

    try {
      const parsedBody = toolCallSchema.parse(req.body);
      const gmail = await getGmailClient(token);
      const result = await handleToolCall(parsedBody.tool, parsedBody.arguments || {}, gmail);

      logger.info('MCP Gmail tool call', {
        userId: sanitizeText(String(userId)),
        tool: parsedBody.tool,
      });
      res.json({ success: true, result });
    } catch (error: any) {
      const message = extractToolErrorMessage(error, "Tool call failed");
      const isInputError = isToolCallInputError(message);
      const status = isInputError ? 400 : 500;
      const responseError = status >= 500 ? "Tool call failed" : message;

      if (status >= 500) {
        logger.error('[MCP Gmail] Tool call error', {
          userId: sanitizeText(String(userId)),
          error: message,
        });
      } else {
        logger.warn('[MCP Gmail] Tool call validation error', {
          userId: sanitizeText(String(userId)),
          error: message,
        });
      }

      res.status(status).json({ error: responseError });
    }
  });

  router.get('/tools', aiLimiter, (req: Request, res: Response) => {
    const userId = resolveAuthenticatedUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    res.json({ tools: MCP_TOOLS });
  });

  router.post('/jsonrpc', aiLimiter, async (req: Request, res: Response) => {
    const userId = resolveAuthenticatedUserId(req);
    const parsed = mcpRequestSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Invalid JSON-RPC request" },
      });
      return;
    }

    const request = parsed.data as McpRequest;
    
    const response: McpResponse = {
      jsonrpc: '2.0',
      id: request.id ?? null,
    };

    try {
      if (!userId) {
        throw new Error("Unauthorized");
      }

      const token = await storage.getGmailOAuthToken(userId);
      if (!token) {
        throw new Error("Gmail not connected");
      }

      switch (request.method) {
        case 'tools/list':
          response.result = { tools: MCP_TOOLS };
          break;

        case 'tools/call': {
          const params = toolCallSchema.parse(request.params || {});
          const gmail = await getGmailClient(token);
          response.result = await handleToolCall(params.tool, params.arguments || {}, gmail);
          break;
        }

        default:
          throw new Error(`Unknown method: ${request.method}`);
      }
    } catch (error: any) {
      const rawMessage = extractToolErrorMessage(error, "Internal error");
      const isToolInputError =
        isToolCallInputError(rawMessage) ||
        rawMessage === "Invalid params" ||
        rawMessage.includes("Invalid input") ||
        rawMessage.includes("tool");
      const isUnknownMethod = rawMessage.startsWith("Unknown method:");
      const isAuthError = rawMessage === "Unauthorized" || rawMessage === "Gmail not connected";
      const isInternalError = !isToolInputError && !isUnknownMethod && !isAuthError;

      const message = isInternalError ? "Internal error" : rawMessage;

      if (isToolInputError) {
        response.error = { code: -32602, message };
      } else if (isUnknownMethod) {
        response.error = { code: -32601, message };
      } else if (isAuthError) {
        response.error = { code: -32000, message };
      } else {
        response.error = { code: -32603, message };
      }

      logger.error('[MCP Gmail] JSON-RPC error', {
        userId: sanitizeText(String(userId ?? "")),
        method: request.method,
        error: rawMessage,
      });
    }

    res.json(response);
  });

  return router;
}

export const GMAIL_SCOPES_EXPORT = GMAIL_SCOPES;
