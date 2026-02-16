const FB_GRAPH_BASE = "https://graph.facebook.com";
const FB_API_VERSION = "v21.0";
const MESSENGER_MAX_TEXT_LEN = 2000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

function chunkText(text: string, maxLen = MESSENGER_MAX_TEXT_LEN): string[] {
  const cleaned = String(text || "").trim();
  if (!cleaned) return [];
  const parts: string[] = [];
  for (let i = 0; i < cleaned.length; i += maxLen) parts.push(cleaned.slice(i, i + maxLen));
  return parts;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function messengerSendText(input: {
  recipientId: string;
  text: string;
  accessToken: string;
}): Promise<void> {
  const parts = chunkText(input.text);
  if (parts.length === 0) return;

  for (const part of parts) {
    const url = `${FB_GRAPH_BASE}/${FB_API_VERSION}/me/messages`;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) await sleep(RETRY_DELAY_MS * attempt);

      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${input.accessToken}`,
        },
        body: JSON.stringify({
          messaging_type: "RESPONSE",
          recipient: { id: input.recipientId },
          message: { text: part },
        }),
      });

      if (resp.ok) {
        lastError = null;
        break;
      }

      const body = await resp.text().catch(() => "");
      lastError = new Error(`Messenger send failed: HTTP ${resp.status} ${body}`);
      if (!isRetryable(resp.status)) break;
    }

    if (lastError) throw lastError;
  }
}

export async function messengerSendDocument(input: {
  recipientId: string;
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
  accessToken: string;
}): Promise<void> {
  const url = `${FB_GRAPH_BASE}/${FB_API_VERSION}/me/messages`;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS * attempt);

    const form = new FormData();
    form.append("messaging_type", "RESPONSE");
    form.append("recipient", JSON.stringify({ id: input.recipientId }));
    form.append("message", JSON.stringify({
      attachment: { type: "file", payload: { is_reusable: false } },
    }));
    form.append("filedata", new Blob([new Uint8Array(input.fileBuffer)], { type: input.mimeType }), input.fileName);

    const resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${input.accessToken}` },
      body: form,
    });

    if (resp.ok) {
      lastError = null;
      break;
    }

    const body = await resp.text().catch(() => "");
    lastError = new Error(`Messenger document send failed: HTTP ${resp.status} ${body}`);
    if (!isRetryable(resp.status)) break;
  }

  if (lastError) throw lastError;
}
