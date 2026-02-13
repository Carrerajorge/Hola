import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { db } from "../db";
import { chats, sharedLinks } from "@shared/schema";

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_BATCH_SIZE = 500;

function getRetentionDays(): number {
  const raw = String(process.env.CHAT_DELETE_RETENTION_DAYS || "").trim();
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_RETENTION_DAYS;
}

function getCutoffDate(retentionDays: number): Date {
  return new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
}

export async function purgeExpiredDeletedChats(options?: { batchSize?: number; retentionDays?: number }): Promise<number> {
  const batchSize = Math.max(1, Math.min(options?.batchSize ?? DEFAULT_BATCH_SIZE, 5000));
  const retentionDays = Math.max(1, options?.retentionDays ?? getRetentionDays());
  const cutoff = getCutoffDate(retentionDays);

  let totalPurged = 0;

  // Purge in batches to avoid long-running locks on large installations.
  // NOTE: chat_messages rows cascade on chat delete.
  for (;;) {
    const expired = await db
      .select({ id: chats.id })
      .from(chats)
      .where(and(isNotNull(chats.deletedAt), lt(chats.deletedAt, cutoff)))
      .limit(batchSize);

    if (expired.length === 0) break;

    const ids = expired.map((c) => c.id);

    // Remove any shared links pointing to chats being permanently deleted.
    await db
      .delete(sharedLinks)
      .where(and(eq(sharedLinks.resourceType, "chat"), inArray(sharedLinks.resourceId, ids)));

    await db.delete(chats).where(inArray(chats.id, ids));

    totalPurged += ids.length;
  }

  return totalPurged;
}

export function startChatRetentionJob(): void {
  const retentionDays = getRetentionDays();
  const intervalMs = 24 * 60 * 60 * 1000; // daily

  // Kick once at startup, then daily.
  void purgeExpiredDeletedChats({ retentionDays }).catch((err) => {
    console.error("[Retention] Failed to purge deleted chats:", err);
  });

  setInterval(() => {
    void purgeExpiredDeletedChats({ retentionDays }).catch((err) => {
      console.error("[Retention] Failed to purge deleted chats:", err);
    });
  }, intervalMs);
}

