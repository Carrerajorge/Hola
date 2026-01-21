/**
 * Encryption at Rest Service (#58)
 * AES-256-GCM encryption for sensitive data
 */

import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

// Derive key from password (for user-specific encryption)
function deriveKey(password: string, salt: Buffer): Buffer {
    return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
}

// Get master key
function getMasterKey(): Buffer {
    if (ENCRYPTION_KEY.length !== 64) {
        throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
    }
    return Buffer.from(ENCRYPTION_KEY, 'hex');
}

/**
 * Encrypt data with AES-256-GCM
 * @returns Base64 encoded string: IV + AuthTag + CipherText
 */
export function encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = getMasterKey();

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Combine: IV (16) + AuthTag (16) + Ciphertext
    const combined = Buffer.concat([
        iv,
        authTag,
        Buffer.from(encrypted, 'hex')
    ]);

    return combined.toString('base64');
}

/**
 * Decrypt data encrypted with encrypt()
 */
export function decrypt(encryptedData: string): string {
    const combined = Buffer.from(encryptedData, 'base64');

    // Extract parts
    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const key = getMasterKey();

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString('utf8');
}

/**
 * Encrypt with user-specific key (for E2E encryption)
 * @returns Base64 encoded string: Salt + IV + AuthTag + CipherText
 */
export function encryptWithPassword(plaintext: string, password: string): string {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const key = deriveKey(password, salt);
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Combine: Salt (32) + IV (16) + AuthTag (16) + Ciphertext
    const combined = Buffer.concat([
        salt,
        iv,
        authTag,
        Buffer.from(encrypted, 'hex')
    ]);

    return combined.toString('base64');
}

/**
 * Decrypt data encrypted with encryptWithPassword()
 */
export function decryptWithPassword(encryptedData: string, password: string): string {
    const combined = Buffer.from(encryptedData, 'base64');

    // Extract parts
    const salt = combined.subarray(0, SALT_LENGTH);
    const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const authTag = combined.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = combined.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

    const key = deriveKey(password, salt);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString('utf8');
}

/**
 * Hash data with SHA-256 (one-way, for comparisons)
 */
export function hash(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Generate secure random token
 */
export function generateSecureToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
}

/**
 * Encrypt object (JSON)
 */
export function encryptObject<T>(obj: T): string {
    return encrypt(JSON.stringify(obj));
}

/**
 * Decrypt to object
 */
export function decryptObject<T>(encryptedData: string): T {
    const json = decrypt(encryptedData);
    return JSON.parse(json);
}

/**
 * Encrypt specific fields in an object
 */
export function encryptFields<T extends Record<string, any>>(
    obj: T,
    fieldsToEncrypt: (keyof T)[]
): T {
    const result = { ...obj };

    for (const field of fieldsToEncrypt) {
        if (result[field] !== undefined && result[field] !== null) {
            const value = typeof result[field] === 'string'
                ? result[field]
                : JSON.stringify(result[field]);
            result[field] = encrypt(value) as any;
        }
    }

    return result;
}

/**
 * Decrypt specific fields in an object
 */
export function decryptFields<T extends Record<string, any>>(
    obj: T,
    fieldsToDecrypt: (keyof T)[]
): T {
    const result = { ...obj };

    for (const field of fieldsToDecrypt) {
        if (result[field] !== undefined && result[field] !== null) {
            try {
                const decrypted = decrypt(result[field] as string);
                // Try to parse as JSON, if fails keep as string
                try {
                    result[field] = JSON.parse(decrypted);
                } catch {
                    result[field] = decrypted as any;
                }
            } catch (e) {
                // Field wasn't encrypted, keep as is
            }
        }
    }

    return result;
}

// ============================================
// DATABASE INTEGRATION HELPERS
// ============================================

/**
 * Middleware for Drizzle - encrypt before insert
 */
export function createEncryptedColumn(columnName: string) {
    return {
        mapToDriverValue: (value: string) => encrypt(value),
        mapFromDriverValue: (value: string) => decrypt(value),
    };
}

/**
 * Encrypt message content for storage
 */
export function encryptMessage(content: string, userId: number): string {
    // Add metadata for key rotation support
    const payload = {
        v: 1, // version
        t: Date.now(),
        c: content,
    };
    return encrypt(JSON.stringify(payload));
}

/**
 * Decrypt message content from storage
 */
export function decryptMessage(encrypted: string): string {
    try {
        const payload = JSON.parse(decrypt(encrypted));
        return payload.c;
    } catch {
        // Fallback for legacy non-versioned data
        return decrypt(encrypted);
    }
}
