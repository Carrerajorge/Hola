import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer, IncomingMessage } from 'http';
import type { OpenClawConfig } from '../config';
import { parseMessage, createEvent } from './protocol';
import { handleRpc } from './rpcHandlers';
import { Logger } from '../../lib/logger';

export interface ConnectedClient {
  ws: WebSocket;
  userId: string;
  connectedAt: number;
  subscriptions: Set<string>;
}

const clients = new Map<WebSocket, ConnectedClient>();
let tickInterval: NodeJS.Timeout | null = null;

const BACKPRESSURE_THRESHOLD = 64 * 1024; // 64 KB buffered → skip send

/** Send data only if the socket is open and not backpressured. */
function safeSend(ws: WebSocket, data: string): boolean {
  if (ws.readyState !== WebSocket.OPEN) return false;
  if (ws.bufferedAmount > BACKPRESSURE_THRESHOLD) {
    Logger.debug(`[OpenClaw:Gateway] Skipping send, backpressure (buffered: ${ws.bufferedAmount})`);
    return false;
  }
  ws.send(data);
  return true;
}

export async function initGateway(httpServer: HttpServer, config: OpenClawConfig): Promise<void> {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req: IncomingMessage, socket: any, head: Buffer) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname !== config.gateway.path) return;

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const userId = url.searchParams.get('userId') || 'anonymous';

    const client: ConnectedClient = {
      ws,
      userId,
      connectedAt: Date.now(),
      subscriptions: new Set(),
    };
    clients.set(ws, client);

    Logger.info(`[OpenClaw:Gateway] Client connected: ${userId} (total: ${clients.size})`);

    ws.send(JSON.stringify(createEvent('connected', {
      protocol: 1,
      timestamp: Date.now(),
    })));

    ws.on('message', async (raw: Buffer | string) => {
      const msg = parseMessage(raw.toString());
      if (!msg || msg.type !== 'req') return;

      const response = await handleRpc(msg, { userId: client.userId });
      safeSend(ws, JSON.stringify(response));
    });

    ws.on('close', () => {
      clients.delete(ws);
      Logger.info(`[OpenClaw:Gateway] Client disconnected: ${userId} (total: ${clients.size})`);
    });

    ws.on('error', (err: Error) => {
      Logger.error(`[OpenClaw:Gateway] WebSocket error for ${userId}: ${err.message}`);
      clients.delete(ws);
    });
  });

  tickInterval = setInterval(() => {
    const event = createEvent('tick', { seq: Date.now(), clients: clients.size });
    broadcast(JSON.stringify(event));
  }, 15_000);

  Logger.info(`[OpenClaw:Gateway] Gateway initialized on path: ${config.gateway.path}`);
}

// ── Broadcasting ────────────────────────────────────────────────────────────

export function broadcast(data: string, filter?: (client: ConnectedClient) => boolean): void {
  for (const [ws, client] of clients) {
    if (!filter || filter(client)) {
      safeSend(ws, data);
    }
  }
}

export function broadcastEvent(event: string, payload: unknown, filter?: (client: ConnectedClient) => boolean): void {
  broadcast(JSON.stringify(createEvent(event, payload)), filter);
}

/**
 * Broadcast to clients that have subscribed to a specific runId.
 * Backward-compatible: clients with no subscriptions receive everything.
 */
export function broadcastToSubscribed(
  event: string,
  payload: { runId?: string; [key: string]: unknown },
): void {
  const { runId } = payload;
  if (!runId) {
    broadcastEvent(event, payload);
    return;
  }
  broadcastEvent(event, payload, (client) => {
    // Empty subscriptions = "subscribe to everything" (backward-compatible)
    if (client.subscriptions.size === 0) return true;
    return client.subscriptions.has(runId);
  });
}

// ── Subscription Management ─────────────────────────────────────────────────

export function addClientSubscription(ws: WebSocket, runId: string): boolean {
  const client = clients.get(ws);
  if (!client) return false;
  client.subscriptions.add(runId);
  return true;
}

export function removeClientSubscription(ws: WebSocket, runId: string): boolean {
  const client = clients.get(ws);
  if (!client) return false;
  client.subscriptions.delete(runId);
  return true;
}

export function getClientByUserId(userId: string): WebSocket | undefined {
  for (const [ws, client] of clients) {
    if (client.userId === userId && ws.readyState === WebSocket.OPEN) return ws;
  }
  return undefined;
}

// ── Metrics & Lifecycle ─────────────────────────────────────────────────────

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
