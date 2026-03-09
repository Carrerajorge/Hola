import { db } from "../db";
import { users } from "@shared/schema";

/**
 * Some tables (e.g. user_settings, semantic_memory_chunks) FK to users.id.
 * For anonymous sessions (anon_* ids), we still want those features to work.
 *
 * This helper creates a minimal users row if missing.
 */
export async function ensureUserRowExists(userId: string): Promise<void> {
  const id = String(userId || "").trim();
  if (!id || id === "anonymous") return;

  try {
    await db
      .insert(users)
      .values({ id } as typeof users.$inferInsert)
      .onConflictDoNothing();
  } catch (e: any) {
    console.warn("[ensureUserRowExists] Failed to ensure user row:", e?.message || e);
  }
}
