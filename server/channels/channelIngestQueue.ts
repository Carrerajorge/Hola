import { env } from "../config/env";
import crypto from "crypto";
import { Logger } from "../lib/logger";
import { createQueue, QUEUE_NAMES } from "../lib/queueFactory";
import { processChannelIngestJob } from "./channelIngestService";
import type { ChannelIngestJob } from "./types";
import { validateChannelIngestJob } from "./types";

const DEFAULT_MAX_INGEST_JOB_BYTES = 32 * 1024;
const MAX_INGEST_JOB_BYTES = Number(process.env.MAX_CHANNEL_INGEST_JOB_BYTES || DEFAULT_MAX_INGEST_JOB_BYTES);
const HASH_PAYLOAD_MAX_BYTES = 64 * 1024;

export const channelIngestQueue = createQueue<ChannelIngestJob>(QUEUE_NAMES.CHANNEL_INGEST);

function shouldUseQueue(): boolean {
  if (env.CHANNEL_INGEST_MODE === "queue") return true;
  if (env.CHANNEL_INGEST_MODE === "inprocess") return false;
  // auto
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
    return;
  }

  const sanitizedJob = parsed.data;
  const canonicalPayload = stableStringify(sanitizedJob);
  if (Buffer.byteLength(canonicalPayload, "utf8") > MAX_INGEST_JOB_BYTES || canonicalPayload.length > HASH_PAYLOAD_MAX_BYTES) {
    Logger.warn("[Channels] Ingest payload too large to process safely", {
      channel: sanitizedJob.channel,
      bytes: Buffer.byteLength(canonicalPayload, "utf8"),
    });
    return;
  }

  const useQueue = shouldUseQueue();

  if (useQueue && channelIngestQueue) {
    const jobId = hashJobForIdempotency(sanitizedJob);

    try {
      await channelIngestQueue.add(
        "ingest",
        sanitizedJob,
        {
          jobId,
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 750,
          },
          removeOnComplete: { age: 24 * 3600, count: 1000 },
          removeOnFail: { age: 7 * 24 * 3600 },
        },
      );
    } catch (err) {
      const message = String((err as Error)?.message || err);
      if (/already exists|duplicate/i.test(message)) {
        Logger.warn("[Channels] Duplicate ingest event ignored (queue dedupe)", {
          channel: sanitizedJob.channel,
          jobId,
        });
        return;
      }
      Logger.error("[Channels] Failed to enqueue channel ingest", { err: message, channel: sanitizedJob.channel });
      throw err;
    }
    return;
  }

  if (useQueue && !channelIngestQueue) {
    Logger.warn("[Channels] CHANNEL_INGEST_MODE requires Redis, falling back to in-process handler");
  }

  setImmediate(() => {
    processChannelIngestJob(sanitizedJob).catch((err) => {
      Logger.error("[Channels] In-process ingest failed", err);
    });
  });
}
