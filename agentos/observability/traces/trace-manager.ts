// Distributed tracing for agent runs
// Each run gets a trace, each step a span. Captures model calls, tool uses, decisions, with full context.

export interface Trace {
  traceId: string;
  runId: string;
  agentId: string;
  missionId: string;
  startTime: number;
  endTime?: number;
  status: "running" | "completed" | "failed" | "cancelled";
  rootSpanId: string;
  spans: Map<string, Span>;
  baggage: Record<string, string>;
}

export interface Span {
  spanId: string;
  parentSpanId?: string;
  traceId: string;
  name: string;
  kind: "internal" | "model-call" | "tool-use" | "decision" | "retrieval" | "action";
  startTime: number;
  endTime?: number;
  status: "ok" | "error" | "timeout";
  attributes: Record<string, string | number | boolean>;
  events: SpanEvent[];
  links: Array<{ traceId: string; spanId: string }>;
}

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes: Record<string, string | number | boolean>;
}

export interface TraceQuery {
  agentId?: string;
  missionId?: string;
  status?: Trace["status"];
  minDuration?: number;
  maxDuration?: number;
  since?: number;
  limit?: number;
}

export class TraceManager {
  private traces = new Map<string, Trace>();
  private activeSpans = new Map<string, Span>();
  private readonly maxTraces: number;

  constructor(options: { maxTraces?: number } = {}) {
    this.maxTraces = options.maxTraces ?? 10_000;
  }

  startTrace(runId: string, agentId: string, missionId: string, baggage?: Record<string, string>): Trace {
    const traceId = this.generateId("tr");
    const rootSpanId = this.generateId("sp");
    const now = Date.now();

    const rootSpan: Span = {
      spanId: rootSpanId,
      traceId,
      name: `run:${runId}`,
      kind: "internal",
      startTime: now,
      status: "ok",
      attributes: { agentId, missionId, runId },
      events: [],
      links: [],
    };

    const trace: Trace = {
      traceId, runId, agentId, missionId,
      startTime: now,
      status: "running",
      rootSpanId,
      spans: new Map([[rootSpanId, rootSpan]]),
      baggage: baggage ?? {},
    };

    this.traces.set(traceId, trace);
    this.activeSpans.set(rootSpanId, rootSpan);
    this.enforceRetention();
    return trace;
  }

  startSpan(traceId: string, name: string, kind: Span["kind"], parentSpanId?: string, attributes?: Record<string, string | number | boolean>): Span | null {
    const trace = this.traces.get(traceId);
    if (!trace) return null;

    const spanId = this.generateId("sp");
    const span: Span = {
      spanId,
      parentSpanId: parentSpanId ?? trace.rootSpanId,
      traceId,
      name,
      kind,
      startTime: Date.now(),
      status: "ok",
      attributes: attributes ?? {},
      events: [],
      links: [],
    };

    trace.spans.set(spanId, span);
    this.activeSpans.set(spanId, span);
    return span;
  }

  addEvent(spanId: string, name: string, attributes: Record<string, string | number | boolean> = {}): void {
    const span = this.activeSpans.get(spanId);
    if (!span) return;
    span.events.push({ name, timestamp: Date.now(), attributes });
  }

  setAttributes(spanId: string, attributes: Record<string, string | number | boolean>): void {
    const span = this.activeSpans.get(spanId);
    if (!span) return;
    Object.assign(span.attributes, attributes);
  }

  endSpan(spanId: string, status: Span["status"] = "ok"): void {
    const span = this.activeSpans.get(spanId);
    if (!span) return;
    span.endTime = Date.now();
    span.status = status;
    this.activeSpans.delete(spanId);
  }

  endTrace(traceId: string, status: Trace["status"] = "completed"): Trace | null {
    const trace = this.traces.get(traceId);
    if (!trace) return null;

    // End all remaining active spans
    for (const [spanId, span] of trace.spans) {
      if (!span.endTime) {
        span.endTime = Date.now();
        this.activeSpans.delete(spanId);
      }
    }

    trace.endTime = Date.now();
    trace.status = status;
    return trace;
  }

  /** Record a model call as a span with token and cost data */
  recordModelCall(traceId: string, parentSpanId: string, model: string, tokensIn: number, tokensOut: number, latencyMs: number, costUsd: number): Span | null {
    const span = this.startSpan(traceId, `model:${model}`, "model-call", parentSpanId, {
      "model.name": model, "model.tokens_in": tokensIn, "model.tokens_out": tokensOut,
      "model.latency_ms": latencyMs, "model.cost_usd": costUsd,
    });
    if (span) {
      span.endTime = span.startTime + latencyMs;
      this.activeSpans.delete(span.spanId);
    }
    return span;
  }

  /** Record a tool invocation as a span */
  recordToolUse(traceId: string, parentSpanId: string, toolName: string, input: string, output: string, durationMs: number, success: boolean): Span | null {
    const span = this.startSpan(traceId, `tool:${toolName}`, "tool-use", parentSpanId, {
      "tool.name": toolName,
      "tool.input_length": input.length,
      "tool.output_length": output.length,
      "tool.success": success,
    });
    if (span) {
      span.endTime = span.startTime + durationMs;
      span.status = success ? "ok" : "error";
      this.activeSpans.delete(span.spanId);
    }
    return span;
  }

  query(q: TraceQuery): Trace[] {
    let results = Array.from(this.traces.values());
    if (q.agentId) results = results.filter((t) => t.agentId === q.agentId);
    if (q.missionId) results = results.filter((t) => t.missionId === q.missionId);
    if (q.status) results = results.filter((t) => t.status === q.status);
    if (q.since) results = results.filter((t) => t.startTime >= q.since!);
    if (q.minDuration) results = results.filter((t) => t.endTime && (t.endTime - t.startTime) >= q.minDuration!);
    if (q.maxDuration) results = results.filter((t) => t.endTime && (t.endTime - t.startTime) <= q.maxDuration!);
    results.sort((a, b) => b.startTime - a.startTime);
    return results.slice(0, q.limit ?? 100);
  }

  getTrace(traceId: string): Trace | null {
    return this.traces.get(traceId) ?? null;
  }

  /** Export trace in OpenTelemetry-compatible format */
  exportOtel(traceId: string): object | null {
    const trace = this.traces.get(traceId);
    if (!trace) return null;
    return {
      resourceSpans: [{
        resource: { attributes: [{ key: "service.name", value: { stringValue: "agentos" } }, { key: "agent.id", value: { stringValue: trace.agentId } }] },
        scopeSpans: [{
          spans: Array.from(trace.spans.values()).map((s) => ({
            traceId: s.traceId, spanId: s.spanId, parentSpanId: s.parentSpanId,
            name: s.name, kind: s.kind, startTimeUnixNano: s.startTime * 1_000_000,
            endTimeUnixNano: (s.endTime ?? Date.now()) * 1_000_000,
            attributes: Object.entries(s.attributes).map(([k, v]) => ({ key: k, value: typeof v === "string" ? { stringValue: v } : typeof v === "number" ? { intValue: v } : { boolValue: v } })),
            events: s.events.map((e) => ({ name: e.name, timeUnixNano: e.timestamp * 1_000_000, attributes: Object.entries(e.attributes).map(([k, v]) => ({ key: k, value: { stringValue: String(v) } })) })),
            status: { code: s.status === "ok" ? 1 : 2 },
          })),
        }],
      }],
    };
  }

  private enforceRetention(): void {
    if (this.traces.size <= this.maxTraces) return;
    const sorted = Array.from(this.traces.entries()).sort(([, a], [, b]) => a.startTime - b.startTime);
    const toRemove = sorted.slice(0, sorted.length - this.maxTraces);
    for (const [id] of toRemove) this.traces.delete(id);
  }

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}
