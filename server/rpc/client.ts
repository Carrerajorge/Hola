import { WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { serialize, deserialize, RPCMessage } from './protocol.js';

export class RPCClient {
    private ws!: WebSocket;
    private pendingRequests: Map<string, { resolve: (res: any) => void, reject: (err: any) => void }> = new Map();
    private reconnectAttempts = 0;
    private readonly maxReconnectDelay = 30000;
    private messageQueue: Buffer[] = [];
    private streamHandlers: Map<string, (chunk: any) => void> = new Map();

    constructor(private url: string) {
        this.connect();
    }

    private connect() {
        if (this.ws) {
            this.ws.removeAllListeners();
        }

        this.ws = new WebSocket(this.url);

        this.ws.on('open', () => {
            console.log(`[RPC Client] Connected to ${this.url}`);
            this.reconnectAttempts = 0;
            this.flushQueue();
        });

        this.ws.on('message', (data: Buffer) => {
            try {
                const msg = deserialize(data);
                if (msg.type === 'response') {
                    const promise = this.pendingRequests.get(msg.id);
                    if (promise) {
                        msg.error ? promise.reject(new Error(msg.error.message)) : promise.resolve(msg.result);
                        this.pendingRequests.delete(msg.id);
                    }
                } else if (msg.type === 'stream') {
                    const handler = this.streamHandlers.get(msg.method);
                    if (handler) {
                        handler(msg.params);
                    }
                }
            } catch (e) {
                console.error("RPC Client Decode Error:", e);
            }
        });

        this.ws.on('close', () => {
            console.warn(`[RPC Client] Disconnected from ${this.url}. Attempting to reconnect...`);
            this.scheduleReconnect();
        });

        this.ws.on('error', (err) => {
            console.error(`[RPC Client] WebSocket Error:`, err.message);
        });
    }

    private scheduleReconnect() {
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);
        this.reconnectAttempts++;
        setTimeout(() => this.connect(), delay);
    }

    private flushQueue() {
        while (this.messageQueue.length > 0 && this.ws.readyState === WebSocket.OPEN) {
            const buffer = this.messageQueue.shift();
            if (buffer) this.ws.send(buffer);
        }
    }

    public onStream(method: string, handler: (chunk: any) => void) {
        this.streamHandlers.set(method, handler);
        return () => this.streamHandlers.delete(method);
    }

    public async request(method: string, params?: any, timeoutMs = 30000, channel?: 'vision' | 'control' | 'telemetry' | 'system'): Promise<any> {
        const id = randomUUID();
        const msg: Omit<RPCMessage, 'signature'> = {
            id,
            type: 'request',
            method,
            params,
            timestamp: Date.now(),
            channel
        };

        return new Promise((resolve, reject) => {
            const buffer = serialize(msg);

            if (this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(buffer);
            } else {
                this.messageQueue.push(buffer);
            }

            const timer = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`Timeout exceeding ${timeoutMs}ms for ${method}`));
            }, timeoutMs);

            this.pendingRequests.set(id, {
                resolve: (res) => { clearTimeout(timer); resolve(res); },
                reject: (err) => { clearTimeout(timer); reject(err); }
            });
        });
    }
}
