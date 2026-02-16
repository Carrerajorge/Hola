import { Router, Request, Response } from 'express';
import { gmail_v1 } from 'googleapis';
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
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface McpResponse {
  jsonrpc: string;
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
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
  switch (toolName) {
    case 'gmail_search': {
      const query = String(args.query || '');
      const maxResults = args.maxResults ? Number(args.maxResults) : undefined;
      return gmailSearch(gmail, { query, maxResults });
    }

    case 'gmail_fetch': {
      const threadId = String(args.threadId);
      return gmailFetchThread(gmail, { threadId });
    }

    case 'gmail_send': {
      const to = String(args.to);
      const subject = String(args.subject);
      const body = String(args.body);
      const threadId = args.threadId ? String(args.threadId) : undefined;
      return gmailSend(gmail, { to, subject, body, threadId });
    }

    case 'gmail_mark_read': {
      const messageId = String(args.messageId);
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

  router.post('/tools/call', async (req: Request, res: Response) => {
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
      const gmail = await getGmailClient(token);
      const { tool, arguments: args } = req.body;
      
      const result = await handleToolCall(tool, args || {}, gmail);
      res.json({ success: true, result });
    } catch (error: any) {
      console.error('[MCP Gmail] Tool call error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/tools', (req: Request, res: Response) => {
    const userId = resolveAuthenticatedUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    res.json({ tools: MCP_TOOLS });
  });

  router.post('/jsonrpc', async (req: Request, res: Response) => {
    const userId = resolveAuthenticatedUserId(req);
    const request = req.body as McpRequest;
    
    const response: McpResponse = {
      jsonrpc: '2.0',
      id: request.id
    };

    try {
      if (!userId) {
        throw new Error('Unauthorized');
      }

      const token = await storage.getGmailOAuthToken(userId);
      if (!token) {
        throw new Error('Gmail not connected');
      }

      switch (request.method) {
        case 'tools/list':
          response.result = { tools: MCP_TOOLS };
          break;

        case 'tools/call': {
          const gmail = await getGmailClient(token);
          const { name, arguments: args } = request.params as { name: string; arguments: Record<string, unknown> };
          response.result = await handleToolCall(name, args || {}, gmail);
          break;
        }

        default:
          throw new Error(`Unknown method: ${request.method}`);
      }
    } catch (error: any) {
      response.error = { code: -32000, message: error.message };
    }

    res.json(response);
  });

  return router;
}

export const GMAIL_SCOPES_EXPORT = GMAIL_SCOPES;
