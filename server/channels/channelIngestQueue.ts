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
const INGEST_QUEUE_BACKPRESSURE_LIMIT = 1_200;
const INGEST_RECEIVED_AT_MAX_FUTURE_MS = 5 * 60 * 1000;
const INGEST_RECEIVED_AT_MAX_PAST_MS = 7 * 24 * 60 * 60 * 1000;
const INGEST_RUN_ID_RE = /^[A-Za-z0-9._:-]+$/;
const MAX_INGEST_RUN_ID_LENGTH = 128;
const INPROCESS_MAX_CONCURRENCY = parsePositiveInt(process.env.CHANNEL_INGEST_INPROCESS_CONCURRENCY, 4, 1, 128);
const INPROCESS_TASK_TIMEOUT_MS = parsePositiveInt(process.env.CHANNEL_INGEST_INPROCESS_TIMEOUT_MS, 120_000, 2_000, 300_000);
const INPROCESS_TASK_QUEUE_MAX = parsePositiveInt(process.env.CHANNEL_INGEST_INPROCESS_QUEUE_MAX, 400, 32, 20_000);
const INPROCESS_DEDUPE_TTL_MS = parsePositiveInt(process.env.CHANNEL_INGEST_INPROCESS_DEDUPE_TTL_MS, 10 * 60 * 1000, 1_000, 30 * 60 * 1000);

const MAX_INGEST_INPROCESS_RUNS = 10_000;

type IngestDeadLetterEntry = {
  createdAt: string;
  channel: string;
  reason: string;
  runId: string;
  jobId: string;
  traceKey: string;
  error: string;
  payloadSample: string;
};

type InProcessTaskResult = {
  ok: true;
} | {
  ok: false;
  timedOut: boolean;
  error: string;
};

type InProcessTask = {
  job: ChannelIngestJob;
  jobId: string;
  runId: string;
  traceKey: string;
  submittedAt: number;
};

const INGEST_STATS = {
  submitted: 0,
  queueAccepted: 0,
  queueDuplicate: 0,
  queueRejected: 0,
  queueBackpressured: 0,
  queueFallback: 0,
  inprocessQueued: 0,
  inprocessDuplicate: 0,
  inprocessRejected: 0,
  inprocessCompleted: 0,
  inprocessTimeout: 0,
  inprocessFailed: 0,
  deadLettered: 0,
};

const INGEST_DEAD_LETTERS: IngestDeadLetterEntry[] = [];
const inProcessQueue: Array<InProcessTask> = [];
const inProcessDedupWindow = new Map<string, number>();
const inProcessTaskReservations = new Set<string>();

let inProcessRunning = 0;
let inProcessPumpScheduled = false;

export const channelIngestQueue = createQueue<ChannelIngestJob>(QUEUE_NAMES.CHANNEL_INGEST);

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

function normalizeText(value: unknown, maxLength = MAX_INGEST_RUN_ID_LENGTH): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").replace(/\u0000/g, "").replace(/[\x00-\x1f\x7f-\x9f]/g, "").trim();
  if (normalized.length === 0 || normalized.length > maxLength) return null;
  return normalized;
}

function normalizeRunId(raw: unknown): string | null {
  const value = normalizeText(raw, MAX_INGEST_RUN_ID_LENGTH);
  if (!value || !INGEST_RUN_ID_RE.test(value)) return null;
  return value;
}

function parseQueueBackoff(value: string | undefined, fallback: number, min: number, max: number): number {
  return parsePositiveInt(value, fallback, min, max);
}

function resolveReceivedAt(raw: string | undefined): string | null {
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;

  const now = Date.now();
  if (parsed > now + INGEST_RECEIVED_AT_MAX_FUTURE_MS || parsed < now - INGEST_RECEIVED_AT_MAX_PAST_MS) {
    return null;
  }

  return new Date(parsed).toISOString();
}

const MAX_INGEST_JOB_BYTES = parseIngestMaxBytes(process.env.MAX_CHANNEL_INGEST_JOB_BYTES, DEFAULT_MAX_INGEST_JOB_BYTES);
const INGEST_QUEUE_ATTEMPTS_SAFE = parseQueueBackoff(
  process.env.CHANNEL_INGEST_ATTEMPTS,
  INGEST_QUEUE_ATTEMPTS,
  1,
  INGEST_QUEUE_MAX_ATTEMPTS,
);
const INGEST_QUEUE_BACKOFF_SAFE = parseQueueBackoff(
  process.env.CHANNEL_INGEST_BACKOFF_MS,
  INGEST_QUEUE_BACKOFF_MS,
  200,
  INGEST_QUEUE_MAX_BACKOFF_MS,
);

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
  runId: string,
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
    runId,
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
    runId,
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

function resolveRunId(job: ChannelIngestJob, jobId: string): string {
  return normalizeRunId((job as { runId?: unknown }).runId) || `run_${jobId.slice(0, 52)}`;
}

function pruneInProcessState(nowMs = Date.now()): void {
  for (const [runId, seenAt] of inProcessDedupWindow.entries()) {
    if (nowMs - seenAt > INPROCESS_DEDUPE_TTL_MS) {
      inProcessDedupWindow.delete(runId);
    }
  }

  if (inProcessDedupWindow.size <= MAX_INGEST_INPROCESS_RUNS) {
    return;
  }

  const excess = inProcessDedupWindow.size - MAX_INGEST_INPROCESS_RUNS;
  const keys = Array.from(inProcessDedupWindow.keys()).slice(0, excess);
  for (const key of keys) {
    inProcessDedupWindow.delete(key);
  }
}

function reserveInprocessRun(runId: string): boolean {
  pruneInProcessState();
  if (inProcessTaskReservations.has(runId) || inProcessDedupWindow.has(runId)) {
    return false;
  }

  inProcessTaskReservations.add(runId);
  inProcessDedupWindow.set(runId, Date.now());
  return true;
}

function releaseInprocessRun(runId: string): void {
  inProcessTaskReservations.delete(runId);
}

function isInProcessQueueBackpressured(): boolean {
  return inProcessQueue.length >= INPROCESS_TASK_QUEUE_MAX;
}

function markQueueBackpressure(cause: string, channel: string, runId: string): void {
  INGEST_STATS.queueBackpressured += 1;
  Logger.warn("[Channels] queue backpressure active", {
    channel,
    cause,
    runId,
  });
}

async function isQueueBackpressured(): Promise<boolean> {
  if (!channelIngestQueue) return false;

  try {
    const [waiting, active, delayed] = await Promise.all([
      channelIngestQueue.getWaitingCount(),
      channelIngestQueue.getActiveCount(),
      channelIngestQueue.getDelayedCount(),
    ]);

    const total = waiting + active + delayed;
    return total >= INGEST_QUEUE_BACKPRESSURE_LIMIT;
  } catch (error) {
    Logger.warn("[Channels] queue pressure check failed; processing in-process", {
      reason: normalizeErrorMessage(error),
    });
    return false;
  }
}

function runInProcessExecution(task: InProcessTask): Promise<InProcessTaskResult> {
  const processResult = processChannelIngestJob(task.job)
    .then<InProcessTaskResult>(() => ({ ok: true }))
    .catch((error) => ({
      ok: false,
      timedOut: false,
      error: normalizeErrorMessage(error),
    }));

  const timeoutResult = new Promise<InProcessTaskResult>((resolve) => {
    const timeoutId = setTimeout(() => {
      resolve({
        ok: false,
        timedOut: true,
        error: `in-process ingest timeout after ${INPROCESS_TASK_TIMEOUT_MS}ms`,
      });
    }, INPROCESS_TASK_TIMEOUT_MS);

    void processResult.then(() => clearTimeout(timeoutId)).catch(() => clearTimeout(timeoutId));
  });

  return Promise.race([processResult, timeoutResult]);
}

function enqueueInProcessIngest(task: InProcessTask): "accepted" | "duplicate" | "rejected" {
  if (isInProcessQueueBackpressured()) {
    return "rejected";
  }

  if (!reserveInprocessRun(task.runId)) {
    return "duplicate";
  }

  inProcessQueue.push(task);
  INGEST_STATS.inprocessQueued += 1;
  scheduleInProcessPump();
  return "accepted";
}

function scheduleInProcessPump(): void {
  if (inProcessPumpScheduled) return;
  inProcessPumpScheduled = true;
  void pumpInProcessQueue();
}

async function pumpInProcessQueue(): Promise<void> {
  try {
    while (inProcessRunning < INPROCESS_MAX_CONCURRENCY) {
      const task = inProcessQueue.shift();
      if (!task) {
        break;
      }

      inProcessRunning += 1;
      void runInProcessExecution(task)
        .then((result) => {
          if (result.ok) {
            INGEST_STATS.inprocessCompleted += 1;
            Logger.debug("[Channels] in-process ingest completed", {
              channel: task.job.channel,
              runId: task.runId,
              elapsedMs: Date.now() - task.submittedAt,
            });
            return;
          }

          if (result.timedOut) {
            INGEST_STATS.inprocessTimeout += 1;
            Logger.warn("[Channels] in-process ingest timed out", {
              channel: task.job.channel,
              runId: task.runId,
              error: result.error,
            });
            addDeadLetter("inprocess_timeout", task.job, task.traceKey, task.jobId, task.runId, result.error);
            return;
          }

          INGEST_STATS.inprocessFailed += 1;
          Logger.error("[Channels] in-process ingest failed", {
            channel: task.job.channel,
            runId: task.runId,
            error: result.error,
          });
          addDeadLetter("inprocess_failed", task.job, task.traceKey, task.jobId, task.runId, result.error);
        })
        .catch((unexpected) => {
          INGEST_STATS.inprocessFailed += 1;
          Logger.error("[Channels] in-process ingest unexpected error", {
            channel: task.job.channel,
            runId: task.runId,
            error: normalizeErrorMessage(unexpected),
          });
          addDeadLetter("inprocess_unexpected", task.job, task.traceKey, task.jobId, task.runId, unexpected);
        })
        .finally(() => {
          inProcessRunning -= 1;
          releaseInprocessRun(task.runId);
          scheduleInProcessPump();
        });
    }
  } finally {
    inProcessPumpScheduled = false;
    if (inProcessQueue.length > 0 && inProcessRunning < INPROCESS_MAX_CONCURRENCY) {
      scheduleInProcessPump();
    }
  }
}

function submitInProcessFallback(
  sanitizedJob: ChannelIngestJob,
  runId: string,
  traceKey: string,
  jobId: string,
  cause: string,
): void {
  const result = enqueueInProcessIngest({
    job: sanitizedJob,
    jobId,
    runId,
    traceKey,
    submittedAt: Date.now(),
  });

  if (result === "accepted") {
    INGEST_STATS.queueFallback += 1;
    Logger.warn("[Channels] Falling back to in-process ingest", {
      channel: sanitizedJob.channel,
      cause,
      runId,
      jobId,
      queueDepth: inProcessQueue.length,
      inProcessRunning,
    });
    return;
  }

  if (result === "duplicate") {
    INGEST_STATS.inprocessDuplicate += 1;
    Logger.info("[Channels] Duplicate in-process ingest ignored", {
      channel: sanitizedJob.channel,
      runId,
      jobId,
      cause: "dedupe_replay",
    });
    return;
  }

  INGEST_STATS.inprocessRejected += 1;
  Logger.error("[Channels] in-process ingest queue saturated, rejecting message", {
    channel: sanitizedJob.channel,
    runId,
    jobId,
    cause,
    queueDepth: inProcessQueue.length,
  });
  addDeadLetter("inprocess_queue_full", sanitizedJob, traceKey, jobId, runId, cause);
}

function validateReceivedAt(raw: string | undefined, channel: string, jobId: string): string | null {
  const parsed = resolveReceivedAt(raw || "");
  if (!parsed) {
    Logger.warn("[Channels] receivedAt dropped due to invalid timestamp", {
      channel,
      runId: jobId,
    });
    return null;
  }

  return parsed;
}

function finalizeIngestJob(job: ChannelIngestJob): ChannelIngestJob {
  const normalizedReceivedAt = validateReceivedAt(job.receivedAt, job.channel, hashJobForIdempotency(job));
  if (normalizedReceivedAt) {
    return { ...job, receivedAt: normalizedReceivedAt };
  }

  return { ...job, receivedAt: new Date().toISOString() };
}

export async function submitChannelIngest(job: unknown): Promise<void> {
  const parsed = validateChannelIngestJob(job);
  if (!parsed.ok) {
    Logger.warn("[Channels] rejected invalid ingest payload", {
      errors: parsed.errors,
      payloadKeys: job && typeof job === "object" ? Object.keys(job as Record<string, unknown>) : [],
    });
    addDeadLetter("invalid_job_schema", job, "ingest:invalid", "invalid", "ingest:invalid", parsed.errors);
    return;
  }

  const sanitizedJob = finalizeIngestJob(parsed.data);
  const canonicalPayload = stableStringify(sanitizedJob);
  const payloadByteLength = Buffer.byteLength(canonicalPayload, "utf8");
  INGEST_STATS.submitted += 1;
  if (payloadByteLength > MAX_INGEST_JOB_BYTES || canonicalPayload.length > HASH_PAYLOAD_MAX_BYTES) {
    const runId = resolveRunId(sanitizedJob, hashJobForIdempotency(sanitizedJob));
    Logger.warn("[Channels] Ingest payload too large to process safely", {
      channel: sanitizedJob.channel,
      runId,
      bytes: payloadByteLength,
    });
    addDeadLetter(
      "payload_too_large",
      sanitizedJob,
      `${sanitizedJob.channel}:${runId}`,
      hashJobForIdempotency(sanitizedJob),
      runId,
      { bytes: payloadByteLength },
    );
    return;
  }

  const useQueue = shouldUseQueue();
  const jobId = hashJobForIdempotency(sanitizedJob);
  const runId = resolveRunId(sanitizedJob, jobId);
  const traceKey = `${sanitizedJob.channel}:${runId}`;

  if (useQueue && channelIngestQueue) {
    if (await isQueueBackpressured()) {
      markQueueBackpressure("waiting/active/delayed over limit", sanitizedJob.channel, runId);
      submitInProcessFallback(sanitizedJob, runId, traceKey, jobId, "queue_backpressured");
      return;
    }

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
      addDeadLetter("queue_add_failed", sanitizedJob, traceKey, jobId, runId, message);

      if (/already exists|duplicate/i.test(message)) {
        Logger.warn("[Channels] Duplicate ingest event ignored (queue dedupe)", {
          channel: sanitizedJob.channel,
          runId,
          traceKey,
          jobId,
        });
        INGEST_STATS.queueDuplicate += 1;
        return;
      }

      submitInProcessFallback(sanitizedJob, runId, traceKey, jobId, message);
      return;
    }
  }

  if (useQueue && !channelIngestQueue) {
    Logger.warn("[Channels] CHANNEL_INGEST_MODE requires Redis, falling back to in-process handler", {
      runId,
      channel: sanitizedJob.channel,
    });
  }

  submitInProcessFallback(sanitizedJob, runId, traceKey, jobId, "queue_disabled_or_not_configured");
  return;
}

export function getChannelIngestQueueStats() {
  return { ...INGEST_STATS, deadLetterSize: INGEST_DEAD_LETTERS.length, inProcessQueueDepth: inProcessQueue.length };
}

export function getChannelIngestDeadLetters(): IngestDeadLetterEntry[] {
  pruneDeadLetters();
  return [...INGEST_DEAD_LETTERS];
}
