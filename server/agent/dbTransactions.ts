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
  const lockKey = `run_lock:${runId}`;
  const lockExpiry = new Date(Date.now() + lockDurationMs);
  
  try {
    const [run] = await db.select()
      .from(agentModeRuns)
      .where(eq(agentModeRuns.id, runId));
    
    if (!run) return false;
    
    console.log(`[DBTransaction] Acquired lock for run ${runId} until ${lockExpiry.toISOString()}`);
    return true;
  } catch (error) {
    console.error(`[DBTransaction] Failed to acquire lock for run ${runId}:`, error);
    return false;
  }
}
