import { trace, SpanStatusCode, context, SpanKind } from "@opentelemetry/api";
import type { IntentType, SupportedLocale, IntentResult } from "../../../shared/schemas/intent";

const tracer = trace.getTracer("intent-router", "2.0.0");

interface LatencyBucket {
  count: number;
  sum: number;
  values: number[];
}

interface IntentMetricsStore {
  total_requests: number;
  cache_hits: number;
  cache_misses: number;
  rule_only: number;
  knn_fallbacks: number;
  llm_fallbacks: number;
  clarification_requests: number;
  unknown_intents: number;
  confidence_sum: number;
  latencies: LatencyBucket;
  by_intent: Record<IntentType, number>;
  by_locale: Record<string, number>;
  by_fallback: Record<string, number>;
  errors: number;
  degraded_fallbacks: number;
}

const metrics: IntentMetricsStore = {
  total_requests: 0,
  cache_hits: 0,
  cache_misses: 0,
  rule_only: 0,
  knn_fallbacks: 0,
  llm_fallbacks: 0,
  clarification_requests: 0,
  unknown_intents: 0,
  confidence_sum: 0,
  latencies: { count: 0, sum: 0, values: [] },
  by_intent: {
    CREATE_PRESENTATION: 0,
    CREATE_DOCUMENT: 0,
    CREATE_SPREADSHEET: 0,
    SUMMARIZE: 0,
    TRANSLATE: 0,
    SEARCH_WEB: 0,
    ANALYZE_DOCUMENT: 0,
    CHAT_GENERAL: 0,
    NEED_CLARIFICATION: 0
  },
  by_locale: {},
  by_fallback: { none: 0, knn: 0, llm: 0, degraded: 0 },
  errors: 0,
  degraded_fallbacks: 0
};

const MAX_LATENCY_SAMPLES = 1000;

function recordLatency(ms: number): void {
  metrics.latencies.count++;
  metrics.latencies.sum += ms;
  
  if (metrics.latencies.values.length >= MAX_LATENCY_SAMPLES) {
    metrics.latencies.values.shift();
  }
  metrics.latencies.values.push(ms);
}

function computePercentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

export interface TelemetryContext {
  trace_id: string;
  span_id: string;
  start_time: number;
}

export function startTrace(
  operation: string,
  attributes?: Record<string, string | number | boolean>
): TelemetryContext {
  const span = tracer.startSpan(operation, {
    kind: SpanKind.INTERNAL,
    attributes: {
      "intent_router.version": "2.0.0",
      ...attributes
    }
  });

  const spanContext = span.spanContext();

  return {
    trace_id: spanContext.traceId,
    span_id: spanContext.spanId,
    start_time: Date.now()
  };
}

export function endTrace(
  ctx: TelemetryContext,
  result: IntentResult,
  success: boolean = true
): void {
  const duration = Date.now() - ctx.start_time;
  recordLatency(duration);

  metrics.total_requests++;
  metrics.confidence_sum += result.confidence;
  metrics.by_intent[result.intent]++;

  if (result.cache_hit) {
    metrics.cache_hits++;
  } else {
    metrics.cache_misses++;
  }

  const fallback = result.fallback_used || "none";
  metrics.by_fallback[fallback] = (metrics.by_fallback[fallback] || 0) + 1;

  if (fallback === "none") {
    metrics.rule_only++;
  } else if (fallback === "knn") {
    metrics.knn_fallbacks++;
  } else if (fallback === "llm") {
    metrics.llm_fallbacks++;
  }

  if (result.intent === "NEED_CLARIFICATION") {
    metrics.clarification_requests++;
  }

  if (result.language_detected) {
    metrics.by_locale[result.language_detected] = 
      (metrics.by_locale[result.language_detected] || 0) + 1;
  }

  const span = trace.getSpan(context.active());
  if (span) {
    span.setAttributes({
      "intent_router.intent": result.intent,
      "intent_router.confidence": result.confidence,
      "intent_router.fallback_used": fallback,
      "intent_router.cache_hit": result.cache_hit || false,
      "intent_router.duration_ms": duration
    });

    if (success) {
      span.setStatus({ code: SpanStatusCode.OK });
    } else {
      span.setStatus({ code: SpanStatusCode.ERROR });
    }

    span.end();
  }
}

export function recordError(error: Error, ctx?: TelemetryContext): void {
  metrics.errors++;

  const span = trace.getSpan(context.active());
  if (span) {
    span.recordException(error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message
    });
  }

  console.error("[IntentRouter] Error:", {
    trace_id: ctx?.trace_id,
    error: error.message,
    stack: error.stack
  });
}

export function recordDegradedFallback(): void {
  metrics.degraded_fallbacks++;
  metrics.by_fallback.degraded = (metrics.by_fallback.degraded || 0) + 1;
}

export interface MetricsSnapshot {
  total_requests: number;
  cache_hit_rate: number;
  avg_confidence: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  p99_latency_ms: number;
  avg_latency_ms: number;
  rule_only_rate: number;
  knn_fallback_rate: number;
  llm_fallback_rate: number;
  clarification_rate: number;
  error_rate: number;
  by_intent: Record<IntentType, number>;
  by_locale: Record<string, number>;
}

export function getMetricsSnapshot(): MetricsSnapshot {
  const total = metrics.total_requests || 1;

  return {
    total_requests: metrics.total_requests,
    cache_hit_rate: metrics.cache_hits / total,
    avg_confidence: metrics.confidence_sum / total,
    p50_latency_ms: computePercentile(metrics.latencies.values, 50),
    p95_latency_ms: computePercentile(metrics.latencies.values, 95),
    p99_latency_ms: computePercentile(metrics.latencies.values, 99),
    avg_latency_ms: metrics.latencies.count > 0 
      ? metrics.latencies.sum / metrics.latencies.count 
      : 0,
    rule_only_rate: metrics.rule_only / total,
    knn_fallback_rate: metrics.knn_fallbacks / total,
    llm_fallback_rate: metrics.llm_fallbacks / total,
    clarification_rate: metrics.clarification_requests / total,
    error_rate: metrics.errors / total,
    by_intent: { ...metrics.by_intent },
    by_locale: { ...metrics.by_locale }
  };
}

export function resetMetrics(): void {
  metrics.total_requests = 0;
  metrics.cache_hits = 0;
  metrics.cache_misses = 0;
  metrics.rule_only = 0;
  metrics.knn_fallbacks = 0;
  metrics.llm_fallbacks = 0;
  metrics.clarification_requests = 0;
  metrics.unknown_intents = 0;
  metrics.confidence_sum = 0;
  metrics.latencies = { count: 0, sum: 0, values: [] };
  metrics.errors = 0;
  metrics.degraded_fallbacks = 0;
  
  for (const key of Object.keys(metrics.by_intent) as IntentType[]) {
    metrics.by_intent[key] = 0;
  }
  
  metrics.by_locale = {};
  metrics.by_fallback = { none: 0, knn: 0, llm: 0, degraded: 0 };
}

export function logStructured(
  level: "info" | "warn" | "error",
  message: string,
  data: Record<string, unknown>
): void {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    component: "intent-router",
    version: "2.0.0",
    message,
    ...data
  };

  switch (level) {
    case "error":
      console.error(JSON.stringify(logEntry));
      break;
    case "warn":
      console.warn(JSON.stringify(logEntry));
      break;
    default:
      console.log(JSON.stringify(logEntry));
  }
}
