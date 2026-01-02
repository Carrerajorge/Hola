import { db } from "../db";
import { agentModeRuns, agentModeSteps } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

export interface OptimisticLockResult {
  success: boolean;
  error?: string;
  currentVersion?: number;
}

export async function updateRunWithLock(
  runId: string,
  expectedStatus: string,
  updates: Partial<typeof agentModeRuns.$inferInsert>
): Promise<OptimisticLockResult> {
  try {
    const result = await db.update(agentModeRuns)
      .set(updates)
      .where(and(
        eq(agentModeRuns.id, runId),
        eq(agentModeRuns.status, expectedStatus)
      ))
      .returning();
    
    if (result.length === 0) {
      const [current] = await db.select({ status: agentModeRuns.status })
        .from(agentModeRuns)
        .where(eq(agentModeRuns.id, runId));
      
      return {
        success: false,
        error: `Optimistic lock failed: expected status '${expectedStatus}', current is '${current?.status || "not found"}'`,
      };
    }
    
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function executeInTransaction<T>(
  operation: () => Promise<T>
): Promise<{ success: boolean; data?: T; error?: string }> {
  try {
    const result = await db.transaction(async (tx) => {
      return await operation();
    });
    return { success: true, data: result };
  } catch (error: any) {
    console.error("[DBTransaction] Transaction failed:", error.message);
    return { success: false, error: error.message };
  }
}

export async function acquireRunLock(runId: string, lockDurationMs: number = 30000): Promise<boolean> {
  const lockTimeoutMs = Math.min(lockDurationMs, 5000);
  
  try {
    await db.execute(sql`SET LOCAL lock_timeout = ${lockTimeoutMs}`);
    
    const result = await db.execute(
      sql`SELECT id FROM agent_mode_runs WHERE id = ${runId} FOR UPDATE NOWAIT`
    );
    
    if (!result || (result as any).length === 0) {
      console.warn(`[DBTransaction] Run ${runId} not found for lock`);
      return false;
    }
    
    console.log(`[DBTransaction] Acquired row lock for run ${runId}`);
    return true;
  } catch (error: any) {
    if (error.code === '55P03') {
      console.warn(`[DBTransaction] Lock contention for run ${runId}: already locked`);
      return false;
    }
    console.error(`[DBTransaction] Failed to acquire lock for run ${runId}:`, error.message);
    return false;
  }
}

export async function tryAcquireAdvisoryLock(lockId: number): Promise<boolean> {
  try {
    const result = await db.execute(sql`SELECT pg_try_advisory_lock(${lockId}) as acquired`);
    const acquired = (result as any)?.[0]?.acquired;
    return acquired === true;
  } catch (error) {
    console.error(`[DBTransaction] Advisory lock error:`, error);
    return false;
  }
}

export async function releaseAdvisoryLock(lockId: number): Promise<void> {
  try {
    await db.execute(sql`SELECT pg_advisory_unlock(${lockId})`);
  } catch (error) {
    console.error(`[DBTransaction] Advisory unlock error:`, error);
  }
}

export function runIdToLockId(runId: string): number {
  let hash = 0;
  for (let i = 0; i < runId.length; i++) {
    const char = runId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}
