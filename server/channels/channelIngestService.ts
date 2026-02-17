import { createHash, randomUUID } from "crypto";

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import type { ChannelIngestJob, ConversationKey, ExternalChannel, MessageEnvelope } from "./types";
import {
  normalizeMessengerMessages,
  normalizeTelegramMessages,
  normalizeWhatsAppMessages,
  normalizeWeChatMessage,
  withConversationKeyDefaults,
} from "./inboundNormalization";
import {
  evaluateChannelPolicy,
  getConversationPolicy,
  getConversationWindowState,
  parseChannelPairingCodeFromMessage,
} from "./channelPolicyEngine";
import {
  consumeChannelPairingCode,
  findAnyActiveTelegramAccount,
  findMessengerAccountByPageId,
  findTelegramAccountByUserId,
  findWeChatAccountByAppId,
  findWhatsAppCloudAccountByPhoneNumberId,
  getOrCreateChannelConversation,
  patchConversationMetadata,
  setConversationOwnerIdentity,
  touchChannelConversationHeartbeat,
} from "./channelStore";
import { parseWeChatXml, wechatSendDocument, wechatSendText } from "./wechat/wechatApi";
import { sendWhatsAppCloudDocument, sendWhatsAppCloudText } from "./whatsappCloud/whatsappCloudApi";
import { messengerSendDocument, messengerSendText } from "./messenger/messengerApi";
import { telegramSendDocument, telegramSendMessage } from "./telegram/telegramApi";
import {
  buildResponseStyleSystemPrompt,
  parseRuntimeConfig,
  resolveRuntimeConfig,
} from "./runtimeConfig";
import type { MessageRecord } from "../../shared/schema/chat";
import { Logger } from "../lib/logger";
import { llmGateway } from "../lib/llmGateway";
import { storage } from "../storage";

type ChannelAccount = {
  id: string;
  userId: string;
  accessToken: string | null;
  metadata: Record<string, unknown> | null;
};

type InboundProcessingContext = {
  jobChannel: ExternalChannel;
  envelope: MessageEnvelope;
  account: ChannelAccount;
  conversation: Awaited<ReturnType<typeof getOrCreateChannelConversation>>;
  runtimeConfig: ReturnType<typeof resolveRuntimeConfig>;
};

type SendRequest = {
  text: string;
  requestId: string;
  runId: string;
  conversationKey: ConversationKey;
  senderId: string;
};

const RUN_QUEUE_MAX_HISTORY = 60;
const MAX_STREAM_CONTEXT = 80;
const ORCHESTRATION_TIMEOUT_MS = 120_000;
const SEND_RETRY_ATTEMPTS = 2;
const SEND_RETRY_BACKOFF_MS = 750;
const PROVIDER_ID_FALLBACK_KEY = "unknown";
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_ID_LENGTH = 256;
const MAX_REQUEST_ID_LENGTH = 120;
const MAX_WORKSPACE_ID_LENGTH = 200;
const MAX_ENVELOPES_PER_JOB = 12;
const MAX_RATE_BUCKET_ENTRIES = 8_000;
const MAX_MESSAGE_ID_ENTRIES = 120_000;
const DEFAULT_MEDIA_LABEL = {
  image: "[Imagen recibida]",
  audio: "[Audio recibido]",
  document: "[Documento recibido]",
};

const inFlightRunsByConversation = new Map<string, AbortController>();
const conversationQueues = new Map<string, Promise<void>>();
const seenProviderMessageIdsByConversation = new Map<string, number>();
const conversationRateBuckets = new Map<string, { startedAt: number; count: number }>();

function isAllowedByRateLimit(conversationKey: string, perMinute: number): { allowed: boolean; retryAfterMs?: number } {
  if (!perMinute || perMinute <= 0) return { allowed: true };

  const now = Date.now();
  const current = conversationRateBuckets.get(conversationKey);
  if (!current || now - current.startedAt >= RATE_LIMIT_WINDOW_MS) {
    conversationRateBuckets.set(conversationKey, { startedAt: now, count: 1 });
    return { allowed: true };
  }

  if (current.count < perMinute) {
    current.count += 1;
    return { allowed: true };
  }

  return { allowed: false, retryAfterMs: current.startedAt + RATE_LIMIT_WINDOW_MS - now };
}

function pruneRateBuckets(ttlMs = RATE_LIMIT_WINDOW_MS): void {
  const now = Date.now();
  for (const [key, value] of conversationRateBuckets.entries()) {
    if (now - value.startedAt > ttlMs) conversationRateBuckets.delete(key);
  }

  if (conversationRateBuckets.size > MAX_RATE_BUCKET_ENTRIES) {
    const excess = conversationRateBuckets.size - MAX_RATE_BUCKET_ENTRIES;
    let removed = 0;
    for (const key of conversationRateBuckets.keys()) {
      conversationRateBuckets.delete(key);
      removed += 1;
      if (removed >= excess) break;
    }
  }
}

function serializeConversationKey(conversationKey: ConversationKey): string {
  return [conversationKey.workspaceId, conversationKey.channel, conversationKey.channelAccountId, conversationKey.threadId]
    .map((value) => String(value ?? "").replace(/\|/g, "_"))
    .join("|");
}

function isUniqueViolation(err: unknown): boolean {
  return String((err as any)?.code || "") === "23505";
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeIdentifier(value: unknown, maxLength = MAX_ID_LENGTH): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value)
    .normalize("NFKC")
    .replace(/\u0000/g, "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim();

  if (!normalized || normalized.length > maxLength) return null;
  return normalized;
}

function toCleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function sanitizeReceivedAt(value: unknown): string {
  const candidate = String(value ?? "").trim();
  if (!candidate) return nowIso();

  const parsed = Date.parse(candidate);
  if (!Number.isFinite(parsed)) return nowIso();
  return new Date(parsed).toISOString();
}

function normalizeTextPayload(value: string): string {
  const trimmed = toCleanText(value);
  return trimmed.length > 0 ? trimmed : "";
}

function sanitizeMessageType(value: MessageEnvelope["messageType"] | unknown): MessageEnvelope["messageType"] {
  if (value === "text" || value === "image" || value === "audio" || value === "document" || value === "unsupported") {
    return value;
  }

  return "unsupported";
}

function buildConversationScopedRequestId(conversationKey: string, providerMessageId: string): string {
  const canonical = `${conversationKey}|${providerMessageId}`;
  const safeCanonical = sanitizeRequestIdentifier(canonical);
  if (safeCanonical.length <= MAX_REQUEST_ID_LENGTH) {
    return safeCanonical;
  }

  const digest = createHash("sha256").update(canonical).digest("hex");
  return sanitizeRequestIdentifier(`${providerMessageId.slice(0, 24)}_${digest}`).slice(0, MAX_REQUEST_ID_LENGTH);
}

function buildDeterministicFallbackProviderMessageId(seedParts: unknown[]): string {
  const seed = seedParts
    .map((part) => normalizeIdentifier(part, MAX_ID_LENGTH))
    .filter(Boolean)
    .join("|");

  if (!seed) {
    return randomUUID();
  }

  const compact = seed
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[^A-Za-z0-9._:-]+/g, "")
    .toLowerCase()
    .slice(0, MAX_ID_LENGTH - 3);

  if (!compact) {
    return randomUUID();
  }

  return `fb_${compact}`.slice(0, MAX_ID_LENGTH);
}

function buildConversationWorkspaceId(account: ChannelAccount): string {
  const userPart = normalizeIdentifier(account.userId, MAX_WORKSPACE_ID_LENGTH) || "unknown";
  return `workspace:${userPart}`;
}

function envelopeFromRaw(raw: ChannelIngestJob, channel: ExternalChannel): MessageEnvelope[] {
  if (channel === "whatsapp_cloud") {
    return normalizeWhatsAppMessages((raw as any).payload);
  }

  if (channel === "messenger") {
    return normalizeMessengerMessages((raw as any).payload);
  }

  if (channel === "wechat") {
    const parsed = parseWeChatXml(toCleanText((raw as any).payload));
    const message = parsed ? normalizeWeChatMessage(toCleanText((raw as any).payload), parsed) : null;
    return message ? [message] : [];
  }

  // telegram
  return normalizeTelegramMessages((raw as any).update);
}

function buildMessageDedupeKey(conversationKey: string, providerMessageId: string): string {
  return `${conversationKey}|${providerMessageId}`;
}

function isAllowedToQueue(conversationKey: string, providerMessageId: string): boolean {
  const dedupeKey = buildMessageDedupeKey(conversationKey, providerMessageId);
  const lastSeen = seenProviderMessageIdsByConversation.get(dedupeKey) || 0;
  if (!lastSeen) {
    seenProviderMessageIdsByConversation.set(dedupeKey, Date.now());
    return true;
  }
  return false;
}

function pruneMessageIdLedger(ttlMs = 5 * 60 * 1000): void {
  const now = Date.now();
  for (const [id, seenAt] of seenProviderMessageIdsByConversation.entries()) {
    if (now - seenAt > ttlMs) seenProviderMessageIdsByConversation.delete(id);
  }

  if (seenProviderMessageIdsByConversation.size > MAX_MESSAGE_ID_ENTRIES) {
    const excess = seenProviderMessageIdsByConversation.size - MAX_MESSAGE_ID_ENTRIES;
    let removed = 0;
    for (const id of seenProviderMessageIdsByConversation.keys()) {
      seenProviderMessageIdsByConversation.delete(id);
      removed += 1;
      if (removed >= excess) break;
    }
  }
}

async function resolveChannelAccount(channel: ExternalChannel, envelope: MessageEnvelope): Promise<ChannelAccount | null> {
  if (channel === "whatsapp_cloud") {
    const account = await findWhatsAppCloudAccountByPhoneNumberId(envelope.channelKey);
    if (!account) return null;
    return {
      id: account.id,
      userId: account.userId,
      accessToken: account.accessToken,
      metadata: account.metadata as Record<string, unknown> | null,
    };
  }

  if (channel === "messenger") {
    const account = await findMessengerAccountByPageId(envelope.channelKey);
    if (!account) return null;
    return {
      id: account.id,
      userId: account.userId,
      accessToken: account.accessToken,
      metadata: account.metadata as Record<string, unknown> | null,
    };
  }

  if (channel === "wechat") {
    const appId = toCleanText((envelope.metadata as any)?.appId) || envelope.channelKey;
    const account = await findWeChatAccountByAppId(appId);
    if (!account) return null;
    return {
      id: account.id,
      userId: account.userId,
      accessToken: account.accessToken,
      metadata: account.metadata as Record<string, unknown> | null,
    };
  }

  // telegram
  const accountByThread = await findTelegramAccountByUserId(envelope.channelKey || envelope.senderId);
  if (accountByThread) {
    return {
      id: accountByThread.id,
      userId: accountByThread.userId,
      accessToken: accountByThread.accessToken,
      metadata: accountByThread.metadata as Record<string, unknown> | null,
    };
  }

  const anyAccount = await findAnyActiveTelegramAccount();
  if (!anyAccount) return null;
  return {
    id: anyAccount.id,
    userId: anyAccount.userId,
    accessToken: anyAccount.accessToken,
    metadata: anyAccount.metadata as Record<string, unknown> | null,
  };
}

function buildIncomingTextForHistory(envelope: MessageEnvelope): string {
  const text = normalizeTextPayload(envelope.text);
  if (text) return text;

  const media = envelope.media;
  if (!media) return "[Mensaje sin texto]";

  if (media.providerAssetId || media.url || media.fileName) {
    const kind = envelope.messageType;
    const label = DEFAULT_MEDIA_LABEL[kind as keyof typeof DEFAULT_MEDIA_LABEL] || "[Archivo recibido]";
    const details: string[] = [label];
    if (media.fileName) details.push(`nombre=${media.fileName}`);
    if (media.mimeType) details.push(`mime=${media.mimeType}`);
    return details.join(" ");
  }

  return "[Mensaje recibido]";
}

function buildMessageAttachments(envelope: MessageEnvelope) {
  if (!envelope.media) return [] as Array<Record<string, unknown>>;

  return [{
    type: envelope.messageType,
    mediaProviderId: envelope.media.providerAssetId || null,
    fileName: envelope.media.fileName || null,
    mimeType: envelope.media.mimeType || null,
    url: envelope.media.url || null,
    raw: envelope.media.raw || null,
    sourceChannel: envelope.channel,
    messageId: envelope.providerMessageId,
  }];
}

function withConversationDefaults(conversation: { userId: string }, envelope: MessageEnvelope): MessageEnvelope {
  return withConversationKeyDefaults(
    envelope,
    buildConversationWorkspaceId({ id: "", userId: conversation.userId, accessToken: null, metadata: null }),
    envelope.channelKey || PROVIDER_ID_FALLBACK_KEY,
    envelope.threadId || envelope.senderId,
  );
}

function mergeRuntimeConfig(
  accountMetadata: Record<string, unknown> | null | undefined,
  conversationMetadata: Record<string, unknown> | null | undefined,
) {
  const accountRuntime = parseRuntimeConfig((accountMetadata as Record<string, unknown> | null)?.runtime || accountMetadata || {});
  const conversationRuntime = parseRuntimeConfig(
    (conversationMetadata as Record<string, unknown> | null)?.runtime || conversationMetadata || {},
  );

  return resolveRuntimeConfig({
    ...accountRuntime,
    ...conversationRuntime,
  });
}

function getExplicitRuntimeMetadata(metadata: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const parsed = parseRuntimeConfig((metadata as Record<string, unknown> | null)?.runtime || metadata || {});

  const runtime: Record<string, unknown> = {};

  if (parsed.responder_enabled !== undefined) runtime.responder_enabled = parsed.responder_enabled;
  if (parsed.owner_only !== undefined) runtime.owner_only = parsed.owner_only;
  if (parsed.owner_external_ids !== undefined) runtime.owner_external_ids = parsed.owner_external_ids;
  if (parsed.response_style !== undefined) runtime.response_style = parsed.response_style;
  if (parsed.custom_prompt !== undefined) runtime.custom_prompt = parsed.custom_prompt;
  if (parsed.allowlist !== undefined) runtime.allowlist = parsed.allowlist;
  if (parsed.rate_limit_per_minute !== undefined) runtime.rate_limit_per_minute = parsed.rate_limit_per_minute;

  return runtime;
}

function asAttachmentFromEnvelope(envelope: MessageEnvelope): { name?: string; contentType?: string; url?: string } | null {
  if (!envelope.media) return null;
  return {
    name: envelope.media.fileName || undefined,
    contentType: envelope.media.mimeType || undefined,
    url: envelope.media.url || undefined,
  };
}

async function sendTextWithRetries(
  channel: ExternalChannel,
  account: ChannelAccount,
  conversation: InboundProcessingContext["conversation"],
  envelope: MessageEnvelope,
  payload: SendRequest,
  maxRetries = SEND_RETRY_ATTEMPTS,
): Promise<void> {
  let attempt = 0;

  while (true) {
    try {
      if (channel === "whatsapp_cloud") {
        await sendWhatsAppCloudText({
          phoneNumberId: conversation.channelAccountId,
          to: envelope.threadId,
          text: payload.text,
          accessToken: account.accessToken || "",
        });
        return;
      }

      if (channel === "telegram") {
        await telegramSendMessage(envelope.threadId, payload.text);
        return;
      }

      if (channel === "messenger") {
        if (!account.accessToken) {
          throw new Error("Missing Messenger access token");
        }
        await messengerSendText({
          recipientId: envelope.threadId,
          text: payload.text,
          accessToken: account.accessToken,
        });
        return;
      }

      if (channel === "wechat") {
        const appSecret = toCleanText(account.accessToken || "");
        const appId = toCleanText((conversation.metadata as any)?.appId as string) || conversation.channelKey;
        if (!appId || !appSecret) {
          throw new Error("Missing WeChat credentials");
        }

        await wechatSendText({
          openId: envelope.threadId,
          text: payload.text,
          appId,
          appSecret,
        });
        return;
      }

      throw new Error(`Unsupported channel '${channel}'`);
    } catch (error: unknown) {
      attempt += 1;
      Logger.warn(`[Channels] outbound send failed (attempt ${attempt}/${maxRetries + 1})`, {
        conversation: payload.conversationKey,
        channel,
        senderId: payload.senderId,
        runId: payload.runId,
        requestId: payload.requestId,
        reason: String((error as Error)?.message || error),
      });

      if (attempt > maxRetries) throw error;

      await new Promise((resolve) => setTimeout(resolve, SEND_RETRY_BACKOFF_MS * attempt));
    }
  }
}

function mapToLlmMessages(
  history: MessageRecord[],
  userContent: string,
  stylePrompt: string | null,
): ChatCompletionMessageParam[] {
  const mapped: ChatCompletionMessageParam[] = [];

  if (stylePrompt) {
    mapped.push({ role: "system", content: stylePrompt });
  }

  const bounded = history.slice(-MAX_STREAM_CONTEXT);
  for (const message of bounded) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    if (!message.content) continue;
    mapped.push({ role: message.role, content: message.content });
  }

  mapped.push({ role: "user", content: userContent });

  return mapped;
}

async function createRunForMessage(
  chatId: string,
  requestId: string,
  userMessageId: string,
) {
  try {
    return await storage.createChatRun({
      chatId,
      clientRequestId: requestId,
      userMessageId,
      status: "pending",
    });
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }

    const fallback = await storage.getChatRunByClientRequestId(chatId, requestId);
    if (fallback) return fallback;
    throw error;
  }
}

function timeoutMsForChannel(channel: ExternalChannel): number {
  if (channel === "telegram") return 90_000;
  return ORCHESTRATION_TIMEOUT_MS;
}

async function safeQueue<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = conversationQueues.get(key) || Promise.resolve();
  const wrapped = previous
    .catch((error) => {
      Logger.warn(`[Channels] previous job for conversation failed: ${String(error?.message || error)}`);
    })
    .then(async () => task());

  conversationQueues.set(
    key,
    wrapped.catch(() => undefined) as Promise<void>,
  );

  try {
    return await wrapped;
  } finally {
    if (conversationQueues.get(key) === wrapped) {
      conversationQueues.delete(key);
    }
  }
}

async function abortPreviousRunForConversation(conversationKey: string): Promise<void> {
  const existing = inFlightRunsByConversation.get(conversationKey);
  if (!existing) return;
  try {
    existing.abort();
  } catch (error) {
    // best effort
  } finally {
    inFlightRunsByConversation.delete(conversationKey);
  }
}

async function runOutboundDecision(
  context: InboundProcessingContext,
  assistantContent: string,
  userMessageId: string,
  runId: string,
): Promise<void> {
  const messageKey = sanitizeRequestIdentifier(runId);
  const requestId = messageKey;
  const payload: SendRequest = {
    text: assistantContent,
    requestId,
    runId,
    conversationKey: context.envelope.conversationKey,
    senderId: context.envelope.threadId,
  };

  await sendTextWithRetries(context.jobChannel, context.account, context.conversation, context.envelope, payload);

  await touchChannelConversationHeartbeat(context.conversation.id, {
    lastOutboundAt: nowIso(),
    lastInboundAt: nowIso(),
  });

  await storage.updateChatMessageContent(payload.requestId, assistantContent, {
    status: "done",
    content: assistantContent,
  } as any);

  await storage.updateChatRunStatus(runId, "done").catch(() => null);
  await storage.updateChatRunLastSeq(runId, 0).catch(() => null);

  Logger.info("[Channels] outbound completed", {
    runId,
    conversation: payload.conversationKey,
    channel: context.jobChannel,
    requestId,
    userMessageId,
  });
}

function sanitizeRequestIdentifier(value: string): string {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\u0000/g, "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .slice(0, MAX_REQUEST_ID_LENGTH);
}

async function processAllowedMessage(context: InboundProcessingContext): Promise<void> {
  const { envelope, account, conversation, runtimeConfig, jobChannel } = context;

  const safeMessageId = normalizeIdentifier(envelope.providerMessageId, MAX_ID_LENGTH);
  const safeSenderId = normalizeIdentifier(envelope.senderId, MAX_ID_LENGTH);
  const safeThreadId = normalizeIdentifier(envelope.threadId, MAX_ID_LENGTH);
  const safeChannelKey = normalizeIdentifier(envelope.channelKey, MAX_ID_LENGTH);
  const safeWorkspaceId = normalizeIdentifier(envelope.conversationKey.workspaceId, MAX_WORKSPACE_ID_LENGTH);
  if (!safeMessageId || !safeSenderId || !safeThreadId || !safeChannelKey || !safeWorkspaceId) {
    Logger.warn("[Channels] inbound message rejected due to malformed identifiers", {
      conversation: envelope.conversationKey,
      providerMessageId: envelope.providerMessageId,
      senderId: envelope.senderId,
      threadId: envelope.threadId,
      channelKey: envelope.channelKey,
      workspaceId: envelope.conversationKey.workspaceId,
    });
    return;
  }

  const safeEnvelope: MessageEnvelope = {
    ...envelope,
    providerMessageId: safeMessageId,
    senderId: safeSenderId,
    threadId: safeThreadId,
    channelKey: safeChannelKey,
    conversationKey: {
      ...envelope.conversationKey,
      workspaceId: safeWorkspaceId,
      channelAccountId: safeChannelKey,
      threadId: safeThreadId,
    },
  };

  const messageId = safeMessageId;
  const conversationKey = serializeConversationKey(safeEnvelope.conversationKey);
  const scopedRequestId = buildConversationScopedRequestId(conversationKey, messageId);

  pruneMessageIdLedger();
  pruneRateBuckets();

  if (!isAllowedToQueue(conversationKey, messageId)) {
    const existing = await storage.findMessageByRequestId(scopedRequestId);
    if (existing) {
      Logger.info("[Channels] Duplicate inbound message ignored", {
        conversation: safeEnvelope.conversationKey,
        messageId: scopedRequestId,
        channel: jobChannel,
      });
      return;
    }
  }

  const existingMessage = await storage.findMessageByRequestId(scopedRequestId);
  if (existingMessage) {
    Logger.info("[Channels] Duplicate inbound message ignored", {
      conversation: safeEnvelope.conversationKey,
      messageId: scopedRequestId,
      channel: jobChannel,
    });
    return;
  }

  const pairingCode = parseChannelPairingCodeFromMessage(safeEnvelope.text || "");
  if (pairingCode) {
    const consumed = await consumeChannelPairingCode({
      channel: jobChannel,
      code: pairingCode,
      consumedByExternalId: safeEnvelope.senderId,
    });

    if (consumed?.userId) {
      await setConversationOwnerIdentity(conversation.id, {
        ownerExternalId: safeEnvelope.senderId,
        owners: [safeEnvelope.senderId],
        linkedAt: nowIso(),
      });

      const ackText = `✅ Handshake confirmado. Tu cuenta está vinculada para este chat (${jobChannel}).`;
      await runOutboundDecision({
        ...context,
        jobChannel,
        envelope: safeEnvelope,
        account,
        conversation,
        runtimeConfig,
      }, ackText, "", sanitizeRequestIdentifier(scopedRequestId));
      return;
    }

    await runOutboundDecision({
      ...context,
      jobChannel,
      envelope: safeEnvelope,
      account,
      conversation,
      runtimeConfig,
    }, "❌ Código no válido o caducado. Solicita un nuevo QR/código de vinculación.", "", sanitizeRequestIdentifier(scopedRequestId));
    return;
  }

  const policyConfig = getConversationPolicy(conversation);
  const rateControl = isAllowedByRateLimit(serializeConversationKey(safeEnvelope.conversationKey), policyConfig.rateLimitPerMinute);

      const policyContext = {
    conversation,
    envelope: safeEnvelope,
    runtimeConfig,
    globalResponderEnabled: runtimeConfig.responder_enabled,
  };

  const policyResult = evaluateChannelPolicy(policyContext, getConversationWindowState(conversation), {
    allowed: rateControl.allowed,
    retryAfterIso: rateControl.retryAfterMs ? new Date(Date.now() + rateControl.retryAfterMs).toISOString() : undefined,
  });
  const policy = policyResult.ok ? policyResult.data : policyResult.data;

  if (!policy.allowed) {
    const shouldRespond = policy.shouldRespond !== false;
    Logger.warn("[Channels] inbound message blocked by policy", {
      conversation: safeEnvelope.conversationKey,
      messageId: scopedRequestId,
      policyCode: policy.code,
      channel: jobChannel,
      shouldRespond,
      senderId: safeEnvelope.senderId,
    });

    if (!shouldRespond) return;

    await runOutboundDecision(
      {
        ...context,
        jobChannel,
        envelope: safeEnvelope,
        account,
        conversation,
        runtimeConfig,
      },
      policy.replyText,
      "",
      sanitizeRequestIdentifier(scopedRequestId),
    );
    return;
  }

  const userMessagePayload = {
    chatId: conversation.chatId,
    role: "user",
    content: buildIncomingTextForHistory(safeEnvelope),
    status: "done",
    requestId: scopedRequestId,
    attachments: buildMessageAttachments(safeEnvelope),
    metadata: {
      runSource: "channel_ingest",
      providerMessageId: messageId,
      channel: safeEnvelope.channel,
      threadId: safeThreadId,
      conversationKey: safeEnvelope.conversationKey,
      receivedAt: safeEnvelope.receivedAt,
      messageType: safeEnvelope.messageType,
      sourceMetadata: asAttachmentFromEnvelope(safeEnvelope),
    },
  } as any;

  const userMessage = await storage.createChatMessage(userMessagePayload);
  const run = await createRunForMessage(conversation.chatId, scopedRequestId, userMessage.id);
  if (!run) {
    Logger.error("[Channels] could not create chat run", {
      messageId: scopedRequestId,
      conversation: safeEnvelope.conversationKey,
      channel: jobChannel,
    });
    return;
  }

  const claimedRun = await storage.claimPendingRun(conversation.chatId, scopedRequestId);
  if (!claimedRun) {
    const current = await storage.getChatRunByClientRequestId(conversation.chatId, scopedRequestId);
    if (current && (current.status === "processing" || current.status === "done")) {
      Logger.info("[Channels] run already claimed or done, skipping", {
        messageId: scopedRequestId,
        runId: current?.id,
        status: current?.status,
      });
      return;
    }
  }

  const activeRun = claimedRun ?? run;
  const runId = activeRun.id;
  const runAbort = new AbortController();
  inFlightRunsByConversation.set(conversationKey, runAbort);
  const safeRunId = sanitizeRequestIdentifier(runId);
  let assistantMessageId: string | null = null;

  const start = Date.now();

  try {
    const attachmentForPrompt = buildIncomingTextForHistory(safeEnvelope);

    const stylePrompt = buildResponseStyleSystemPrompt(runtimeConfig, safeEnvelope.channel);
    const historicalMessages = (await storage.getChatMessages(conversation.chatId, { orderBy: "asc", limit: MAX_STREAM_CONTEXT }))
      .slice(-RUN_QUEUE_MAX_HISTORY)
      .filter((msg) => msg.role === "user" || msg.role === "assistant");

    const llmMessages = mapToLlmMessages(historicalMessages, attachmentForPrompt, stylePrompt);

    const assistantPlaceholder = await storage.createChatMessage({
      chatId: conversation.chatId,
      role: "assistant",
      content: "",
      status: "pending",
      runId,
      userMessageId: userMessage.id,
      requestId: `${safeRunId}:assistant`,
    });
    assistantMessageId = assistantPlaceholder.id;

    await storage.updateChatRunAssistantMessage(runId, assistantMessageId);

    let output = "";
    let lastSeq = -1;
    const stream = llmGateway.streamChat(llmMessages, {
      userId: conversation.userId || account.userId,
      requestId: runId,
      timeout: timeoutMsForChannel(jobChannel),
      maxTokens: 1500,
    });

    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error("Channel orchestration timeout"));
      }, timeoutMsForChannel(jobChannel) + 10_000);
    });

    try {
      await Promise.race([
        (async () => {
          for await (const chunk of stream) {
            if (runAbort.signal.aborted) {
              throw new Error("Run aborted due to new message in same conversation");
            }

            output += chunk.content;
            lastSeq = chunk.sequenceId;
            if (lastSeq > -1) {
              await storage.updateChatRunLastSeq(runId, lastSeq).catch(() => null);
            }
          }
        })(),
        timeout,
      ]);
    } catch (streamError) {
      throw streamError;
    }

    if (!output.trim()) {
      output = "No pude redactar una respuesta en este momento. Reintenta en unos segundos.";
    }

    await storage.updateChatMessageContent(assistantMessageId, output, {
      status: "done",
      metadata: {
        runId,
        requestId: scopedRequestId,
        sourceChannel: jobChannel,
        conversationKey: safeEnvelope.conversationKey,
      },
    });

    await storage.updateChatRunStatus(runId, "done");

    await sendTextWithRetries(
      jobChannel,
      account,
      conversation,
      safeEnvelope,
      {
        text: output,
        requestId: scopedRequestId,
        runId,
        conversationKey: safeEnvelope.conversationKey,
        senderId: safeEnvelope.threadId,
      },
      SEND_RETRY_ATTEMPTS,
    );

    await touchChannelConversationHeartbeat(conversation.id, {
      lastOutboundAt: nowIso(),
    });

    Logger.info("[Channels] message processed", {
      runId,
      conversation: safeEnvelope.conversationKey,
      channel: jobChannel,
      elapsedMs: Date.now() - start,
    });
  } catch (err) {
    const reason = String((err as Error)?.message || err);
    const fallback = "No puedo responder ahora. Reintenta en unos minutos.";

    if (assistantMessageId) {
      await storage.updateChatMessageContent(assistantMessageId, fallback, {
        status: "failed",
        metadata: {
          runId,
          requestId: scopedRequestId,
          error: reason,
          sourceChannel: jobChannel,
        },
      }).catch(() => null);
    }

    await storage.updateChatRunStatus(runId, "failed", reason).catch(() => null);
    await patchConversationMetadata(conversation.id, {
      lastError: reason,
      lastErrorAt: nowIso(),
      lastRunId: runId,
    }).catch(() => null);

    try {
      await sendTextWithRetries(
        jobChannel,
        account,
        conversation,
        safeEnvelope,
        {
          text: fallback,
          requestId: scopedRequestId,
          runId,
          conversationKey: safeEnvelope.conversationKey,
          senderId: safeEnvelope.threadId,
        },
        0,
      );
    } catch (sendError) {
      Logger.error("[Channels] fallback send failed", {
        conversation: safeEnvelope.conversationKey,
        channel: jobChannel,
        error: String((sendError as Error)?.message || sendError),
      });
    }

    Logger.error("[Channels] failed to process inbound message", {
      messageId: scopedRequestId,
      runId,
      conversation: safeEnvelope.conversationKey,
      channel: jobChannel,
      error: reason,
    });
  } finally {
    inFlightRunsByConversation.delete(conversationKey);
    await touchChannelConversationHeartbeat(conversation.id, { lastInboundAt: safeEnvelope.receivedAt || nowIso() }).catch(() => null);
  }
}

export async function processChannelIngestJob(job: ChannelIngestJob): Promise<void> {
  const envelopes = envelopeFromRaw(job, job.channel);
  if (!envelopes.length) {
    Logger.warn(`[Channels] no normalized envelopes`, { channel: job.channel });
    return;
  }

  if (envelopes.length > MAX_ENVELOPES_PER_JOB) {
    Logger.warn("[Channels] too many inbound envelopes in one webhook payload, truncating", {
      channel: job.channel,
      envelopeCount: envelopes.length,
      maxEnvelopesPerJob: MAX_ENVELOPES_PER_JOB,
    });
    envelopes.length = MAX_ENVELOPES_PER_JOB;
  }

  for (const [envelopeIndex, rawEnvelope] of envelopes.entries()) {
    const safeChannelKey = normalizeIdentifier(rawEnvelope.channelKey, MAX_ID_LENGTH);
    const safeThreadId = normalizeIdentifier(rawEnvelope.threadId, MAX_ID_LENGTH);
    const safeSenderId = normalizeIdentifier(rawEnvelope.senderId, MAX_ID_LENGTH);
    const safeProviderMessageId =
      normalizeIdentifier(rawEnvelope.providerMessageId, MAX_ID_LENGTH)
      || buildDeterministicFallbackProviderMessageId([
        job.channel,
        rawEnvelope.channelKey,
        rawEnvelope.threadId,
        rawEnvelope.senderId,
        rawEnvelope.receivedAt,
        envelopeIndex,
      ]);

    if (!safeChannelKey || !safeThreadId || !safeSenderId) {
      Logger.warn("[Channels] inbound envelope has invalid identifiers", {
        channel: job.channel,
        threadId: rawEnvelope.threadId,
        channelKey: rawEnvelope.channelKey,
        senderId: rawEnvelope.senderId,
      });
      continue;
    }

    const normalizedEnvelope: MessageEnvelope = {
      ...rawEnvelope,
      providerMessageId: safeProviderMessageId,
      channelKey: safeChannelKey,
      threadId: safeThreadId,
      senderId: safeSenderId,
      receivedAt: sanitizeReceivedAt(rawEnvelope.receivedAt),
      messageType: sanitizeMessageType(rawEnvelope.messageType),
      conversationKey: {
        ...rawEnvelope.conversationKey,
        channel: rawEnvelope.channel,
        workspaceId: normalizeIdentifier(rawEnvelope.conversationKey?.workspaceId, MAX_WORKSPACE_ID_LENGTH) || "workspace:unknown",
        channelAccountId: safeChannelKey,
        threadId: safeThreadId,
      },
    };

    const account = await resolveChannelAccount(job.channel, normalizedEnvelope);
    if (!account) {
      Logger.warn(`[Channels] account not found`, {
        channel: job.channel,
        threadId: normalizedEnvelope.threadId,
        channelKey: normalizedEnvelope.channelKey,
      });
      continue;
    }

    let envelope = withConversationDefaults(account, normalizedEnvelope);
    const workspaceId = buildConversationWorkspaceId(account);
    envelope = withConversationKeyDefaults(envelope, workspaceId, envelope.channelKey, envelope.threadId);

    const conversation = await getOrCreateChannelConversation({
      userId: account.userId,
      channel: envelope.channel,
      channelKey: envelope.channelKey,
      externalConversationId: envelope.threadId,
      title: `Canal ${envelope.channel}: ${envelope.threadId}`,
      metadata: {
        runtime: getExplicitRuntimeMetadata(account.metadata),
        createdVia: "inbound",
        channelAccountId: envelope.channelKey,
      },
    });

    const mergedRuntimeConfig = mergeRuntimeConfig(account.metadata, conversation.metadata as Record<string, unknown> | null);

    const context: InboundProcessingContext = {
      jobChannel: job.channel,
      envelope,
      account,
      conversation,
      runtimeConfig: mergedRuntimeConfig,
    };

    const queueKey = serializeConversationKey(envelope.conversationKey);
    await safeQueue(queueKey, async () => {
      await abortPreviousRunForConversation(queueKey);

      const runAbort = inFlightRunsByConversation.get(queueKey) || new AbortController();
      inFlightRunsByConversation.set(queueKey, runAbort);

      await processAllowedMessage(context);
    }).catch((error) => {
      Logger.error("[Channels] conversation queue processing error", {
        error: String(error?.message || error),
        channel: job.channel,
        conversation: envelope.conversationKey,
      });
    });
  }
}
