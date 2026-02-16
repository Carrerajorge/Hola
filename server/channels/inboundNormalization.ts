export type NormalizedInboundMessage = {
  providerMessageId: string;
  senderId: string;
  recipientId?: string;
  text: string;
  messageType: "text" | "image" | "audio";
  raw: any;
};

export function normalizeWhatsAppMessages(payload: any): Array<NormalizedInboundMessage & { phoneNumberId: string; contactName: string | null }> {
  const out: Array<NormalizedInboundMessage & { phoneNumberId: string; contactName: string | null }> = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      const messages = Array.isArray(value?.messages) ? value.messages : [];
      const contactName = Array.isArray(value?.contacts) && value.contacts[0]?.profile?.name ? String(value.contacts[0].profile.name) : null;

      for (const m of messages) {
        if (!m?.id || !m?.from) continue;
        if (m.type === "text" && typeof m?.text?.body === "string" && m.text.body.trim()) {
          out.push({
            phoneNumberId: String(phoneNumberId),
            contactName,
            providerMessageId: String(m.id),
            senderId: String(m.from),
            text: m.text.body,
            messageType: "text",
            raw: m,
          });
          continue;
        }

        if (m.type === "image") {
          const caption = typeof m?.image?.caption === "string" ? m.image.caption.trim() : "";
          out.push({
            phoneNumberId: String(phoneNumberId),
            contactName,
            providerMessageId: String(m.id),
            senderId: String(m.from),
            text: caption || "[Imagen recibida]",
            messageType: "image",
            raw: m,
          });
          continue;
        }

        if (m.type === "audio") {
          out.push({
            phoneNumberId: String(phoneNumberId),
            contactName,
            providerMessageId: String(m.id),
            senderId: String(m.from),
            text: "[Mensaje de voz recibido. Transcripción no disponible en este momento.]",
            messageType: "audio",
            raw: m,
          });
        }
      }
    }
  }
  return out;
}

export function normalizeMessengerMessages(payload: any): NormalizedInboundMessage[] {
  const out: NormalizedInboundMessage[] = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    const messaging = Array.isArray(entry?.messaging) ? entry.messaging : [];
    for (const event of messaging) {
      if (event?.message?.is_echo) continue;
      if (event?.delivery || event?.read) continue;
      const senderId = event?.sender?.id;
      const recipientId = event?.recipient?.id;
      const message = event?.message;
      if (!senderId || !recipientId || !message) continue;
      const providerMessageId = String(message.mid || `msg_${Date.now()}`);
      if (typeof message?.text === "string" && message.text.trim()) {
        out.push({
          providerMessageId,
          senderId: String(senderId),
          recipientId: String(recipientId),
          text: message.text,
          messageType: "text",
          raw: event,
        });
      } else if (Array.isArray(message?.attachments) && message.attachments.length > 0) {
        const attType = String(message.attachments[0]?.type || "");
        const messageType = attType === "audio" ? "audio" : "image";
        out.push({
          providerMessageId,
          senderId: String(senderId),
          recipientId: String(recipientId),
          text: messageType === "audio" ? "[Audio recibido. Transcripción no disponible.]" : "[Imagen recibida]",
          messageType,
          raw: event,
        });
      }
    }
  }
  return out;
}

export function normalizeWeChatMessage(rawXml: string, parsed: any): NormalizedInboundMessage | null {
  const msgType = parsed?.MsgType;
  const from = parsed?.FromUserName;
  const to = parsed?.ToUserName;
  const msgId = parsed?.MsgId || `wc_${Date.now()}`;
  if (!from || !to) return null;

  if (msgType === "text") {
    const content = String(parsed?.Content || "").trim();
    if (!content) return null;
    return {
      providerMessageId: String(msgId),
      senderId: String(from),
      recipientId: String(to),
      text: content,
      messageType: "text",
      raw: rawXml,
    };
  }

  if (msgType === "image") {
    return {
      providerMessageId: String(msgId),
      senderId: String(from),
      recipientId: String(to),
      text: "[Imagen recibida]",
      messageType: "image",
      raw: rawXml,
    };
  }

  if (msgType === "voice") {
    return {
      providerMessageId: String(msgId),
      senderId: String(from),
      recipientId: String(to),
      text: "[Mensaje de voz recibido. Transcripción no disponible.]",
      messageType: "audio",
      raw: rawXml,
    };
  }

  return null;
}
