import { Logger } from '../logger';
import * as crypto from 'crypto';
import { db } from '../../db';
import { authTokens } from '../../../shared/schema/auth';
import { eq, and, sql } from 'drizzle-orm';

interface RefreshTokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
}

interface TokenRecord {
    userId: string;
    provider: 'google' | 'microsoft' | 'auth0';
    accessToken: string;
    refreshToken: string;
    expiresAt: number; // Timestamp
    scope: string;
}

export class TokenManager {
    private encryptionKey: Buffer;

    constructor() {
        // Ensure key is 32 bytes for AES-256
        const keyString = process.env.TOKEN_ENCRYPTION_KEY || 'default-secret-key-must-be-32-bytes-long!';
        this.encryptionKey = crypto.scryptSync(keyString, 'salt', 32);
    }

    /**
     * Store tokens securely in Postgres
     */
    async saveTokens(userId: string, provider: 'google' | 'microsoft' | 'auth0', tokens: any) {
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
    async getAccessToken(userId: string, provider: 'google' | 'microsoft' | 'auth0'): Promise<string | null> {
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

    private getRefreshConfig(provider: 'google' | 'microsoft' | 'auth0') {
        switch (provider) {
            case 'google':
                return {
                    tokenUrl: 'https://oauth2.googleapis.com/token',
                    clientId: process.env.GOOGLE_CLIENT_ID,
                    clientSecret: process.env.GOOGLE_CLIENT_SECRET
                };
            case 'microsoft': {
                const tenantId = process.env.MICROSOFT_TENANT_ID || 'common';
                return {
                    tokenUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
                    clientId: process.env.MICROSOFT_CLIENT_ID,
                    clientSecret: process.env.MICROSOFT_CLIENT_SECRET
                };
            }
            case 'auth0': {
                const domain = process.env.AUTH0_DOMAIN;
                return {
                    tokenUrl: domain ? `https://${domain}/oauth/token` : undefined,
                    clientId: process.env.AUTH0_CLIENT_ID,
                    clientSecret: process.env.AUTH0_CLIENT_SECRET
                };
            }
            default:
                return { tokenUrl: undefined, clientId: undefined, clientSecret: undefined };
        }
    }

    private async refreshTokens(userId: string, provider: 'google' | 'microsoft' | 'auth0', record: any): Promise<string | null> {
        if (!record.refreshToken) {
            Logger.warn(`[TokenMgr] No refresh token available for ${userId} ${provider}`);
            return null;
        }

        const refreshToken = this.decrypt(record.refreshToken);
        if (!refreshToken) return null;

        try {
            const { tokenUrl, clientId, clientSecret } = this.getRefreshConfig(provider);
            if (!tokenUrl || !clientId || !clientSecret) {
                Logger.warn(`[TokenMgr] Missing OAuth configuration for ${provider} - cannot refresh`);
                return null;
            }

            const body = new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                client_id: clientId,
                client_secret: clientSecret
            });

            if (provider === 'microsoft' && record.scope) {
                body.set('scope', record.scope);
            }

            const response = await fetch(tokenUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body
            });

            if (!response.ok) {
                const errorBody = await response.text();
                Logger.error(`[TokenMgr] Refresh failed for ${provider}: ${response.status} ${errorBody}`);
                return null;
            }

            const refreshed = (await response.json()) as RefreshTokenResponse;
            if (!refreshed.access_token) {
                Logger.error(`[TokenMgr] Refresh response missing access_token for ${provider}`);
                return null;
            }

            await this.saveTokens(userId, provider, {
                access_token: refreshed.access_token,
                refresh_token: refreshed.refresh_token,
                expires_in: refreshed.expires_in,
                scope: refreshed.scope || record.scope
            });

            return refreshed.access_token;
        } catch (e) {
            Logger.error(`[TokenMgr] Refresh failed: ${e}`);
            return null;
        }
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
