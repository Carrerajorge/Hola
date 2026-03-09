import crypto from "crypto";
import bcrypt from "bcrypt";

const SCRYPT_PREFIX = "scrypt";
const SCRYPT_KEYLEN = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(derivedKey as Buffer);
    });
  });
}

function parseScryptHash(value: string): { salt: Buffer; key: Buffer } | null {
  const prefixed = value.startsWith(`${SCRYPT_PREFIX}$`);
  const parts = prefixed ? value.split("$") : value.split(":");

  if (prefixed && parts.length === 3) {
    const [, saltHex, keyHex] = parts;
    return {
      salt: Buffer.from(saltHex, "hex"),
      key: Buffer.from(keyHex, "hex"),
    };
  }

  if (!prefixed && parts.length === 2) {
    const [saltHex, keyHex] = parts;
    return {
      salt: Buffer.from(saltHex, "hex"),
      key: Buffer.from(keyHex, "hex"),
    };
  }

  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(32);
  const key = await deriveKey(password, salt);
  return `${SCRYPT_PREFIX}$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (hash.startsWith("$2a$") || hash.startsWith("$2b$")) {
    return bcrypt.compare(password, hash);
  }

  const parsed = parseScryptHash(hash);
  if (!parsed) {
    return false;
  }

  const derivedKey = await deriveKey(password, parsed.salt);
  return crypto.timingSafeEqual(derivedKey, parsed.key);
}

export function isHashed(value: string): boolean {
  return value.startsWith(`${SCRYPT_PREFIX}$`) || value.includes(":") || value.startsWith("$2b$") || value.startsWith("$2a$");
}
