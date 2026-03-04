interface ProviderStats {
  requests: number;
  errors: number;
  latencySum: number;
  lastFailure: number;
  status: "healthy" | "degraded" | "down";
}

export class QoSEngine {
  private stats: Map<string, ProviderStats> = new Map();
  
  // Configuración
  private ERROR_THRESHOLD = 0.1; // 10% error rate -> Degraded
  private LATENCY_THRESHOLD_MS = 3000; // >3s avg -> Degraded
  private COOLDOWN_MS = 60000; // 1 min cooldown after failure

  constructor() {
    this.resetStats();
  }

  private resetStats() {
    const providers = ["openai", "anthropic", "google", "xai", "deepseek"];
    providers.forEach(p => {
        this.stats.set(p, { 
            requests: 0, 
            errors: 0, 
            latencySum: 0, 
            lastFailure: 0, 
            status: "healthy" 
        });
    });
  }

  public recordSignal(provider: string, success: boolean, latencyMs: number) {
    const stat = this.stats.get(provider) || { requests:0, errors:0, latencySum:0, lastFailure:0, status:"healthy" };
    
    stat.requests++;
    stat.latencySum += latencyMs;
    if (!success) {
        stat.errors++;
        stat.lastFailure = Date.now();
    }

    // Recalcular estado
    const errorRate = stat.requests > 0 ? stat.errors / stat.requests : 0;
    const avgLatency = stat.requests > 0 ? stat.latencySum / stat.requests : 0;

    if (errorRate > this.ERROR_THRESHOLD || avgLatency > this.LATENCY_THRESHOLD_MS) {
        stat.status = "degraded";
    } else {
        // Recovery logic
        if (stat.status !== "healthy" && (Date.now() - stat.lastFailure > this.COOLDOWN_MS)) {
            stat.status = "healthy";
            // Reset stats to give fresh start
            stat.errors = 0;
            stat.requests = 0;
            stat.latencySum = 0;
        }
    }
    
    this.stats.set(provider, stat);
  }

  public getBestProvider(candidates: string[]): string | null {
    // Filtrar saludables
    const healthy = candidates.filter(c => this.stats.get(c)?.status === "healthy");
    
    if (healthy.length > 0) {
        // Pick lowest latency among healthy
        return healthy.sort((a, b) => {
            const statA = this.stats.get(a)!;
            const statB = this.stats.get(b)!;
            const latA = statA.requests > 0 ? statA.latencySum / statA.requests : 0;
            const latB = statB.requests > 0 ? statB.latencySum / statB.requests : 0;
            return latA - latB;
        })[0];
    }

    // Fallback: Pick degraded (least errors)
    const degraded = candidates.filter(c => this.stats.get(c)?.status === "degraded");
    if (degraded.length > 0) return degraded[0];

    // Last resort: Just return the first candidate
    return candidates[0];
  }
}

export const qos = new QoSEngine();
