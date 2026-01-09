import { db } from "../db";
import { pareIdempotencyKeys, type PareIdempotencyStatus } from "@shared/schema";
import { eq, lt, sql, and } from "drizzle-orm";
import crypto from "crypto";

export type IdempotencyCheckResult = 
  | { status: 'new' }
  | { status: 'processing' }
  | { status: 'completed'; cachedResponse: Record<string, unknown> }
  | { status: 'conflict' };

const TTL_HOURS = 24;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

let cleanupIntervalId: NodeJS.Timeout | null = null;

export function computePayloadHash(body: unknown): string {
  const normalized = JSON.stringify(body);
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

export async function checkIdempotencyKey(
  key: string,
  payloadHash: string
): Promise<IdempotencyCheckResult> {
  const expiresAt = new Date(Date.now() + TTL_HOURS * 60 * 60 * 1000);
  
  try {
    const insertResult = await db.execute(sql`
      INSERT INTO pare_idempotency_keys (idempotency_key, payload_hash, status, expires_at)
      VALUES (${key}, ${payloadHash}, 'processing', ${expiresAt})
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id
    `);
    
    if (insertResult.rowCount && insertResult.rowCount > 0) {
      console.log(JSON.stringify({
        level: "info",
        event: "IDEMPOTENCY_KEY_CREATED",
        key,
        payloadHash: payloadHash.substring(0, 16) + "...",
        timestamp: new Date().toISOString()
      }));
      return { status: 'new' };
    }
    
    const existing = await db.query.pareIdempotencyKeys.findFirst({
      where: eq(pareIdempotencyKeys.idempotencyKey, key)
    });
    
    if (!existing) {
      console.error(JSON.stringify({
        level: "error",
        event: "IDEMPOTENCY_KEY_RACE_CONDITION",
        key,
        message: "Insert failed but no existing record found",
        timestamp: new Date().toISOString()
      }));
      return { status: 'new' };
    }
    
    if (existing.payloadHash !== payloadHash) {
      console.log(JSON.stringify({
        level: "warn",
        event: "IDEMPOTENCY_CONFLICT",
        key,
        existingHash: existing.payloadHash.substring(0, 16) + "...",
        newHash: payloadHash.substring(0, 16) + "...",
        timestamp: new Date().toISOString()
      }));
      return { status: 'conflict' };
    }
    
    if (existing.status === 'completed' && existing.responseJson) {
      console.log(JSON.stringify({
        level: "info",
        event: "IDEMPOTENCY_CACHE_HIT",
        key,
        timestamp: new Date().toISOString()
      }));
      return { status: 'completed', cachedResponse: existing.responseJson as Record<string, unknown> };
    }
    
    if (existing.status === 'processing') {
      console.log(JSON.stringify({
        level: "info",
        event: "IDEMPOTENCY_IN_PROGRESS",
        key,
        createdAt: existing.createdAt,
        timestamp: new Date().toISOString()
      }));
      return { status: 'processing' };
    }
    
    if (existing.status === 'failed') {
      await db
        .update(pareIdempotencyKeys)
        .set({ status: 'processing', expiresAt })
        .where(eq(pareIdempotencyKeys.idempotencyKey, key));
      
      console.log(JSON.stringify({
        level: "info",
        event: "IDEMPOTENCY_RETRY_AFTER_FAILURE",
        key,
        timestamp: new Date().toISOString()
      }));
      return { status: 'new' };
    }
    
    return { status: 'new' };
  } catch (error: any) {
    console.error(JSON.stringify({
      level: "error",
      event: "IDEMPOTENCY_CHECK_ERROR",
      key,
      error: error.message,
      timestamp: new Date().toISOString()
    }));
    throw error;
  }
}

export async function completeIdempotencyKey(
  key: string,
  response: Record<string, unknown>
): Promise<void> {
  try {
    await db
      .update(pareIdempotencyKeys)
      .set({
        status: 'completed' as PareIdempotencyStatus,
        responseJson: response
      })
      .where(eq(pareIdempotencyKeys.idempotencyKey, key));
    
    console.log(JSON.stringify({
      level: "info",
      event: "IDEMPOTENCY_KEY_COMPLETED",
      key,
      timestamp: new Date().toISOString()
    }));
  } catch (error: any) {
    console.error(JSON.stringify({
      level: "error",
      event: "IDEMPOTENCY_COMPLETE_ERROR",
      key,
      error: error.message,
      timestamp: new Date().toISOString()
    }));
    throw error;
  }
}

export async function failIdempotencyKey(
  key: string,
  error: string
): Promise<void> {
  try {
    await db
      .update(pareIdempotencyKeys)
      .set({
        status: 'failed' as PareIdempotencyStatus,
        responseJson: { error, failedAt: new Date().toISOString() }
      })
      .where(eq(pareIdempotencyKeys.idempotencyKey, key));
    
    console.log(JSON.stringify({
      level: "info",
      event: "IDEMPOTENCY_KEY_FAILED",
      key,
      error,
      timestamp: new Date().toISOString()
    }));
  } catch (dbError: any) {
    console.error(JSON.stringify({
      level: "error",
      event: "IDEMPOTENCY_FAIL_ERROR",
      key,
      originalError: error,
      dbError: dbError.message,
      timestamp: new Date().toISOString()
    }));
  }
}

export async function cleanupExpiredKeys(): Promise<number> {
  try {
    const now = new Date();
    const result = await db
      .delete(pareIdempotencyKeys)
      .where(lt(pareIdempotencyKeys.expiresAt, now));
    
    const deletedCount = result.rowCount || 0;
    
    if (deletedCount > 0) {
      console.log(JSON.stringify({
        level: "info",
        event: "IDEMPOTENCY_CLEANUP",
        deletedCount,
        timestamp: now.toISOString()
      }));
    }
    
    return deletedCount;
  } catch (error: any) {
    console.error(JSON.stringify({
      level: "error",
      event: "IDEMPOTENCY_CLEANUP_ERROR",
      error: error.message,
      timestamp: new Date().toISOString()
    }));
    return 0;
  }
}

export function startCleanupScheduler(): void {
  if (cleanupIntervalId) {
    return;
  }
  
  cleanupIntervalId = setInterval(async () => {
    await cleanupExpiredKeys();
  }, CLEANUP_INTERVAL_MS);
  
  console.log(JSON.stringify({
    level: "info",
    event: "IDEMPOTENCY_CLEANUP_SCHEDULER_STARTED",
    intervalMs: CLEANUP_INTERVAL_MS,
    timestamp: new Date().toISOString()
  }));
}

export function stopCleanupScheduler(): void {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
    
    console.log(JSON.stringify({
      level: "info",
      event: "IDEMPOTENCY_CLEANUP_SCHEDULER_STOPPED",
      timestamp: new Date().toISOString()
    }));
  }
}

export async function getIdempotencyKeyStats(): Promise<{
  total: number;
  processing: number;
  completed: number;
  failed: number;
  expired: number;
}> {
  const now = new Date();
  
  const [allKeys] = await Promise.all([
    db.query.pareIdempotencyKeys.findMany()
  ]);
  
  const stats = {
    total: allKeys.length,
    processing: 0,
    completed: 0,
    failed: 0,
    expired: 0
  };
  
  for (const key of allKeys) {
    if (key.expiresAt < now) {
      stats.expired++;
    } else if (key.status === 'processing') {
      stats.processing++;
    } else if (key.status === 'completed') {
      stats.completed++;
    } else if (key.status === 'failed') {
      stats.failed++;
    }
  }
  
  return stats;
}
