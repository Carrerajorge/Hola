import { env } from "../config/env";
import { Logger } from "../lib/logger";
import { createQueue, QUEUE_NAMES } from "../lib/queueFactory";
import { processChannelIngestJob } from "./channelIngestService";
import type { ChannelIngestJob } from "./types";
import { validateChannelIngestJob } from "./types";

export const channelIngestQueue = createQueue<ChannelIngestJob>(QUEUE_NAMES.CHANNEL_INGEST);

function shouldUseQueue(): boolean {
  if (env.CHANNEL_INGEST_MODE === "queue") return true;
  if (env.CHANNEL_INGEST_MODE === "inprocess") return false;
  // auto
  return env.NODE_ENV === "production";
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
  const useQueue = shouldUseQueue();

  if (useQueue && channelIngestQueue) {
    await channelIngestQueue.add("ingest", sanitizedJob, {
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    });
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
