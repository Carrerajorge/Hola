import { Logger } from '../logger';
import * as crypto from 'crypto';
import { db } from '../../db';
import { authTokens } from '../../../shared/schema/auth';
import { eq, and, sql } from 'drizzle-orm';

type TokenProvider = 'google' | 'microsoft' | 'auth0';

interface TokenRecord {
    userId: string;
    provider: TokenProvider;
    accessToken: string;
    refreshToken: string;
    expiresAt: number; // Timestamp
    scope: string;
}

interface RefreshTokenResponse {
    accessToken: string;
    refreshToken: string | undefined;
    expiresAt: number;
    scope: string;
}

interface RefreshProviderConfig {
    tokenUrl: string;
    clientId: string;
    clientSecret: string;
}

export class TokenManager {
    private encryptionKey: Buffer;

    constructor() {
        // SECURITY: never fall back to a built-in key.
        const keyString = process.env.TOKEN_ENCRYPTION_KEY;

        if (!keyString) {
            throw new Error("TOKEN_ENCRYPTION_KEY is required for OAuth token storage.");
        }

        if (Buffer.byteLength(keyString, 'utf8') < 32) {
            throw new Error("TOKEN_ENCRYPTION_KEY must be at least 32 bytes long.");
        }

        if (keyString === 'default-secret-key-must-be-32-bytes-long!') {
            throw new Error("TOKEN_ENCRYPTION_KEY must not use the default development placeholder.");
        }

        // Ensure key is exactly 32 bytes for AES-256 via deterministic derivation.
        this.encryptionKey = crypto.scryptSync(keyString, 'salt', 32);
    }

    /**
     * Store tokens securely in Postgres
     */
    async saveTokens(userId: string, provider: TokenProvider, tokens: any) {
        try {
            const accessToken = this.encrypt(tokens.access_token);
            const refreshToken = tokens.refresh_token ? this.encrypt(tokens.refresh_token) : undefined;
            const expiresAt = tokens.expiry_date || (Date.now() + (tokens.expires_in || 3600) * 1000); // Normalize expiry
            const scope = tokens.scope || '';

            // Upsert mechanism
            await db.insert(authTokens).values({
                userId,
                provider,
                accessToken,
                refreshToken,
                expiresAt,
                scope
            }).onConflictDoUpdate({
                target: [authTokens.userId, authTokens.provider],
                set: {
                    accessToken,
                    refreshToken: refreshToken || sql`auth_tokens.refresh_token`, // Keep old refresh token if not provided
                    expiresAt,
                    scope,
                    updatedAt: new Date()
                }
            });

            Logger.info(`[TokenMgr] Saved ${provider} tokens for user ${userId}`);
        } catch (error) {
            Logger.error(`[TokenMgr] Failed to save tokens: ${error}`);
            throw error;
        }
    }

    /**
     * Get valid access token (auto-refresh if needed)
     */
    async getAccessToken(userId: string, provider: TokenProvider): Promise<string | null> {
        try {
            const [record] = await db
                .select()
                .from(authTokens)
                .where(and(eq(authTokens.userId, userId), eq(authTokens.provider, provider)));

            if (!record) return null;

            // Check expiration (with 5 minute buffer)
            const expiresAt = Number(record.expiresAt);
            if (Date.now() > expiresAt - 5 * 60 * 1000) {
                Logger.info(`[TokenMgr] Token expired for ${userId}, refreshing...`);
                return this.refreshTokens(userId, provider, record);
            }

            return this.decrypt(record.accessToken);
        } catch (error) {
            Logger.error(`[TokenMgr] Failed to get access token: ${error}`);
            return null;
        }
    }

    private async refreshTokens(userId: string, provider: TokenProvider, record: TokenRecord): Promise<string | null> {
        if (!record.refreshToken) {
            Logger.warn(`[TokenMgr] No refresh token available for ${userId} ${provider}`);
            return null;
        }

        const refreshToken = this.decrypt(record.refreshToken);
        if (!refreshToken) return null;

        try {
            const result = await this.refreshTokenWithProvider(provider, refreshToken);
            if (!result) return null;

            const values: Record<string, unknown> = {
                accessToken: this.encrypt(result.accessToken),
                expiresAt: result.expiresAt,
                scope: result.scope || "",
                updatedAt: new Date(),
            };

            if (result.refreshToken) {
                values.refreshToken = this.encrypt(result.refreshToken);
            }

            await db.update(authTokens).set(values).where(and(eq(authTokens.userId, userId), eq(authTokens.provider, provider)));

            Logger.info(`[TokenMgr] Refreshed ${provider} token for user ${userId}`);
            return result.accessToken;
        } catch (e) {
            Logger.error(`[TokenMgr] Refresh failed: ${e}`);
            return null;
        }
    }

    private getRefreshProviderConfig(provider: TokenProvider): RefreshProviderConfig | null {
        if (provider === 'google') {
            const clientId = process.env.GOOGLE_CLIENT_ID;
            const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
            if (!clientId || !clientSecret) return null;
            return {
                tokenUrl: "https://oauth2.googleapis.com/token",
                clientId,
                clientSecret,
            };
        }

        if (provider === 'microsoft') {
            const clientId = process.env.MICROSOFT_CLIENT_ID;
            const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
            const tenantId = process.env.MICROSOFT_TENANT_ID || "common";

            if (!clientId || !clientSecret) return null;

            return {
                tokenUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
                clientId,
                clientSecret,
            };
        }

        if (provider === 'auth0') {
            const clientId = process.env.AUTH0_CLIENT_ID;
            const clientSecret = process.env.AUTH0_CLIENT_SECRET;
            const domain = process.env.AUTH0_DOMAIN?.replace(/^https?:\/\//, "");
            if (!clientId || !clientSecret || !domain) return null;

            return {
                tokenUrl: `https://${domain}/oauth/token`,
                clientId,
                clientSecret,
            };
        }

        return null;
    }

    private async refreshTokenWithProvider(
        provider: TokenProvider,
        refreshToken: string
    ): Promise<RefreshTokenResponse | null> {
        const config = this.getRefreshProviderConfig(provider);
        if (!config) {
            Logger.warn(`[TokenMgr] Missing OAuth config for refresh flow: ${provider}`);
            return null;
        }

        const params = new URLSearchParams({
            grant_type: "refresh_token",
            client_id: config.clientId,
            client_secret: config.clientSecret,
            refresh_token: refreshToken,
        });

        if (provider === "auth0") {
            params.append("scope", "openid profile email offline_access");
        }

        const response = await fetch(config.tokenUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params,
        });
        const rawBody = await response.text();

        let payload: Record<string, unknown>;
        try {
            payload = rawBody ? JSON.parse(rawBody) : {};
        } catch {
            Logger.warn(`[TokenMgr] Failed to parse refresh response for ${provider}: ${rawBody}`);
            return null;
        }

        if (!response.ok) {
            const errorText = typeof payload.error_description === "string" ? payload.error_description : JSON.stringify(payload.error || payload);
            Logger.warn(`[TokenMgr] Refresh request failed for ${provider}: ${response.status} ${errorText}`);
            return null;
        }

        if (typeof payload.access_token !== "string" || !payload.access_token) {
            Logger.warn(`[TokenMgr] Refresh response missing access token for ${provider}`);
            return null;
        }

        const expiresInRaw = payload.expires_in;
        const expiresInSeconds = typeof expiresInRaw === "number"
            ? expiresInRaw
            : Number(expiresInRaw);
        const expiryMs = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds * 1000 : 3600 * 1000;

        return {
            accessToken: payload.access_token as string,
            refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : undefined,
            expiresAt: Date.now() + expiryMs,
            scope: typeof payload.scope === "string" ? payload.scope : "",
        };
    }

    // AES-256-GCM Encryption
    private encrypt(text: string): string {
        if (!text) return '';
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag().toString('hex');
        return `${iv.toString('hex')}:${authTag}:${encrypted}`;
    }

    private decrypt(ciphertext: string): string {
        if (!ciphertext) return '';
        const parts = ciphertext.split(':');
        if (parts.length !== 3) return '';

        try {
            const iv = Buffer.from(parts[0], 'hex');
            const authTag = Buffer.from(parts[1], 'hex');
            const encryptedText = parts[2];

            const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
            decipher.setAuthTag(authTag);
            let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        } catch (e) {
            Logger.error(`[TokenMgr] Decryption error: ${e}`);
            return '';
        }
    }
}

export const tokenManager = new TokenManager();
