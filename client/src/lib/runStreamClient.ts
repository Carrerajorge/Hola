export interface TraceEvent {
  schema_version: "v1";
  run_id: string;
  seq: number;
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  node_id: string;
  attempt_id: number;
  agent: string;
  event_type: string;
  phase?: string;
  message: string;
  status?: string;
  progress?: number;
  metrics?: {
    latency_ms?: number;
    tokens?: number;
    cost?: number;
    http_status?: number;
    bytes_in?: number;
    bytes_out?: number;
    articles_collected?: number;
    articles_verified?: number;
    articles_accepted?: number;
  };
  evidence?: {
    doi?: string;
    doi_url?: string;
    final_url?: string;
    title_similarity?: number;
    relevance_score?: number;
    fail_reason?: string;
    error_code?: string;
    stacktrace_redacted?: string;
    missing_fields?: string[];
  };
  ts: number;
}

export interface SpanNode {
  span_id: string;
  parent_span_id: string | null;
  node_id: string;
  agent: string;
  status: "pending" | "running" | "success" | "failed";
  started_at: number;
  ended_at?: number;
  latency_ms?: number;
  children: SpanNode[];
  events: TraceEvent[];
  message: string;
  phase?: string;
}

export type ConnectionMode = "connecting" | "sse_active" | "polling" | "failed";

export interface RunStreamState {
  run_id: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  phase: string;
  progress: number;
  spanTree: SpanNode[];
  events: TraceEvent[];
  metrics: {
    articles_collected: number;
    articles_verified: number;
    articles_accepted: number;
  };
  artifacts: Array<{
    id: string;
    type: string;
    name: string;
    url: string;
  }>;
  violations: Array<{
    field: string;
    reason: string;
  }>;
  lastHeartbeat: number;
  connected: boolean;
  connectionMode: ConnectionMode;
  error?: string;
}

type RunStreamListener = (state: RunStreamState) => void;

export class RunStreamClient {
  private runId: string;
  private eventSource: EventSource | null = null;
  private lastEventId: number = 0;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectDelay: number = 1000;
  private listeners: Set<RunStreamListener> = new Set();
  private spanMap: Map<string, SpanNode> = new Map();
  
  private sseOpenTimer: NodeJS.Timeout | null = null;
  private firstEventTimer: NodeJS.Timeout | null = null;
  private pollingInterval: NodeJS.Timeout | null = null;
  private sseOpened: boolean = false;
  private firstEventReceived: boolean = false;
  
  private state: RunStreamState;

  constructor(runId: string) {
    this.runId = runId;
    this.state = this.createInitialState();
    console.log(`[RunStreamClient] Created for run: ${runId}`);
  }

  private createInitialState(): RunStreamState {
    return {
      run_id: this.runId,
      status: "pending",
      phase: "idle",
      progress: 0,
      spanTree: [],
      events: [],
      metrics: {
        articles_collected: 0,
        articles_verified: 0,
        articles_accepted: 0,
      },
      artifacts: [],
      violations: [],
      lastHeartbeat: Date.now(),
      connected: false,
      connectionMode: "connecting",
    };
  }

  connect(): void {
    console.log(`[RunStreamClient] Connecting to SSE for run: ${this.runId}`);
    
    if (this.eventSource) {
      this.eventSource.close();
    }

    const url = this.lastEventId > 0
      ? `/api/runs/${this.runId}/events?from=${this.lastEventId}`
      : `/api/runs/${this.runId}/events`;

    console.log(`[RunStreamClient] SSE URL: ${url}`);
    this.eventSource = new EventSource(url);
    
    this.sseOpenTimer = setTimeout(() => {
      if (!this.sseOpened) {
        console.warn(`[RunStreamClient] SSE onopen timeout (2.5s), activating polling fallback`);
        this.activatePollingFallback();
      }
    }, 2500);
    
    this.firstEventTimer = setTimeout(() => {
      if (!this.firstEventReceived) {
        console.warn(`[RunStreamClient] No events received within 3s, activating polling fallback`);
        this.activatePollingFallback();
      }
    }, 3000);
    
    this.eventSource.onopen = () => {
      console.log(`[RunStreamClient] SSE onopen fired`);
      this.sseOpened = true;
      this.state.connected = true;
      this.state.connectionMode = "sse_active";
      this.reconnectAttempts = 0;
      if (this.sseOpenTimer) {
        clearTimeout(this.sseOpenTimer);
        this.sseOpenTimer = null;
      }
      this.emit();
    };

    this.eventSource.onerror = (e) => {
      console.error(`[RunStreamClient] SSE onerror:`, e);
      this.state.connected = false;
      this.emit();
      
      if (!this.sseOpened && !this.pollingInterval) {
        console.log(`[RunStreamClient] SSE failed before open, activating polling`);
        this.activatePollingFallback();
      } else if (this.state.connectionMode === "sse_active") {
        this.scheduleReconnect();
      }
    };

    this.eventSource.onmessage = (event) => {
      this.markFirstEventReceived();
      this.handleEvent(JSON.parse(event.data));
    };

    const eventTypes = [
      "run_started", "run_completed", "run_failed",
      "phase_started", "phase_completed", "phase_failed",
      "tool_start", "tool_progress", "tool_stdout_chunk", "tool_end", "tool_error",
      "checkpoint", "contract_violation", "heartbeat", "connected",
      "retry_scheduled", "fallback_activated",
      "source_collected", "source_verified", "source_rejected",
      "artifact_created", "progress_update",
    ];

    for (const type of eventTypes) {
      this.eventSource.addEventListener(type, (event: MessageEvent) => {
        this.markFirstEventReceived();
        try {
          const data = JSON.parse(event.data);
          console.log(`[RunStreamClient] Event received: ${type}`, data);
          this.handleEvent(data);
        } catch (e) {
          console.error("[RunStreamClient] Parse error:", e);
        }
      });
    }
  }
  
  private markFirstEventReceived(): void {
    if (!this.firstEventReceived) {
      console.log(`[RunStreamClient] First event received`);
      this.firstEventReceived = true;
      if (this.firstEventTimer) {
        clearTimeout(this.firstEventTimer);
        this.firstEventTimer = null;
      }
    }
  }
  
  private activatePollingFallback(): void {
    if (this.pollingInterval) return;
    
    console.log(`[RunStreamClient] Activating polling fallback for run: ${this.runId}`);
    
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    
    if (this.sseOpenTimer) {
      clearTimeout(this.sseOpenTimer);
      this.sseOpenTimer = null;
    }
    if (this.firstEventTimer) {
      clearTimeout(this.firstEventTimer);
      this.firstEventTimer = null;
    }
    
    this.state.connectionMode = "polling";
    this.state.connected = true;
    this.emit();
    
    this.pollStatus();
    this.pollingInterval = setInterval(() => this.pollStatus(), 500);
  }
  
  private async pollStatus(): Promise<void> {
    try {
      const response = await fetch(`/api/runs/${this.runId}/status`);
      if (response.ok) {
        const data = await response.json();
        console.log(`[RunStreamClient] Poll response:`, data);
        
        if (data.status) this.state.status = data.status;
        if (data.phase) this.state.phase = data.phase;
        if (data.progress !== undefined) this.state.progress = data.progress;
        if (data.metrics) this.updateMetrics(data.metrics);
        if (data.artifacts) this.state.artifacts = data.artifacts;
        if (data.error) this.state.error = data.error;
        
        this.state.lastHeartbeat = Date.now();
        this.emit();
        
        if (data.status === "completed" || data.status === "failed") {
          this.stopPolling();
        }
      }
    } catch (e) {
      console.error(`[RunStreamClient] Poll error:`, e);
    }
  }
  
  private stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  private handleEvent(event: TraceEvent): void {
    if (event.seq > this.lastEventId) {
      this.lastEventId = event.seq;
    }

    this.state.events.push(event);

    if (this.state.events.length > 500) {
      this.state.events = this.state.events.slice(-500);
    }

    switch (event.event_type) {
      case "heartbeat":
        this.state.lastHeartbeat = Date.now();
        break;

      case "run_started":
        this.state.status = "running";
        this.state.phase = event.phase || "planning";
        break;

      case "run_completed":
        this.state.status = "completed";
        this.state.progress = 100;
        break;

      case "run_failed":
        this.state.status = "failed";
        this.state.error = event.message;
        break;

      case "phase_started":
        this.state.phase = event.phase || this.state.phase;
        this.addSpanNode(event);
        break;

      case "phase_completed":
      case "phase_failed":
        this.completeSpanNode(event);
        break;

      case "tool_start":
        this.addSpanNode(event);
        break;

      case "tool_end":
      case "tool_error":
        this.completeSpanNode(event);
        break;

      case "progress_update":
        if (event.progress !== undefined) {
          this.state.progress = event.progress;
        }
        if (event.metrics) {
          this.updateMetrics(event.metrics);
        }
        break;

      case "checkpoint":
        if (event.metrics) {
          this.updateMetrics(event.metrics);
        }
        break;

      case "contract_violation":
        if (event.evidence?.missing_fields) {
          for (const field of event.evidence.missing_fields) {
            this.state.violations.push({
              field,
              reason: event.message,
            });
          }
        }
        break;

      case "artifact_created":
        if (event.evidence?.final_url) {
          this.state.artifacts.push({
            id: event.span_id,
            type: "xlsx",
            name: event.message.replace("Created xlsx: ", ""),
            url: event.evidence.final_url,
          });
        }
        break;

      case "source_collected":
      case "source_verified":
        if (event.metrics) {
          this.updateMetrics(event.metrics);
        }
        break;
    }

    this.emit();
  }

  private updateMetrics(metrics: TraceEvent["metrics"]): void {
    if (!metrics) return;
    
    if (metrics.articles_collected !== undefined) {
      this.state.metrics.articles_collected = metrics.articles_collected;
    }
    if (metrics.articles_verified !== undefined) {
      this.state.metrics.articles_verified = metrics.articles_verified;
    }
    if (metrics.articles_accepted !== undefined) {
      this.state.metrics.articles_accepted = metrics.articles_accepted;
    }
  }

  private addSpanNode(event: TraceEvent): void {
    const node: SpanNode = {
      span_id: event.span_id,
      parent_span_id: event.parent_span_id,
      node_id: event.node_id,
      agent: event.agent,
      status: "running",
      started_at: event.ts,
      children: [],
      events: [event],
      message: event.message,
      phase: event.phase,
    };

    this.spanMap.set(event.span_id, node);

    if (event.parent_span_id) {
      const parent = this.spanMap.get(event.parent_span_id);
      if (parent) {
        parent.children.push(node);
      }
    } else {
      this.state.spanTree.push(node);
    }
  }

  private completeSpanNode(event: TraceEvent): void {
    const node = this.spanMap.get(event.span_id);
    if (node) {
      node.status = event.status === "success" ? "success" : "failed";
      node.ended_at = event.ts;
      node.latency_ms = event.ts - node.started_at;
      node.events.push(event);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("[RunStreamClient] Max reconnect attempts reached");
      return;
    }

    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;

    setTimeout(() => {
      if (this.state.status !== "completed" && this.state.status !== "failed") {
        this.connect();
      }
    }, Math.min(delay, 30000));
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener({ ...this.state });
    }
  }

  subscribe(listener: RunStreamListener): () => void {
    this.listeners.add(listener);
    listener({ ...this.state });
    
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): RunStreamState {
    return { ...this.state };
  }

  disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.state.connected = false;
  }

  destroy(): void {
    this.disconnect();
    this.stopPolling();
    if (this.sseOpenTimer) {
      clearTimeout(this.sseOpenTimer);
      this.sseOpenTimer = null;
    }
    if (this.firstEventTimer) {
      clearTimeout(this.firstEventTimer);
      this.firstEventTimer = null;
    }
    this.listeners.clear();
    this.spanMap.clear();
  }
  
  getConnectionMode(): ConnectionMode {
    return this.state.connectionMode;
  }
}

export async function createRun(prompt: string, options?: {
  targetCount?: number;
  yearStart?: number;
  yearEnd?: number;
}): Promise<{ run_id: string; stream_url: string }> {
  const response = await fetch("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      targetCount: options?.targetCount ?? 50,
      yearStart: options?.yearStart ?? 2020,
      yearEnd: options?.yearEnd ?? 2025,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create run: ${response.statusText}`);
  }

  return response.json();
}

export function useRunStream(runId: string | null): RunStreamState | null {
  if (!runId) return null;
  
  const client = new RunStreamClient(runId);
  client.connect();
  
  return client.getState();
}
