import { createHash } from "node:crypto"; import { readFile } from "node:fs/promises"; import { drizzle } from "drizzle-orm/node-postgres"; import { migrate } from "drizzle-orm/node-postgres/migrator"; import * as pkg from "pg"; import type { PoolClient } from "pg"; import * as schema
  from "../shared/schema"; import { Registry, Histogram, Counter, Gauge } from 'prom-client'; import { env } from "./config/env"; import { Logger } from "./lib/logger";

const { Pool } = pkg;

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX || (env.NODE_ENV === 'production' ? 25 : 5), // Pool Size of at least 20 for pg_bouncer
  min: env.DB_POOL_MIN || 0, // Pg_bouncer handles underlying pool, allow 0 at app level
  idleTimeoutMillis: 3000,   // Close idle connections very fast (3s) to rely on pg_bouncer
  connectionTimeoutMillis: 3000, // Fail extremely fast (3s)
  allowExitOnIdle: false,
  keepAlive: true,           // Required for stability behind TCP load balancing
  application_name: 'iliagpt_server_write',
  // Ensure predictable table resolution and add strict statement timeout for heavy AI traffic
  options: '-c search_path=public -c statement_timeout=15000',
});

// Read Replica Pool (Optional)
const poolRead = env.DATABASE_READ_URL ? new Pool({
  connectionString: env.DATABASE_READ_URL,
  max: env.DB_POOL_MAX || (env.NODE_ENV === 'production' ? 20 : 5),
  min: env.DB_POOL_MIN || 2,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
  allowExitOnIdle: false,
  application_name: 'iliagpt_server_read',
  options: '-c search_path=public',
}) : pool; // Fallback to primary pool if no read replica

pool.on('error', (err: any) => {
  if (err.code === '57P01') {
    Logger.warn('[DB Write] Connection terminated by administrator, pool will reconnect automatically');
  } else {
    Logger.error('[DB Write] Unexpected error on idle client:', err.message || err);
  }
  healthState.consecutiveFailures++;
  updateHealthStatus();
});

if (env.DATABASE_READ_URL) {
  poolRead.on('error', (err: any) => {
    Logger.error('[DB Read] Unexpected error on idle client:', err.message || err);
  });
  poolRead.on('connect', () => {
    Logger.info('[DB Read] New client connected to read pool');
  });
}

pool.on('connect', () => {
  Logger.info('[DB Write] New client connected to pool');
});

export { pool, poolRead };

export const db = drizzle(pool, { schema });
export const dbRead = drizzle(poolRead, { schema });

interface MigrationMetadata {
  hash: string;
  sql: string;
  tag: string;
  when: number;
}

interface MigrationJournalFile {
  entries: Array<{
    tag: string;
    when: number;
  }>;
}

function stripSqlLineComments(statement: string): string {
  return statement
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .trim();
}

function normalizeSqlStatement(statement: string): string {
  return stripSqlLineComments(statement).replace(/\s+/g, " ").trim();
}

function splitMigrationStatements(migrationSql: string): string[] {
  return migrationSql
    .split("--> statement-breakpoint")
    .map((statement) => normalizeSqlStatement(statement))
    .filter(Boolean);
}

async function schemaObjectExists(client: PoolClient, schemaName: string, objectName: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    "SELECT to_regclass(format('%I.%I', $1::text, $2::text)) IS NOT NULL AS exists",
    [schemaName, objectName],
  );
  return Boolean(result.rows[0]?.exists);
}

async function columnExists(
  client: PoolClient,
  schemaName: string,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
        AND column_name = $3
    ) AS exists`,
    [schemaName, tableName, columnName],
  );
  return Boolean(result.rows[0]?.exists);
}

async function constraintExists(
  client: PoolClient,
  schemaName: string,
  tableName: string,
  constraintName: string,
): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = $1
        AND conrelid = to_regclass(format('%I.%I', $2::text, $3::text))
    ) AS exists`,
    [constraintName, schemaName, tableName],
  );
  return Boolean(result.rows[0]?.exists);
}

async function isMigrationStatementApplied(client: PoolClient, statement: string): Promise<boolean> {
  const normalized = normalizeSqlStatement(statement);
  if (!normalized) {
    return false;
  }

  const createTableMatch = normalized.match(/^CREATE TABLE(?: IF NOT EXISTS)? "([^"]+)"/i);
  if (createTableMatch) {
    return schemaObjectExists(client, "public", createTableMatch[1]!);
  }

  const createIndexMatch = normalized.match(/^CREATE (?:UNIQUE )?INDEX(?: IF NOT EXISTS)? "([^"]+)"/i);
  if (createIndexMatch) {
    return schemaObjectExists(client, "public", createIndexMatch[1]!);
  }

  const addColumnMatch = normalized.match(/^ALTER TABLE "([^"]+)" ADD COLUMN(?: IF NOT EXISTS)? "([^"]+)"/i);
  if (addColumnMatch) {
    return columnExists(client, "public", addColumnMatch[1]!, addColumnMatch[2]!);
  }

  const addConstraintMatch = normalized.match(/^ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)"/i);
  if (addConstraintMatch) {
    return constraintExists(client, "public", addConstraintMatch[1]!, addConstraintMatch[2]!);
  }

  return false;
}

function isDuplicateMigrationError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  return code === "42P07" || code === "42710" || code === "42701";
}

async function reconcileMigrationStatement(client: PoolClient, statement: string): Promise<"skipped" | "executed"> {
  if (await isMigrationStatementApplied(client, statement)) {
    return "skipped";
  }

  try {
    await client.query(statement);
    return "executed";
  } catch (error) {
    if (isDuplicateMigrationError(error) && (await isMigrationStatementApplied(client, statement))) {
      return "skipped";
    }
    throw error;
  }
}

async function loadMigrationMetadata(): Promise<MigrationMetadata[]> {
  const journal = JSON.parse(
    await readFile("./migrations/meta/_journal.json", "utf8"),
  ) as MigrationJournalFile;

  const migrations = await Promise.all(
    journal.entries.map(async (entry) => {
      const sql = await readFile(`./migrations/${entry.tag}.sql`, "utf8");
      return {
        hash: createHash("sha256").update(sql).digest("hex"),
        sql,
        tag: entry.tag,
        when: entry.when,
      };
    }),
  );

  migrations.sort((left, right) => left.when - right.when);
  return migrations;
}

async function ensureMigrationJournalBaseline(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS "drizzle";');
    await client.query(`
      CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);

    const existingEntries = await client.query<{ hash: string }>(
      'SELECT "hash" FROM "drizzle"."__drizzle_migrations"',
    );
    const knownHashes = new Set(existingEntries.rows.map((row) => row.hash));

    const migrations = await loadMigrationMetadata();
    for (const migration of migrations) {
      if (knownHashes.has(migration.hash)) {
        continue;
      }

      const statements = splitMigrationStatements(migration.sql);
      let executedStatements = 0;

      await client.query("BEGIN");
      try {
        for (const statement of statements) {
          const result = await reconcileMigrationStatement(client, statement);
          if (result === "executed") {
            executedStatements++;
          }
        }

        await client.query(
          'INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ($1, $2)',
          [migration.hash, migration.when],
        );
        knownHashes.add(migration.hash);

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }

      if (executedStatements > 0) {
        Logger.warn(
          `[DB] Reconciled ${executedStatements} missing statement${executedStatements === 1 ? "" : "s"} while backfilling Drizzle migration ${migration.tag} for an existing schema`,
        );
      }
    }

    Logger.warn(`[DB] Backfilled Drizzle migration journal for an existing schema`);
  } finally {
    client.release();
  }
}

export async function runMigrations(): Promise<void> {
  await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector;");
  await ensureMigrationJournalBaseline();
  await migrate(db, { migrationsFolder: "./migrations" });
}

export type HealthStatus = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';

interface HealthState {
  status: HealthStatus;
  lastCheck: Date | null;
  latencyMs: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  isReconnecting: boolean;
  reconnectAttempts: number;
}

interface HealthCheckResult {
  status: HealthStatus;
  lastCheck: Date | null;
  latencyMs: number;
  consecutiveFailures: number;
}

const HEALTH_CHECK_INTERVAL_MS = 30000;
const HEALTH_CHECK_TIMEOUT_MS = 5000;
const HEALTHY_THRESHOLD = 3;
const MAX_RECONNECT_DELAY_MS = 30000;
const INITIAL_RECONNECT_DELAY_MS = 1000;

let healthCheckIntervalId: NodeJS.Timeout | null = null;
let reconnectTimeoutId: NodeJS.Timeout | null = null;
let isShuttingDown = false;

const healthState: HealthState = {
  status: 'HEALTHY',
  lastCheck: null,
  latencyMs: 0,
  consecutiveFailures: 0,
  consecutiveSuccesses: 0,
  isReconnecting: false,
  reconnectAttempts: 0,
};

const dbMetricsRegistry = new Registry();

const dbHealthStatusGauge = new Gauge({
  name: 'db_health_status',
  help: 'Database health status (0=unhealthy, 1=degraded, 2=healthy)',
  registers: [dbMetricsRegistry],
});

const dbQueryLatencyHistogram = new Histogram({
  name: 'db_query_latency_ms',
  help: 'Database query latency in milliseconds',
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [dbMetricsRegistry],
});

const dbConnectionFailuresCounter = new Counter({
  name: 'db_connection_failures_total',
  help: 'Total number of database connection failures',
  registers: [dbMetricsRegistry],
});

function updateHealthStatus(): void {
  let newStatus: HealthStatus;

  if (healthState.consecutiveFailures >= 3) {
    newStatus = 'UNHEALTHY';
  } else if (healthState.consecutiveFailures >= 1) {
    newStatus = 'DEGRADED';
  } else if (healthState.consecutiveSuccesses >= HEALTHY_THRESHOLD) {
    newStatus = 'HEALTHY';
  } else {
    newStatus = healthState.status;
  }

  if (newStatus !== healthState.status) {
    console.log(`[DB Health] Status changed: ${healthState.status} -> ${newStatus}`);
  }
  healthState.status = newStatus;

  const statusValue = newStatus === 'HEALTHY' ? 2 : newStatus === 'DEGRADED' ? 1 : 0;
  dbHealthStatusGauge.set(statusValue);
}

async function performHealthCheck(): Promise<boolean> {
  if (isShuttingDown) {
    return false;
  }

  const startTime = Date.now();
  let client: PoolClient | null = null;

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Health check timeout')), HEALTH_CHECK_TIMEOUT_MS);
    });

    const queryPromise = (async () => {
      client = await pool.connect();
      await client.query('SELECT 1');
      return true;
    })();

    await Promise.race([queryPromise, timeoutPromise]);

    const latencyMs = Date.now() - startTime;
    healthState.latencyMs = latencyMs;
    healthState.lastCheck = new Date();
    healthState.consecutiveFailures = 0;
    healthState.consecutiveSuccesses++;
    healthState.isReconnecting = false;
    healthState.reconnectAttempts = 0;

    dbQueryLatencyHistogram.observe(latencyMs);
    updateHealthStatus();

    console.log(`[DB Health] Check OK - ${latencyMs}ms (status: ${healthState.status})`);
    return true;

  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    healthState.latencyMs = latencyMs;
    healthState.lastCheck = new Date();
    healthState.consecutiveFailures++;
    healthState.consecutiveSuccesses = 0;

    dbConnectionFailuresCounter.inc();
    dbQueryLatencyHistogram.observe(latencyMs);
    updateHealthStatus();

    console.error(`[DB Health] Check FAILED - ${error.message} (failures: ${healthState.consecutiveFailures}, status: ${healthState.status})`);

    if (healthState.status === 'UNHEALTHY' && !healthState.isReconnecting) {
      scheduleReconnect();
    }

    return false;

  } finally {
    if (client) {
      try {
        (client as any).release();
      } catch (e) {
      }
    }
  }
}

function calculateBackoffDelay(): number {
  const baseDelay = INITIAL_RECONNECT_DELAY_MS;
  const exponentialDelay = baseDelay * Math.pow(2, healthState.reconnectAttempts);
  return Math.min(exponentialDelay, MAX_RECONNECT_DELAY_MS);
}

async function attemptReconnect(): Promise<void> {
  if (isShuttingDown) {
    healthState.isReconnecting = false;
    return;
  }

  healthState.reconnectAttempts++;
  const delay = calculateBackoffDelay();

  console.log(`[DB Health] Attempting reconnection (attempt ${healthState.reconnectAttempts}, delay: ${delay}ms)`);

  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();

    console.log(`[DB Health] Reconnection successful after ${healthState.reconnectAttempts} attempts`);
    healthState.isReconnecting = false;
    healthState.consecutiveFailures = 0;
    healthState.consecutiveSuccesses = 1;
    healthState.reconnectAttempts = 0;
    updateHealthStatus();

  } catch (error: any) {
    console.error(`[DB Health] Reconnection failed: ${error.message}`);
    dbConnectionFailuresCounter.inc();

    if (!isShuttingDown && healthState.status === 'UNHEALTHY') {
      scheduleReconnect();
    }
  }
}

function scheduleReconnect(): void {
  if (isShuttingDown || reconnectTimeoutId) {
    return;
  }

  healthState.isReconnecting = true;
  const delay = calculateBackoffDelay();

  console.log(`[DB Health] Scheduling reconnection in ${delay}ms`);

  reconnectTimeoutId = setTimeout(() => {
    reconnectTimeoutId = null;
    attemptReconnect();
  }, delay);
}

export function getHealthStatus(): HealthCheckResult {
  return {
    status: healthState.status,
    lastCheck: healthState.lastCheck,
    latencyMs: healthState.latencyMs,
    consecutiveFailures: healthState.consecutiveFailures,
  };
}

export function isHealthy(): boolean {
  return healthState.status === 'HEALTHY';
}

export async function waitForHealthy(timeoutMs: number = 30000): Promise<boolean> {
  if (healthState.status === 'HEALTHY') {
    return true;
  }

  const startTime = Date.now();
  const pollInterval = 1000;

  return new Promise((resolve) => {
    const checkHealth = () => {
      if (healthState.status === 'HEALTHY') {
        resolve(true);
        return;
      }

      if (Date.now() - startTime >= timeoutMs) {
        resolve(false);
        return;
      }

      setTimeout(checkHealth, pollInterval);
    };

    checkHealth();
  });
}

export function startHealthChecks(): void {
  if (healthCheckIntervalId) {
    console.log('[DB Health] Health checks already running');
    return;
  }

  console.log(`[DB Health] Starting periodic health checks (interval: ${HEALTH_CHECK_INTERVAL_MS}ms)`);

  performHealthCheck();

  healthCheckIntervalId = setInterval(() => {
    performHealthCheck();
  }, HEALTH_CHECK_INTERVAL_MS);

  healthCheckIntervalId.unref();
}

export function stopHealthChecks(): void {
  console.log('[DB Health] Stopping health checks');
  isShuttingDown = true;

  if (healthCheckIntervalId) {
    clearInterval(healthCheckIntervalId);
    healthCheckIntervalId = null;
  }

  if (reconnectTimeoutId) {
    clearTimeout(reconnectTimeoutId);
    reconnectTimeoutId = null;
  }
}

export async function drainConnections(): Promise<void> {
  console.log('[DB Health] Draining database connections');

  try {
    await pool.end();
    console.log('[DB Health] All database connections drained');
  } catch (error: any) {
    console.error('[DB Health] Error draining connections:', error.message);
  }
}

export function getDbMetrics(): Registry {
  return dbMetricsRegistry;
}

export async function getDbMetricsText(): Promise<string> {
  return dbMetricsRegistry.metrics();
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: { label: string; retries: number; delayMs: number; maxDelayMs: number }
): Promise<T> {
  let attempt = 0;
  let delay = opts.delayMs;
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      attempt += 1;
      const msg = err?.message || String(err);
      console.warn(`[Startup] ${opts.label} failed (${attempt}/${opts.retries}): ${msg}`);
      if (attempt >= opts.retries) throw err;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(opts.maxDelayMs, Math.round(delay * 1.6));
    }
  }
}

export async function verifyDatabaseConnection(): Promise<boolean> {
  try {
    const result = await retryWithBackoff(
      async () => {
        const client = await pool.connect();
        try {
          return await client.query('SELECT current_database(), NOW() as server_time');
        } finally {
          client.release();
        }
      },
      { label: "DB connect", retries: 10, delayMs: 300, maxDelayMs: 3000 }
    );

    console.log(`[DB] Connected to database: ${result.rows[0].current_database}`);

    healthState.consecutiveSuccesses = HEALTHY_THRESHOLD;
    healthState.status = 'HEALTHY';
    updateHealthStatus();

    return true;
  } catch (error: any) {
    console.error('[DB] Failed to connect to database:', error.message);
    healthState.consecutiveFailures++;
    updateHealthStatus();

    if (env.NODE_ENV === "production") {
      console.error('[FATAL] Cannot start production server without database connection');
      process.exit(1);
    }
    return false;
  }
}
