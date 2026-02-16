/**
 * Observability & Monitoring Service
 * Capabilities 701-750: Tracing, metrics, alerting, chaos testing, monitoring
 */

import crypto from "crypto";
import http from "http";
import https from "https";
import { URL } from "url";

// ============================================
// TYPES
// ============================================

interface MetricPoint {
  name: string;
  value: number;
  labels: Record<string, string>;
  timestamp: number;
}

interface AlertRule {
  id: string;
  name: string;
  metric: string;
  condition: "gt" | "lt" | "eq" | "gte" | "lte";
  threshold: number;
  duration: number; // ms
  severity: "critical" | "warning" | "info";
  channels: string[]; // "slack" | "email" | "sms" | "pagerduty"
  enabled: boolean;
}

interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operationName: string;
  serviceName: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: "ok" | "error" | "unset";
  attributes: Record<string, any>;
  events: Array<{
    name: string;
    timestamp: number;
    attributes?: Record<string, any>;
  }>;
}

interface HealthCheck {
  name: string;
  check: () => Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    details?: string;
    latencyMs?: number;
  }>;
}

interface FaultInjection {
  id: string;
  type: "latency" | "error" | "timeout" | "crash" | "resource_exhaustion";
  target: string;
  probability: number;
  duration: number;
  parameters: Record<string, any>;
  createdAt: number;
  expiresAt: number;
}

// ============================================
// IN-MEMORY STORES
// ============================================

const metrics: MetricPoint[] = [];
const alertRules = new Map<string, AlertRule>();
const spans = new Map<string, Span>();
const traces = new Map<string, Span[]>();
const healthChecks = new Map<string, HealthCheck>();
const alertHistory: Array<{
  ruleId: string;
  firedAt: Date;
  value: number;
  resolved?: Date;
}> = [];
const activeFaults = new Map<string, FaultInjection>();

// Max data retention to prevent unbounded memory growth
const MAX_METRIC_POINTS = 100_000;
const MAX_SPANS = 50_000;
const MAX_ALERT_HISTORY = 10_000;

// ============================================
// HELPERS
// ============================================

function generateId(): string {
  return crypto.randomBytes(16).toString("hex");
}

function generateShortId(): string {
  return crypto.randomBytes(8).toString("hex");
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function pruneMetrics(): void {
  if (metrics.length > MAX_METRIC_POINTS) {
    metrics.splice(0, metrics.length - MAX_METRIC_POINTS);
  }
}

function pruneSpans(): void {
  if (spans.size > MAX_SPANS) {
    const entries = Array.from(spans.entries());
    entries.sort((a, b) => a[1].startTime - b[1].startTime);
    const toRemove = entries.slice(0, entries.length - MAX_SPANS);
    for (const [key] of toRemove) {
      spans.delete(key);
    }
  }
}

function pruneAlertHistory(): void {
  if (alertHistory.length > MAX_ALERT_HISTORY) {
    alertHistory.splice(0, alertHistory.length - MAX_ALERT_HISTORY);
  }
}

function cleanExpiredFaults(): void {
  const now = Date.now();
  for (const [id, fault] of activeFaults.entries()) {
    if (now >= fault.expiresAt) {
      activeFaults.delete(id);
    }
  }
}

function evaluateCondition(
  value: number,
  condition: AlertRule["condition"],
  threshold: number
): boolean {
  switch (condition) {
    case "gt":
      return value > threshold;
    case "lt":
      return value < threshold;
    case "eq":
      return value === threshold;
    case "gte":
      return value >= threshold;
    case "lte":
      return value <= threshold;
    default:
      return false;
  }
}

function escapePrometheusLabel(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function formatPrometheusLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return "";
  const parts = entries.map(
    ([k, v]) => `${k}="${escapePrometheusLabel(v)}"`
  );
  return `{${parts.join(",")}}`;
}

// ============================================
// 701-710: TRACING
// ============================================

export function startSpan(
  traceId: string,
  operationName: string,
  serviceName: string,
  parentSpanId?: string
): Span {
  const span: Span = {
    traceId,
    spanId: generateShortId(),
    parentSpanId,
    operationName,
    serviceName,
    startTime: Date.now(),
    status: "unset",
    attributes: {},
    events: [],
  };

  spans.set(span.spanId, span);

  if (!traces.has(traceId)) {
    traces.set(traceId, []);
  }
  traces.get(traceId)!.push(span);

  pruneSpans();
  return span;
}

export function endSpan(
  spanId: string,
  status?: "ok" | "error",
  attributes?: Record<string, any>
): Span | null {
  const span = spans.get(spanId);
  if (!span) return null;

  span.endTime = Date.now();
  span.duration = span.endTime - span.startTime;
  span.status = status ?? "ok";

  if (attributes) {
    Object.assign(span.attributes, attributes);
  }

  // Also record as a latency metric automatically
  recordMetric(`span_duration_ms`, span.duration, {
    operation: span.operationName,
    service: span.serviceName,
    status: span.status,
  });

  return span;
}

export function addSpanEvent(
  spanId: string,
  eventName: string,
  attributes?: Record<string, any>
): boolean {
  const span = spans.get(spanId);
  if (!span) return false;

  span.events.push({
    name: eventName,
    timestamp: Date.now(),
    attributes,
  });

  return true;
}

export function getTrace(traceId: string): Span[] {
  return traces.get(traceId) ?? [];
}

export function correlateTraces(
  traceIds: string[]
): { traces: Span[][]; commonAttributes: Record<string, any> } {
  const traceSpans = traceIds
    .map((id) => traces.get(id))
    .filter((t): t is Span[] => t !== undefined);

  // Find attributes common across all root spans
  const commonAttributes: Record<string, any> = {};

  if (traceSpans.length > 0) {
    // Get root spans (no parent)
    const rootSpans = traceSpans
      .map((spans) => spans.find((s) => !s.parentSpanId))
      .filter((s): s is Span => s !== undefined);

    if (rootSpans.length > 0) {
      // Start with first root span's attributes
      const firstAttrs = rootSpans[0].attributes;
      for (const [key, value] of Object.entries(firstAttrs)) {
        const isCommon = rootSpans.every(
          (s) =>
            s.attributes[key] !== undefined &&
            JSON.stringify(s.attributes[key]) === JSON.stringify(value)
        );
        if (isCommon) {
          commonAttributes[key] = value;
        }
      }
    }
  }

  return { traces: traceSpans, commonAttributes };
}

export function listRecentTraces(
  limit: number = 50
): Array<{
  traceId: string;
  rootSpan: string;
  spans: number;
  duration: number;
  status: string;
}> {
  const result: Array<{
    traceId: string;
    rootSpan: string;
    spans: number;
    duration: number;
    status: string;
  }> = [];

  for (const [traceId, traceSpans] of traces.entries()) {
    const root = traceSpans.find((s) => !s.parentSpanId) ?? traceSpans[0];
    if (!root) continue;

    const allEnded = traceSpans.every((s) => s.endTime !== undefined);
    const hasError = traceSpans.some((s) => s.status === "error");

    let duration = 0;
    if (allEnded) {
      const minStart = Math.min(...traceSpans.map((s) => s.startTime));
      const maxEnd = Math.max(
        ...traceSpans.map((s) => s.endTime ?? s.startTime)
      );
      duration = maxEnd - minStart;
    } else if (root.duration !== undefined) {
      duration = root.duration;
    }

    result.push({
      traceId,
      rootSpan: root.operationName,
      spans: traceSpans.length,
      duration,
      status: hasError ? "error" : allEnded ? "ok" : "in_progress",
    });
  }

  // Sort by most recent first
  result.sort((a, b) => {
    const aSpans = traces.get(a.traceId) ?? [];
    const bSpans = traces.get(b.traceId) ?? [];
    const aStart = aSpans.length > 0 ? aSpans[0].startTime : 0;
    const bStart = bSpans.length > 0 ? bSpans[0].startTime : 0;
    return bStart - aStart;
  });

  return result.slice(0, limit);
}

// ============================================
// 711-720: METRICS
// ============================================

export function recordMetric(
  name: string,
  value: number,
  labels: Record<string, string> = {}
): void {
  metrics.push({
    name,
    value,
    labels,
    timestamp: Date.now(),
  });
  pruneMetrics();
}

export function incrementCounter(
  name: string,
  labels: Record<string, string> = {}
): void {
  recordMetric(name, 1, labels);
}

export function recordHistogram(
  name: string,
  value: number,
  labels: Record<string, string> = {}
): void {
  recordMetric(name, value, labels);
}

export function getMetricSummary(
  name: string,
  windowMs: number = 300_000
): {
  count: number;
  sum: number;
  avg: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
  labels: Record<string, string[]>;
} {
  const cutoff = Date.now() - windowMs;
  const points = metrics.filter(
    (m) => m.name === name && m.timestamp >= cutoff
  );

  if (points.length === 0) {
    return {
      count: 0,
      sum: 0,
      avg: 0,
      min: 0,
      max: 0,
      p50: 0,
      p95: 0,
      p99: 0,
      labels: {},
    };
  }

  const values = points.map((p) => p.value).sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);

  // Collect unique label values
  const labelMap: Record<string, Set<string>> = {};
  for (const point of points) {
    for (const [k, v] of Object.entries(point.labels)) {
      if (!labelMap[k]) labelMap[k] = new Set();
      labelMap[k].add(v);
    }
  }
  const labels: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(labelMap)) {
    labels[k] = Array.from(v);
  }

  return {
    count: values.length,
    sum,
    avg: sum / values.length,
    min: values[0],
    max: values[values.length - 1],
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    labels,
  };
}

export function getMetricTimeSeries(
  name: string,
  windowMs: number = 300_000,
  bucketMs: number = 10_000
): Array<{ timestamp: number; value: number }> {
  const now = Date.now();
  const cutoff = now - windowMs;
  const points = metrics.filter(
    (m) => m.name === name && m.timestamp >= cutoff
  );

  if (points.length === 0) return [];

  // Group into time buckets and average
  const buckets = new Map<number, number[]>();
  for (const point of points) {
    const bucketKey =
      Math.floor((point.timestamp - cutoff) / bucketMs) * bucketMs + cutoff;
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, []);
    }
    buckets.get(bucketKey)!.push(point.value);
  }

  const result: Array<{ timestamp: number; value: number }> = [];
  for (const [timestamp, values] of buckets.entries()) {
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    result.push({ timestamp, value: avg });
  }

  result.sort((a, b) => a.timestamp - b.timestamp);
  return result;
}

export function listMetricNames(): string[] {
  const names = new Set<string>();
  for (const point of metrics) {
    names.add(point.name);
  }
  return Array.from(names).sort();
}

export function exportPrometheusFormat(): string {
  // Group metrics by name
  const grouped = new Map<
    string,
    Array<{ value: number; labels: Record<string, string>; timestamp: number }>
  >();

  for (const point of metrics) {
    if (!grouped.has(point.name)) {
      grouped.set(point.name, []);
    }
    grouped.get(point.name)!.push({
      value: point.value,
      labels: point.labels,
      timestamp: point.timestamp,
    });
  }

  const lines: string[] = [];

  for (const [name, points] of grouped.entries()) {
    const sanitizedName = name.replace(/[^a-zA-Z0-9_:]/g, "_");

    // Determine type heuristically
    const isCounter =
      name.includes("counter") ||
      name.includes("total") ||
      name.includes("count");
    const isHistogram =
      name.includes("histogram") ||
      name.includes("duration") ||
      name.includes("latency");
    const type = isHistogram ? "histogram" : isCounter ? "counter" : "gauge";

    lines.push(`# HELP ${sanitizedName} ${name}`);
    lines.push(`# TYPE ${sanitizedName} ${type === "histogram" ? "gauge" : type}`);

    // For histograms, emit summary statistics
    if (type === "histogram") {
      const values = points.map((p) => p.value).sort((a, b) => a - b);
      const sum = values.reduce((a, b) => a + b, 0);
      const latestTimestamp = Math.max(...points.map((p) => p.timestamp));

      lines.push(
        `${sanitizedName}_count ${values.length} ${latestTimestamp}`
      );
      lines.push(
        `${sanitizedName}_sum ${sum} ${latestTimestamp}`
      );

      // Emit the most recent value per label combination
      const labelCombinations = new Map<string, typeof points[0]>();
      for (const p of points) {
        const key = JSON.stringify(p.labels);
        const existing = labelCombinations.get(key);
        if (!existing || p.timestamp > existing.timestamp) {
          labelCombinations.set(key, p);
        }
      }

      for (const p of labelCombinations.values()) {
        const labelStr = formatPrometheusLabels(p.labels);
        lines.push(
          `${sanitizedName}${labelStr} ${p.value} ${p.timestamp}`
        );
      }
    } else {
      // For counters and gauges, emit the most recent value per label combination
      // For counters, sum all values per label combination
      const labelCombinations = new Map<
        string,
        { labels: Record<string, string>; value: number; timestamp: number }
      >();

      for (const p of points) {
        const key = JSON.stringify(p.labels);
        const existing = labelCombinations.get(key);
        if (!existing) {
          labelCombinations.set(key, {
            labels: p.labels,
            value: p.value,
            timestamp: p.timestamp,
          });
        } else if (isCounter) {
          existing.value += p.value;
          existing.timestamp = Math.max(existing.timestamp, p.timestamp);
        } else {
          // For gauges, keep the most recent value
          if (p.timestamp > existing.timestamp) {
            existing.value = p.value;
            existing.timestamp = p.timestamp;
          }
        }
      }

      for (const entry of labelCombinations.values()) {
        const labelStr = formatPrometheusLabels(entry.labels);
        lines.push(
          `${sanitizedName}${labelStr} ${entry.value} ${entry.timestamp}`
        );
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

// ============================================
// 721-730: ALERTING
// ============================================

export function createAlertRule(rule: Omit<AlertRule, "id">): AlertRule {
  const id = generateId();
  const fullRule: AlertRule = { ...rule, id };
  alertRules.set(id, fullRule);
  return fullRule;
}

export function updateAlertRule(
  id: string,
  updates: Partial<AlertRule>
): AlertRule | null {
  const rule = alertRules.get(id);
  if (!rule) return null;

  const updated = { ...rule, ...updates, id }; // Preserve ID
  alertRules.set(id, updated);
  return updated;
}

export function deleteAlertRule(id: string): boolean {
  return alertRules.delete(id);
}

export function listAlertRules(): AlertRule[] {
  return Array.from(alertRules.values());
}

export function evaluateAlerts(): Array<{
  rule: AlertRule;
  firing: boolean;
  currentValue: number;
}> {
  const results: Array<{
    rule: AlertRule;
    firing: boolean;
    currentValue: number;
  }> = [];

  for (const rule of alertRules.values()) {
    if (!rule.enabled) {
      results.push({ rule, firing: false, currentValue: 0 });
      continue;
    }

    // Get metric values within the alert duration window
    const cutoff = Date.now() - rule.duration;
    const points = metrics.filter(
      (m) => m.name === rule.metric && m.timestamp >= cutoff
    );

    if (points.length === 0) {
      results.push({ rule, firing: false, currentValue: 0 });
      continue;
    }

    // Use the average value in the window
    const avg =
      points.reduce((sum, p) => sum + p.value, 0) / points.length;
    const firing = evaluateCondition(avg, rule.condition, rule.threshold);

    if (firing) {
      // Check if already in history and not resolved
      const existingFiring = alertHistory.find(
        (h) => h.ruleId === rule.id && !h.resolved
      );
      if (!existingFiring) {
        alertHistory.push({
          ruleId: rule.id,
          firedAt: new Date(),
          value: avg,
        });
        pruneAlertHistory();
      }
    } else {
      // Resolve any open alerts for this rule
      for (const entry of alertHistory) {
        if (entry.ruleId === rule.id && !entry.resolved) {
          entry.resolved = new Date();
        }
      }
    }

    results.push({ rule, firing, currentValue: avg });
  }

  return results;
}

export function getAlertHistory(
  limit: number = 100
): Array<{
  ruleId: string;
  firedAt: Date;
  value: number;
  resolved?: Date;
}> {
  return alertHistory.slice(-limit);
}

// ============================================
// 731-740: HEALTH CHECKS
// ============================================

export function registerHealthCheck(
  name: string,
  check: HealthCheck["check"]
): void {
  healthChecks.set(name, { name, check });
}

export async function runHealthChecks(): Promise<{
  status: "healthy" | "degraded" | "unhealthy";
  checks: Array<{
    name: string;
    status: string;
    details?: string;
    latencyMs?: number;
  }>;
  timestamp: string;
}> {
  const results: Array<{
    name: string;
    status: string;
    details?: string;
    latencyMs?: number;
  }> = [];

  for (const [name, hc] of healthChecks.entries()) {
    const start = Date.now();
    try {
      const result = await hc.check();
      const latencyMs = result.latencyMs ?? Date.now() - start;
      results.push({
        name,
        status: result.status,
        details: result.details,
        latencyMs,
      });
    } catch (err: any) {
      results.push({
        name,
        status: "unhealthy",
        details: `Check failed: ${err.message ?? String(err)}`,
        latencyMs: Date.now() - start,
      });
    }
  }

  // If no checks registered, report healthy
  if (results.length === 0) {
    return {
      status: "healthy",
      checks: [],
      timestamp: new Date().toISOString(),
    };
  }

  // Determine overall status
  const hasUnhealthy = results.some((r) => r.status === "unhealthy");
  const hasDegraded = results.some((r) => r.status === "degraded");

  let overallStatus: "healthy" | "degraded" | "unhealthy";
  if (hasUnhealthy) {
    overallStatus = "unhealthy";
  } else if (hasDegraded) {
    overallStatus = "degraded";
  } else {
    overallStatus = "healthy";
  }

  // Record a metric for the health check
  recordMetric("health_check_status", overallStatus === "healthy" ? 1 : overallStatus === "degraded" ? 0.5 : 0);

  return {
    status: overallStatus,
    checks: results,
    timestamp: new Date().toISOString(),
  };
}

export function generateReadinessProbe(): {
  path: string;
  initialDelaySeconds: number;
  periodSeconds: number;
  handler: string;
} {
  return {
    path: "/healthz/ready",
    initialDelaySeconds: 10,
    periodSeconds: 15,
    handler: "runHealthChecks",
  };
}

export function generateLivenessProbe(): {
  path: string;
  initialDelaySeconds: number;
  periodSeconds: number;
  handler: string;
} {
  return {
    path: "/healthz/live",
    initialDelaySeconds: 5,
    periodSeconds: 10,
    handler: "runHealthChecks",
  };
}

// ============================================
// 741-745: MONITORING (Latency, Error Rate, Throughput)
// ============================================

export function trackLatency(
  operationName: string,
  durationMs: number
): void {
  recordMetric("operation_latency_ms", durationMs, {
    operation: operationName,
  });
}

export function getLatencyStats(
  operationName: string
): { p50: number; p95: number; p99: number; avg: number; count: number } {
  // Filter to the specific operation
  const cutoff = Date.now() - 300_000;
  const points = metrics.filter(
    (m) =>
      m.name === "operation_latency_ms" &&
      m.labels.operation === operationName &&
      m.timestamp >= cutoff
  );

  if (points.length === 0) {
    return { p50: 0, p95: 0, p99: 0, avg: 0, count: 0 };
  }

  const values = points.map((p) => p.value).sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);

  return {
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    avg: sum / values.length,
    count: values.length,
  };
}

export function trackErrorRate(
  serviceName: string,
  isError: boolean
): void {
  recordMetric("request_outcome", isError ? 1 : 0, {
    service: serviceName,
    outcome: isError ? "error" : "success",
  });
}

export function getErrorRate(
  serviceName: string,
  windowMs: number = 300_000
): { total: number; errors: number; rate: number } {
  const cutoff = Date.now() - windowMs;
  const points = metrics.filter(
    (m) =>
      m.name === "request_outcome" &&
      m.labels.service === serviceName &&
      m.timestamp >= cutoff
  );

  const total = points.length;
  const errors = points.filter((p) => p.labels.outcome === "error").length;
  const rate = total > 0 ? errors / total : 0;

  return { total, errors, rate };
}

export function trackThroughput(endpoint: string): void {
  recordMetric("endpoint_request", 1, { endpoint });
}

export function getThroughput(
  endpoint: string,
  windowMs: number = 60_000
): { requestsPerSecond: number; total: number } {
  const cutoff = Date.now() - windowMs;
  const points = metrics.filter(
    (m) =>
      m.name === "endpoint_request" &&
      m.labels.endpoint === endpoint &&
      m.timestamp >= cutoff
  );

  const total = points.length;
  const windowSeconds = windowMs / 1000;
  const requestsPerSecond = total / windowSeconds;

  return { requestsPerSecond, total };
}

// ============================================
// 746-748: CHAOS ENGINEERING
// ============================================

export function injectFault(config: {
  type: "latency" | "error" | "timeout" | "crash" | "resource_exhaustion";
  target: string;
  probability: number;
  duration: number;
  parameters?: Record<string, any>;
}): { id: string; active: boolean; expiresAt: Date } {
  cleanExpiredFaults();

  const id = generateId();
  const now = Date.now();
  const fault: FaultInjection = {
    id,
    type: config.type,
    target: config.target,
    probability: Math.max(0, Math.min(1, config.probability)),
    duration: config.duration,
    parameters: config.parameters ?? {},
    createdAt: now,
    expiresAt: now + config.duration,
  };

  activeFaults.set(id, fault);

  recordMetric("chaos_fault_injected", 1, {
    type: config.type,
    target: config.target,
  });

  return {
    id,
    active: true,
    expiresAt: new Date(fault.expiresAt),
  };
}

export function removeFault(id: string): boolean {
  const removed = activeFaults.delete(id);
  if (removed) {
    recordMetric("chaos_fault_removed", 1, { id });
  }
  return removed;
}

export function listActiveFaults(): Array<{
  id: string;
  type: string;
  target: string;
  expiresAt: Date;
}> {
  cleanExpiredFaults();
  const result: Array<{
    id: string;
    type: string;
    target: string;
    expiresAt: Date;
  }> = [];

  for (const fault of activeFaults.values()) {
    result.push({
      id: fault.id,
      type: fault.type,
      target: fault.target,
      expiresAt: new Date(fault.expiresAt),
    });
  }

  return result;
}

export function shouldInjectFault(
  target: string
): { inject: boolean; faultType?: string; parameters?: Record<string, any> } {
  cleanExpiredFaults();

  for (const fault of activeFaults.values()) {
    // Match target exactly or as a prefix/pattern
    const targetMatches =
      fault.target === target ||
      fault.target === "*" ||
      target.startsWith(fault.target);

    if (targetMatches && Math.random() < fault.probability) {
      recordMetric("chaos_fault_triggered", 1, {
        type: fault.type,
        target,
      });

      return {
        inject: true,
        faultType: fault.type,
        parameters: fault.parameters,
      };
    }
  }

  return { inject: false };
}

// ============================================
// 749: LOAD TESTING
// ============================================

function makeHttpRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string
): Promise<{ statusCode: number; latencyMs: number }> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const transport = isHttps ? https : http;

    const options: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: method.toUpperCase(),
      headers: {
        ...headers,
        "User-Agent": "ObservabilityService-LoadTest/1.0",
      },
      timeout: 30_000,
    };

    const req = transport.request(options, (res) => {
      // Consume the response body to free memory
      res.on("data", () => {});
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode ?? 0,
          latencyMs: Date.now() - start,
        });
      });
    });

    req.on("error", (err) => {
      reject(err);
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });

    if (body) {
      req.write(body);
    }

    req.end();
  });
}

export async function runLoadTest(config: {
  url: string;
  method?: string;
  concurrency: number;
  totalRequests: number;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  requestsPerSecond: number;
  errors: Record<string, number>;
  durationMs: number;
}> {
  const method = config.method ?? "GET";
  const headers = config.headers ?? {};
  const concurrency = Math.max(1, config.concurrency);
  const totalRequests = Math.max(1, config.totalRequests);

  const latencies: number[] = [];
  const errorCounts: Record<string, number> = {};
  let successfulRequests = 0;
  let failedRequests = 0;
  let completedRequests = 0;

  const overallStart = Date.now();

  // Worker function that pulls work from a shared counter
  async function worker(): Promise<void> {
    while (true) {
      // Atomically claim a request slot
      const myIndex = completedRequests;
      if (myIndex >= totalRequests) break;
      completedRequests++;

      try {
        const result = await makeHttpRequest(
          config.url,
          method,
          headers,
          config.body
        );
        latencies.push(result.latencyMs);

        if (result.statusCode >= 200 && result.statusCode < 400) {
          successfulRequests++;
        } else {
          failedRequests++;
          const errKey = `HTTP_${result.statusCode}`;
          errorCounts[errKey] = (errorCounts[errKey] ?? 0) + 1;
        }
      } catch (err: any) {
        failedRequests++;
        const errKey = err.message ?? "unknown_error";
        errorCounts[errKey] = (errorCounts[errKey] ?? 0) + 1;
        latencies.push(Date.now() - overallStart); // Approximate
      }
    }
  }

  // Launch concurrent workers
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, totalRequests); i++) {
    workers.push(worker());
  }

  await Promise.all(workers);

  const overallDuration = Date.now() - overallStart;

  // Calculate statistics
  latencies.sort((a, b) => a - b);
  const avgLatency =
    latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;

  const actualTotal = successfulRequests + failedRequests;

  // Record load test summary metric
  recordMetric("load_test_completed", 1, {
    url: config.url,
    total: String(actualTotal),
    successful: String(successfulRequests),
    failed: String(failedRequests),
  });

  return {
    totalRequests: actualTotal,
    successfulRequests,
    failedRequests,
    avgLatencyMs: Math.round(avgLatency * 100) / 100,
    p95LatencyMs: percentile(latencies, 95),
    p99LatencyMs: percentile(latencies, 99),
    requestsPerSecond:
      overallDuration > 0
        ? Math.round((actualTotal / (overallDuration / 1000)) * 100) / 100
        : 0,
    errors: errorCounts,
    durationMs: overallDuration,
  };
}

// ============================================
// 750: DASHBOARD & CONFIG GENERATION
// ============================================

export function generateGrafanaDashboard(config: {
  title: string;
  metrics: Array<{
    name: string;
    type: "counter" | "gauge" | "histogram";
    title: string;
  }>;
  datasource?: string;
}): object {
  const datasource = config.datasource ?? "Prometheus";
  const uid = crypto
    .createHash("md5")
    .update(config.title)
    .digest("hex")
    .substring(0, 12);

  const panels = config.metrics.map((metric, index) => {
    const sanitizedName = metric.name.replace(/[^a-zA-Z0-9_:]/g, "_");
    const gridPos = {
      h: 8,
      w: 12,
      x: (index % 2) * 12,
      y: Math.floor(index / 2) * 8,
    };

    if (metric.type === "histogram") {
      return {
        id: index + 1,
        title: metric.title,
        type: "timeseries",
        gridPos,
        datasource: { type: "prometheus", uid: datasource },
        fieldConfig: {
          defaults: {
            color: { mode: "palette-classic" },
            custom: {
              axisCenteredZero: false,
              axisColorMode: "text",
              axisLabel: "",
              axisPlacement: "auto",
              barAlignment: 0,
              drawStyle: "line",
              fillOpacity: 10,
              gradientMode: "none",
              hideFrom: { legend: false, tooltip: false, viz: false },
              lineInterpolation: "smooth",
              lineWidth: 2,
              pointSize: 5,
              scaleDistribution: { type: "linear" },
              showPoints: "auto",
              spanNulls: false,
              stacking: { group: "A", mode: "none" },
            },
            mappings: [],
            unit: "ms",
          },
          overrides: [],
        },
        options: {
          legend: { calcs: ["mean", "max", "last"], displayMode: "table", placement: "bottom" },
          tooltip: { mode: "multi", sort: "desc" },
        },
        targets: [
          {
            datasource: { type: "prometheus", uid: datasource },
            expr: `histogram_quantile(0.50, rate(${sanitizedName}_bucket[5m]))`,
            legendFormat: "p50",
            refId: "A",
          },
          {
            datasource: { type: "prometheus", uid: datasource },
            expr: `histogram_quantile(0.95, rate(${sanitizedName}_bucket[5m]))`,
            legendFormat: "p95",
            refId: "B",
          },
          {
            datasource: { type: "prometheus", uid: datasource },
            expr: `histogram_quantile(0.99, rate(${sanitizedName}_bucket[5m]))`,
            legendFormat: "p99",
            refId: "C",
          },
        ],
      };
    }

    if (metric.type === "counter") {
      return {
        id: index + 1,
        title: metric.title,
        type: "timeseries",
        gridPos,
        datasource: { type: "prometheus", uid: datasource },
        fieldConfig: {
          defaults: {
            color: { mode: "palette-classic" },
            custom: {
              axisCenteredZero: false,
              axisColorMode: "text",
              axisLabel: "",
              axisPlacement: "auto",
              drawStyle: "line",
              fillOpacity: 20,
              gradientMode: "scheme",
              lineInterpolation: "smooth",
              lineWidth: 2,
              pointSize: 5,
              scaleDistribution: { type: "linear" },
              showPoints: "never",
              spanNulls: false,
              stacking: { group: "A", mode: "none" },
            },
            mappings: [],
            unit: "reqps",
          },
          overrides: [],
        },
        options: {
          legend: { calcs: ["mean", "max"], displayMode: "table", placement: "bottom" },
          tooltip: { mode: "multi", sort: "desc" },
        },
        targets: [
          {
            datasource: { type: "prometheus", uid: datasource },
            expr: `rate(${sanitizedName}[5m])`,
            legendFormat: "{{instance}}",
            refId: "A",
          },
        ],
      };
    }

    // Gauge
    return {
      id: index + 1,
      title: metric.title,
      type: "gauge",
      gridPos,
      datasource: { type: "prometheus", uid: datasource },
      fieldConfig: {
        defaults: {
          color: { mode: "thresholds" },
          mappings: [],
          thresholds: {
            mode: "absolute",
            steps: [
              { color: "green", value: null },
              { color: "yellow", value: 70 },
              { color: "red", value: 90 },
            ],
          },
          unit: "percent",
          min: 0,
          max: 100,
        },
        overrides: [],
      },
      options: {
        orientation: "auto",
        reduceOptions: { calcs: ["lastNotNull"], fields: "", values: false },
        showThresholdLabels: false,
        showThresholdMarkers: true,
      },
      targets: [
        {
          datasource: { type: "prometheus", uid: datasource },
          expr: sanitizedName,
          legendFormat: "{{instance}}",
          refId: "A",
        },
      ],
    };
  });

  return {
    __inputs: [
      {
        name: datasource,
        label: datasource,
        description: "",
        type: "datasource",
        pluginId: "prometheus",
        pluginName: "Prometheus",
      },
    ],
    __requires: [
      { type: "grafana", id: "grafana", name: "Grafana", version: "10.0.0" },
      { type: "datasource", id: "prometheus", name: "Prometheus", version: "1.0.0" },
      { type: "panel", id: "timeseries", name: "Time series", version: "" },
      { type: "panel", id: "gauge", name: "Gauge", version: "" },
    ],
    annotations: {
      list: [
        {
          builtIn: 1,
          datasource: { type: "grafana", uid: "-- Grafana --" },
          enable: true,
          hide: true,
          iconColor: "rgba(0, 211, 255, 1)",
          name: "Annotations & Alerts",
          type: "dashboard",
        },
      ],
    },
    editable: true,
    fiscalYearStartMonth: 0,
    graphTooltip: 1,
    id: null,
    links: [],
    liveNow: false,
    panels,
    refresh: "10s",
    schemaVersion: 38,
    tags: ["auto-generated", "observability"],
    templating: {
      list: [
        {
          current: { selected: false, text: "All", value: "$__all" },
          datasource: { type: "prometheus", uid: datasource },
          definition: "label_values(instance)",
          hide: 0,
          includeAll: true,
          multi: true,
          name: "instance",
          options: [],
          query: { query: "label_values(instance)", refId: "PrometheusVariableQueryEditor-VariableQuery" },
          refresh: 1,
          regex: "",
          skipUrlSync: false,
          sort: 1,
          type: "query",
        },
      ],
    },
    time: { from: "now-1h", to: "now" },
    timepicker: {},
    timezone: "",
    title: config.title,
    uid,
    version: 1,
    weekStart: "",
  };
}

export function generateAlertManagerConfig(rules: AlertRule[]): string {
  const severityToReceiver: Record<string, string> = {
    critical: "critical-receiver",
    warning: "warning-receiver",
    info: "info-receiver",
  };

  // Collect all unique channels across rules
  const allChannels = new Set<string>();
  for (const rule of rules) {
    for (const ch of rule.channels) {
      allChannels.add(ch);
    }
  }

  // Build receivers section
  const receivers: string[] = [];
  receivers.push("receivers:");
  receivers.push('  - name: "default"');

  // Build channel-specific receiver configs
  const channelReceiverMap = new Map<string, string[]>();
  for (const rule of rules) {
    const receiverName = severityToReceiver[rule.severity] ?? "default";
    if (!channelReceiverMap.has(receiverName)) {
      channelReceiverMap.set(receiverName, []);
    }
    for (const ch of rule.channels) {
      const existing = channelReceiverMap.get(receiverName)!;
      if (!existing.includes(ch)) {
        existing.push(ch);
      }
    }
  }

  for (const [receiverName, channels] of channelReceiverMap.entries()) {
    receivers.push(`  - name: "${receiverName}"`);
    for (const ch of channels) {
      switch (ch) {
        case "slack":
          receivers.push("    slack_configs:");
          receivers.push('      - api_url: "https://hooks.slack.com/services/REPLACE_ME"');
          receivers.push(`        channel: "#alerts-${receiverName.replace("-receiver", "")}"`);
          receivers.push('        send_resolved: true');
          receivers.push(`        title: '{{ template "slack.title" . }}'`);
          receivers.push(`        text: '{{ template "slack.text" . }}'`);
          break;
        case "email":
          receivers.push("    email_configs:");
          receivers.push(`      - to: "alerts-${receiverName.replace("-receiver", "")}@example.com"`);
          receivers.push('        send_resolved: true');
          break;
        case "pagerduty":
          receivers.push("    pagerduty_configs:");
          receivers.push('      - service_key: "REPLACE_ME"');
          receivers.push('        severity: \'{{ .CommonLabels.severity }}\'');
          break;
        case "sms":
          receivers.push("    webhook_configs:");
          receivers.push('      - url: "https://sms-gateway.example.com/alert"');
          receivers.push('        send_resolved: true');
          break;
      }
    }
  }

  // Build alerting rules
  const ruleGroups: string[] = [];
  ruleGroups.push("groups:");
  ruleGroups.push("  - name: auto_generated_rules");
  ruleGroups.push("    rules:");

  for (const rule of rules) {
    if (!rule.enabled) continue;

    const sanitizedMetric = rule.metric.replace(/[^a-zA-Z0-9_:]/g, "_");
    let expr: string;

    switch (rule.condition) {
      case "gt":
        expr = `${sanitizedMetric} > ${rule.threshold}`;
        break;
      case "lt":
        expr = `${sanitizedMetric} < ${rule.threshold}`;
        break;
      case "eq":
        expr = `${sanitizedMetric} == ${rule.threshold}`;
        break;
      case "gte":
        expr = `${sanitizedMetric} >= ${rule.threshold}`;
        break;
      case "lte":
        expr = `${sanitizedMetric} <= ${rule.threshold}`;
        break;
      default:
        expr = `${sanitizedMetric} > ${rule.threshold}`;
    }

    const durationSeconds = Math.max(1, Math.floor(rule.duration / 1000));
    const forDuration =
      durationSeconds >= 60
        ? `${Math.floor(durationSeconds / 60)}m`
        : `${durationSeconds}s`;

    ruleGroups.push(`      - alert: ${rule.name.replace(/\s+/g, "_")}`);
    ruleGroups.push(`        expr: ${expr}`);
    ruleGroups.push(`        for: ${forDuration}`);
    ruleGroups.push("        labels:");
    ruleGroups.push(`          severity: ${rule.severity}`);
    ruleGroups.push("        annotations:");
    ruleGroups.push(`          summary: "${rule.name}"`);
    ruleGroups.push(
      `          description: "${rule.metric} ${rule.condition} ${rule.threshold} for ${forDuration}"`
    );
  }

  // Build route section
  const routes: string[] = [];
  routes.push("route:");
  routes.push('  receiver: "default"');
  routes.push("  group_by: ['alertname', 'severity']");
  routes.push("  group_wait: 30s");
  routes.push("  group_interval: 5m");
  routes.push("  repeat_interval: 4h");
  routes.push("  routes:");

  for (const severity of ["critical", "warning", "info"]) {
    const receiver = severityToReceiver[severity];
    if (channelReceiverMap.has(receiver)) {
      routes.push(`    - match:`);
      routes.push(`        severity: ${severity}`);
      routes.push(`      receiver: "${receiver}"`);
      if (severity === "critical") {
        routes.push("      repeat_interval: 15m");
      } else if (severity === "warning") {
        routes.push("      repeat_interval: 1h");
      }
    }
  }

  // Combine into full Alertmanager config
  const config = [
    "# Auto-generated Alertmanager Configuration",
    "# Generated by ObservabilityService",
    `# Date: ${new Date().toISOString()}`,
    "",
    "global:",
    "  resolve_timeout: 5m",
    "  smtp_from: 'alertmanager@example.com'",
    "  smtp_smarthost: 'smtp.example.com:587'",
    "",
    ...routes,
    "",
    ...receivers,
    "",
    "inhibit_rules:",
    "  - source_match:",
    "      severity: critical",
    "    target_match:",
    "      severity: warning",
    "    equal: ['alertname']",
    "  - source_match:",
    "      severity: warning",
    "    target_match:",
    "      severity: info",
    "    equal: ['alertname']",
    "",
    "# Prometheus alerting rules (place in separate rules file):",
    ...ruleGroups,
  ];

  return config.join("\n");
}
