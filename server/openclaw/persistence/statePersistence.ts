import { Logger } from '../../lib/logger';
import type { SubagentRunRecord, SubagentRunStatus } from '../agents/subagentService';

/**
 * OpenClaw State Persistence Layer
 *
 * Provides durable storage for agent/subagent run state. Uses the existing
 * PostgreSQL database (via Drizzle ORM) when available, falling back to
 * an in-memory store for development/testing.
 *
 * The persistence layer is consumed by:
 * - SubagentService (run records)
 * - AgentOrchestrator (graph state checkpoints)
 * - Session Manager (session metadata)
 */

// ── Interfaces ────────────────────────────────────────────────────────────

export interface AgentRunPersisted {
  id: string;
  userId: string;
  objective: string;
  planHint: string[];
  parentRunId?: string;
  status: SubagentRunStatus;
  result?: unknown;
  error?: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  metadata?: Record<string, unknown>;
}

export interface GraphCheckpoint {
  runId: string;
  state: string; // IDLE | PLAN | ACT | VERIFY | DONE | ...
  transitionHistory: Array<{ from: string; to: string; trigger: string; timestamp: number }>;
  plan?: unknown;
  metrics?: Record<string, number>;
  updatedAt: number;
}

export interface IStatePersistence {
  // Agent runs
  saveRun(run: AgentRunPersisted): Promise<void>;
  getRun(runId: string): Promise<AgentRunPersisted | null>;
  listRuns(opts: { userId?: string; parentRunId?: string; status?: SubagentRunStatus; limit?: number }): Promise<AgentRunPersisted[]>;
  updateRunStatus(runId: string, status: SubagentRunStatus, extra?: Partial<AgentRunPersisted>): Promise<void>;

  // Graph checkpoints
  saveCheckpoint(checkpoint: GraphCheckpoint): Promise<void>;
  getCheckpoint(runId: string): Promise<GraphCheckpoint | null>;
  deleteCheckpoint(runId: string): Promise<void>;
}

// ── In-Memory Implementation (fallback) ───────────────────────────────────

const MAX_MEMORY_RUNS = 500;

class InMemoryStatePersistence implements IStatePersistence {
  private runs = new Map<string, AgentRunPersisted>();
  private checkpoints = new Map<string, GraphCheckpoint>();

  async saveRun(run: AgentRunPersisted): Promise<void> {
    this.runs.set(run.id, { ...run });
    this.trimRuns();
  }

  async getRun(runId: string): Promise<AgentRunPersisted | null> {
    return this.runs.get(runId) ?? null;
  }

  async listRuns(opts: {
    userId?: string;
    parentRunId?: string;
    status?: SubagentRunStatus;
    limit?: number;
  }): Promise<AgentRunPersisted[]> {
    return Array.from(this.runs.values())
      .filter(r => !opts.userId || r.userId === opts.userId)
      .filter(r => !opts.parentRunId || r.parentRunId === opts.parentRunId)
      .filter(r => !opts.status || r.status === opts.status)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, opts.limit || 100);
  }

  async updateRunStatus(runId: string, status: SubagentRunStatus, extra?: Partial<AgentRunPersisted>): Promise<void> {
    const existing = this.runs.get(runId);
    if (!existing) return;
    this.runs.set(runId, { ...existing, ...extra, status });
  }

  async saveCheckpoint(checkpoint: GraphCheckpoint): Promise<void> {
    this.checkpoints.set(checkpoint.runId, { ...checkpoint });
  }

  async getCheckpoint(runId: string): Promise<GraphCheckpoint | null> {
    return this.checkpoints.get(runId) ?? null;
  }

  async deleteCheckpoint(runId: string): Promise<void> {
    this.checkpoints.delete(runId);
  }

  private trimRuns(): void {
    if (this.runs.size <= MAX_MEMORY_RUNS) return;
    const ordered = Array.from(this.runs.entries()).sort((a, b) => a[1].createdAt - b[1].createdAt);
    const overflow = this.runs.size - MAX_MEMORY_RUNS;
    for (let i = 0; i < overflow; i++) {
      this.runs.delete(ordered[i][0]);
    }
  }
}

// ── PostgreSQL Implementation (Drizzle ORM) ───────────────────────────────

class PostgresStatePersistence implements IStatePersistence {
  private db: any;
  private initialized = false;

  constructor(db: any) {
    this.db = db;
  }

  private async ensureTable(): Promise<void> {
    if (this.initialized) return;
    try {
      // Create tables if they don't exist (safe with IF NOT EXISTS)
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS openclaw_agent_runs (
          id VARCHAR(128) PRIMARY KEY,
          user_id VARCHAR(256) NOT NULL,
          objective TEXT NOT NULL,
          plan_hint JSONB DEFAULT '[]',
          parent_run_id VARCHAR(128),
          status VARCHAR(32) NOT NULL DEFAULT 'queued',
          result JSONB,
          error TEXT,
          metadata JSONB,
          created_at BIGINT NOT NULL,
          started_at BIGINT,
          ended_at BIGINT,
          CONSTRAINT fk_parent_run FOREIGN KEY (parent_run_id)
            REFERENCES openclaw_agent_runs(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_oclw_runs_user ON openclaw_agent_runs(user_id);
        CREATE INDEX IF NOT EXISTS idx_oclw_runs_status ON openclaw_agent_runs(status);
        CREATE INDEX IF NOT EXISTS idx_oclw_runs_parent ON openclaw_agent_runs(parent_run_id);

        CREATE TABLE IF NOT EXISTS openclaw_graph_checkpoints (
          run_id VARCHAR(128) PRIMARY KEY,
          state VARCHAR(32) NOT NULL,
          transition_history JSONB DEFAULT '[]',
          plan JSONB,
          metrics JSONB,
          updated_at BIGINT NOT NULL
        );
      `);
      this.initialized = true;
      Logger.info('[OpenClaw:Persistence] PostgreSQL tables ensured');
    } catch (err) {
      Logger.warn(`[OpenClaw:Persistence] Table creation warning: ${(err as Error).message}`);
      this.initialized = true; // Don't retry repeatedly
    }
  }

  async saveRun(run: AgentRunPersisted): Promise<void> {
    await this.ensureTable();
    await this.db.execute(
      `INSERT INTO openclaw_agent_runs (id, user_id, objective, plan_hint, parent_run_id, status, result, error, metadata, created_at, started_at, ended_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         result = EXCLUDED.result,
         error = EXCLUDED.error,
         metadata = EXCLUDED.metadata,
         started_at = EXCLUDED.started_at,
         ended_at = EXCLUDED.ended_at`,
      [
        run.id, run.userId, run.objective, JSON.stringify(run.planHint),
        run.parentRunId || null, run.status,
        run.result ? JSON.stringify(run.result) : null,
        run.error || null,
        run.metadata ? JSON.stringify(run.metadata) : null,
        run.createdAt, run.startedAt || null, run.endedAt || null,
      ],
    );
  }

  async getRun(runId: string): Promise<AgentRunPersisted | null> {
    await this.ensureTable();
    const result = await this.db.execute(
      `SELECT * FROM openclaw_agent_runs WHERE id = $1 LIMIT 1`,
      [runId],
    );
    const row = result.rows?.[0];
    if (!row) return null;
    return this.rowToRun(row);
  }

  async listRuns(opts: {
    userId?: string;
    parentRunId?: string;
    status?: SubagentRunStatus;
    limit?: number;
  }): Promise<AgentRunPersisted[]> {
    await this.ensureTable();
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    if (opts.userId) {
      conditions.push(`user_id = $${paramIdx++}`);
      params.push(opts.userId);
    }
    if (opts.parentRunId) {
      conditions.push(`parent_run_id = $${paramIdx++}`);
      params.push(opts.parentRunId);
    }
    if (opts.status) {
      conditions.push(`status = $${paramIdx++}`);
      params.push(opts.status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = opts.limit || 100;

    const result = await this.db.execute(
      `SELECT * FROM openclaw_agent_runs ${where} ORDER BY created_at DESC LIMIT $${paramIdx}`,
      [...params, limit],
    );

    return (result.rows || []).map((row: any) => this.rowToRun(row));
  }

  async updateRunStatus(runId: string, status: SubagentRunStatus, extra?: Partial<AgentRunPersisted>): Promise<void> {
    await this.ensureTable();
    const sets = ['status = $2'];
    const params: any[] = [runId, status];
    let paramIdx = 3;

    if (extra?.result !== undefined) {
      sets.push(`result = $${paramIdx++}`);
      params.push(JSON.stringify(extra.result));
    }
    if (extra?.error !== undefined) {
      sets.push(`error = $${paramIdx++}`);
      params.push(extra.error);
    }
    if (extra?.startedAt !== undefined) {
      sets.push(`started_at = $${paramIdx++}`);
      params.push(extra.startedAt);
    }
    if (extra?.endedAt !== undefined) {
      sets.push(`ended_at = $${paramIdx++}`);
      params.push(extra.endedAt);
    }

    await this.db.execute(
      `UPDATE openclaw_agent_runs SET ${sets.join(', ')} WHERE id = $1`,
      params,
    );
  }

  async saveCheckpoint(checkpoint: GraphCheckpoint): Promise<void> {
    await this.ensureTable();
    await this.db.execute(
      `INSERT INTO openclaw_graph_checkpoints (run_id, state, transition_history, plan, metrics, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (run_id) DO UPDATE SET
         state = EXCLUDED.state,
         transition_history = EXCLUDED.transition_history,
         plan = EXCLUDED.plan,
         metrics = EXCLUDED.metrics,
         updated_at = EXCLUDED.updated_at`,
      [
        checkpoint.runId, checkpoint.state,
        JSON.stringify(checkpoint.transitionHistory),
        checkpoint.plan ? JSON.stringify(checkpoint.plan) : null,
        checkpoint.metrics ? JSON.stringify(checkpoint.metrics) : null,
        checkpoint.updatedAt,
      ],
    );
  }

  async getCheckpoint(runId: string): Promise<GraphCheckpoint | null> {
    await this.ensureTable();
    const result = await this.db.execute(
      `SELECT * FROM openclaw_graph_checkpoints WHERE run_id = $1 LIMIT 1`,
      [runId],
    );
    const row = result.rows?.[0];
    if (!row) return null;
    return {
      runId: row.run_id,
      state: row.state,
      transitionHistory: typeof row.transition_history === 'string'
        ? JSON.parse(row.transition_history) : (row.transition_history || []),
      plan: row.plan ? (typeof row.plan === 'string' ? JSON.parse(row.plan) : row.plan) : undefined,
      metrics: row.metrics ? (typeof row.metrics === 'string' ? JSON.parse(row.metrics) : row.metrics) : undefined,
      updatedAt: Number(row.updated_at),
    };
  }

  async deleteCheckpoint(runId: string): Promise<void> {
    await this.ensureTable();
    await this.db.execute(`DELETE FROM openclaw_graph_checkpoints WHERE run_id = $1`, [runId]);
  }

  private rowToRun(row: any): AgentRunPersisted {
    return {
      id: row.id,
      userId: row.user_id,
      objective: row.objective,
      planHint: typeof row.plan_hint === 'string' ? JSON.parse(row.plan_hint) : (row.plan_hint || []),
      parentRunId: row.parent_run_id || undefined,
      status: row.status as SubagentRunStatus,
      result: row.result ? (typeof row.result === 'string' ? JSON.parse(row.result) : row.result) : undefined,
      error: row.error || undefined,
      metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : undefined,
      createdAt: Number(row.created_at),
      startedAt: row.started_at ? Number(row.started_at) : undefined,
      endedAt: row.ended_at ? Number(row.ended_at) : undefined,
    };
  }
}

// ── Singleton Factory ─────────────────────────────────────────────────────

let _instance: IStatePersistence | null = null;

export function getStatePersistence(): IStatePersistence {
  if (_instance) return _instance;

  try {
    // Try to use the existing Drizzle db connection
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { db } = require('../../db');
    if (db) {
      _instance = new PostgresStatePersistence(db);
      Logger.info('[OpenClaw:Persistence] Using PostgreSQL persistence');
      return _instance;
    }
  } catch {
    // DB not available
  }

  _instance = new InMemoryStatePersistence();
  Logger.info('[OpenClaw:Persistence] Using in-memory persistence (no DB available)');
  return _instance;
}

/** Reset singleton (useful for tests) */
export function resetStatePersistence(): void {
  _instance = null;
}
