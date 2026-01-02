export interface StepMetrics {
  toolName: string;
  latencyMs: number;
  success: boolean;
  errorCode?: string;
  timestamp: Date;
}

export interface ToolStats {
  latencyP95: number;
  successRate: number;
  errorRate: number;
  totalCalls: number;
}

class MetricsCollector {
  private metrics: Map<string, StepMetrics[]> = new Map();

  record(metrics: StepMetrics): void {
    const existing = this.metrics.get(metrics.toolName) || [];
    existing.push(metrics);
    this.metrics.set(metrics.toolName, existing);
  }

  getLatencyP95(toolName: string): number {
    const toolMetrics = this.metrics.get(toolName);
    if (!toolMetrics || toolMetrics.length === 0) {
      return 0;
    }

    const latencies = toolMetrics.map(m => m.latencyMs).sort((a, b) => a - b);
    const p95Index = Math.floor(latencies.length * 0.95);
    return latencies[Math.min(p95Index, latencies.length - 1)];
  }

  getSuccessRate(toolName: string): number {
    const toolMetrics = this.metrics.get(toolName);
    if (!toolMetrics || toolMetrics.length === 0) {
      return 0;
    }

    const successCount = toolMetrics.filter(m => m.success).length;
    return successCount / toolMetrics.length;
  }

  getErrorRate(toolName: string): number {
    const toolMetrics = this.metrics.get(toolName);
    if (!toolMetrics || toolMetrics.length === 0) {
      return 0;
    }

    const errorCount = toolMetrics.filter(m => !m.success).length;
    return errorCount / toolMetrics.length;
  }

  getToolStats(): Record<string, ToolStats> {
    const stats: Record<string, ToolStats> = {};

    for (const [toolName, toolMetrics] of this.metrics.entries()) {
      if (toolMetrics.length === 0) continue;

      const latencies = toolMetrics.map(m => m.latencyMs).sort((a, b) => a - b);
      const p95Index = Math.floor(latencies.length * 0.95);
      const successCount = toolMetrics.filter(m => m.success).length;
      const errorCount = toolMetrics.filter(m => !m.success).length;

      stats[toolName] = {
        latencyP95: latencies[Math.min(p95Index, latencies.length - 1)],
        successRate: successCount / toolMetrics.length,
        errorRate: errorCount / toolMetrics.length,
        totalCalls: toolMetrics.length,
      };
    }

    return stats;
  }

  clear(): void {
    this.metrics.clear();
  }
}

export const metricsCollector = new MetricsCollector();
