import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

// CRITICAL: Validate DATABASE_URL in production
const isProduction = process.env.NODE_ENV === "production";
const databaseUrl = process.env.DATABASE_URL;

if (isProduction && !databaseUrl) {
  console.error("[FATAL] DATABASE_URL is not set in production environment!");
  console.error("[FATAL] The server cannot start without a PostgreSQL database.");
  console.error("[FATAL] Please configure DATABASE_URL in your deployment secrets.");
  console.error("[FATAL] In Replit Deployments: Go to Secrets tab and add DATABASE_URL");
  process.exit(1);
}

if (!databaseUrl) {
  console.warn("[WARNING] DATABASE_URL is not set. Database operations will fail.");
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err: any) => {
  if (err.code === '57P01') {
    console.warn('[DB] Connection terminated by administrator, pool will reconnect automatically');
  } else {
    console.error('[DB] Unexpected error on idle client:', err.message || err);
  }
});

pool.on('connect', () => {
  console.log('[DB] New client connected to pool');
});

// Export pool for raw queries if needed
export { pool };

export const db = drizzle(pool, { schema });

// Function to verify database connection
export async function verifyDatabaseConnection(): Promise<boolean> {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT current_database(), NOW() as server_time');
    client.release();
    console.log(`[DB] Connected to database: ${result.rows[0].current_database}`);
    return true;
  } catch (error: any) {
    console.error('[DB] Failed to connect to database:', error.message);
    if (isProduction) {
      console.error('[FATAL] Cannot start production server without database connection');
      process.exit(1);
    }
    return false;
  }
}
