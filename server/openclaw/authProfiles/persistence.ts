/**
 * Auth Profiles persistence — PostgreSQL-backed CRUD.
 * Ported from upstream OpenClaw v2026.2.24: src/agents/auth-profiles/store.ts
 *
 * Upstream uses JSON file + file locking. We use PostgreSQL + database transactions.
 */

import type { AuthProfileCredential, AuthProfileRow, ProfileUsageStats, AuthProfileSummary } from './types';
import { isProfileInCooldown, resolveUnusableUntil } from './cooldown';
import { Logger } from '../../lib/logger';
import { randomUUID } from 'crypto';

// ── Interface ───────────────────────────────────────────────────────────

export interface IAuthProfilePersistence {
  initialize(): Promise<void>;
  listByProvider(provider: string): Promise<AuthProfileRow[]>;
  getById(id: string): Promise<AuthProfileRow | null>;
  add(provider: string, credential: AuthProfileCredential): Promise<AuthProfileRow>;
  remove(id: string): Promise<boolean>;
  updateUsageStats(id: string, stats: ProfileUsageStats): Promise<void>;
  getAll(): Promise<AuthProfileRow[]>;
}

// ── In-Memory Implementation (for tests + dev) ─────────────────────────

export class InMemoryAuthProfilePersistence implements IAuthProfilePersistence {
  private profiles = new Map<string, AuthProfileRow>();

  async initialize(): Promise<void> {}

  async listByProvider(provider: string): Promise<AuthProfileRow[]> {
    const normalized = provider.toLowerCase();
    return Array.from(this.profiles.values())
      .filter(p => p.provider.toLowerCase() === normalized);
  }

  async getById(id: string): Promise<AuthProfileRow | null> {
    return this.profiles.get(id) ?? null;
  }

  async add(provider: string, credential: AuthProfileCredential): Promise<AuthProfileRow> {
    const now = Date.now();
    const row: AuthProfileRow = {
      id: randomUUID(),
      provider: provider.toLowerCase(),
      credential,
      usageStats: {},
      createdAt: now,
      updatedAt: now,
    };
    this.profiles.set(row.id, row);
    return row;
  }

  async remove(id: string): Promise<boolean> {
    return this.profiles.delete(id);
  }

  async updateUsageStats(id: string, stats: ProfileUsageStats): Promise<void> {
    const row = this.profiles.get(id);
    if (row) {
      row.usageStats = stats;
      row.updatedAt = Date.now();
    }
  }

  async getAll(): Promise<AuthProfileRow[]> {
    return Array.from(this.profiles.values());
  }
}

// ── PostgreSQL Implementation ───────────────────────────────────────────

export class PostgresAuthProfilePersistence implements IAuthProfilePersistence {
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const { pool } = await import('../../db');

      await pool.query(`
        CREATE TABLE IF NOT EXISTS openclaw_auth_profiles (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          credential JSONB NOT NULL,
          usage_stats JSONB NOT NULL DEFAULT '{}',
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_auth_profiles_provider
          ON openclaw_auth_profiles (provider)
      `);

      this.initialized = true;
      Logger.info('[AuthProfiles:Persistence] PostgreSQL table ready');
    } catch (err) {
      Logger.error(`[AuthProfiles:Persistence] Init failed: ${(err as Error).message}`);
      throw err;
    }
  }

  async listByProvider(provider: string): Promise<AuthProfileRow[]> {
    const { pool } = await import('../../db');
    const result = await pool.query(
      'SELECT * FROM openclaw_auth_profiles WHERE provider = $1 ORDER BY created_at',
      [provider.toLowerCase()],
    );
    return result.rows.map(rowToProfile);
  }

  async getById(id: string): Promise<AuthProfileRow | null> {
    const { pool } = await import('../../db');
    const result = await pool.query(
      'SELECT * FROM openclaw_auth_profiles WHERE id = $1',
      [id],
    );
    return result.rows[0] ? rowToProfile(result.rows[0]) : null;
  }

  async add(provider: string, credential: AuthProfileCredential): Promise<AuthProfileRow> {
    const { pool } = await import('../../db');
    const id = randomUUID();
    const now = Date.now();

    await pool.query(
      `INSERT INTO openclaw_auth_profiles (id, provider, credential, usage_stats, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, provider.toLowerCase(), JSON.stringify(credential), '{}', now, now],
    );

    return {
      id,
      provider: provider.toLowerCase(),
      credential,
      usageStats: {},
      createdAt: now,
      updatedAt: now,
    };
  }

  async remove(id: string): Promise<boolean> {
    const { pool } = await import('../../db');
    const result = await pool.query(
      'DELETE FROM openclaw_auth_profiles WHERE id = $1',
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async updateUsageStats(id: string, stats: ProfileUsageStats): Promise<void> {
    const { pool } = await import('../../db');
    await pool.query(
      `UPDATE openclaw_auth_profiles SET usage_stats = $1, updated_at = $2 WHERE id = $3`,
      [JSON.stringify(stats), Date.now(), id],
    );
  }

  async getAll(): Promise<AuthProfileRow[]> {
    const { pool } = await import('../../db');
    const result = await pool.query(
      'SELECT * FROM openclaw_auth_profiles ORDER BY created_at',
    );
    return result.rows.map(rowToProfile);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function rowToProfile(row: any): AuthProfileRow {
  return {
    id: row.id,
    provider: row.provider,
    credential: typeof row.credential === 'string' ? JSON.parse(row.credential) : row.credential,
    usageStats: typeof row.usage_stats === 'string' ? JSON.parse(row.usage_stats) : (row.usage_stats ?? {}),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

/** Convert an AuthProfileRow to a summary for listing */
export function profileToSummary(row: AuthProfileRow): AuthProfileSummary {
  return {
    id: row.id,
    provider: row.provider,
    type: row.credential.type,
    email: row.credential.email,
    inCooldown: isProfileInCooldown(row.usageStats),
    cooldownUntil: resolveUnusableUntil(row.usageStats) ?? undefined,
    errorCount: row.usageStats.errorCount ?? 0,
    lastUsed: row.usageStats.lastUsed,
  };
}

// ── Factory ─────────────────────────────────────────────────────────────

let singleton: IAuthProfilePersistence | null = null;

export function getAuthProfilePersistence(): IAuthProfilePersistence {
  if (!singleton) {
    const isTest = process.env.NODE_ENV === 'test' || !!process.env.VITEST;
    singleton = isTest
      ? new InMemoryAuthProfilePersistence()
      : new PostgresAuthProfilePersistence();
  }
  return singleton;
}

/** For testing: reset singleton */
export function _resetPersistence(): void {
  singleton = null;
}
