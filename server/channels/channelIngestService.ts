import { randomUUID } from "crypto";

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
import { buildResponseStyleSystemPrompt, resolveRuntimeConfig } from "./runtimeConfig";
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
const DEFAULT_MEDIA_LABEL = {
  image: "[Imagen recibida]",
  audio: "[Audio recibido]",
  document: "[Documento recibido]",
};

const inFlightRunsByConversation = new Map<string, AbortController>();
const conversationQueues = new Map<string, Promise<void>>();
const seenProviderMessageIds = new Map<string, number>();
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

function toCleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeTextPayload(value: string): string {
  const trimmed = toCleanText(value);
  return trimmed.length > 0 ? trimmed : "";
}

function buildConversationWorkspaceId(account: ChannelAccount): string {
  return `workspace:${account.userId}`;
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

function isAllowedToQueue(providerMessageId: string): boolean {
  const lastSeen = seenProviderMessageIds.get(providerMessageId) || 0;
  if (!lastSeen) {
    seenProviderMessageIds.set(providerMessageId, Date.now());
    return true;
  }
  return false;
}

function pruneMessageIdLedger(ttlMs = 5 * 60 * 1000): void {
  const now = Date.now();
  for (const [id, seenAt] of seenProviderMessageIds.entries()) {
    if (now - seenAt > ttlMs) seenProviderMessageIds.delete(id);
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
  return {
    ...resolveRuntimeConfig(accountMetadata ?? null),
    ...resolveRuntimeConfig(conversationMetadata ?? null),
  };
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
  return String(value || "").trim().slice(0, 120);
}

async function processAllowedMessage(context: InboundProcessingContext): Promise<void> {
  const { envelope, account, conversation, runtimeConfig, jobChannel } = context;

  const messageId = envelope.providerMessageId;
  const conversationKey = serializeConversationKey(envelope.conversationKey);

  pruneMessageIdLedger();
  pruneRateBuckets();
  if (!messageId || !envelope.senderId || !envelope.threadId || !envelope.channelKey) {
    Logger.warn("[Channels] inbound message missing required IDs", {
      conversation: envelope.conversationKey,
      senderId: envelope.senderId,
      threadId: envelope.threadId,
      channelKey: envelope.channelKey,
      providerMessageId: messageId,
    });
    return;
  }

  if (!isAllowedToQueue(messageId)) {
    const existing = await storage.findMessageByRequestId(messageId);
    if (existing) {
      Logger.info("[Channels] Duplicate inbound message ignored", {
        conversation: envelope.conversationKey,
        messageId,
        channel: jobChannel,
      });
      return;
    }
  }

  const existingMessage = await storage.findMessageByRequestId(messageId);
  if (existingMessage) {
    Logger.info("[Channels] Duplicate inbound message ignored", {
      conversation: envelope.conversationKey,
      messageId,
      channel: jobChannel,
    });
    return;
  }

  const pairingCode = parseChannelPairingCodeFromMessage(envelope.text || "");
  if (pairingCode) {
    const consumed = await consumeChannelPairingCode({
      channel: jobChannel,
      code: pairingCode,
      consumedByExternalId: envelope.senderId,
    });

    if (consumed?.userId) {
      await setConversationOwnerIdentity(conversation.id, {
        ownerExternalId: envelope.senderId,
        owners: [envelope.senderId],
        linkedAt: nowIso(),
      });

      const ackText = `✅ Handshake confirmado. Tu cuenta está vinculada para este chat (${jobChannel}).`;
      await runOutboundDecision({
        ...context,
        jobChannel,
        envelope,
        account,
        conversation,
        runtimeConfig,
      }, ackText, "", sanitizeRequestIdentifier(messageId));
      return;
    }

    await runOutboundDecision({
      ...context,
      jobChannel,
      envelope,
      account,
      conversation,
      runtimeConfig,
    }, "❌ Código no válido o caducado. Solicita un nuevo QR/código de vinculación.", "", sanitizeRequestIdentifier(messageId));
    return;
  }

  const policyConfig = getConversationPolicy(conversation);
  const rateControl = isAllowedByRateLimit(serializeConversationKey(envelope.conversationKey), policyConfig.rateLimitPerMinute);

  const policyContext = {
    conversation,
    envelope,
    runtimeConfig,
    globalResponderEnabled: runtimeConfig.responder_enabled,
  };

  const policy = evaluateChannelPolicy(policyContext, getConversationWindowState(conversation), {
    allowed: rateControl.allowed,
    retryAfterIso: rateControl.retryAfterMs ? new Date(Date.now() + rateControl.retryAfterMs).toISOString() : undefined,
  });
  if (!policy.allowed) {
    const shouldRespond = policy.shouldRespond !== false;
    Logger.warn("[Channels] inbound message blocked by policy", {
      conversation: envelope.conversationKey,
      messageId,
      policyCode: policy.code,
      channel: jobChannel,
      shouldRespond,
      senderId: envelope.senderId,
    });

    if (!shouldRespond) return;

    await runOutboundDecision(
      {
        ...context,
        jobChannel,
        envelope,
        account,
        conversation,
        runtimeConfig,
      },
      policy.replyText,
      "",
      sanitizeRequestIdentifier(messageId),
    );
    return;
  }

  const userMessagePayload = {
    chatId: conversation.chatId,
    role: "user",
    content: buildIncomingTextForHistory(envelope),
    status: "done",
    requestId: messageId,
    attachments: buildMessageAttachments(envelope),
    metadata: {
      runSource: "channel_ingest",
      providerMessageId: messageId,
      channel: envelope.channel,
      threadId: envelope.threadId,
      conversationKey: envelope.conversationKey,
      receivedAt: envelope.receivedAt,
      messageType: envelope.messageType,
      sourceMetadata: asAttachmentFromEnvelope(envelope),
    },
  } as any;

  const userMessage = await storage.createChatMessage(userMessagePayload);
  const run = await createRunForMessage(conversation.chatId, messageId, userMessage.id);
  if (!run) {
    Logger.error("[Channels] could not create chat run", {
      messageId,
      conversation: envelope.conversationKey,
      channel: jobChannel,
    });
    return;
  }

  const claimedRun = await storage.claimPendingRun(conversation.chatId, messageId);
  if (!claimedRun) {
    const current = await storage.getChatRunByClientRequestId(conversation.chatId, messageId);
    if (!current || current.status === "processing" || current.status === "done") {
      Logger.info("[Channels] run already claimed or done, skipping", {
        messageId,
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
    const attachmentForPrompt = buildIncomingTextForHistory(envelope);

    const stylePrompt = buildResponseStyleSystemPrompt(runtimeConfig, jobChannel);
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
        requestId: messageId,
        sourceChannel: jobChannel,
        conversationKey: envelope.conversationKey,
      },
    });

    await storage.updateChatRunStatus(runId, "done");

    await sendTextWithRetries(
      jobChannel,
      account,
      conversation,
      envelope,
      {
        text: output,
        requestId: messageId,
        runId,
        conversationKey: envelope.conversationKey,
        senderId: envelope.threadId,
      },
      SEND_RETRY_ATTEMPTS,
    );

    await touchChannelConversationHeartbeat(conversation.id, {
      lastOutboundAt: nowIso(),
    });

    Logger.info("[Channels] message processed", {
      runId,
      conversation: envelope.conversationKey,
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
          requestId: messageId,
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
        envelope,
        {
          text: fallback,
          requestId: messageId,
          runId,
          conversationKey: envelope.conversationKey,
          senderId: envelope.threadId,
        },
        0,
      );
    } catch (sendError) {
      Logger.error("[Channels] fallback send failed", {
        conversation: envelope.conversationKey,
        channel: jobChannel,
        error: String((sendError as Error)?.message || sendError),
      });
    }

    Logger.error("[Channels] failed to process inbound message", {
      messageId,
      runId,
      conversation: envelope.conversationKey,
      channel: jobChannel,
      error: reason,
    });
  } finally {
    inFlightRunsByConversation.delete(conversationKey);
    await touchChannelConversationHeartbeat(conversation.id, { lastInboundAt: envelope.receivedAt || nowIso() }).catch(() => null);
  }
}

export async function processChannelIngestJob(job: ChannelIngestJob): Promise<void> {
  const envelopes = envelopeFromRaw(job, job.channel);
  if (!envelopes.length) {
    Logger.warn(`[Channels] no normalized envelopes`, { channel: job.channel });
    return;
  }

  for (const rawEnvelope of envelopes) {
    const account = await resolveChannelAccount(job.channel, rawEnvelope);
    if (!account) {
      Logger.warn(`[Channels] account not found`, {
        channel: job.channel,
        threadId: rawEnvelope.threadId,
        channelKey: rawEnvelope.channelKey,
      });
      continue;
    }

    let envelope = withConversationDefaults(account, rawEnvelope);
    const workspaceId = buildConversationWorkspaceId(account);
    envelope = withConversationKeyDefaults(envelope, workspaceId, envelope.channelKey, envelope.threadId);

    const conversation = await getOrCreateChannelConversation({
      userId: account.userId,
      channel: envelope.channel,
      channelKey: envelope.channelKey,
      externalConversationId: envelope.threadId,
      title: `Canal ${envelope.channel}: ${envelope.threadId}`,
      metadata: {
        runtime: {
          ...(resolveRuntimeConfig(account.metadata).responder_enabled !== undefined
            ? { responder_enabled: resolveRuntimeConfig(account.metadata).responder_enabled }
            : {}),
          ...(resolveRuntimeConfig(account.metadata).owner_only !== undefined
            ? { owner_only: resolveRuntimeConfig(account.metadata).owner_only }
            : {}),
        },
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
