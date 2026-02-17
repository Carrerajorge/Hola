import type { ConversationKey, ExternalChannel, MessageEnvelope } from "./types";

export type NormalizedInboundMessage = {
  providerMessageId: string;
  senderId: string;
  recipientId?: string;
  text: string;
  messageType: "text" | "image" | "audio" | "document";
  raw: any;
};

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function textOrFallback(value: unknown, fallback: string): string {
  const normalized = normalizeText(value);
  return normalized || fallback;
}

function parseTimestamp(raw: any): string {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (Number.isFinite(n) && n > 0) {
    const ms = n < 1e12 ? n * 1000 : n;
    return new Date(ms).toISOString();
  }
  return new Date().toISOString();
}

export function normalizeWhatsAppMessages(payload: any): Array<MessageEnvelope> {
  const out: MessageEnvelope[] = [];

  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value;
      const phoneNumberId = normalizeText(value?.metadata?.phone_number_id);
      if (!phoneNumberId) continue;

      const messages = Array.isArray(value?.messages) ? value.messages : [];
      const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
      const contact = contacts[0];
      const contactName = normalizeText(contact?.profile?.name) || null;

      for (const m of messages) {
        const providerMessageId = textOrFallback(m?.id, `wa_${Date.now()}_${Math.random().toString(16).slice(2)}`);
        if (!providerMessageId) continue;

        const senderId = normalizeText(m?.from);
        if (!senderId) continue;

        const envelopeBase: MessageEnvelope = {
          providerMessageId,
          channel: "whatsapp_cloud",
          channelKey: phoneNumberId,
          threadId: senderId,
          senderId,
          recipientId: normalizeText(m?.to) || undefined,
          conversationKey: {
            workspaceId: "workspace:unknown",
            channel: "whatsapp_cloud",
            channelAccountId: phoneNumberId,
            threadId: senderId,
          },
          receivedAt: parseTimestamp(m?.timestamp),
          text: "",
          messageType: "text",
          metadata: {
            rawPayload: payload,
            channelMessageType: m?.type,
            messageId: providerMessageId,
            phoneNumberId,
            contactName,
            contact,
          },
        };

        if (m?.type === "text") {
          const text = textOrFallback(m?.text?.body, "");
          if (!text) continue;
          out.push({
            ...envelopeBase,
            text,
            messageType: "text",
            metadata: {
              ...envelopeBase.metadata,
              textPreview: text.slice(0, 280),
            },
          });
          continue;
        }

        if (m?.type === "image") {
          const caption = normalizeText(m?.image?.caption);
          out.push({
            ...envelopeBase,
            text: caption || "[Imagen recibida]",
            messageType: "image",
            media: {
              providerAssetId: normalizeText(m?.image?.id),
              fileName: "image.jpg",
              mimeType: "image/jpeg",
              raw: m,
            },
            metadata: {
              ...envelopeBase.metadata,
              mediaId: normalizeText(m?.image?.id),
            },
          });
          continue;
        }

        if (m?.type === "audio") {
          const caption = normalizeText(m?.audio?.mime_type) || "[Mensaje de voz recibido]";
          out.push({
            ...envelopeBase,
            text: "[Mensaje de voz recibido. Transcripción no disponible en este momento.]",
            messageType: "audio",
            media: {
              providerAssetId: normalizeText(m?.audio?.id),
              fileName: `audio_${providerMessageId}.ogg`,
              mimeType: normalizeText(m?.audio?.mime_type) || "audio/ogg",
              raw: m,
            },
            metadata: {
              ...envelopeBase.metadata,
              mimeType: normalizeText(m?.audio?.mime_type),
            },
          });
          continue;
        }

        if (m?.type === "document") {
          const caption = normalizeText(m?.document?.filename);
          out.push({
            ...envelopeBase,
            text: caption ? `[Documento recibido: ${caption}]` : "[Documento recibido]",
            messageType: "document",
            media: {
              providerAssetId: normalizeText(m?.document?.id),
              fileName: caption || `document_${providerMessageId}`,
              mimeType: normalizeText(m?.document?.mime_type) || "application/octet-stream",
              raw: m,
            },
            metadata: {
              ...envelopeBase.metadata,
              fileName: caption || null,
              mimeType: normalizeText(m?.document?.mime_type),
            },
          });
          continue;
        }

        const text = textOrFallback(m?.text?.body, textOrFallback(m?.caption, "Mensaje recibido"));
        if (!text) continue;
        out.push({
          ...envelopeBase,
          text,
          messageType: "text",
        });
      }
    }
  }

  return out;
}

export function normalizeMessengerMessages(payload: any): MessageEnvelope[] {
  const out: MessageEnvelope[] = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];

  for (const entry of entries) {
    const messaging = Array.isArray(entry?.messaging) ? entry.messaging : [];
    const pageId = normalizeText(entry?.id);

    for (const event of messaging) {
      if (!event || typeof event !== "object") continue;
      if (event?.message?.is_echo || event?.delivery || event?.read) continue;

      const senderId = normalizeText(event?.sender?.id);
      const recipientId = normalizeText(event?.recipient?.id) || pageId;
      const message = event?.message;
      if (!senderId || !recipientId || !message) continue;

      const providerMessageId = textOrFallback(message?.mid, `ms_${Date.now()}_${Math.random().toString(16).slice(2)}`);
      const envelopeBase: MessageEnvelope = {
        providerMessageId,
        channel: "messenger",
        channelKey: recipientId,
        threadId: senderId,
        senderId,
        recipientId,
        conversationKey: {
          workspaceId: "workspace:unknown",
          channel: "messenger",
          channelAccountId: recipientId,
          threadId: senderId,
        },
        receivedAt: parseTimestamp(event?.timestamp),
        text: "",
        messageType: "text",
        metadata: {
          rawPayload: payload,
          pageId: recipientId,
          messageMid: providerMessageId,
        },
      };

      if (typeof message?.text === "string" && normalizeText(message?.text)) {
        out.push({ ...envelopeBase, text: normalizeText(message.text), messageType: "text" });
        continue;
      }

      if (message?.text?.body && normalizeText(message.text.body)) {
        out.push({ ...envelopeBase, text: normalizeText(message.text.body), messageType: "text" });
        continue;
      }

      const firstAttachment = Array.isArray(message?.attachments) ? message.attachments[0] : null;
      if (!firstAttachment) continue;

      const type = normalizeText(firstAttachment?.type || "");
      if (type === "audio") {
        out.push({
          ...envelopeBase,
          text: "[Audio recibido. Transcripción no disponible.]",
          messageType: "audio",
          media: {
            fileName: `audio_${providerMessageId}.ogg`,
            mimeType: "audio/ogg",
            raw: firstAttachment,
          },
          metadata: {
            ...envelopeBase.metadata,
            attachmentType: type,
          },
        });
        continue;
      }

      if (type === "image") {
        out.push({
          ...envelopeBase,
          text: "[Imagen recibida]",
          messageType: "image",
          media: {
            fileName: `image_${providerMessageId}.jpg`,
            mimeType: "image/jpeg",
            raw: firstAttachment,
          },
          metadata: {
            ...envelopeBase.metadata,
            attachmentType: type,
          },
        });
        continue;
      }

      if (type === "file" || type === "application") {
        const payload = firstAttachment?.payload || {};
        const url = normalizeText(payload?.url);
        const fileName = normalizeText(payload?.name) || `document_${providerMessageId}`;
        out.push({
          ...envelopeBase,
          text: fileName ? `[Documento recibido: ${fileName}]` : "[Documento recibido]",
          messageType: "document",
          media: {
            fileName,
            mimeType: normalizeText(payload?.mime_type) || "application/octet-stream",
            url: url || undefined,
            raw: firstAttachment,
          },
          metadata: {
            ...envelopeBase.metadata,
            attachmentType: type,
          },
        });
        continue;
      }
    }
  }

  return out;
}

export function normalizeWeChatMessage(rawXml: string, parsed: any): MessageEnvelope | null {
  if (!rawXml || typeof rawXml !== "string") return null;

  const msgType = parsed?.MsgType;
  const from = normalizeText(parsed?.FromUserName);
  const to = normalizeText(parsed?.ToUserName);
  const msgId = normalizeText(parsed?.MsgId) || `wc_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  if (!from || !to) return null;

  const envelopeBase: MessageEnvelope = {
    providerMessageId: msgId,
    channel: "wechat",
    channelKey: to,
    threadId: from,
    senderId: from,
    recipientId: to,
    conversationKey: {
      workspaceId: "workspace:unknown",
      channel: "wechat",
      channelAccountId: to,
      threadId: from,
    },
    receivedAt: parseTimestamp(parsed?.CreateTime),
    text: "",
    messageType: "text",
    metadata: {
      rawPayload: rawXml,
      msgType,
      event: normalizeText(parsed?.Event),
      eventKey: normalizeText(parsed?.EventKey),
      toUserName: to,
      fromUserName: from,
    },
  };

  if (msgType === "text") {
    const text = normalizeText(parsed?.Content);
    if (!text) return null;
    return { ...envelopeBase, text };
  }

  if (msgType === "image") {
    return {
      ...envelopeBase,
      text: "[Imagen recibida]",
      messageType: "image",
      media: {
        fileName: `image_${msgId}.jpg`,
        mimeType: "image/jpeg",
        raw: parsed,
      },
    };
  }

  if (msgType === "voice") {
    return {
      ...envelopeBase,
      text: "[Mensaje de voz recibido. Transcripción no disponible.]",
      messageType: "audio",
      media: {
        fileName: `audio_${msgId}.ogg`,
        mimeType: "audio/ogg",
        raw: parsed,
      },
    };
  }

  if (msgType === "doc") {
    const fileName = normalizeText(parsed?.Title) || `document_${msgId}`;
    return {
      ...envelopeBase,
      text: `[Documento recibido: ${fileName}]`,
      messageType: "document",
      media: {
        fileName,
        mimeType: normalizeText(parsed?.FileMd5) || "application/octet-stream",
        raw: parsed,
      },
    };
  }

  return null;
}

export function normalizeTelegramMessages(payload: any): MessageEnvelope[] {
  const out: MessageEnvelope[] = [];
  const msg = payload?.message;
  if (!msg) return out;

  const text = normalizeText(msg?.text);
  const caption = normalizeText(msg?.caption);
  const chatId = normalizeText(msg?.chat?.id);
  const messageId = normalizeText(msg?.message_id) ? String(msg.message_id) : `tg_${Date.now()}`;
  const from = normalizeText(msg?.from?.id);
  if (!chatId || !from) return out;

  const conversationAccountId = "default";
  const baseEnvelope: MessageEnvelope = {
    providerMessageId: messageId,
    channel: "telegram",
    channelKey: conversationAccountId,
    threadId: chatId,
    senderId: from,
    recipientId: chatId,
    conversationKey: {
      workspaceId: "workspace:unknown",
      channel: "telegram",
      channelAccountId: conversationAccountId,
      threadId: chatId,
    },
    receivedAt: parseTimestamp(msg?.date || Date.now()),
    text: "",
    messageType: "text",
    metadata: {
      rawPayload: payload,
      from,
      chatId,
      fromFirstName: normalizeText(msg?.from?.first_name),
      fromLastName: normalizeText(msg?.from?.last_name),
      fromUsername: normalizeText(msg?.from?.username),
    },
  };

  if (msg?.photo && Array.isArray(msg.photo) && msg.photo.length > 0) {
    const photo = msg.photo[msg.photo.length - 1];
    const photoText = caption || "[Imagen recibida en Telegram]";
    out.push({
      ...baseEnvelope,
      text: photoText,
      messageType: "image",
      metadata: {
        ...baseEnvelope.metadata,
        photoId: normalizeText(photo?.file_id),
      },
      media: {
        providerAssetId: normalizeText(photo?.file_id),
        fileName: `telegram-photo-${messageId}.jpg`,
        mimeType: "image/jpeg",
        raw: photo,
      },
    });
    return out;
  }

  if (msg?.voice) {
    out.push({
      ...baseEnvelope,
      text: "[Audio recibido. Transcripción no disponible.]",
      messageType: "audio",
      metadata: {
        ...baseEnvelope.metadata,
        voiceId: normalizeText(msg?.voice?.file_id),
      },
      media: {
        providerAssetId: normalizeText(msg?.voice?.file_id),
        fileName: `telegram-voice-${messageId}.ogg`,
        mimeType: normalizeText(msg?.voice?.mime_type) || "audio/ogg",
        raw: msg?.voice,
      },
    });
    return out;
  }

  if (msg?.audio) {
    out.push({
      ...baseEnvelope,
      text: "[Audio recibido. Transcripción no disponible.]",
      messageType: "audio",
      metadata: {
        ...baseEnvelope.metadata,
        audioId: normalizeText(msg?.audio?.file_id),
      },
      media: {
        providerAssetId: normalizeText(msg?.audio?.file_id),
        fileName: `telegram-audio-${messageId}.mp3`,
        mimeType: normalizeText(msg?.audio?.mime_type) || "audio/mpeg",
        raw: msg?.audio,
      },
    });
    return out;
  }

  if (msg?.document) {
    const fileName = normalizeText(msg?.document?.file_name) || `document_${messageId}`;
    out.push({
      ...baseEnvelope,
      text: `[Documento recibido: ${fileName}]`,
      messageType: "document",
      metadata: {
        ...baseEnvelope.metadata,
        documentId: normalizeText(msg?.document?.file_id),
      },
      media: {
        providerAssetId: normalizeText(msg?.document?.file_id),
        fileName,
        mimeType: normalizeText(msg?.document?.mime_type) || "application/octet-stream",
        raw: msg?.document,
      },
    });
    return out;
  }

  if (!text) return out;

  out.push({
    ...baseEnvelope,
    text,
    messageType: "text",
  });

  return out;
}

export function normalizeTelegramMessageForHandshake(payload: any): MessageEnvelope | null {
  return normalizeTelegramMessages(payload)[0] ?? null;
}

export function withConversationKeyDefaults(
  envelope: MessageEnvelope,
  workspaceId: string,
  channelKey: string,
  threadId: string,
): MessageEnvelope {
  return {
    ...envelope,
    channelKey,
    threadId,
    conversationKey: {
      workspaceId,
      channel: envelope.channel,
      channelAccountId: channelKey,
      threadId,
    },
  };
}

export function buildFallbackEnvelope(channel: ExternalChannel, base: {
  providerMessageId?: string;
  threadId: string;
  senderId: string;
  recipientId?: string;
  text?: string;
  messageType?: MessageEnvelope["messageType"];
  metadata?: Record<string, unknown>;
}): MessageEnvelope {
  const channelKey = base.recipientId || base.threadId;
  return {
    providerMessageId: base.providerMessageId || `${channel}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    channel,
    channelKey,
    threadId: base.threadId,
    senderId: base.senderId,
    recipientId: base.recipientId,
    conversationKey: {
      workspaceId: "workspace:unknown",
      channel,
      channelAccountId: channelKey,
      threadId: base.threadId,
    },
    receivedAt: new Date().toISOString(),
    text: base.text || "",
    messageType: base.messageType || "text",
    metadata: {
      rawPayload: null,
      ...base.metadata,
    },
  };
}

export { ExternalChannel as ParsedChannel, ConversationKey };
