import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { serialize, deserialize, RPCMessage } from './protocol.js';

export class RPCServer {
    private wss: WebSocketServer;
    private clients: Set<WebSocket> = new Set();
    private requestHandlers: Map<string, (params: any) => Promise<any>> = new Map();
    private heartbeatInterval: NodeJS.Timeout;

    constructor(port: number) {
        this.wss = new WebSocketServer({ port });

        this.wss.on('connection', (ws) => {
            this.clients.add(ws);
            (ws as any).isAlive = true;

            ws.on('pong', () => {
                (ws as any).isAlive = true;
            });

            ws.on('message', async (data: Buffer) => {
                try {
                    const msg = deserialize(data);
                    await this.handleMessage(ws, msg);
                } catch (e) {
                    console.error("RPC Server Decode/Handle Error:", e);
                }
            });

            ws.on('close', () => this.clients.delete(ws));
        });

        this.heartbeatInterval = setInterval(() => {
            for (const ws of this.clients) {
                if ((ws as any).isAlive === false) {
                    console.warn(`[RPC Server] Terminating unresponsive client`);
                    this.clients.delete(ws);
                    ws.terminate();
                    continue;
                }
                (ws as any).isAlive = false;
                ws.ping();
            }
        }, 5000);

        console.log(`RPC Server listening on port ${port}`);
    }

    public registerHandler(method: string, handler: (params: any) => Promise<any>) {
        this.requestHandlers.set(method, handler);
    }

    private async handleMessage(ws: WebSocket, msg: RPCMessage) {
        if (msg.type === 'request') {
            const handler = this.requestHandlers.get(msg.method);
            const response: Omit<RPCMessage, 'signature'> = {
                id: msg.id,
                type: 'response',
                method: msg.method,
                timestamp: Date.now()
            };

            try {
                if (!handler) throw new Error(`Method ${msg.method} not found`);
                response.result = await handler(msg.params);
            } catch (err: any) {
                response.error = { code: 500, message: err.message || "Internal RPC Error" };
            }

            ws.send(serialize(response));
        }
    }

    public broadcast(method: string, params: any, channel?: 'vision' | 'control' | 'telemetry' | 'system') {
        const msg: Omit<RPCMessage, 'signature'> = {
            id: randomUUID(),
            type: 'event',
            method,
            params,
            timestamp: Date.now(),
            channel
        };
        const buffer = serialize(msg);
        for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
                if (client.bufferedAmount > 10 * 1024 * 1024) { // 10MB drop
                    console.warn(`[RPC Server] Backpressure drop for broadcast ${method}`);
                    continue;
                }
                client.send(buffer);
            }
        }
    }

    public stream(method: string, chunk: any, sequenceId?: number, channel?: 'vision' | 'control' | 'telemetry' | 'system') {
        const msg: Omit<RPCMessage, 'signature'> = {
            id: randomUUID(),
            type: 'stream',
            method,
            params: chunk,
            timestamp: Date.now(),
            channel,
            sequenceId
        };
        const buffer = serialize(msg);
        for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
                if (client.bufferedAmount > 10 * 1024 * 1024) {
                    console.warn(`[RPC Server] Backpressure drop for stream ${method} seq=${sequenceId}`);
                    continue;
                }
                client.send(buffer);
            }
        }
    }

    public stop() {
        clearInterval(this.heartbeatInterval);
        for (const ws of this.clients) {
            ws.terminate();
        }
        this.wss.close();
    }
}
