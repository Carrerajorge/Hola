// AgentOS Event Stream Client - SSE/WebSocket dual-transport
import type { StreamMessage, EventKind, RunState, PlanDiff } from "../types";

export type ConnectionMode = "sse" | "websocket" | "auto";
export type ConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting" | "error";

export interface EventStreamOptions {
  baseUrl: string;
  runId: string;
  mode?: ConnectionMode;
  reconnectIntervalMs?: number;
  maxReconnectAttempts?: number;
  heartbeatTimeoutMs?: number;
  authToken?: string;
  onMessage?: (message: StreamMessage) => void;
  onStateChange?: (state: ConnectionState) => void;
  onError?: (error: Error) => void;
}

type EventHandler<T = unknown> = (payload: T, message: StreamMessage<T>) => void;

export class EventStreamClient {
  private options: Required<
    Pick<EventStreamOptions, "mode" | "reconnectIntervalMs" | "maxReconnectAttempts" | "heartbeatTimeoutMs">
  > & EventStreamOptions;

  private state: ConnectionState = "disconnected";
  private eventSource: EventSource | null = null;
  private webSocket: WebSocket | null = null;
  private handlers = new Map<EventKind | "*", Set<EventHandler>>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSequence = -1;
  private disposed = false;

  constructor(options: EventStreamOptions) {
    this.options = {
      mode: "auto",
      reconnectIntervalMs: 2000,
      maxReconnectAttempts: 15,
      heartbeatTimeoutMs: 30_000,
      ...options,
    };
  }

  async connect(): Promise<void> {
    if (this.disposed) throw new Error("Client has been disposed");
    this.setState("connecting");

    const mode = this.options.mode === "auto" ? this.detectTransport() : this.options.mode;

    if (mode === "websocket") {
      this.connectWebSocket();
    } else {
      this.connectSSE();
    }
  }

  on<T = unknown>(event: EventKind | "*", handler: EventHandler<T>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    const handlerSet = this.handlers.get(event)!;
    handlerSet.add(handler as EventHandler);
    return () => handlerSet.delete(handler as EventHandler);
  }

  off(event: EventKind | "*", handler: EventHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  send(action: string, payload: unknown): void {
    if (this.webSocket?.readyState === WebSocket.OPEN) {
      this.webSocket.send(JSON.stringify({ action, payload }));
    } else {
      throw new Error("Send is only supported over WebSocket transport");
    }
  }

  getState(): ConnectionState {
    return this.state;
  }

  getLastSequence(): number {
    return this.lastSequence;
  }

  disconnect(): void {
    this.clearTimers();
    this.eventSource?.close();
    this.eventSource = null;
    if (this.webSocket) {
      this.webSocket.onclose = null;
      this.webSocket.close(1000, "Client disconnect");
      this.webSocket = null;
    }
    this.setState("disconnected");
  }

  dispose(): void {
    this.disposed = true;
    this.disconnect();
    this.handlers.clear();
  }

  private connectSSE(): void {
    const url = new URL(`${this.options.baseUrl}/runs/${this.options.runId}/stream`);
    if (this.lastSequence >= 0) {
      url.searchParams.set("after", String(this.lastSequence));
    }

    const headers: Record<string, string> = {};
    if (this.options.authToken) {
      headers["Authorization"] = `Bearer ${this.options.authToken}`;
    }

    this.eventSource = new EventSource(url.toString());

    this.eventSource.onopen = () => {
      this.reconnectAttempts = 0;
      this.setState("connected");
      this.resetHeartbeat();
    };

    this.eventSource.onmessage = (event) => {
      this.resetHeartbeat();
      try {
        const message: StreamMessage = JSON.parse(event.data);
        this.processMessage(message);
      } catch {
        this.options.onError?.(new Error("Failed to parse SSE message"));
      }
    };

    this.eventSource.onerror = () => {
      this.eventSource?.close();
      this.eventSource = null;
      this.attemptReconnect();
    };
  }

  private connectWebSocket(): void {
    const protocol = this.options.baseUrl.startsWith("https") ? "wss" : "ws";
    const host = this.options.baseUrl.replace(/^https?:\/\//, "");
    const url = `${protocol}://${host}/runs/${this.options.runId}/ws`;

    this.webSocket = new WebSocket(url);

    this.webSocket.onopen = () => {
      this.reconnectAttempts = 0;
      this.setState("connected");
      this.resetHeartbeat();

      if (this.options.authToken) {
        this.send("auth", { token: this.options.authToken });
      }
      if (this.lastSequence >= 0) {
        this.send("replay_from", { sequence: this.lastSequence + 1 });
      }
    };

    this.webSocket.onmessage = (event) => {
      this.resetHeartbeat();
      try {
        const message: StreamMessage = JSON.parse(String(event.data));
        this.processMessage(message);
      } catch {
        this.options.onError?.(new Error("Failed to parse WebSocket message"));
      }
    };

    this.webSocket.onclose = (event) => {
      this.webSocket = null;
      if (!this.disposed && event.code !== 1000) {
        this.attemptReconnect();
      } else {
        this.setState("disconnected");
      }
    };

    this.webSocket.onerror = () => {
      this.options.onError?.(new Error("WebSocket connection error"));
    };
  }

  private processMessage(message: StreamMessage): void {
    if (message.sequence <= this.lastSequence) return;
    this.lastSequence = message.sequence;

    this.options.onMessage?.(message);

    const wildcardHandlers = this.handlers.get("*");
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        handler(message.payload, message);
      }
    }

    const eventHandlers = this.handlers.get(message.event);
    if (eventHandlers) {
      for (const handler of eventHandlers) {
        handler(message.payload, message);
      }
    }
  }

  private attemptReconnect(): void {
    if (this.disposed || this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      this.setState("error");
      this.options.onError?.(new Error("Max reconnect attempts reached"));
      return;
    }

    this.setState("reconnecting");
    this.reconnectAttempts++;

    const backoff = Math.min(
      this.options.reconnectIntervalMs * Math.pow(1.5, this.reconnectAttempts - 1),
      30_000
    );

    this.reconnectTimer = setTimeout(() => this.connect(), backoff);
  }

  private resetHeartbeat(): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = setTimeout(() => {
      this.options.onError?.(new Error("Heartbeat timeout"));
      this.disconnect();
      this.attemptReconnect();
    }, this.options.heartbeatTimeoutMs);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
  }

  private setState(state: ConnectionState): void {
    this.state = state;
    this.options.onStateChange?.(state);
  }

  private detectTransport(): "sse" | "websocket" {
    return typeof WebSocket !== "undefined" ? "websocket" : "sse";
  }
}

export function createEventStream(options: EventStreamOptions): EventStreamClient {
  return new EventStreamClient(options);
}
