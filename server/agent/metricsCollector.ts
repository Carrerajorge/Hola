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

export interface ExportedMetrics {
  timestamp: string;
  tools: Record<string, ToolStats>;
  aggregate: {
    totalCalls: number;
    overallSuccessRate: number;
    overallErrorRate: number;
    overallLatencyP95: number;
  };
}

export interface EventTrace {
  correlationId: string;
  runId: string;
  events: TracedEvent[];
}

export interface TracedEvent {
  timestamp: string;
  type: "step_start" | "step_end" | "tool_call" | "tool_result" | "error" | "state_change";
  stepId?: string;
  toolName?: string;
  durationMs?: number;
  metadata?: Record<string, any>;
}

export class MetricsCollector {
  private metrics: Map<string, StepMetrics[]> = new Map();
  private readonly maxEntriesPerTool: number;
  private readonly retentionMs: number;

  constructor(maxEntriesPerTool: number = 1000, retentionMs: number = 3600000) {
    this.maxEntriesPerTool = maxEntriesPerTool;
    this.retentionMs = retentionMs;
  }

  record(metrics: StepMetrics): void {
    const existing = this.metrics.get(metrics.toolName) || [];
    existing.push(metrics);
    
    if (existing.length > this.maxEntriesPerTool) {
      existing.shift();
    }
    
    this.metrics.set(metrics.toolName, existing);
  }

  pruneOldEntries(): number {
    const cutoff = new Date(Date.now() - this.retentionMs);
    let pruned = 0;
    
    for (const [toolName, entries] of this.metrics.entries()) {
      const originalLength = entries.length;
      const filtered = entries.filter(m => m.timestamp >= cutoff);
      if (filtered.length !== originalLength) {
        pruned += originalLength - filtered.length;
        this.metrics.set(toolName, filtered);
      }
    }
    
    return pruned;
  }

  private getAllMetrics(): StepMetrics[] {
    const allMetrics: StepMetrics[] = [];
    Array.from(this.metrics.values()).forEach(toolMetrics => {
      allMetrics.push(...toolMetrics);
    });
    return allMetrics;
  }

  getLatencyP95(toolName?: string): number {
    const metricsToAnalyze = toolName 
      ? this.metrics.get(toolName) || []
      : this.getAllMetrics();
    
    if (metricsToAnalyze.length === 0) {
      return 0;
    }

    const latencies = metricsToAnalyze.map(m => m.latencyMs).sort((a, b) => a - b);
    const p95Index = Math.floor(latencies.length * 0.95);
    return latencies[Math.min(p95Index, latencies.length - 1)];
  }

  getSuccessRate(toolName?: string): number {
    const metricsToAnalyze = toolName 
      ? this.metrics.get(toolName) || []
      : this.getAllMetrics();
    
    if (metricsToAnalyze.length === 0) {
      return 0;
    }

    const successCount = metricsToAnalyze.filter(m => m.success).length;
    return (successCount / metricsToAnalyze.length) * 100;
  }

  getErrorRate(toolName?: string): number {
    const metricsToAnalyze = toolName 
      ? this.metrics.get(toolName) || []
      : this.getAllMetrics();
    
    if (metricsToAnalyze.length === 0) {
      return 0;
    }

    const errorCount = metricsToAnalyze.filter(m => !m.success).length;
    return (errorCount / metricsToAnalyze.length) * 100;
  }

  getToolStats(): Record<string, ToolStats> {
    const stats: Record<string, ToolStats> = {};

    Array.from(this.metrics.entries()).forEach(([toolName, toolMetrics]) => {
      if (toolMetrics.length === 0) return;

      const latencies = toolMetrics.map(m => m.latencyMs).sort((a, b) => a - b);
      const p95Index = Math.floor(latencies.length * 0.95);
      const successCount = toolMetrics.filter(m => m.success).length;
      const errorCount = toolMetrics.filter(m => !m.success).length;

      stats[toolName] = {
        latencyP95: latencies[Math.min(p95Index, latencies.length - 1)],
        successRate: (successCount / toolMetrics.length) * 100,
        errorRate: (errorCount / toolMetrics.length) * 100,
        totalCalls: toolMetrics.length,
      };
    });

    return stats;
  }

  exportMetrics(): ExportedMetrics {
    const allMetrics = this.getAllMetrics();
    const toolStats = this.getToolStats();

    return {
      timestamp: new Date().toISOString(),
      tools: toolStats,
      aggregate: {
        totalCalls: allMetrics.length,
        overallSuccessRate: this.getSuccessRate(),
        overallErrorRate: this.getErrorRate(),
        overallLatencyP95: this.getLatencyP95(),
      },
    };
  }

  clear(): void {
    this.metrics.clear();
  }
}

export const metricsCollector = new MetricsCollector();

class EventTracer {
  private traces: Map<string, EventTrace> = new Map();

  startTrace(correlationId: string, runId: string): void {
    this.traces.set(correlationId, { correlationId, runId, events: [] });
  }

  addEvent(correlationId: string, event: Omit<TracedEvent, "timestamp">): void {
    const trace = this.traces.get(correlationId);
    if (trace) {
      trace.events.push({ ...event, timestamp: new Date().toISOString() });
    }
  }

  getTrace(correlationId: string): EventTrace | undefined {
    return this.traces.get(correlationId);
  }

  endTrace(correlationId: string): EventTrace | undefined {
    const trace = this.traces.get(correlationId);
    this.traces.delete(correlationId);
    return trace;
  }
}

export const eventTracer = new EventTracer();
