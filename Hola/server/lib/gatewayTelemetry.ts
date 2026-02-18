/**
 * Gateway Telemetry - OpenTelemetry instrumentation for the LLM Gateway.
 *
 * Provides:
 * - End-to-end traces (UI -> API -> gateway -> provider)
 * - p95/p99 latency histograms
 * - Error rate counters
 * - Timeout/retry/circuit-breaker event counters
 * - First-token-time histogram
 * - Request state machine transition tracking
 */

import { Histogram, Counter, Gauge, register } from "prom-client";
import { getTracer, SPAN_ATTRIBUTES } from "./tracing";
import { SpanStatusCode, type Span } from "@opentelemetry/api";

// ===== Prometheus Metrics =====

// Latency histograms
const gatewayLatency = new Histogram({
  name: "llm_gateway_request_duration_seconds",
  help: "LLM gateway request duration in seconds",
  labelNames: ["provider", "model", "status", "from_fallback"],
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 15, 30, 60, 120, 300],
  registers: [],
});

const firstTokenLatency = new Histogram({
  name: "llm_gateway_first_token_seconds",
  help: "Time to first token in seconds",
  labelNames: ["provider", "model"],
  buckets: [0.1, 0.25, 0.5, 1, 2, 3, 5, 10, 15, 30],
  registers: [],
});

const streamDuration = new Histogram({
  name: "llm_gateway_stream_duration_seconds",
  help: "Total stream duration in seconds",
  labelNames: ["provider", "model", "status"],
  buckets: [0.5, 1, 2.5, 5, 10, 30, 60, 120, 300],
  registers: [],
});

// Counters
const requestTotal = new Counter({
  name: "llm_gateway_requests_total",
  help: "Total LLM gateway requests",
  labelNames: ["provider", "model", "status"],
  registers: [],
});

const errorTotal = new Counter({
  name: "llm_gateway_errors_total",
  help: "Total LLM gateway errors by type",
  labelNames: ["provider", "model", "error_type"],
  registers: [],
});

const retryTotal = new Counter({
  name: "llm_gateway_retries_total",
  help: "Total retry attempts",
  labelNames: ["provider", "model", "attempt"],
  registers: [],
});

const circuitBreakerEvents = new Counter({
  name: "llm_gateway_circuit_breaker_events_total",
  help: "Circuit breaker state change events",
  labelNames: ["provider", "event"],
  registers: [],
});

const bulkheadRejections = new Counter({
  name: "llm_gateway_bulkhead_rejections_total",
  help: "Requests rejected by bulkhead",
  labelNames: ["provider", "reason"],
  registers: [],
});

const fallbackTotal = new Counter({
  name: "llm_gateway_fallbacks_total",
  help: "Fallback provider invocations",
  labelNames: ["from_provider", "to_provider"],
  registers: [],
});

const validationErrors = new Counter({
  name: "llm_gateway_validation_errors_total",
  help: "Pre-flight validation errors",
  labelNames: ["error_code"],
  registers: [],
});

const timeoutTotal = new Counter({
  name: "llm_gateway_timeouts_total",
  help: "Timeout events by type",
  labelNames: ["provider", "timeout_type"],
  registers: [],
});

const stateTransitions = new Counter({
  name: "llm_gateway_state_transitions_total",
  help: "Request state machine transitions",
  labelNames: ["from_state", "to_state"],
  registers: [],
});

// Gauges
const activeRequests = new Gauge({
  name: "llm_gateway_active_requests",
  help: "Currently active requests by state",
  labelNames: ["state", "provider"],
  registers: [],
});

const queueDepth = new Gauge({
  name: "llm_gateway_queue_depth",
  help: "Current queue depth per provider",
  labelNames: ["provider"],
  registers: [],
});

// Register all metrics
const allMetrics: Array<Histogram<string> | Counter<string> | Gauge<string>> = [
  gatewayLatency, firstTokenLatency, streamDuration,
  requestTotal, errorTotal, retryTotal,
  circuitBreakerEvents, bulkheadRejections, fallbackTotal,
  validationErrors, timeoutTotal, stateTransitions,
  activeRequests, queueDepth,
];

for (const metric of allMetrics) {
  try { register.registerMetric(metric as any); } catch { /* already registered */ }
}

// ===== Telemetry Recorder =====

export const gatewayTelemetry = {
  // --- Request lifecycle ---
  recordRequestStart(provider: string, model: string): void {
    requestTotal.inc({ provider, model, status: "started" });
    activeRequests.inc({ state: "active", provider });
  },

  recordRequestComplete(provider: string, model: string, durationMs: number, fromFallback: boolean): void {
    requestTotal.inc({ provider, model, status: "success" });
    gatewayLatency.observe(
      { provider, model, status: "success", from_fallback: String(fromFallback) },
      durationMs / 1000
    );
    activeRequests.dec({ state: "active", provider });
  },

  recordRequestFailed(provider: string, model: string, durationMs: number, errorType: string): void {
    requestTotal.inc({ provider, model, status: "failed" });
    errorTotal.inc({ provider, model, error_type: errorType });
    gatewayLatency.observe(
      { provider, model, status: "failed", from_fallback: "false" },
      durationMs / 1000
    );
    activeRequests.dec({ state: "active", provider });
  },

  // --- Streaming ---
  recordFirstToken(provider: string, model: string, ttftMs: number): void {
    firstTokenLatency.observe({ provider, model }, ttftMs / 1000);
  },

  recordStreamComplete(provider: string, model: string, durationMs: number, status: string): void {
    streamDuration.observe({ provider, model, status }, durationMs / 1000);
  },

  // --- Resilience ---
  recordRetry(provider: string, model: string, attempt: number): void {
    retryTotal.inc({ provider, model, attempt: String(attempt) });
  },

  recordCircuitBreakerEvent(provider: string, event: "opened" | "closed" | "half_open"): void {
    circuitBreakerEvents.inc({ provider, event });
  },

  recordBulkheadRejection(provider: string, reason: string): void {
    bulkheadRejections.inc({ provider, reason });
  },

  recordFallback(fromProvider: string, toProvider: string): void {
    fallbackTotal.inc({ from_provider: fromProvider, to_provider: toProvider });
  },

  recordTimeout(provider: string, timeoutType: "overall" | "first_token" | "idle" | "connect"): void {
    timeoutTotal.inc({ provider, timeout_type: timeoutType });
  },

  // --- Validation ---
  recordValidationError(errorCode: string): void {
    validationErrors.inc({ error_code: errorCode });
  },

  // --- State machine ---
  recordStateTransition(fromState: string, toState: string): void {
    stateTransitions.inc({ from_state: fromState, to_state: toState });
  },

  // --- Queue ---
  setQueueDepth(provider: string, depth: number): void {
    queueDepth.set({ provider }, depth);
  },

  // --- OpenTelemetry Span helpers ---

  /**
   * Create a traced LLM gateway span. Returns a function to end the span.
   */
  startGatewaySpan(
    requestId: string,
    provider: string,
    model: string,
    userId?: string,
  ): { span: Span; end: (status: "ok" | "error", error?: Error) => void } {
    const tracer = getTracer();
    const span = tracer.startSpan("llm.gateway.request", {
      attributes: {
        [SPAN_ATTRIBUTES.REQUEST_ID]: requestId,
        [SPAN_ATTRIBUTES.LLM_PROVIDER]: provider,
        [SPAN_ATTRIBUTES.LLM_MODEL]: model,
        ...(userId ? { [SPAN_ATTRIBUTES.USER_ID]: userId } : {}),
        "llm.gateway.version": "2.0",
      },
    });

    return {
      span,
      end: (status: "ok" | "error", error?: Error) => {
        if (status === "error" && error) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
          span.setAttribute(SPAN_ATTRIBUTES.ERROR_TYPE, error.name || "Error");
          span.setAttribute(SPAN_ATTRIBUTES.ERROR_MESSAGE, error.message.slice(0, 200));
        } else {
          span.setStatus({ code: SpanStatusCode.OK });
        }
        span.end();
      },
    };
  },

  /**
   * Record state transition as a span event.
   */
  recordTransitionEvent(span: Span, from: string, to: string, reason?: string): void {
    span.addEvent("state_transition", {
      "state.from": from,
      "state.to": to,
      ...(reason ? { "state.reason": reason } : {}),
    });
  },
};

export type GatewayTelemetry = typeof gatewayTelemetry;
