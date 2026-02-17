import crypto from "crypto";
import { db } from "../db";
import { pareIdempotencyKeys, type PareIdempotencyStatus } from "@shared/schema";
import { createLogger } from "./structuredLogger";
import { eq, lt, sql } from "drizzle-orm";

export type IdempotencyCheckResult =
  | { status: "new" }
  | { status: "processing" }
  | { status: "completed"; cachedResponse: Record<string, unknown> }
  | { status: "conflict" };

const TTL_HOURS = 24;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const MAX_PAYLOAD_HASH_BYTES = 128_000;
const IDEMPOTENCY_KEY_MIN_LENGTH = 6;
const IDEMPOTENCY_KEY_MAX_LENGTH = 140;
const IDEMPOTENCY_KEY_RE = /^[a-zA-Z0-9._-]+$/;
const IDEMPOTENCY_HASH_RE = /^[a-f0-9]{64}$/;
const MAX_PAYLOAD_HASH_JSON_BYTES = 65_536;
const MAX_IDEMPOTENCY_LOG_KEY_BYTES = 6;

let cleanupIntervalId: NodeJS.Timeout | null = null;
const logger = createLogger("idempotency-store");

function obfuscateIdempotencyKey(key: string): string {
  if (key.length <= MAX_IDEMPOTENCY_LOG_KEY_BYTES) {
    return "[REDACTED]";
  }
  return `${key.slice(0, 3)}...${key.slice(-3)}`;
}

function validateIdempotencyKey(key: string): void {
  if (
    typeof key !== "string" ||
    key.length < IDEMPOTENCY_KEY_MIN_LENGTH ||
    key.length > IDEMPOTENCY_KEY_MAX_LENGTH ||
    !IDEMPOTENCY_KEY_RE.test(key)
  ) {
    throw new Error("Invalid idempotency key");
  }
}

function validatePayloadHash(payloadHash: string): void {
  if (typeof payloadHash !== "string" || !IDEMPOTENCY_HASH_RE.test(payloadHash)) {
    throw new Error("Invalid idempotency payload hash");
  }
}

function normalizeForHash(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (seen.has(value as object)) {
    return "[circular]";
  }
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeForHash(entry, seen));
  }

  const source = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  const keys = Object.keys(source).sort();
  for (const key of keys) {
    output[key] = normalizeForHash(source[key], seen);
  }
  return output;
}

export function computePayloadHash(body: unknown): string {
  const normalizedStructure = normalizeForHash(body);
  const normalized = JSON.stringify(normalizedStructure);
  if (normalized === undefined) {
    throw new Error("Unable to serialize idempotency payload");
  }
  if (Buffer.byteLength(normalized, "utf8") > MAX_PAYLOAD_HASH_BYTES) {
    throw new Error("Idempotency payload too large");
  }
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

export async function checkIdempotencyKey(
  key: string,
  payloadHash: string
): Promise<IdempotencyCheckResult> {
  validateIdempotencyKey(key);
  validatePayloadHash(payloadHash);

  const expiresAt = new Date(Date.now() + TTL_HOURS * 60 * 60 * 1000);

  try {
    const insertResult = await db.execute(sql`
      INSERT INTO pare_idempotency_keys (idempotency_key, payload_hash, status, expires_at)
      VALUES (${key}, ${payloadHash}, 'processing', ${expiresAt})
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id
    `);

    if (insertResult.rowCount && insertResult.rowCount > 0) {
      logger.info("Idempotency key created", {
        event: "IDEMPOTENCY_KEY_CREATED",
        key: obfuscateIdempotencyKey(key),
        payloadHash: payloadHash.substring(0, MAX_IDEMPOTENCY_LOG_KEY_BYTES) + "...",
        timestamp: new Date().toISOString(),
      });
      return { status: "new" };
    }

    const existing = await db.query.pareIdempotencyKeys.findFirst({
      where: eq(pareIdempotencyKeys.idempotencyKey, key),
    });

    if (!existing) {
      logger.error("Idempotency race condition on insert without existing row", {
        event: "IDEMPOTENCY_KEY_RACE_CONDITION",
        key: obfuscateIdempotencyKey(key),
        message: "Insert failed but no existing record found",
        timestamp: new Date().toISOString(),
      });
      return { status: "new" };
    }

    if (existing.payloadHash !== payloadHash) {
      logger.warn("Idempotency conflict detected", {
        event: "IDEMPOTENCY_CONFLICT",
        key: obfuscateIdempotencyKey(key),
        existingHash: existing.payloadHash.substring(0, MAX_IDEMPOTENCY_LOG_KEY_BYTES) + "...",
        newHash: payloadHash.substring(0, MAX_IDEMPOTENCY_LOG_KEY_BYTES) + "...",
        timestamp: new Date().toISOString(),
      });
      return { status: "conflict" };
    }

    if (existing.status === "completed" && existing.responseJson) {
      logger.info("Idempotency cache hit", {
        event: "IDEMPOTENCY_CACHE_HIT",
        key: obfuscateIdempotencyKey(key),
        timestamp: new Date().toISOString(),
      });
      return { status: "completed", cachedResponse: existing.responseJson as Record<string, unknown> };
    }

    if (existing.status === "processing") {
      logger.info("Idempotency key in progress", {
        event: "IDEMPOTENCY_IN_PROGRESS",
        key: obfuscateIdempotencyKey(key),
        createdAt: existing.createdAt,
        timestamp: new Date().toISOString(),
      });
      return { status: "processing" };
    }

    if (existing.status === "failed") {
      await db
        .update(pareIdempotencyKeys)
        .set({ status: "processing", expiresAt })
        .where(eq(pareIdempotencyKeys.idempotencyKey, key));

      logger.info("Idempotency retry after failure", {
        event: "IDEMPOTENCY_RETRY_AFTER_FAILURE",
        key: obfuscateIdempotencyKey(key),
        timestamp: new Date().toISOString(),
      });
      return { status: "new" };
    }

    return { status: "new" };
  } catch (error: unknown) {
    logger.error("Idempotency check failed", {
      event: "IDEMPOTENCY_CHECK_ERROR",
      key: obfuscateIdempotencyKey(key),
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });
    throw error;
  }
}

export async function completeIdempotencyKey(
  key: string,
  response: Record<string, unknown>
): Promise<void> {
  validateIdempotencyKey(key);
  try {
    await db
      .update(pareIdempotencyKeys)
      .set({
        status: "completed" as PareIdempotencyStatus,
        responseJson: response,
      })
      .where(eq(pareIdempotencyKeys.idempotencyKey, key));

    logger.info("Idempotency key completed", {
      event: "IDEMPOTENCY_KEY_COMPLETED",
      key: obfuscateIdempotencyKey(key),
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    logger.error("Idempotency completion failed", {
      event: "IDEMPOTENCY_COMPLETE_ERROR",
      key: obfuscateIdempotencyKey(key),
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });
    throw error;
  }
}

export async function failIdempotencyKey(
  key: string,
  error: string
): Promise<void> {
  validateIdempotencyKey(key);
  const truncatedError =
    typeof error === "string" && error.length > MAX_PAYLOAD_HASH_BYTES
      ? `${error.slice(0, MAX_PAYLOAD_HASH_BYTES - 20)}...`
      : error;

  try {
    await db
      .update(pareIdempotencyKeys)
      .set({
        status: "failed" as PareIdempotencyStatus,
        responseJson: {
          error:
            truncatedError.length > MAX_PAYLOAD_HASH_JSON_BYTES
              ? `[truncated] ${truncatedError.slice(0, MAX_PAYLOAD_HASH_JSON_BYTES)}`
              : `[redacted] ${truncatedError}`,
          failedAt: new Date().toISOString(),
        },
      })
      .where(eq(pareIdempotencyKeys.idempotencyKey, key));

    logger.info("Idempotency key failed", {
      event: "IDEMPOTENCY_KEY_FAILED",
      key: obfuscateIdempotencyKey(key),
      timestamp: new Date().toISOString(),
    });
  } catch (dbError: unknown) {
    logger.error("Idempotency fail-state update failed", {
      event: "IDEMPOTENCY_FAIL_ERROR",
      key: obfuscateIdempotencyKey(key),
      originalError: truncatedError,
      dbError: dbError instanceof Error ? dbError.message : String(dbError),
      timestamp: new Date().toISOString(),
    });
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
      logger.info("Idempotency cleanup removed expired keys", {
        event: "IDEMPOTENCY_CLEANUP",
        deletedCount,
        timestamp: now.toISOString(),
      });
    }

    return deletedCount;
  } catch (error: unknown) {
    logger.error("Idempotency cleanup failed", {
      event: "IDEMPOTENCY_CLEANUP_ERROR",
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });
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
  if (cleanupIntervalId.unref) {
    cleanupIntervalId.unref();
  }

  logger.info("Idempotency cleanup scheduler started", {
    event: "IDEMPOTENCY_CLEANUP_SCHEDULER_STARTED",
    intervalMs: CLEANUP_INTERVAL_MS,
    timestamp: new Date().toISOString(),
  });
}

export function stopCleanupScheduler(): void {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;

    logger.info("Idempotency cleanup scheduler stopped", {
      event: "IDEMPOTENCY_CLEANUP_SCHEDULER_STOPPED",
      timestamp: new Date().toISOString(),
    });
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
    db.query.pareIdempotencyKeys.findMany(),
  ]);

  const stats = {
    total: allKeys.length,
    processing: 0,
    completed: 0,
    failed: 0,
    expired: 0,
  };

  for (const key of allKeys) {
    if (key.expiresAt < now) {
      stats.expired++;
    } else if (key.status === "processing") {
      stats.processing++;
    } else if (key.status === "completed") {
      stats.completed++;
    } else if (key.status === "failed") {
      stats.failed++;
    }
  }

  return stats;
}
