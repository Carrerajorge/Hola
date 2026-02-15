import { env } from "../../config/env";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const TELEGRAM_MAX_TEXT_LEN = 3900; // keep margin under hard 4096

function chunkText(text: string, maxLen = TELEGRAM_MAX_TEXT_LEN): string[] {
  const cleaned = String(text || "").trim();
  if (!cleaned) return [];
  const parts: string[] = [];
  for (let i = 0; i < cleaned.length; i += maxLen) parts.push(cleaned.slice(i, i + maxLen));
  return parts;
}

async function telegramCall<T>(method: string, payload: Record<string, unknown>): Promise<T> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  }

  const url = `${TELEGRAM_API_BASE}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const json = (await resp.json().catch(() => null)) as any;
  if (!resp.ok || !json?.ok) {
    const desc = json?.description ? String(json.description) : `HTTP ${resp.status}`;
    throw new Error(`Telegram API error (${method}): ${desc}`);
  }

  return json.result as T;
}

export async function telegramSendMessage(chatId: string, text: string): Promise<void> {
  const parts = chunkText(text);
  if (parts.length === 0) return;

  for (const part of parts) {
    await telegramCall("sendMessage", {
      chat_id: chatId,
      text: part,
    });
  }
}

export async function telegramSetWebhook(input: {
  webhookUrl: string;
  secretToken?: string;
}): Promise<void> {
  const payload: Record<string, unknown> = {
    url: input.webhookUrl,
  };

  if (input.secretToken) {
    payload.secret_token = input.secretToken;
  }

  await telegramCall("setWebhook", payload);
}

