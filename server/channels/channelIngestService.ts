import { and, eq } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../db";
import { Logger } from "../lib/logger";
import { chatService, DEFAULT_MODEL, DEFAULT_PROVIDER } from "../services/ChatServiceV2";
import { conversationMemoryManager } from "../services/conversationMemory";
import { storage } from "../storage";
import { chatMessages } from "@shared/schema";
import type { ChannelIngestJob } from "./types";
import {
  consumeChannelPairingCode,
  getChannelConversation,
  getOrCreateChannelConversation,
  findWhatsAppCloudAccountByPhoneNumberId,
} from "./channelStore";
import { telegramSendMessage } from "./telegram/telegramApi";
import { sendWhatsAppCloudText } from "./whatsappCloud/whatsappCloudApi";
import { evaluateWhatsAppPolicy } from "./whatsappCloud/whatsappPolicy";

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

  const requestId = `telegram:${inbound.tgChatId}:${inbound.tgMessageId}`;
  const userMsg = await upsertUserMessage({
    chatId: convo.chatId,
    requestId,
    content: inbound.text,
    metadata: {
      channel: "telegram",
      channelKey: "default",
      externalConversationId: inbound.tgChatId,
      telegram: {
        updateId: inbound.updateId,
        messageId: inbound.tgMessageId,
        fromId: inbound.from?.id != null ? String(inbound.from.id) : null,
        username: inbound.from?.username ?? null,
      },
    },
  });

  const already = await getAssistantForUserMessage(userMsg.id);
  if (already) return;

  const history = await conversationMemoryManager.augmentWithHistory(convo.chatId, [
    { role: "user", content: inbound.text },
  ]);

  let assistantText = "";
  try {
    const response = await chatService.chat(history, {
      conversationId: convo.chatId,
      userId: convo.userId,
      useRag: true,
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
    });
    assistantText = String(response?.content || "").trim();
  } catch (err) {
    Logger.error("[Telegram] LLM processing failed", err);
    assistantText = "Ahora mismo no puedo responder. Intenta de nuevo en unos minutos.";
  }

  assistantText = assistantText || "(sin respuesta)";
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
}

type WhatsAppInbound = {
  phoneNumberId: string;
  from: string;
  messageId: string;
  text: string;
  contactName: string | null;
};

function extractWhatsAppInbounds(payload: any): WhatsAppInbound[] {
  const inbounds: WhatsAppInbound[] = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      const messages = Array.isArray(value?.messages) ? value.messages : [];
      if (!phoneNumberId) continue;

      const contactName =
        Array.isArray(value?.contacts) && value.contacts[0]?.profile?.name
          ? String(value.contacts[0].profile.name)
          : null;

      for (const m of messages) {
        if (!m || m.type !== "text") continue;
        const body = m?.text?.body;
        if (typeof body !== "string" || !body.trim()) continue;
        if (!m.from || !m.id) continue;
        inbounds.push({
          phoneNumberId: String(phoneNumberId),
          from: String(m.from),
          messageId: String(m.id),
          text: body,
          contactName,
        });
      }
    }
  }
  return inbounds;
}

async function handleWhatsAppCloud(payloadUnknown: unknown): Promise<void> {
  const inbounds = extractWhatsAppInbounds(payloadUnknown as any);
  if (inbounds.length === 0) return;

  for (const inbound of inbounds) {
    const account = await findWhatsAppCloudAccountByPhoneNumberId(inbound.phoneNumberId);
    const userId = account?.userId || env.WHATSAPP_CLOUD_DEFAULT_USER_ID || null;
    const accessToken = account?.accessToken || env.WHATSAPP_CLOUD_ACCESS_TOKEN || null;

    if (!userId) {
      Logger.warn("[WhatsAppCloud] No owner user configured for phone_number_id", {
        phoneNumberId: inbound.phoneNumberId,
      });
      continue;
    }

    const convo = await getOrCreateChannelConversation({
      userId,
      channel: "whatsapp_cloud",
      channelKey: inbound.phoneNumberId,
      externalConversationId: inbound.from,
      title: `WhatsApp: ${inbound.contactName ? inbound.contactName : inbound.from}`,
      metadata: {
        whatsapp: {
          phoneNumberId: inbound.phoneNumberId,
          from: inbound.from,
        },
      },
    });

    const requestId = `whatsapp_cloud:${inbound.phoneNumberId}:${inbound.messageId}`;
    const userMsg = await upsertUserMessage({
      chatId: convo.chatId,
      requestId,
      content: inbound.text,
      metadata: {
        channel: "whatsapp_cloud",
        channelKey: inbound.phoneNumberId,
        externalConversationId: inbound.from,
        whatsapp: {
          phoneNumberId: inbound.phoneNumberId,
          messageId: inbound.messageId,
          from: inbound.from,
          contactName: inbound.contactName,
        },
      },
    });

    const already = await getAssistantForUserMessage(userMsg.id);
    if (already) continue;

    const decision = evaluateWhatsAppPolicy(inbound.text, { baseUrl: env.BASE_URL });

    if (!decision.allowed) {
      const assistantRequestId = `whatsapp_cloud:assistant:${inbound.phoneNumberId}:${inbound.messageId}`;
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
            to: inbound.from,
            text: decision.reply,
            accessToken,
          });
        } catch (err) {
          Logger.error("[WhatsAppCloud] Failed to send policy reply", err);
        }
      }
      continue;
    }

    const history = await conversationMemoryManager.augmentWithHistory(convo.chatId, [
      { role: "user", content: inbound.text },
    ]);

    const systemPrompt =
      "Eres un asistente de un negocio atendiendo por WhatsApp. " +
      "Tu alcance es: reservas, soporte y seguimiento. " +
      "Responde breve y pide solo los datos minimos necesarios. " +
      "No ofrezcas acciones fuera de esos flujos.";

    let assistantText = "";
    try {
      const response = await chatService.chat(
        [{ role: "system", content: systemPrompt }, ...history],
        {
          conversationId: convo.chatId,
          userId: convo.userId,
          useRag: true,
          provider: DEFAULT_PROVIDER,
          model: DEFAULT_MODEL,
        },
      );
      assistantText = String(response?.content || "").trim();
    } catch (err) {
      Logger.error("[WhatsAppCloud] LLM processing failed", err);
      assistantText = "Ahora mismo no puedo atender tu solicitud. Intenta de nuevo en unos minutos.";
    }

    assistantText = assistantText || "(sin respuesta)";
    const assistantRequestId = `whatsapp_cloud:assistant:${inbound.phoneNumberId}:${inbound.messageId}`;

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
          to: inbound.from,
          text: assistantText,
          accessToken,
        });
      } catch (err) {
        Logger.error("[WhatsAppCloud] Failed to send reply", err);
      }
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
    Logger.warn("[Channels] Unknown ingest job channel", { receivedAt, channel: (job as any)?.channel });
  } catch (err) {
    Logger.error("[Channels] Ingest job failed", { receivedAt, channel: (job as any)?.channel, err });
    throw err;
  }
}
