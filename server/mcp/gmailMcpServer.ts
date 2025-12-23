import { Router, Request, Response } from 'express';
import { google, gmail_v1 } from 'googleapis';
import { storage } from '../storage';
import type { GmailOAuthToken } from '@shared/schema';

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels'
];

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

async function getGmailClient(token: GmailOAuthToken): Promise<gmail_v1.Gmail> {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    access_token: token.accessToken,
    refresh_token: token.refreshToken,
    expiry_date: token.expiresAt.getTime()
  });

  if (token.expiresAt.getTime() < Date.now() + 60000) {
    const { credentials } = await oauth2Client.refreshAccessToken();
    await storage.updateGmailOAuthToken(token.userId, {
      accessToken: credentials.access_token!,
      expiresAt: new Date(credentials.expiry_date!)
    });
    oauth2Client.setCredentials(credentials);
  }

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

function getHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  return headers?.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
}

function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): { text: string; html: string } {
  let text = '';
  let html = '';

  function traverse(part: gmail_v1.Schema$MessagePart) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      text += Buffer.from(part.body.data, 'base64').toString('utf-8');
    } else if (part.mimeType === 'text/html' && part.body?.data) {
      html += Buffer.from(part.body.data, 'base64').toString('utf-8');
    }
    if (part.parts) {
      part.parts.forEach(traverse);
    }
  }

  if (payload) traverse(payload);
  return { text, html };
}

async function handleToolCall(
  toolName: string,
  args: Record<string, unknown>,
  gmail: gmail_v1.Gmail
): Promise<unknown> {
  switch (toolName) {
    case 'gmail_search': {
      const query = String(args.query || '');
      const maxResults = Number(args.maxResults) || 20;
      
      const response = await gmail.users.messages.list({
        userId: 'me',
        maxResults,
        q: query
      });

      const emails = [];
      for (const msg of (response.data.messages || []).slice(0, maxResults)) {
        const fullMsg = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: 'metadata',
          metadataHeaders: ['From', 'To', 'Subject', 'Date']
        });

        const headers = fullMsg.data.payload?.headers;
        emails.push({
          id: msg.id,
          threadId: msg.threadId,
          subject: getHeader(headers, 'Subject') || '(No subject)',
          from: getHeader(headers, 'From'),
          to: getHeader(headers, 'To'),
          date: getHeader(headers, 'Date'),
          snippet: fullMsg.data.snippet,
          labels: fullMsg.data.labelIds
        });
      }

      return { emails, count: emails.length };
    }

    case 'gmail_fetch': {
      const threadId = String(args.threadId);
      
      const thread = await gmail.users.threads.get({
        userId: 'me',
        id: threadId,
        format: 'full'
      });

      const messages = [];
      for (const msg of thread.data.messages || []) {
        const headers = msg.payload?.headers;
        const body = extractBody(msg.payload);
        
        messages.push({
          id: msg.id,
          from: getHeader(headers, 'From'),
          to: getHeader(headers, 'To'),
          subject: getHeader(headers, 'Subject'),
          date: getHeader(headers, 'Date'),
          body: body.text || body.html.replace(/<[^>]*>/g, ' ').trim(),
          snippet: msg.snippet
        });
      }

      return { threadId, subject: messages[0]?.subject, messages };
    }

    case 'gmail_send': {
      const to = String(args.to);
      const subject = String(args.subject);
      const body = String(args.body);
      const threadId = args.threadId ? String(args.threadId) : undefined;

      const profile = await gmail.users.getProfile({ userId: 'me' });
      const from = profile.data.emailAddress;

      const email = [
        `From: ${from}`,
        `To: ${to}`,
        `Subject: ${subject}`,
        '',
        body
      ].join('\r\n');

      const encodedMessage = Buffer.from(email).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

      const result = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedMessage,
          threadId
        }
      });

      return { success: true, messageId: result.data.id };
    }

    case 'gmail_mark_read': {
      const messageId = String(args.messageId);
      
      await gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: {
          removeLabelIds: ['UNREAD']
        }
      });

      return { success: true, messageId };
    }

    case 'gmail_labels': {
      const response = await gmail.users.labels.list({ userId: 'me' });
      return { labels: response.data.labels };
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

export function createGmailMcpRouter(): Router {
  const router = Router();

  router.get('/sse', async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    
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
    res.setHeader('Access-Control-Allow-Origin', '*');

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
    const userId = (req as any).userId;
    
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
    res.json({ tools: MCP_TOOLS });
  });

  router.post('/jsonrpc', async (req: Request, res: Response) => {
    const userId = (req as any).userId;
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
