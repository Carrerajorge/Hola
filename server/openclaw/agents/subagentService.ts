import { randomUUID } from "crypto";
import { AgentRunner } from "../../services/agentRunner";

export type SubagentRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface SubagentRunRecord {
  id: string;
  requesterUserId: string;
  objective: string;
  planHint: string[];
  parentRunId?: string;
  status: SubagentRunStatus;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  result?: unknown;
  error?: string;
}

type SpawnSubagentParams = {
  requesterUserId: string;
  objective: string;
  planHint?: string[];
  parentRunId?: string;
};

type ListRunsParams = {
  requesterUserId?: string;
  parentRunId?: string;
  status?: SubagentRunStatus;
  limit?: number;
};

const MAX_RETENTION_RUNS = 500;

class OpenClawSubagentService {
  private readonly runs = new Map<string, SubagentRunRecord>();
  private readonly runners = new Map<string, AgentRunner>();

  spawn(params: SpawnSubagentParams): SubagentRunRecord {
    const runId = `subagent_${randomUUID()}`;
    const run: SubagentRunRecord = {
      id: runId,
      requesterUserId: params.requesterUserId,
      objective: params.objective,
      planHint: params.planHint || [],
      parentRunId: params.parentRunId,
      status: "queued",
      createdAt: Date.now(),
    };

    this.runs.set(runId, run);
    this.trimRetention();
    void this.execute(runId);
    return run;
  }

  get(runId: string): SubagentRunRecord | undefined {
    return this.runs.get(runId);
  }

  list(params: ListRunsParams = {}): SubagentRunRecord[] {
    const limit = Math.max(1, params.limit || 100);
    return Array.from(this.runs.values())
      .filter((run) => !params.requesterUserId || run.requesterUserId === params.requesterUserId)
      .filter((run) => !params.parentRunId || run.parentRunId === params.parentRunId)
      .filter((run) => !params.status || run.status === params.status)
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, limit);
  }

  cancel(runId: string): boolean {
    const run = this.runs.get(runId);
    if (!run) return false;
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
      return false;
    }

    const runner = this.runners.get(runId);
    if (runner) {
      runner.cancel();
    } else {
      run.status = "cancelled";
      run.endedAt = Date.now();
      this.runs.set(runId, run);
    }
    return true;
  }

  private async execute(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run || run.status === "cancelled") {
      return;
    }

    const runner = new AgentRunner();
    this.runners.set(runId, runner);
    run.status = "running";
    run.startedAt = Date.now();
    this.runs.set(runId, run);

    try {
      const result = await runner.run(run.objective, run.planHint);
      const next = this.runs.get(runId);
      if (!next) return;

      if (result.state.status === "cancelled") {
        next.status = "cancelled";
      } else if (result.success) {
        next.status = "completed";
      } else {
        next.status = "failed";
      }

      next.result = result.result;
      next.error = result.success ? undefined : (result.result as any)?.error;
      next.endedAt = Date.now();
      this.runs.set(runId, next);
    } catch (error: any) {
      const next = this.runs.get(runId);
      if (!next) return;
      next.status = "failed";
      next.error = error?.message || "Subagent execution failed";
      next.endedAt = Date.now();
      this.runs.set(runId, next);
    } finally {
      this.runners.delete(runId);
      this.trimRetention();
    }
  }

  private trimRetention(): void {
    if (this.runs.size <= MAX_RETENTION_RUNS) {
      return;
    }

    const ordered = Array.from(this.runs.values()).sort((left, right) => left.createdAt - right.createdAt);
    const overflow = this.runs.size - MAX_RETENTION_RUNS;
    for (let index = 0; index < overflow; index += 1) {
      this.runs.delete(ordered[index].id);
    }
  }
}

export const openclawSubagentService = new OpenClawSubagentService();
