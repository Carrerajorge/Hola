// Metrics collector for token usage, cost, latency, success rate, grounding rate,
// hallucination rate, per-provider stats. OpenTelemetry compatible.

export interface MetricPoint {
  name: string;
  value: number;
  timestamp: number;
  labels: Record<string, string>;
  type: "counter" | "gauge" | "histogram";
}

export interface ProviderStats {
  provider: string;
  model: string;
  totalRequests: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
  avgLatencyMs: number;
  successRate: number;
  groundingRate: number;
  hallucinationRate: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
}

export interface RunMetrics {
  runId: string;
  agentId: string;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  success: boolean;
  grounded: boolean;
  hallucinated: boolean;
  timestamp: number;
}

interface HistogramBucket {
  le: number; // less-than-or-equal boundary
  count: number;
}

const DEFAULT_LATENCY_BUCKETS = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000];

export class MetricsCollector {
  private metrics: MetricPoint[] = [];
  private runMetrics: RunMetrics[] = [];
  private histograms = new Map<string, HistogramBucket[]>();
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private readonly maxRetention: number;

  constructor(options: { maxRetention?: number } = {}) {
    this.maxRetention = options.maxRetention ?? 100_000;
    this.initHistogram("request_latency_ms", DEFAULT_LATENCY_BUCKETS);
  }

  recordRun(run: RunMetrics): void {
    this.runMetrics.push(run);
    if (this.runMetrics.length > this.maxRetention) {
      this.runMetrics = this.runMetrics.slice(-this.maxRetention);
    }

    const providerLabel = `${run.provider}/${run.model}`;
    this.incrementCounter("requests_total", { provider: providerLabel });
    this.incrementCounter("tokens_in_total", { provider: providerLabel }, run.tokensIn);
    this.incrementCounter("tokens_out_total", { provider: providerLabel }, run.tokensOut);
    this.incrementCounter("cost_usd_total", { provider: providerLabel }, run.costUsd);
    if (run.success) this.incrementCounter("requests_success", { provider: providerLabel });
    if (run.grounded) this.incrementCounter("requests_grounded", { provider: providerLabel });
    if (run.hallucinated) this.incrementCounter("requests_hallucinated", { provider: providerLabel });

    this.observeHistogram("request_latency_ms", run.latencyMs);
    this.setGauge("last_request_latency_ms", run.latencyMs);
    this.setGauge("last_request_cost_usd", run.costUsd);
  }

  getProviderStats(provider?: string): ProviderStats[] {
    const grouped = new Map<string, RunMetrics[]>();
    for (const run of this.runMetrics) {
      const key = `${run.provider}/${run.model}`;
      if (provider && key !== provider) continue;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(run);
    }

    const stats: ProviderStats[] = [];
    for (const [key, runs] of grouped) {
      const [prov, model] = key.split("/");
      const latencies = runs.map((r) => r.latencyMs).sort((a, b) => a - b);
      stats.push({
        provider: prov,
        model,
        totalRequests: runs.length,
        totalTokensIn: runs.reduce((s, r) => s + r.tokensIn, 0),
        totalTokensOut: runs.reduce((s, r) => s + r.tokensOut, 0),
        totalCostUsd: runs.reduce((s, r) => s + r.costUsd, 0),
        avgLatencyMs: latencies.reduce((s, v) => s + v, 0) / latencies.length,
        successRate: runs.filter((r) => r.success).length / runs.length,
        groundingRate: runs.filter((r) => r.grounded).length / runs.length,
        hallucinationRate: runs.filter((r) => r.hallucinated).length / runs.length,
        p50LatencyMs: this.percentile(latencies, 0.5),
        p95LatencyMs: this.percentile(latencies, 0.95),
        p99LatencyMs: this.percentile(latencies, 0.99),
      });
    }
    return stats;
  }

  /** Export all metrics in OpenTelemetry-compatible format */
  exportOtel(): { resourceMetrics: Array<{ scopeMetrics: Array<{ metrics: MetricPoint[] }> }> } {
    const allMetrics: MetricPoint[] = [];
    const now = Date.now();
    for (const [key, value] of this.counters) {
      const [name, ...labelParts] = key.split("|");
      const labels: Record<string, string> = {};
      for (const lp of labelParts) { const [k, v] = lp.split("="); if (k && v) labels[k] = v; }
      allMetrics.push({ name, value, timestamp: now, labels, type: "counter" });
    }
    for (const [name, value] of this.gauges) {
      allMetrics.push({ name, value, timestamp: now, labels: {}, type: "gauge" });
    }
    return { resourceMetrics: [{ scopeMetrics: [{ metrics: allMetrics }] }] };
  }

  /** Get summary dashboard data */
  getSummary(): {
    totalRuns: number; totalCostUsd: number; avgLatencyMs: number;
    overallSuccessRate: number; overallGroundingRate: number; overallHallucinationRate: number;
  } {
    const runs = this.runMetrics;
    if (runs.length === 0) {
      return { totalRuns: 0, totalCostUsd: 0, avgLatencyMs: 0, overallSuccessRate: 0, overallGroundingRate: 0, overallHallucinationRate: 0 };
    }
    return {
      totalRuns: runs.length,
      totalCostUsd: runs.reduce((s, r) => s + r.costUsd, 0),
      avgLatencyMs: runs.reduce((s, r) => s + r.latencyMs, 0) / runs.length,
      overallSuccessRate: runs.filter((r) => r.success).length / runs.length,
      overallGroundingRate: runs.filter((r) => r.grounded).length / runs.length,
      overallHallucinationRate: runs.filter((r) => r.hallucinated).length / runs.length,
    };
  }

  private incrementCounter(name: string, labels: Record<string, string>, amount = 1): void {
    const key = this.labelKey(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + amount);
  }

  private setGauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  private initHistogram(name: string, buckets: number[]): void {
    this.histograms.set(name, buckets.map((le) => ({ le, count: 0 })));
  }

  private observeHistogram(name: string, value: number): void {
    const buckets = this.histograms.get(name);
    if (!buckets) return;
    for (const bucket of buckets) {
      if (value <= bucket.le) bucket.count++;
    }
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil(p * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  private labelKey(name: string, labels: Record<string, string>): string {
    const parts = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`);
    return [name, ...parts].join("|");
  }
}
