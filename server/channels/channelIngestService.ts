import { and, eq } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../db";
import { Logger } from "../lib/logger";
import { storage } from "../storage";
import { chatMessages } from "@shared/schema";
import type { ChannelIngestJob } from "./types";
import {
  consumeChannelPairingCode,
  getChannelConversation,
  getOrCreateChannelConversation,
  findWhatsAppCloudAccountByPhoneNumberId,
  findMessengerAccountByPageId,
  findWeChatAccountByAppId,
  findTelegramAccountByUserId,
} from "./channelStore";
import { telegramSendMessage, telegramSendDocument } from "./telegram/telegramApi";
import { sendWhatsAppCloudText, sendWhatsAppCloudDocument } from "./whatsappCloud/whatsappCloudApi";
import { evaluateWhatsAppPolicy } from "./whatsappCloud/whatsappPolicy";
import { messengerSendText, messengerSendDocument } from "./messenger/messengerApi";
import { evaluateMessengerPolicy } from "./messenger/messengerPolicy";
import { wechatSendText, wechatSendDocument, parseWeChatXml } from "./wechat/wechatApi";
import { evaluateWeChatPolicy } from "./wechat/wechatPolicy";
import { createUnifiedRun, executeUnifiedChat } from "../agent/unifiedChatHandler";
import { normalizeMessengerMessages, normalizeWeChatMessage, normalizeWhatsAppMessages } from "./inboundNormalization";
import { buildResponseStyleSystemPrompt, isSenderAllowedByPolicy, resolveRuntimeConfig } from "./runtimeConfig";
import { MemorySseResponse } from "../integrations/whatsappWebAutoReply";
import type { Response } from "express";
import fs from "fs/promises";
import path from "path";

function isUniqueViolation(err: unknown): boolean {
  return (err as any)?.code === "23505";
}

async function getChatMessageByRequestId(requestId: string) {
  const [row] = await db.select().from(chatMessages).where(eq(chatMessages.requestId, requestId)).limit(1);
  return row ?? null;
}

async function getAssistantForUserMessage(userMessageId: string) {
  const [row] = await db
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.userMessageId, userMessageId), eq(chatMessages.role, "assistant")))
    .limit(1);
  return row ?? null;
}

async function upsertUserMessage(input: {
  chatId: string;
  requestId: string;
  content: string;
  metadata: Record<string, unknown>;
}) {
  try {
    return await storage.createChatMessage({
      chatId: input.chatId,
      role: "user",
      content: input.content,
      requestId: input.requestId,
      status: "done",
      metadata: input.metadata,
    });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const existing = await getChatMessageByRequestId(input.requestId);
    if (!existing) throw e;
    return existing;
  }
}

async function upsertAssistantMessage(input: {
  chatId: string;
  requestId: string;
  content: string;
  userMessageId: string;
  metadata: Record<string, unknown>;
}) {
  try {
    return await storage.createChatMessage({
      chatId: input.chatId,
      role: "assistant",
      content: input.content,
      requestId: input.requestId,
      userMessageId: input.userMessageId,
      status: "done",
      metadata: input.metadata,
    });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const existing = await getChatMessageByRequestId(input.requestId);
    if (!existing) throw e;
    return existing;
  }
}

function telegramDisplayName(from: any, fallback: string): string {
  const name = [from?.first_name, from?.last_name].filter(Boolean).join(" ").trim();
  return name || from?.username || fallback;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * Shared helper: runs the LLM pipeline and returns the assistant text + MemorySseResponse.
 * Eliminates duplication across the 4 channel handlers.
 */
async function runChannelLlm(input: {
  channel: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  chatId: string;
  userId: string;
  msgPrefix: string;
  fallbackText: string;
  timeoutMs?: number;
}): Promise<{ assistantText: string; memRes: MemorySseResponse }> {
  const memRes = new MemorySseResponse();
  let assistantText = "";
  try {
    const unifiedContext = await createUnifiedRun({
      messages: input.messages,
      chatId: input.chatId,
      userId: input.userId,
      messageId: `${input.msgPrefix}_${Date.now()}`,
    });
    await withTimeout(
      executeUnifiedChat(
        unifiedContext,
        {
          messages: input.messages,
          chatId: input.chatId,
          userId: input.userId,
          messageId: `${input.msgPrefix}_${Date.now()}`,
        },
        memRes as any as Response,
      ),
      input.timeoutMs ?? 120_000,
      `${input.channel} AI`,
    );
    assistantText = memRes.chunks
      .filter((c: any) => c.event === "chunk" && typeof c.data?.content === "string")
      .map((c: any) => c.data.content)
      .join("")
      .trim();
  } catch (err) {
    Logger.error(`[${input.channel}] LLM processing failed`, {
      chatId: input.chatId,
      userId: input.userId,
      err,
    });
    assistantText = input.fallbackText;
  }
  return { assistantText: assistantText || input.fallbackText, memRes };
}

const ARTIFACT_MIME_MAP: Record<string, string> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".pdf": "application/pdf",
};

async function sendChannelArtifacts(
  memRes: MemorySseResponse,
  channel: "telegram" | "whatsapp_cloud" | "messenger" | "wechat",
  recipientId: string,
  opts?: {
    phoneNumberId?: string;
    accessToken?: string;
    appId?: string;
    appSecret?: string;
  },
): Promise<void> {
  const artifactEvents = memRes.chunks.filter(
    (c: any) => c.event === "artifacts" && c.data?.artifacts,
  );
  for (const evt of artifactEvents) {
    const artifacts: Array<{ type?: string; url?: string; name?: string }> =
      (evt as any).data.artifacts || [];
    for (const artifact of artifacts) {
      if (!artifact.name) continue;
      const filePath = path.join(process.cwd(), "generated_artifacts", artifact.name);
      try {
        const fileBuffer = await fs.readFile(filePath);
        const ext = path.extname(artifact.name).toLowerCase();
        const mimetype = ARTIFACT_MIME_MAP[ext] || "application/octet-stream";
        if (channel === "telegram") {
          await telegramSendDocument(recipientId, fileBuffer, artifact.name, mimetype);
        } else if (channel === "whatsapp_cloud" && opts?.phoneNumberId && opts?.accessToken) {
          await sendWhatsAppCloudDocument({
            phoneNumberId: opts.phoneNumberId,
            to: recipientId,
            fileBuffer,
            fileName: artifact.name,
            mimeType: mimetype,
            accessToken: opts.accessToken,
          });
        } else if (channel === "messenger" && opts?.accessToken) {
          await messengerSendDocument({
            recipientId,
            fileBuffer,
            fileName: artifact.name,
            mimeType: mimetype,
            accessToken: opts.accessToken,
          });
        } else if (channel === "wechat" && opts?.appId && opts?.appSecret) {
          await wechatSendDocument({
            openId: recipientId,
            fileBuffer,
            fileName: artifact.name,
            mimeType: mimetype,
            appId: opts.appId,
            appSecret: opts.appSecret,
          });
        }
      } catch (fileErr: any) {
        Logger.error(
          `[${channel}] Failed to send artifact "${artifact.name}"`,
          fileErr?.message || fileErr,
        );
      }
    }
  }
}

const inboundMessageDedupe = new Map<string, number>();
const senderRateWindow = new Map<string, number[]>();
const DEDUPE_TTL_MS = 10 * 60 * 1000;

function isDuplicateInbound(key: string): boolean {
  const now = Date.now();
  for (const [k, ts] of inboundMessageDedupe.entries()) {
    if (now - ts > DEDUPE_TTL_MS) inboundMessageDedupe.delete(k);
  }
  if (inboundMessageDedupe.has(key)) return true;
  inboundMessageDedupe.set(key, now);
  return false;
}

function isRateLimited(senderKey: string, limitPerMinute: number): boolean {
  const now = Date.now();
  const windowStart = now - 60_000;
  const bucket = (senderRateWindow.get(senderKey) ?? []).filter((t) => t >= windowStart);
  bucket.push(now);
  senderRateWindow.set(senderKey, bucket);
  return bucket.length > limitPerMinute;
}

function parseTelegramStartCode(text: string): string | null {
  const trimmed = text.trim();
  const first = trimmed.split(/\s+/)[0] || "";
  const cmd = first.split("@")[0] || "";
  if (cmd !== "/start") return null;
  const rest = trimmed.slice(first.length).trim();
  return rest || null;
}

type TelegramInbound = {
  tgChatId: string;
  tgMessageId: string;
  updateId: string | null;
  text: string;
  from: any | null;
};

function extractTelegramInbound(update: any): TelegramInbound | null {
  const msg = update?.message;
  const text = msg?.text;
  const chatId = msg?.chat?.id;
  const messageId = msg?.message_id;
  if (text == null || chatId == null || messageId == null) return null;
  if (typeof text !== "string") return null;
  return {
    tgChatId: String(chatId),
    tgMessageId: String(messageId),
    updateId: update?.update_id != null ? String(update.update_id) : null,
    text,
    from: msg?.from ?? null,
  };
}

async function handleTelegram(updateUnknown: unknown): Promise<void> {
  const inbound = extractTelegramInbound(updateUnknown as any);
  if (!inbound) return;

  const startCode = parseTelegramStartCode(inbound.text);
  if (startCode) {
    const consumed = await consumeChannelPairingCode({
      channel: "telegram",
      code: startCode,
      consumedByExternalId: inbound.tgChatId,
    });

    if (!consumed) {
      await telegramSendMessage(inbound.tgChatId, "Codigo invalido o expirado. Genera uno nuevo en la web y vuelve a intentarlo.");
      return;
    }

    const existing = await getChannelConversation({
      channel: "telegram",
      channelKey: "default",
      externalConversationId: inbound.tgChatId,
    });

    if (existing && existing.userId !== consumed.userId) {
      await telegramSendMessage(inbound.tgChatId, "Este chat ya esta vinculado a otra cuenta. Si necesitas cambiarlo, desvincula primero desde la web.");
      return;
    }

    await getOrCreateChannelConversation({
      userId: consumed.userId,
      channel: "telegram",
      channelKey: "default",
      externalConversationId: inbound.tgChatId,
      title: `Telegram: ${telegramDisplayName(inbound.from, inbound.tgChatId)}`,
      metadata: {
        telegram: {
          chatId: inbound.tgChatId,
          fromId: inbound.from?.id != null ? String(inbound.from.id) : null,
          username: inbound.from?.username ?? null,
        },
      },
    });

    await telegramSendMessage(inbound.tgChatId, "✅ Listo. Tu cuenta quedo vinculada. Ya puedes escribir aqui.");
    return;
  }

  const convo = await getChannelConversation({
    channel: "telegram",
    channelKey: "default",
    externalConversationId: inbound.tgChatId,
  });

  if (!convo) {
    await telegramSendMessage(
      inbound.tgChatId,
      `Este bot no esta vinculado a tu cuenta. Entra a ${env.BASE_URL} y genera un codigo, luego envia /start <CODIGO>.`,
    );
    return;
  }

  const senderId = inbound.from?.id != null ? String(inbound.from.id) : inbound.tgChatId;
  const providerMessageId = inbound.tgMessageId;
  if (isDuplicateInbound(`telegram:default:${providerMessageId}`)) return;

  const telegramAccount = await findTelegramAccountByUserId(convo.userId);
  const runtimeConfig = resolveRuntimeConfig(telegramAccount?.metadata);
  if (!runtimeConfig.responder_enabled) return;
  if (!isSenderAllowedByPolicy(runtimeConfig, senderId)) return;
  if (isRateLimited(`telegram:${senderId}`, runtimeConfig.rate_limit_per_minute)) return;

  const requestId = `telegram:${inbound.tgChatId}:${providerMessageId}`;
  const userMsg = await upsertUserMessage({
    chatId: convo.chatId,
    requestId,
    content: inbound.text,
    metadata: {
      channel: "telegram",
      channelKey: "default",
      externalConversationId: inbound.tgChatId,
      messageType: "text",
      telegram: {
        updateId: inbound.updateId,
        messageId: providerMessageId,
        fromId: senderId,
        username: inbound.from?.username ?? null,
      },
    },
  });

  const already = await getAssistantForUserMessage(userMsg.id);
  if (already) return;

  const stylePrompt = buildResponseStyleSystemPrompt(runtimeConfig, "Telegram");
  const messages = [
    ...(stylePrompt ? [{ role: "system" as const, content: stylePrompt }] : []),
    { role: "user" as const, content: inbound.text },
  ];

  const { assistantText, memRes } = await runChannelLlm({
    channel: "Telegram",
    messages,
    chatId: convo.chatId,
    userId: convo.userId,
    msgPrefix: "tg_msg",
    fallbackText: "Ahora mismo no puedo responder. Intenta de nuevo en unos minutos.",
  });

  const assistantRequestId = `telegram:assistant:${inbound.tgChatId}:${inbound.tgMessageId}`;

  await upsertAssistantMessage({
    chatId: convo.chatId,
    requestId: assistantRequestId,
    content: assistantText,
    userMessageId: userMsg.id,
    metadata: {
      channel: "telegram",
      replyTo: requestId,
    },
  });

  try {
    await telegramSendMessage(inbound.tgChatId, assistantText);
  } catch (err) {
    Logger.error("[Telegram] Failed to send reply", err);
  }

  // Send generated artifacts (documents) if any
  try {
    await sendChannelArtifacts(memRes, "telegram", inbound.tgChatId);
  } catch (err) {
    Logger.error("[Telegram] Failed to send artifacts", err);
  }
}

async function handleWhatsAppCloud(payloadUnknown: unknown): Promise<void> {
  const inbounds = normalizeWhatsAppMessages(payloadUnknown as any);
  if (inbounds.length === 0) return;

  for (const inbound of inbounds) {
    const account = await findWhatsAppCloudAccountByPhoneNumberId(inbound.phoneNumberId);
    const userId = account?.userId || env.WHATSAPP_CLOUD_DEFAULT_USER_ID || null;
    const accessToken = account?.accessToken || env.WHATSAPP_CLOUD_ACCESS_TOKEN || null;

    if (!userId) {
      Logger.warn("[WhatsAppCloud] No owner user configured for phone_number_id", {
        phoneNumberId: inbound.phoneNumberId,
        from: inbound.senderId,
      });
      continue;
    }

    const runtimeConfig = resolveRuntimeConfig(account?.metadata);
    if (!runtimeConfig.responder_enabled) continue;
    if (!isSenderAllowedByPolicy(runtimeConfig, inbound.senderId)) continue;
    if (isDuplicateInbound(`whatsapp_cloud:${inbound.phoneNumberId}:${inbound.providerMessageId}`)) continue;
    if (isRateLimited(`whatsapp_cloud:${inbound.senderId}`, runtimeConfig.rate_limit_per_minute)) continue;

    const convo = await getOrCreateChannelConversation({
      userId,
      channel: "whatsapp_cloud",
      channelKey: inbound.phoneNumberId,
      externalConversationId: inbound.senderId,
      title: `WhatsApp: ${inbound.contactName ? inbound.contactName : inbound.senderId}`,
      metadata: {
        whatsapp: {
          phoneNumberId: inbound.phoneNumberId,
          from: inbound.senderId,
        },
      },
    });

    const requestId = `whatsapp_cloud:${inbound.phoneNumberId}:${inbound.providerMessageId}`;
    const userMsg = await upsertUserMessage({
      chatId: convo.chatId,
      requestId,
      content: inbound.text,
      metadata: {
        channel: "whatsapp_cloud",
        channelKey: inbound.phoneNumberId,
        externalConversationId: inbound.senderId,
        messageType: inbound.messageType,
        whatsapp: {
          phoneNumberId: inbound.phoneNumberId,
          messageId: inbound.providerMessageId,
          from: inbound.senderId,
          contactName: inbound.contactName,
        },
      },
    });

    const already = await getAssistantForUserMessage(userMsg.id);
    if (already) continue;

    const decision = evaluateWhatsAppPolicy(inbound.text, { baseUrl: env.BASE_URL });

    if (!decision.allowed) {
      const assistantRequestId = `whatsapp_cloud:assistant:${inbound.phoneNumberId}:${inbound.providerMessageId}`;
      await upsertAssistantMessage({
        chatId: convo.chatId,
        requestId: assistantRequestId,
        content: decision.reply,
        userMessageId: userMsg.id,
        metadata: {
          channel: "whatsapp_cloud",
          policy: { allowed: false, reason: decision.reason },
          replyTo: requestId,
        },
      });

      if (accessToken) {
        try {
          await sendWhatsAppCloudText({
            phoneNumberId: inbound.phoneNumberId,
            to: inbound.senderId,
            text: decision.reply,
            accessToken,
          });
        } catch (err) {
          Logger.error("[WhatsAppCloud] Failed to send policy reply", err);
        }
      }
      continue;
    }

    const baseSystemPrompt =
      "Eres un asistente de un negocio atendiendo por WhatsApp. " +
      "Tu alcance es: reservas, soporte y seguimiento. " +
      "Responde breve y pide solo los datos minimos necesarios. " +
      "No ofrezcas acciones fuera de esos flujos.";

    const stylePrompt = buildResponseStyleSystemPrompt(runtimeConfig, "WhatsApp");
    const messages = [
      { role: "system" as const, content: baseSystemPrompt },
      ...(stylePrompt ? [{ role: "system" as const, content: stylePrompt }] : []),
      { role: "user" as const, content: inbound.text },
    ];

    const { assistantText, memRes } = await runChannelLlm({
      channel: "WhatsAppCloud",
      messages,
      chatId: convo.chatId,
      userId: convo.userId,
      msgPrefix: "wa_msg",
      fallbackText: "Ahora mismo no puedo atender tu solicitud. Intenta de nuevo en unos minutos.",
    });

    const assistantRequestId = `whatsapp_cloud:assistant:${inbound.phoneNumberId}:${inbound.providerMessageId}`;

    await upsertAssistantMessage({
      chatId: convo.chatId,
      requestId: assistantRequestId,
      content: assistantText,
      userMessageId: userMsg.id,
      metadata: {
        channel: "whatsapp_cloud",
        policy: { allowed: true, category: decision.category },
        replyTo: requestId,
      },
    });

    if (accessToken) {
      try {
        await sendWhatsAppCloudText({
          phoneNumberId: inbound.phoneNumberId,
          to: inbound.senderId,
          text: assistantText,
          accessToken,
        });
      } catch (err) {
        Logger.error("[WhatsAppCloud] Failed to send reply", err);
      }

      try {
        await sendChannelArtifacts(memRes, "whatsapp_cloud", inbound.senderId, {
          phoneNumberId: inbound.phoneNumberId,
          accessToken,
        });
      } catch (err) {
        Logger.error("[WhatsAppCloud] Failed to send artifacts", err);
      }
    }
  }
}

// ── Messenger ─────────────────────────────────────────────────────

async function handleMessenger(payloadUnknown: unknown): Promise<void> {
  const inbounds = normalizeMessengerMessages(payloadUnknown as any);
  if (inbounds.length === 0) return;

  for (const inbound of inbounds) {
    const account = await findMessengerAccountByPageId(inbound.recipientId || "");
    const userId = account?.userId || env.MESSENGER_DEFAULT_USER_ID || null;
    const accessToken = account?.accessToken || env.MESSENGER_PAGE_ACCESS_TOKEN || null;

    if (!userId || !inbound.recipientId) {
      Logger.warn("[Messenger] No owner user configured for page", { pageId: inbound.recipientId, senderId: inbound.senderId });
      continue;
    }

    const runtimeConfig = resolveRuntimeConfig(account?.metadata);
    if (!runtimeConfig.responder_enabled) continue;
    if (!isSenderAllowedByPolicy(runtimeConfig, inbound.senderId)) continue;
    if (isDuplicateInbound(`messenger:${inbound.recipientId}:${inbound.providerMessageId}`)) continue;
    if (isRateLimited(`messenger:${inbound.senderId}`, runtimeConfig.rate_limit_per_minute)) continue;

    const convo = await getOrCreateChannelConversation({
      userId,
      channel: "messenger",
      channelKey: inbound.recipientId,
      externalConversationId: inbound.senderId,
      title: `Messenger: ${inbound.senderId}`,
      metadata: { messenger: { pageId: inbound.recipientId, senderId: inbound.senderId } },
    });

    const requestId = `messenger:${inbound.recipientId}:${inbound.providerMessageId}`;
    const userMsg = await upsertUserMessage({
      chatId: convo.chatId,
      requestId,
      content: inbound.text,
      metadata: {
        channel: "messenger",
        channelKey: inbound.recipientId,
        externalConversationId: inbound.senderId,
        messageType: inbound.messageType,
        messenger: { messageId: inbound.providerMessageId, senderId: inbound.senderId },
      },
    });

    const already = await getAssistantForUserMessage(userMsg.id);
    if (already) continue;

    const decision = evaluateMessengerPolicy(inbound.text);
    if (!decision.allowed) {
      const assistantRequestId = `messenger:assistant:${inbound.recipientId}:${inbound.providerMessageId}`;
      await upsertAssistantMessage({
        chatId: convo.chatId,
        requestId: assistantRequestId,
        content: decision.reply,
        userMessageId: userMsg.id,
        metadata: { channel: "messenger", policy: { allowed: false, reason: decision.reason }, replyTo: requestId },
      });
      if (accessToken) {
        try {
          await messengerSendText({ recipientId: inbound.senderId, text: decision.reply, accessToken });
        } catch (err) {
          Logger.error("[Messenger] Failed to send policy reply", err);
        }
      }
      continue;
    }

    const stylePrompt = buildResponseStyleSystemPrompt(runtimeConfig, "Messenger");
    const messages = [
      ...(stylePrompt ? [{ role: "system" as const, content: stylePrompt }] : []),
      { role: "user" as const, content: inbound.text },
    ];

    const { assistantText, memRes } = await runChannelLlm({
      channel: "Messenger",
      messages,
      chatId: convo.chatId,
      userId: convo.userId,
      msgPrefix: "msngr_msg",
      fallbackText: "No puedo responder en este momento. Intenta de nuevo más tarde.",
    });

    const assistantRequestId = `messenger:assistant:${inbound.recipientId}:${inbound.providerMessageId}`;

    await upsertAssistantMessage({
      chatId: convo.chatId,
      requestId: assistantRequestId,
      content: assistantText,
      userMessageId: userMsg.id,
      metadata: { channel: "messenger", replyTo: requestId },
    });

    if (accessToken) {
      try {
        await messengerSendText({ recipientId: inbound.senderId, text: assistantText, accessToken });
      } catch (err) {
        Logger.error("[Messenger] Failed to send reply", err);
      }
      try {
        await sendChannelArtifacts(memRes, "messenger", inbound.senderId, { accessToken });
      } catch (err) {
        Logger.error("[Messenger] Failed to send artifacts", err);
      }
    }
  }
}

// ── WeChat ────────────────────────────────────────────────────────

type WeChatParsed = {
  toUserName: string;
  fromUserName: string;
  msgType: string;
  createTime: number;
  event?: string;
  eventKey?: string;
};

function parseWeChatPayload(payloadUnknown: unknown): WeChatParsed | null {
  const raw = typeof payloadUnknown === "string" ? payloadUnknown : null;
  if (!raw) return null;
  const parsed = parseWeChatXml(raw);
  if (!parsed) return null;
  return {
    toUserName: parsed.ToUserName || "",
    fromUserName: parsed.FromUserName || "",
    msgType: parsed.MsgType || "",
    createTime: parseInt(parsed.CreateTime || "0", 10),
    event: parsed.Event || undefined,
    eventKey: parsed.EventKey || undefined,
  };
}

async function handleWeChat(payloadUnknown: unknown): Promise<void> {
  // Handle subscribe events (new followers) with a welcome message
  const wechatEvent = parseWeChatPayload(payloadUnknown);
  if (wechatEvent && wechatEvent.msgType === "event" && wechatEvent.event?.toLowerCase() === "subscribe") {
    const appId = env.WECHAT_APP_ID || null;
    const appSecret = env.WECHAT_APP_SECRET || null;
    if (appId && appSecret) {
      try {
        await wechatSendText({
          openId: wechatEvent.fromUserName,
          text: "欢迎关注！我是ILIAGPT智能助手，有任何问题请直接发消息给我。\n\nBienvenido! Soy ILIAGPT, tu asistente inteligente. Envíame un mensaje para comenzar.",
          appId,
          appSecret,
        });
      } catch (err) {
        Logger.error("[WeChat] Failed to send welcome message", err);
      }
    }
    return;
  }

  const raw = typeof payloadUnknown === "string" ? payloadUnknown : null;
  if (!raw) return;
  const parsed = parseWeChatXml(raw);
  const inbound = parsed ? normalizeWeChatMessage(raw, parsed) : null;
  if (!inbound) return;

  const appId = env.WECHAT_APP_ID || null;
  const appSecret = env.WECHAT_APP_SECRET || null;
  const account = appId ? await findWeChatAccountByAppId(appId) : null;
  const userId = account?.userId || env.WECHAT_DEFAULT_USER_ID || null;

  if (!userId || !inbound.recipientId) {
    Logger.warn("[WeChat] No owner user configured", { appId, senderId: inbound.senderId });
    return;
  }

  const runtimeConfig = resolveRuntimeConfig(account?.metadata);
  if (!runtimeConfig.responder_enabled) return;
  if (!isSenderAllowedByPolicy(runtimeConfig, inbound.senderId)) return;
  if (isDuplicateInbound(`wechat:${inbound.recipientId}:${inbound.providerMessageId}`)) return;
  if (isRateLimited(`wechat:${inbound.senderId}`, runtimeConfig.rate_limit_per_minute)) return;

  const convo = await getOrCreateChannelConversation({
    userId,
    channel: "wechat",
    channelKey: appId || "default",
    externalConversationId: inbound.senderId,
    title: `WeChat: ${inbound.senderId}`,
    metadata: { wechat: { toUserName: inbound.recipientId, fromUserName: inbound.senderId } },
  });

  const requestId = `wechat:${inbound.recipientId}:${inbound.providerMessageId}`;
  const userMsg = await upsertUserMessage({
    chatId: convo.chatId,
    requestId,
    content: inbound.text,
    metadata: {
      channel: "wechat",
      channelKey: appId || "default",
      externalConversationId: inbound.senderId,
      messageType: inbound.messageType,
      wechat: { msgId: inbound.providerMessageId, fromUserName: inbound.senderId },
    },
  });

  const already = await getAssistantForUserMessage(userMsg.id);
  if (already) return;

  const decision = evaluateWeChatPolicy(inbound.text);
  if (!decision.allowed) {
    const assistantRequestId = `wechat:assistant:${inbound.recipientId}:${inbound.providerMessageId}`;
    await upsertAssistantMessage({
      chatId: convo.chatId,
      requestId: assistantRequestId,
      content: decision.reply,
      userMessageId: userMsg.id,
      metadata: { channel: "wechat", policy: { allowed: false, reason: decision.reason }, replyTo: requestId },
    });
    if (appId && appSecret) {
      try {
        await wechatSendText({ openId: inbound.senderId, text: decision.reply, appId, appSecret });
      } catch (err) {
        Logger.error("[WeChat] Failed to send policy reply", err);
      }
    }
    return;
  }

  const stylePrompt = buildResponseStyleSystemPrompt(runtimeConfig, "WeChat");
  const messages = [
    ...(stylePrompt ? [{ role: "system" as const, content: stylePrompt }] : []),
    { role: "user" as const, content: inbound.text },
  ];

  const { assistantText, memRes } = await runChannelLlm({
    channel: "WeChat",
    messages,
    chatId: convo.chatId,
    userId: convo.userId,
    msgPrefix: "wc_msg",
    fallbackText: "暂时无法回复，请稍后再试。",
  });

  const assistantRequestId = `wechat:assistant:${inbound.recipientId}:${inbound.providerMessageId}`;

  await upsertAssistantMessage({
    chatId: convo.chatId,
    requestId: assistantRequestId,
    content: assistantText,
    userMessageId: userMsg.id,
    metadata: { channel: "wechat", replyTo: requestId },
  });

  if (appId && appSecret) {
    try {
      await wechatSendText({ openId: inbound.senderId, text: assistantText, appId, appSecret });
    } catch (err) {
      Logger.error("[WeChat] Failed to send reply", err);
    }
    try {
      await sendChannelArtifacts(memRes, "wechat", inbound.senderId, { appId, appSecret });
    } catch (err) {
      Logger.error("[WeChat] Failed to send artifacts", err);
    }
  }
}

export async function processChannelIngestJob(job: ChannelIngestJob): Promise<void> {
  const receivedAt = job.receivedAt || new Date().toISOString();
  try {
    if (job.channel === "telegram") {
      await handleTelegram(job.update);
      return;
    }
    if (job.channel === "whatsapp_cloud") {
      await handleWhatsAppCloud(job.payload);
      return;
    }
    if (job.channel === "messenger") {
      await handleMessenger(job.payload);
      return;
    }
    if (job.channel === "wechat") {
      await handleWeChat(job.payload);
      return;
    }
    Logger.warn("[Channels] Unknown ingest job channel", { receivedAt, channel: (job as any)?.channel });
  } catch (err) {
    const extra: Record<string, unknown> = { receivedAt, channel: (job as any)?.channel };
    if (job.channel === "telegram") extra.updateId = (job.update as any)?.update_id;
    if (job.channel === "whatsapp_cloud") extra.entryCount = Array.isArray((job.payload as any)?.entry) ? (job.payload as any).entry.length : 0;
    if (job.channel === "messenger") extra.entryCount = Array.isArray((job.payload as any)?.entry) ? (job.payload as any).entry.length : 0;
    Logger.error("[Channels] Ingest job failed", { ...extra, err });
    throw err;
  }
}
