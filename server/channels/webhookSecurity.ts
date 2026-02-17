import crypto from "crypto";

const DEFAULT_WEBHOOK_CLOCK_SKEW_MS = 6 * 60 * 1000;

export function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function verifyTelegramSecretToken(input: {
  providedToken: string | undefined;
  expectedToken: string | undefined;
}): boolean {
  if (!input.expectedToken) return true; // best-effort: allow if not configured
  if (!input.providedToken) return false;
  return timingSafeEqual(String(input.providedToken), String(input.expectedToken));
}

export function computeWhatsAppSignature256(input: {
  rawBody: Buffer;
  appSecret: string;
}): string {
  const mac = crypto.createHmac("sha256", input.appSecret).update(input.rawBody).digest("hex");
  return `sha256=${mac}`;
}

export function verifyWhatsAppSignature256(input: {
  rawBody: Buffer;
  headerSignature: string | undefined;
  appSecret: string | undefined;
}): boolean {
  if (!input.appSecret) return true; // best-effort: allow if not configured
  if (!input.headerSignature) return false;
  const expected = computeWhatsAppSignature256({ rawBody: input.rawBody, appSecret: input.appSecret });
  return timingSafeEqual(input.headerSignature, expected);
}

/** Messenger uses the same HMAC-SHA256 pattern as WhatsApp (both Meta platforms). */
export function verifyMessengerSignature256(input: {
  rawBody: Buffer;
  headerSignature: string | undefined;
  appSecret: string | undefined;
}): boolean {
  if (!input.appSecret) return true;
  if (!input.headerSignature) return false;
  const mac = crypto.createHmac("sha256", input.appSecret).update(input.rawBody).digest("hex");
  const expected = `sha256=${mac}`;
  return timingSafeEqual(input.headerSignature, expected);
}

/** WeChat uses SHA1 of sorted [token, timestamp, nonce]. */
export function verifyWeChatSignature(input: {
  signature: string | undefined;
  timestamp: string | undefined;
  nonce: string | undefined;
  token: string | undefined;
}): boolean {
  if (!input.token) return true;
  if (!input.signature || !input.timestamp || !input.nonce) return false;
  const arr = [input.token, input.timestamp, input.nonce].sort();
  const computed = crypto.createHash("sha1").update(arr.join("")).digest("hex");
  return timingSafeEqual(computed, input.signature);
}

function normalizeTimestampInput(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const asNumber = Number.parseInt(value, 10);
    if (Number.isFinite(asNumber)) return asNumber;
  }
  return null;
}

function toEpochMs(raw: unknown): number | null {
  const v = normalizeTimestampInput(raw);
  if (v === null) return null;
  if (v > 0 && v < 1_000_000_000_000) return v * 1000;
  return v;
}

export function extractWebhookPayloadTimestamp(payload: unknown): number | null {
  const root = payload as Record<string, unknown>;
  const candidates: number[] = [];

  const addTimestamp = (value: unknown) => {
    const ts = toEpochMs(value);
    if (ts !== null) candidates.push(ts);
  };

  const entries = Array.isArray(root?.entry) ? root.entry as unknown[] : [];
  for (const entry of entries) {
    const changes = Array.isArray((entry as any)?.changes) ? (entry as any).changes : [];
    for (const change of changes) {
      const value = (change as any)?.value;
      addTimestamp((value as any)?.timestamp);
      const messages = Array.isArray((value as any)?.messages) ? (value as any).messages : [];
      for (const msg of messages) {
        addTimestamp((msg as any)?.timestamp);
      }
    }

    const messaging = Array.isArray((entry as any)?.messaging) ? (entry as any).messaging : [];
    for (const event of messaging) {
      addTimestamp((event as any)?.timestamp);
    }
  }

  const message = (root as any)?.message;
  if (message) {
    addTimestamp(message?.date);
  }

  if (!candidates.length) return null;
  return Math.max(...candidates);
}

export function isWebhookTimestampFresh(
  timestampMs: number | null | undefined,
  options: { nowMs?: number; maxSkewMs?: number } = {},
): boolean {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return false;

  const nowMs = options.nowMs ?? Date.now();
  const maxSkewMs = options.maxSkewMs ?? DEFAULT_WEBHOOK_CLOCK_SKEW_MS;

  if (timestampMs > nowMs + 60_000) return false;
  return nowMs - timestampMs <= maxSkewMs;
}
