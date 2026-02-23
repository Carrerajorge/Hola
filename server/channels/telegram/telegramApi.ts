import { env } from "../../config/env";
import {
  channelFetch,
  normalizeChannelId,
  normalizeChannelText,
  readResponseTextSafe,
  sanitizeOutboundFilePayload,
} from "../channelTransport";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const TELEGRAM_HOST = "api.telegram.org";
const TELEGRAM_MAX_TEXT_LEN = 3900;
const TELEGRAM_MAX_TOKEN_LENGTH = 256;
const TELEGRAM_TOKEN_PREFIX_RE = /^(\d+):[A-Za-z0-9_-]{35,}$/;
const TELEGRAM_MAX_RETRY_ATTEMPTS = 2;
const TELEGRAM_RETRY_BASE_MS = 500;
const TELEGRAM_RETRY_JITTER_MS = 250;
const MAX_RESPONSE_TEXT_LEN = 2048;
const MAX_MEDIA_CAPTION_LEN = 1024;

function chunkText(text: string, maxLen = TELEGRAM_MAX_TEXT_LEN): string[] {
  const cleaned = normalizeChannelText(text, 4_000).trim();
  if (!cleaned) return [];
  const parts: string[] = [];
  for (let i = 0; i < cleaned.length; i += maxLen) {
    parts.push(cleaned.slice(i, i + maxLen));
  }
  return parts;
}

function normalizeTelegramText(value: unknown, maxLen = TELEGRAM_MAX_TEXT_LEN): string {
  return normalizeChannelText(value, maxLen).trim();
}

function normalizeToken(raw: string | undefined): string {
  const token = normalizeChannelText(raw, TELEGRAM_MAX_TOKEN_LENGTH).replace(/\s+/g, "");
  if (!TELEGRAM_TOKEN_PREFIX_RE.test(token)) {
    return "";
  }
  return token;
}

function normalizeId(value: unknown): string {
  return normalizeChannelId(value, 64);
}

function normalizeSecret(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const normalized = normalizeChannelText(raw, 256).slice(0, 512);
  return normalized || undefined;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function computeBackoffMs(attempt: number): number {
  const multiplier = Math.min(6, Math.max(1, attempt));
  const exponential = TELEGRAM_RETRY_BASE_MS * 2 ** multiplier;
  const jitter = Math.floor(Math.random() * TELEGRAM_RETRY_JITTER_MS);
  return exponential + jitter;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function telegramCall<T>(token: string, method: string, payload: Record<string, unknown>): Promise<T> {
  const sanitizedMethod = normalizeChannelText(method, 64).replace(/\//g, "");
  if (!sanitizedMethod) {
    throw new Error("Telegram method missing");
  }

  const url = `${TELEGRAM_API_BASE}/bot${token}/${sanitizedMethod}`;
  let lastError = "unknown";
  for (let attempt = 0; attempt <= TELEGRAM_MAX_RETRY_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(computeBackoffMs(attempt));

    const response = await channelFetch(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      {
        expectedHost: TELEGRAM_HOST,
        allowedHostSuffixes: [TELEGRAM_HOST],
        traceId: `tg-${sanitizedMethod}`,
      },
    );

    const bodyText = await readResponseTextSafe(response, MAX_RESPONSE_TEXT_LEN);
    const json = (() => {
      try {
        const parsed = JSON.parse(bodyText);
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch {
        return {};
      }
    })() as Record<string, unknown>;

    if (response.ok && json?.ok) {
      return json.result as T;
    }

    lastError = String(json?.description || `HTTP ${response.status} ${bodyText}`).slice(0, 400);
    if (!isRetryableStatus(response.status)) {
      throw new Error(`Telegram API error (${sanitizedMethod}): ${lastError}`);
    }
  }

  throw new Error(`Telegram API error (${sanitizedMethod}): ${lastError}`);
}

export async function telegramSendMessage(chatId: string, text: string): Promise<void> {
  const safeToken = normalizeToken(env.TELEGRAM_BOT_TOKEN);
  if (!safeToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  }

  const safeChatId = normalizeId(chatId);
  if (!safeChatId) {
    throw new Error("Invalid Telegram chat id");
  }

  const parts = chunkText(text);
  if (parts.length === 0) return;

  for (const [index, part] of parts.entries()) {
    const payload = {
      chat_id: safeChatId,
      text: normalizeTelegramText(part),
      parse_mode: "HTML",
    };
    try {
      await telegramCall(safeToken, "sendMessage", payload);
    } catch (error) {
      const current = String((error as Error)?.message || error);
      if (index < parts.length - 1) {
        throw new Error(`Telegram message part failed: ${current}`);
      }
      throw error;
    }
  }
}

export async function telegramSendDocument(
  chatId: string,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  caption?: string,
): Promise<void> {
  return telegramSendMediaInternal(chatId, "document", fileBuffer, fileName, mimeType, caption);
}

export async function telegramSendPhoto(
  chatId: string,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  caption?: string,
): Promise<void> {
  return telegramSendMediaInternal(chatId, "photo", fileBuffer, fileName, mimeType, caption);
}

export async function telegramSendVideo(
  chatId: string,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  caption?: string,
): Promise<void> {
  return telegramSendMediaInternal(chatId, "video", fileBuffer, fileName, mimeType, caption);
}

export async function telegramSendVoice(
  chatId: string,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  caption?: string,
): Promise<void> {
  return telegramSendMediaInternal(chatId, "voice", fileBuffer, fileName, mimeType, caption);
}

async function telegramSendMediaInternal(
  chatId: string,
  mediaType: "document" | "photo" | "video" | "voice",
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  caption?: string,
): Promise<void> {
  const safeToken = normalizeToken(env.TELEGRAM_BOT_TOKEN);
  if (!safeToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  }
  const safeChatId = normalizeId(chatId);
  if (!safeChatId) {
    throw new Error("Invalid Telegram chat id");
  }

  const fileValidation = sanitizeOutboundFilePayload({
    kind: "document", // uses document generic validation regardless of type
    fileBuffer,
    fileName,
    mimeType,
  });
  if (!fileValidation.ok) {
    throw new Error(`Invalid Telegram media payload: ${fileValidation.reason}`);
  }

  let lastError: string | null = null;
  for (let attempt = 0; attempt <= TELEGRAM_MAX_RETRY_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(computeBackoffMs(attempt));

    const method = `send${mediaType.charAt(0).toUpperCase() + mediaType.slice(1)}`;
    const url = `${TELEGRAM_API_BASE}/bot${safeToken}/${method}`;
    const form = new FormData();
    form.append("chat_id", safeChatId);
    form.append(
      mediaType,
      new Blob([new Uint8Array(fileValidation.value.fileBuffer)], { type: fileValidation.value.mimeType }),
      fileValidation.value.fileName,
    );

    const safeCaption = normalizeTelegramText(caption || "", MAX_MEDIA_CAPTION_LEN);
    if (safeCaption) {
      form.append("caption", safeCaption);
    }

    const response = await channelFetch(
      url,
      {
        method: "POST",
        body: form,
      },
      {
        expectedHost: TELEGRAM_HOST,
        allowedHostSuffixes: [TELEGRAM_HOST],
        timeoutMs: 60_000,
        traceId: `tg-${mediaType}:${safeChatId}`,
      },
    );

    const bodyText = await readResponseTextSafe(response, MAX_RESPONSE_TEXT_LEN);
    if (response.ok) {
      lastError = null;
      const parsed = (() => {
        try {
          return JSON.parse(bodyText) as Record<string, unknown>;
        } catch {
          return { ok: true };
        }
      })();
      if (parsed.ok === true || (typeof parsed.ok === "undefined" && bodyText.length > 0)) {
        return;
      }
    }

    lastError = `HTTP ${response.status} ${bodyText}`;
    if (!isRetryableStatus(response.status) || attempt >= TELEGRAM_MAX_RETRY_ATTEMPTS) {
      throw new Error(`Telegram ${method} failed: ${lastError}`);
    }
  }

  if (lastError) {
    throw new Error(`Telegram send ${mediaType} failed: ${lastError}`);
  }
}

export async function downloadTelegramMedia(fileId: string): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
  const safeToken = normalizeToken(env.TELEGRAM_BOT_TOKEN);
  if (!safeToken) throw new Error("TELEGRAM_BOT_TOKEN is not configured");

  const fileInfo = await telegramCall<{ file_path: string }>(safeToken, "getFile", { file_id: fileId });
  if (!fileInfo.file_path) {
    throw new Error("Could not get file_path from Telegram getFile");
  }

  const url = `https://api.telegram.org/file/bot${safeToken}/${fileInfo.file_path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download Telegram media: ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();

  // Adivinar el nombre y mimetype desde la ruta de archivo (ej: photos/file_0.jpg o voice/voice_1.oga)
  const fileName = fileInfo.file_path.split('/').pop() || 'telegram_media';

  let mimeType = 'application/octet-stream';
  if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) mimeType = 'image/jpeg';
  else if (fileName.endsWith('.png')) mimeType = 'image/png';
  else if (fileName.endsWith('.oga') || fileName.endsWith('.ogg')) mimeType = 'audio/ogg';
  else if (fileName.endsWith('.mp3')) mimeType = 'audio/mpeg';
  else if (fileName.endsWith('.mp4')) mimeType = 'video/mp4';
  else if (fileName.endsWith('.pdf')) mimeType = 'application/pdf';

  return { buffer: Buffer.from(arrayBuffer), mimeType, fileName };
}

export async function telegramSetWebhook(input: {
  webhookUrl: string;
  secretToken?: string;
  botToken?: string;
}): Promise<void> {
  const tokenSource = input.botToken || env.TELEGRAM_BOT_TOKEN;
  const safeToken = normalizeToken(tokenSource);
  if (!safeToken) {
    throw new Error("No Telegram bot token available");
  }

  const safeWebhookUrl = normalizeChannelText(input.webhookUrl, 2048);
  if (!safeWebhookUrl.startsWith("https://")) {
    throw new Error("Invalid Telegram webhook URL");
  }

  const payload: Record<string, unknown> = { url: safeWebhookUrl };
  const secret = normalizeSecret(input.secretToken);
  if (secret) {
    payload.secret_token = secret;
  }

  await telegramCall(safeToken, "setWebhook", payload);
}
