import { env } from "../config/env";
import crypto from "crypto";
import { Logger } from "../lib/logger";
import { createQueue, QUEUE_NAMES } from "../lib/queueFactory";
import { processChannelIngestJob } from "./channelIngestService";
import type { ChannelIngestJob } from "./types";
import { validateChannelIngestJob } from "./types";

const DEFAULT_MAX_INGEST_JOB_BYTES = 32 * 1024;
const MAX_JOB_BYTES_FLOOR = 4 * 1024;
const MAX_JOB_BYTES_CEILING = 256 * 1024;
const HASH_PAYLOAD_MAX_BYTES = 64 * 1024;
const INGEST_QUEUE_ATTEMPTS = 4;
const INGEST_QUEUE_BACKOFF_MS = 750;
const INGEST_QUEUE_MAX_ATTEMPTS = 8;
const INGEST_QUEUE_MAX_BACKOFF_MS = 20_000;
const INGEST_DEAD_LETTER_TTL_MS = 12 * 60 * 60 * 1000;
const INGEST_DEAD_LETTER_MAX_ENTRIES = 2_000;
const INGEST_DEAD_LETTER_SAMPLE_LENGTH = 1200;

type IngestDeadLetterEntry = {
  createdAt: string;
  channel: string;
  reason: string;
  jobId: string;
  traceKey: string;
  error: string;
  payloadSample: string;
};

const INGEST_STATS = {
  submitted: 0,
  queueAccepted: 0,
  queueDuplicate: 0,
  queueRejected: 0,
  queueFallback: 0,
  deadLettered: 0,
};
const INGEST_DEAD_LETTERS: IngestDeadLetterEntry[] = [];

function parsePositiveInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

function parseIngestMaxBytes(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  if (parsed < MAX_JOB_BYTES_FLOOR) return MAX_JOB_BYTES_FLOOR;
  if (parsed > MAX_JOB_BYTES_CEILING) return MAX_JOB_BYTES_CEILING;
  return parsed;
}

const MAX_INGEST_JOB_BYTES = parseIngestMaxBytes(process.env.MAX_CHANNEL_INGEST_JOB_BYTES, DEFAULT_MAX_INGEST_JOB_BYTES);
const INGEST_QUEUE_ATTEMPTS_SAFE = parsePositiveInt(
  process.env.CHANNEL_INGEST_ATTEMPTS,
  INGEST_QUEUE_ATTEMPTS,
  1,
  INGEST_QUEUE_MAX_ATTEMPTS,
);
const INGEST_QUEUE_BACKOFF_SAFE = parsePositiveInt(
  process.env.CHANNEL_INGEST_BACKOFF_MS,
  INGEST_QUEUE_BACKOFF_MS,
  200,
  INGEST_QUEUE_MAX_BACKOFF_MS,
);

export const channelIngestQueue = createQueue<ChannelIngestJob>(QUEUE_NAMES.CHANNEL_INGEST);

function normalizeErrorMessage(error: unknown): string {
  return String((error as Error)?.message || error || "unknown")
    .normalize("NFKC")
    .replace(/\u0000/g, "")
    .replace(/[\x00-\x1f\x7f-\x9f]/g, "")
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, "")
    .slice(0, 1_000);
}

function pruneDeadLetters(nowMs = Date.now()): void {
  for (let i = INGEST_DEAD_LETTERS.length - 1; i >= 0; i--) {
    const entry = INGEST_DEAD_LETTERS[i];
    const createdAtMs = Date.parse(entry.createdAt);
    if (!Number.isFinite(createdAtMs) || nowMs - createdAtMs > INGEST_DEAD_LETTER_TTL_MS) {
      INGEST_DEAD_LETTERS.splice(i, 1);
    }
  }

  if (INGEST_DEAD_LETTERS.length <= INGEST_DEAD_LETTER_MAX_ENTRIES) return;
  const excess = INGEST_DEAD_LETTERS.length - INGEST_DEAD_LETTER_MAX_ENTRIES;
  if (excess > 0) {
    INGEST_DEAD_LETTERS.splice(0, excess);
  }
}

function addDeadLetter(
  reason: string,
  job: unknown,
  traceKey: string,
  jobId: string,
  error?: unknown,
): void {
  pruneDeadLetters();
  const payloadSample = stableStringify(job)
    .replace(/[\\\x00-\x1F\x7F]/g, "")
    .slice(0, INGEST_DEAD_LETTER_SAMPLE_LENGTH);
  const entry: IngestDeadLetterEntry = {
    createdAt: nowIso(),
    channel: (typeof job === "object" && job !== null && "channel" in (job as Record<string, unknown>))
      ? String((job as Record<string, unknown>).channel || "")
      : "unknown",
    reason,
    jobId,
    traceKey,
    error: normalizeErrorMessage(error),
    payloadSample,
  };
  INGEST_DEAD_LETTERS.push(entry);
  INGEST_STATS.deadLettered += 1;

  Logger.warn("[Channels] ingest dead-lettered", {
    channel: entry.channel,
    reason,
    traceKey,
    jobId,
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

function shouldUseQueue(): boolean {
  if (env.CHANNEL_INGEST_MODE === "queue") return true;
  if (env.CHANNEL_INGEST_MODE === "inprocess") return false;
  return env.NODE_ENV === "production";
}

function stableStringify(value: unknown, seen = new Set<object>(), depth = 0, maxDepth = 6): string {
  if (depth > maxDepth) {
    return "\"[max-depth-reached]\"";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
    return JSON.stringify(value);
  }

  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  if (Array.isArray(value)) {
    const values = value.slice(0, 256).map((item) => stableStringify(item, seen, depth + 1, maxDepth));
    return `[${values.join(",")}]`;
  }

  if (typeof value === "object" && value !== null) {
    const asObject = value as Record<string, unknown>;
    const keys = Object.keys(asObject).sort();
    const seenObj = value as object;
    if (seen.has(seenObj)) {
      return "\"[circular]\"";
    }

    seen.add(seenObj);
    const entries = keys.slice(0, 256).map((key) => `${JSON.stringify(key)}:${stableStringify(asObject[key], seen, depth + 1, maxDepth)}`);
    seen.delete(seenObj);
    return `{${entries.join(",")}}`;
  }

  return "null";
}

function hashJobForIdempotency(job: ChannelIngestJob): string {
  const digest = crypto.createHash("sha256");
  digest.update(job.channel);

  if (job.channel === "telegram") {
    const update = job.update as any;
    digest.update(stableStringify(update?.message?.message_id || update?.callback_query?.id || update || {}));
  } else if (job.channel === "whatsapp_cloud") {
    const meta = (job as any).whatsappMeta || {};
    digest.update(meta.accountPhoneNumberId || "");
    digest.update(stableStringify((job as any).payload || {}));
  } else if (job.channel === "messenger") {
    const meta = (job as any).pageId || "";
    digest.update(meta);
    digest.update(stableStringify((job as any).payload || {}));
  } else {
    const meta = (job as any).appId || "";
    digest.update(meta);
    digest.update(stableStringify((job as any).payload || ""));
  }

  return digest.digest("hex");
}

export async function submitChannelIngest(job: unknown): Promise<void> {
  const parsed = validateChannelIngestJob(job);
  if (!parsed.ok) {
    Logger.warn("[Channels] rejected invalid ingest payload", {
      errors: parsed.errors,
      payloadKeys: job && typeof job === "object" ? Object.keys(job as Record<string, unknown>) : [],
    });
    addDeadLetter("invalid_job_schema", job, "ingest:invalid", "invalid", parsed.errors);
    return;
  }

  const sanitizedJob = parsed.data;
  const canonicalPayload = stableStringify(sanitizedJob);
  const payloadByteLength = Buffer.byteLength(canonicalPayload, "utf8");
  if (payloadByteLength > MAX_INGEST_JOB_BYTES || canonicalPayload.length > HASH_PAYLOAD_MAX_BYTES) {
    Logger.warn("[Channels] Ingest payload too large to process safely", {
      channel: sanitizedJob.channel,
      bytes: payloadByteLength,
    });
    addDeadLetter("payload_too_large", sanitizedJob, `ingest:${sanitizedJob.channel}`, hashJobForIdempotency(sanitizedJob), {
      bytes: payloadByteLength,
    });
    return;
  }

  const useQueue = shouldUseQueue();
  INGEST_STATS.submitted += 1;

  if (useQueue && channelIngestQueue) {
    const jobId = hashJobForIdempotency(sanitizedJob);
    const traceKey = `${sanitizedJob.channel}:${jobId}`;
    const fallbackToInprocess = async (cause: string): Promise<void> => {
      INGEST_STATS.queueFallback += 1;
      Logger.warn("[Channels] Falling back to in-process ingest", {
        channel: sanitizedJob.channel,
        cause,
        jobId,
        traceKey,
      });

      setImmediate(() => {
        processChannelIngestJob(sanitizedJob).catch((error) => {
          Logger.error("[Channels] In-process ingest fallback failed", {
            channel: sanitizedJob.channel,
            traceKey,
            error: normalizeErrorMessage(error),
          });
        });
      });
    };

    try {
      await channelIngestQueue.add("ingest", sanitizedJob, {
        jobId,
        attempts: INGEST_QUEUE_ATTEMPTS_SAFE,
        backoff: {
          type: "exponential",
          delay: INGEST_QUEUE_BACKOFF_SAFE,
        },
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      });
      INGEST_STATS.queueAccepted += 1;
      return;
    } catch (err) {
      const message = normalizeErrorMessage(err);
      INGEST_STATS.queueRejected += 1;
      addDeadLetter("queue_add_failed", sanitizedJob, traceKey, jobId, message);
      if (/already exists|duplicate/i.test(message)) {
        Logger.warn("[Channels] Duplicate ingest event ignored (queue dedupe)", {
          channel: sanitizedJob.channel,
          jobId,
          traceKey,
        });
        INGEST_STATS.queueDuplicate += 1;
        return;
      }

      await fallbackToInprocess(message);
      return;
    }
  }

  if (useQueue && !channelIngestQueue) {
    Logger.warn("[Channels] CHANNEL_INGEST_MODE requires Redis, falling back to in-process handler");
  }

  setImmediate(() => {
    processChannelIngestJob(sanitizedJob).catch((err) => {
      Logger.error("[Channels] In-process ingest failed", {
        channel: sanitizedJob.channel,
        error: normalizeErrorMessage(err),
      });
      addDeadLetter("inprocess_fallback_failed", sanitizedJob, `ingest:${sanitizedJob.channel}`, hashJobForIdempotency(sanitizedJob), err);
    });
  });
}

export function getChannelIngestQueueStats() {
  return { ...INGEST_STATS, deadLetterSize: INGEST_DEAD_LETTERS.length };
}

export function getChannelIngestDeadLetters(): IngestDeadLetterEntry[] {
  pruneDeadLetters();
  return [...INGEST_DEAD_LETTERS];
}
