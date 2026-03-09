import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'crypto';
import { AgentRunner } from '../../services/agentRunner';

export type SubagentRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

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

export type SubagentServiceStatus = {
  storePath: string;
  persistRuns: boolean;
  totalRuns: number;
  activeRunners: number;
  counts: Record<SubagentRunStatus, number>;
  lastUpdatedAt: number | null;
};

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

type SubagentRunner = Pick<AgentRunner, 'run' | 'cancel'>;

type CreateOpenClawSubagentServiceOptions = {
  runnerFactory?: () => SubagentRunner;
  storePath?: string;
  persistRuns?: boolean;
  nowMs?: () => number;
};

type SubagentStoreFile = {
  version: 1;
  updatedAt: string;
  runs: SubagentRunRecord[];
};

const MAX_RETENTION_RUNS = 500;

function resolveSubagentStorePath(storePath?: string): string {
  if (typeof storePath === 'string' && storePath.trim().length > 0) {
    return path.resolve(storePath.trim());
  }
  if (process.env.OPENCLAW_SUBAGENT_STORE_PATH?.trim()) {
    return path.resolve(process.env.OPENCLAW_SUBAGENT_STORE_PATH.trim());
  }
  if (process.env.NODE_ENV === 'test') {
    return path.join(os.tmpdir(), 'hola-openclaw', 'subagent-runs.json');
  }
  return path.resolve(process.cwd(), 'output', 'openclaw', 'subagent-runs.json');
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

class OpenClawSubagentService {
  private runs = new Map<string, SubagentRunRecord>();
  private runners = new Map<string, SubagentRunner>();
  private readonly runnerFactory: () => SubagentRunner;
  private readonly storePath: string;
  private readonly persistRuns: boolean;
  private readonly nowMs: () => number;

  constructor(options: CreateOpenClawSubagentServiceOptions = {}) {
    this.runnerFactory = options.runnerFactory ?? (() => new AgentRunner());
    this.storePath = resolveSubagentStorePath(options.storePath);
    this.persistRuns = options.persistRuns ?? true;
    this.nowMs = options.nowMs ?? Date.now;
    this.loadRunsFromDisk();
  }

  spawn(params: SpawnSubagentParams): SubagentRunRecord {
    const runId = `subagent_${randomUUID()}`;
    const run: SubagentRunRecord = {
      id: runId,
      requesterUserId: params.requesterUserId,
      objective: params.objective,
      planHint: params.planHint || [],
      parentRunId: params.parentRunId,
      status: 'queued',
      createdAt: this.nowMs(),
    };
    this.runs.set(runId, run);
    this.trimRetention();
    this.persistRunsToDisk();
    void this.execute(runId);
    return cloneJson(run);
  }

  get(runId: string): SubagentRunRecord | undefined {
    const run = this.runs.get(runId);
    return run ? cloneJson(run) : undefined;
  }

  list(params: ListRunsParams = {}): SubagentRunRecord[] {
    const {
      requesterUserId,
      parentRunId,
      status,
      limit = 100,
    } = params;

    return Array.from(this.runs.values())
      .filter((run) => !requesterUserId || run.requesterUserId === requesterUserId)
      .filter((run) => !parentRunId || run.parentRunId === parentRunId)
      .filter((run) => !status || run.status === status)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.max(1, limit))
      .map((run) => cloneJson(run));
  }

  getStatus(): SubagentServiceStatus {
    const counts: Record<SubagentRunStatus, number> = {
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };

    let lastUpdatedAt: number | null = null;
    for (const run of this.runs.values()) {
      counts[run.status] += 1;
      const candidate = run.endedAt ?? run.startedAt ?? run.createdAt;
      if (lastUpdatedAt == null || candidate > lastUpdatedAt) {
        lastUpdatedAt = candidate;
      }
    }

    return {
      storePath: this.storePath,
      persistRuns: this.persistRuns,
      totalRuns: this.runs.size,
      activeRunners: this.runners.size,
      counts,
      lastUpdatedAt,
    };
  }

  cancel(runId: string): boolean {
    const run = this.runs.get(runId);
    if (!run) {
      return false;
    }

    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      return false;
    }

    const runner = this.runners.get(runId);
    if (runner) {
      runner.cancel();
    } else {
      run.status = 'cancelled';
      run.endedAt = this.nowMs();
      this.runs.set(runId, run);
      this.persistRunsToDisk();
    }
    return true;
  }

  private loadRunsFromDisk(): void {
    if (!this.persistRuns) {
      return;
    }
    try {
      const raw = fs.readFileSync(this.storePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<SubagentStoreFile>;
      if (!parsed || !Array.isArray(parsed.runs)) {
        return;
      }

      const recoveredAt = this.nowMs();
      let mutated = false;
      for (const entry of parsed.runs.slice(0, MAX_RETENTION_RUNS)) {
        const run = cloneJson(entry);
        if (run.status === 'queued' || run.status === 'running') {
          run.status = 'failed';
          run.error = run.error ?? 'Recovered interrupted subagent run after restart';
          run.endedAt = run.endedAt ?? recoveredAt;
          mutated = true;
        }
        this.runs.set(run.id, run);
      }

      this.trimRetention();
      if (mutated) {
        this.persistRunsToDisk();
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') {
        console.warn(
          `[OpenClawSubagentService] Failed to load persisted runs from ${this.storePath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  private persistRunsToDisk(): void {
    if (!this.persistRuns) {
      return;
    }
    try {
      const payload: SubagentStoreFile = {
        version: 1,
        updatedAt: new Date().toISOString(),
        runs: Array.from(this.runs.values())
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, MAX_RETENTION_RUNS)
          .map((run) => cloneJson(run)),
      };
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
      const tmpPath = `${this.storePath}.${process.pid}.${randomUUID()}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.storePath);
    } catch (error) {
      console.warn(
        `[OpenClawSubagentService] Failed to persist runs to ${this.storePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async execute(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run || run.status === 'cancelled') {
      return;
    }

    const runner = this.runnerFactory();
    this.runners.set(runId, runner);
    run.status = 'running';
    run.startedAt = this.nowMs();
    this.runs.set(runId, run);
    this.persistRunsToDisk();

    try {
      const result = await runner.run(run.objective, run.planHint);
      const next = this.runs.get(runId);
      if (!next) {
        return;
      }

      if (result.state.status === 'cancelled') {
        next.status = 'cancelled';
      } else if (result.success) {
        next.status = 'completed';
      } else {
        next.status = 'failed';
      }

      next.result = result.result;
      next.error = result.success ? undefined : (result.result as any)?.error;
      next.endedAt = this.nowMs();
      this.runs.set(runId, next);
    } catch (error: any) {
      const next = this.runs.get(runId);
      if (!next) {
        return;
      }
      next.status = 'failed';
      next.error = error?.message || 'Subagent execution failed';
      next.endedAt = this.nowMs();
      this.runs.set(runId, next);
    } finally {
      this.runners.delete(runId);
      this.trimRetention();
      this.persistRunsToDisk();
    }
  }

  private trimRetention(): void {
    if (this.runs.size <= MAX_RETENTION_RUNS) {
      return;
    }
    const ordered = Array.from(this.runs.values()).sort((a, b) => a.createdAt - b.createdAt);
    const overflow = this.runs.size - MAX_RETENTION_RUNS;
    for (let i = 0; i < overflow; i += 1) {
      this.runs.delete(ordered[i].id);
    }
  }
}

export function createOpenClawSubagentService(
  options: CreateOpenClawSubagentServiceOptions = {},
): OpenClawSubagentService {
  return new OpenClawSubagentService(options);
}

export const openclawSubagentService = createOpenClawSubagentService();
