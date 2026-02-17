import { z } from "zod";

export type ExternalChannel = "telegram" | "whatsapp_cloud" | "messenger" | "wechat";

export type ConversationKey = {
  workspaceId: string;
  channel: ExternalChannel;
  channelAccountId: string;
  threadId: string;
};

export type MessageEnvelope = {
  providerMessageId: string;
  channel: ExternalChannel;
  channelKey: string;
  threadId: string;
  senderId: string;
  recipientId?: string;
  conversationKey: ConversationKey;
  receivedAt: string;
  text: string;
  messageType: "text" | "image" | "audio" | "document" | "unsupported";
  media?: {
    providerAssetId?: string;
    fileName?: string;
    mimeType?: string;
    url?: string;
    raw?: unknown;
  };
  metadata: {
    rawPayload: unknown;
    [key: string]: unknown;
  };
};

export type ChannelIngestJob =
  | {
      channel: "telegram";
      update: unknown;
      receivedAt?: string;
    }
  | {
      channel: "whatsapp_cloud";
      payload: unknown;
      receivedAt?: string;
      whatsappMeta?: {
        accountPhoneNumberId: string;
      };
    }
  | {
      channel: "messenger";
      payload: unknown;
      receivedAt?: string;
      pageId?: string;
    }
  | {
      channel: "wechat";
      payload: unknown;
      receivedAt?: string;
      appId?: string;
    };

const BASE_INGEST_JOB = z.object({
  receivedAt: z.string().optional(),
});

const telegramIngestJobSchema = BASE_INGEST_JOB.extend({
  channel: z.literal("telegram"),
  update: z.unknown(),
});

const whatsappIngestJobSchema = BASE_INGEST_JOB.extend({
  channel: z.literal("whatsapp_cloud"),
  payload: z.unknown(),
  whatsappMeta: z.object({
    accountPhoneNumberId: z.string().min(1).trim(),
  }).passthrough().optional(),
});

const messengerIngestJobSchema = BASE_INGEST_JOB.extend({
  channel: z.literal("messenger"),
  payload: z.unknown(),
  pageId: z.string().min(1).trim().optional(),
});

const wechatIngestJobSchema = BASE_INGEST_JOB.extend({
  channel: z.literal("wechat"),
  payload: z.unknown(),
  appId: z.string().min(1).trim().optional(),
});

export const channelIngestJobSchema = z.discriminatedUnion("channel", [
  telegramIngestJobSchema,
  whatsappIngestJobSchema,
  messengerIngestJobSchema,
  wechatIngestJobSchema,
]).strict();

export type ChannelIngestJobValidationError = {
  path: string;
  message: string;
  code: string;
};

export type ChannelIngestJobValidationResult =
  | { ok: true; data: ChannelIngestJob }
  | { ok: false; errors: ChannelIngestJobValidationError[] };

export function validateChannelIngestJob(input: unknown): ChannelIngestJobValidationResult {
  const result = channelIngestJobSchema.safeParse(input);
  if (result.success) {
    return { ok: true, data: result.data };
  }

  const issues = (result.error as any).errors || [];
  return {
    ok: false,
    errors: issues.map((issue: any) => ({
      path: Array.isArray(issue.path) ? issue.path.join(".") : "",
      message: issue.message || "Invalid payload",
      code: issue.code || "invalid",
    })),
  };
}
