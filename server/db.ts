import { drizzle } from "drizzle-orm/node-postgres";
import * as pkg from "pg";
import * as schema from "../shared/schema";
import { Registry, Histogram, Counter, Gauge } from 'prom-client';
import { env } from "./config/env";
import { Logger } from "./lib/logger";

const { Pool } = pkg;

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX || (env.NODE_ENV === 'production' ? 20 : 5), // Higher in prod
  min: env.DB_POOL_MIN || 2, // Always keep a few hot
  idleTimeoutMillis: 10000, // Close idle connections faster (10s) to free up resources
  connectionTimeoutMillis: 5000, // Fail fast
  allowExitOnIdle: false,
  application_name: 'michat_server', // Tag connections for PG logs
});

pool.on('error', (err: any) => {
  if (err.code === '57P01') {
    Logger.warn('[DB] Connection terminated by administrator, pool will reconnect automatically');
  } else {
    Logger.error('[DB] Unexpected error on idle client:', err.message || err);
  }
  healthState.consecutiveFailures++;
  updateHealthStatus();
});

pool.on('connect', () => {
  Logger.info('[DB] New client connected to pool');
});

export { pool };

export const db = drizzle(pool, { schema });

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
  let client: pg.PoolClient | null = null;

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

export async function verifyDatabaseConnection(): Promise<boolean> {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT current_database(), NOW() as server_time');
    client.release();
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
