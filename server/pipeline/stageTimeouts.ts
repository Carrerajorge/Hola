import { EventEmitter } from "events";
import { z } from "zod";

export const StageNameSchema = z.enum([
  "preprocess",
  "nlu",
  "retrieval",
  "rerank",
  "generation",
  "postprocess",
  "total"
]);
export type StageName = z.infer<typeof StageNameSchema>;

export interface StageTimeoutConfig {
  preprocess: number;
  nlu: number;
  retrieval: number;
  rerank: number;
  generation: number;
  postprocess: number;
  total: number;
}

const DEFAULT_TIMEOUTS: StageTimeoutConfig = {
  preprocess: 500,
  nlu: 1000,
  retrieval: 3000,
  rerank: 1500,
  generation: 8000,
  postprocess: 500,
  total: 15000
};

const AGGRESSIVE_TIMEOUTS: StageTimeoutConfig = {
  preprocess: 200,
  nlu: 500,
  retrieval: 2000,
  rerank: 1000,
  generation: 5000,
  postprocess: 300,
  total: 10000
};

export interface StageResult<T = any> {
  success: boolean;
  data?: T;
  error?: Error;
  durationMs: number;
  timedOut: boolean;
  stage: StageName;
}

export interface PipelineLatency {
  preprocess: number | null;
  nlu: number | null;
  retrieval: number | null;
  rerank: number | null;
  generation: number | null;
  postprocess: number | null;
  total: number;
}

export class StageTimeoutError extends Error {
  constructor(
    public readonly stage: StageName,
    public readonly timeoutMs: number,
    public readonly elapsedMs: number
  ) {
    super(`Stage '${stage}' timed out after ${elapsedMs}ms (limit: ${timeoutMs}ms)`);
    this.name = "StageTimeoutError";
  }
}

export class StageWatchdog extends EventEmitter {
  private config: StageTimeoutConfig;
  private stageTimers: Map<StageName, NodeJS.Timeout> = new Map();
  private stageStartTimes: Map<StageName, number> = new Map();
  private stageDurations: Map<StageName, number> = new Map();
  private requestStartTime: number = 0;
  private requestId: string;
  private aborted: boolean = false;

  constructor(requestId: string, config?: Partial<StageTimeoutConfig>, aggressive: boolean = false) {
    super();
    this.requestId = requestId;
    const baseConfig = aggressive ? AGGRESSIVE_TIMEOUTS : DEFAULT_TIMEOUTS;
    this.config = { ...baseConfig, ...config };
    this.setMaxListeners(50);
  }

  getConfig(): StageTimeoutConfig {
    return { ...this.config };
  }

  startRequest(): void {
    this.requestStartTime = Date.now();
    this.aborted = false;
    this.stageDurations.clear();
    this.stageStartTimes.clear();
    
    const totalTimer = setTimeout(() => {
      if (!this.aborted) {
        this.handleTimeout("total");
      }
    }, this.config.total);
    this.stageTimers.set("total", totalTimer);

    this.emit("request_started", {
      requestId: this.requestId,
      timestamp: this.requestStartTime,
      timeoutConfig: this.config
    });
  }

  startStage(stage: StageName): void {
    if (this.aborted) return;

    const startTime = Date.now();
    this.stageStartTimes.set(stage, startTime);

    const timer = setTimeout(() => {
      if (!this.aborted && this.stageStartTimes.has(stage)) {
        this.handleTimeout(stage);
      }
    }, this.config[stage]);
    this.stageTimers.set(stage, timer);

    this.emit("stage_started", {
      requestId: this.requestId,
      stage,
      startTime,
      timeoutMs: this.config[stage]
    });
  }

  endStage(stage: StageName): number {
    const startTime = this.stageStartTimes.get(stage);
    const timer = this.stageTimers.get(stage);

    if (timer) {
      clearTimeout(timer);
      this.stageTimers.delete(stage);
    }

    const duration = startTime ? Date.now() - startTime : 0;
    this.stageDurations.set(stage, duration);
    this.stageStartTimes.delete(stage);

    this.emit("stage_completed", {
      requestId: this.requestId,
      stage,
      durationMs: duration,
      withinBudget: duration <= this.config[stage]
    });

    return duration;
  }

  async executeWithTimeout<T>(
    stage: StageName,
    operation: () => Promise<T>,
    fallback?: () => T
  ): Promise<StageResult<T>> {
    if (this.aborted) {
      return {
        success: false,
        error: new Error("Pipeline aborted"),
        durationMs: 0,
        timedOut: false,
        stage
      };
    }

    this.startStage(stage);
    const startTime = Date.now();

    try {
      const result = await Promise.race([
        operation(),
        this.createTimeoutPromise<T>(stage)
      ]);

      const duration = this.endStage(stage);

      return {
        success: true,
        data: result,
        durationMs: duration,
        timedOut: false,
        stage
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.endStage(stage);

      if (error instanceof StageTimeoutError) {
        this.emit("stage_timeout", {
          requestId: this.requestId,
          stage,
          timeoutMs: this.config[stage],
          elapsedMs: duration
        });

        if (fallback) {
          return {
            success: true,
            data: fallback(),
            durationMs: duration,
            timedOut: true,
            stage
          };
        }

        return {
          success: false,
          error,
          durationMs: duration,
          timedOut: true,
          stage
        };
      }

      return {
        success: false,
        error: error as Error,
        durationMs: duration,
        timedOut: false,
        stage
      };
    }
  }

  private createTimeoutPromise<T>(stage: StageName): Promise<T> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        const elapsed = Date.now() - (this.stageStartTimes.get(stage) || Date.now());
        reject(new StageTimeoutError(stage, this.config[stage], elapsed));
      }, this.config[stage]);
    });
  }

  private handleTimeout(stage: StageName): void {
    const startTime = this.stageStartTimes.get(stage) || this.requestStartTime;
    const elapsed = Date.now() - startTime;

    this.emit("timeout", {
      requestId: this.requestId,
      stage,
      timeoutMs: this.config[stage],
      elapsedMs: elapsed,
      isTotal: stage === "total"
    });

    if (stage === "total") {
      this.abort();
    }
  }

  abort(): void {
    if (this.aborted) return;
    this.aborted = true;

    for (const [stage, timer] of this.stageTimers) {
      clearTimeout(timer);
    }
    this.stageTimers.clear();

    this.emit("aborted", {
      requestId: this.requestId,
      totalElapsedMs: Date.now() - this.requestStartTime,
      completedStages: Array.from(this.stageDurations.keys())
    });
  }

  isAborted(): boolean {
    return this.aborted;
  }

  finishRequest(): PipelineLatency {
    const totalDuration = Date.now() - this.requestStartTime;

    const totalTimer = this.stageTimers.get("total");
    if (totalTimer) {
      clearTimeout(totalTimer);
      this.stageTimers.delete("total");
    }

    const latency: PipelineLatency = {
      preprocess: this.stageDurations.get("preprocess") ?? null,
      nlu: this.stageDurations.get("nlu") ?? null,
      retrieval: this.stageDurations.get("retrieval") ?? null,
      rerank: this.stageDurations.get("rerank") ?? null,
      generation: this.stageDurations.get("generation") ?? null,
      postprocess: this.stageDurations.get("postprocess") ?? null,
      total: totalDuration
    };

    this.emit("request_completed", {
      requestId: this.requestId,
      latency,
      aborted: this.aborted
    });

    return latency;
  }

  getRemainingBudget(): number {
    const elapsed = Date.now() - this.requestStartTime;
    return Math.max(0, this.config.total - elapsed);
  }

  getElapsedTime(): number {
    return Date.now() - this.requestStartTime;
  }

  getStageDurations(): Record<StageName, number | null> {
    const result: Record<StageName, number | null> = {
      preprocess: null,
      nlu: null,
      retrieval: null,
      rerank: null,
      generation: null,
      postprocess: null,
      total: null
    };

    for (const [stage, duration] of this.stageDurations) {
      result[stage] = duration;
    }

    return result;
  }
}

export function createWatchdog(
  requestId: string,
  config?: Partial<StageTimeoutConfig>,
  aggressive: boolean = false
): StageWatchdog {
  return new StageWatchdog(requestId, config, aggressive);
}
