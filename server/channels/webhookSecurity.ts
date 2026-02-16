import crypto from "crypto";

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

