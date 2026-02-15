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

