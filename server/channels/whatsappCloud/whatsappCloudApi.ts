const WHATSAPP_GRAPH_BASE = "https://graph.facebook.com";
const WHATSAPP_API_VERSION = "v21.0";
const WHATSAPP_MAX_TEXT_LEN = 1400;

function chunkText(text: string, maxLen = WHATSAPP_MAX_TEXT_LEN): string[] {
  const cleaned = String(text || "").trim();
  if (!cleaned) return [];
  const parts: string[] = [];
  for (let i = 0; i < cleaned.length; i += maxLen) parts.push(cleaned.slice(i, i + maxLen));
  return parts;
}

/**
 * Upload media to WhatsApp Cloud, then send it as a document message.
 * Meta Graph API: POST /{phone_number_id}/media  →  POST /{phone_number_id}/messages
 */
export async function sendWhatsAppCloudDocument(input: {
  phoneNumberId: string;
  to: string;
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
  accessToken: string;
  caption?: string;
}): Promise<void> {
  // Step 1: Upload media
  const uploadUrl = `${WHATSAPP_GRAPH_BASE}/${WHATSAPP_API_VERSION}/${encodeURIComponent(input.phoneNumberId)}/media`;
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", new Blob([new Uint8Array(input.fileBuffer)], { type: input.mimeType }), input.fileName);
  form.append("type", input.mimeType);

  const uploadResp = await fetch(uploadUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.accessToken}` },
    body: form,
  });

  if (!uploadResp.ok) {
    const body = await uploadResp.text().catch(() => "");
    throw new Error(`WhatsApp Cloud media upload failed: HTTP ${uploadResp.status} ${body}`);
  }

  const uploadJson = (await uploadResp.json()) as any;
  const mediaId = uploadJson?.id;
  if (!mediaId) {
    throw new Error("WhatsApp Cloud media upload returned no media ID");
  }

  // Step 2: Send document message with media_id
  const sendUrl = `${WHATSAPP_GRAPH_BASE}/${WHATSAPP_API_VERSION}/${encodeURIComponent(input.phoneNumberId)}/messages`;
  const sendResp = await fetch(sendUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: input.to,
      type: "document",
      document: {
        id: mediaId,
        filename: input.fileName,
        caption: input.caption || undefined,
      },
    }),
  });

  if (!sendResp.ok) {
    const body = await sendResp.text().catch(() => "");
    throw new Error(`WhatsApp Cloud document send failed: HTTP ${sendResp.status} ${body}`);
  }
}

export async function sendWhatsAppCloudText(input: {
  phoneNumberId: string;
  to: string;
  text: string;
  accessToken: string;
}): Promise<void> {
  const parts = chunkText(input.text);
  if (parts.length === 0) return;

  for (const part of parts) {
    const url = `${WHATSAPP_GRAPH_BASE}/${WHATSAPP_API_VERSION}/${encodeURIComponent(input.phoneNumberId)}/messages`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: input.to,
        type: "text",
        text: { body: part },
      }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`WhatsApp Cloud send failed: HTTP ${resp.status} ${body}`);
    }
  }
}

