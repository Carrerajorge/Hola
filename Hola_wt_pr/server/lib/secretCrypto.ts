import crypto from "crypto";
import { Logger } from "./logger";

let cachedKey: Buffer | null | undefined;
let warnedMissingKey = false;

function getEncryptionKey(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;

  const keyString = process.env.TOKEN_ENCRYPTION_KEY;
  if (!keyString) {
    cachedKey = null;
    return cachedKey;
  }

  // Derive a stable 32-byte key for AES-256-GCM.
  cachedKey = crypto.scryptSync(keyString, "iliagpt-token-salt", 32);
  return cachedKey;
}

function looksEncrypted(value: string): boolean {
  // Format: ivHex:authTagHex:cipherHex (all hex)
  const parts = value.split(":");
  if (parts.length !== 3) return false;

  const [ivHex, authTagHex, cipherHex] = parts;
  if (!ivHex || !authTagHex || !cipherHex) return false;
  if (ivHex.length !== 32) return false; // 16 bytes
  if (authTagHex.length !== 32) return false; // 16 bytes

  return /^[0-9a-f]+$/i.test(ivHex) && /^[0-9a-f]+$/i.test(authTagHex) && /^[0-9a-f]+$/i.test(cipherHex);
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) return "";
  const key = getEncryptionKey();
  if (!key) {
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      Logger.warn("[SecretCrypto] TOKEN_ENCRYPTION_KEY is not set; secrets will be stored in plaintext (non-production only).");
    }
    return plaintext;
  }

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Decrypts a secret value when it matches our encryption format.
 * Returns:
 * - string: plaintext value (decrypted or original if not encrypted)
 * - null: value looked encrypted but could not be decrypted (missing/wrong key)
 */
export function decryptSecretMaybe(value: string): string | null {
  if (!value) return "";
  if (!looksEncrypted(value)) return value;

  const key = getEncryptionKey();
  if (!key) {
    Logger.error("[SecretCrypto] Encrypted secret found but TOKEN_ENCRYPTION_KEY is not set; cannot decrypt.");
    return null;
  }

  const [ivHex, authTagHex, cipherHex] = value.split(":");

  try {
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(cipherHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (error) {
    Logger.error("[SecretCrypto] Failed to decrypt secret; treating token as invalid.", error as any);
    return null;
  }
}

