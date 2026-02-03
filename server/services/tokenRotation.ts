/**
 * JWT Refresh Token Rotation Service (#57)
 * Secure token management with rotation and blacklisting
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { db } from '../db';
import { eq, and, lt } from 'drizzle-orm';
import { cache } from '../lib/cache';

const ACCESS_TOKEN_SECRET = process.env.JWT_ACCESS_SECRET || 'access-secret-dev-only';
const REFRESH_TOKEN_SECRET = process.env.JWT_REFRESH_SECRET || 'refresh-secret-dev-only';

if (process.env.NODE_ENV === 'production') {
    if (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET) {
        throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be set in production.');
    }
}

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';
const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

// Token blacklist (in production, use Redis)
const tokenBlacklist = new Set<string>();

// Refresh token family tracking (for rotation)
const refreshTokenFamilies = new Map<string, {
    userId: number;
    createdAt: Date;
    lastRotatedAt: Date;
    tokens: Set<string>;
}>();

const BLACKLIST_KEY_PREFIX = 'token_blacklist:';
const FAMILY_KEY_PREFIX = 'token_family:';
const FAMILY_TOKENS_PREFIX = 'token_family_tokens:';

const getRedisClient = () => cache.getRedisClient();

interface TokenPayload {
    userId: number;
    email: string;
    role: string;
    sessionId: string;
    fingerprint?: string;
}

interface TokenPair {
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
}

/**
 * Generate a new token pair
 */
export async function generateTokenPair(payload: TokenPayload): Promise<TokenPair> {
    const sessionId = payload.sessionId || crypto.randomUUID();
    const familyId = crypto.randomUUID();

    // Access token - short lived
    const accessToken = jwt.sign(
        { ...payload, sessionId, type: 'access' },
        ACCESS_TOKEN_SECRET,
        { expiresIn: ACCESS_TOKEN_EXPIRY }
    );

    // Refresh token - longer lived, includes family ID for rotation tracking
    const refreshToken = jwt.sign(
        { ...payload, sessionId, familyId, type: 'refresh' },
        REFRESH_TOKEN_SECRET,
        { expiresIn: REFRESH_TOKEN_EXPIRY }
    );

    // Track token family
    refreshTokenFamilies.set(familyId, {
        userId: payload.userId,
        createdAt: new Date(),
        lastRotatedAt: new Date(),
        tokens: new Set([refreshToken]),
    });

    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);

    const redis = getRedisClient();
    if (redis) {
        const familyKey = `${FAMILY_KEY_PREFIX}${familyId}`;
        const familyTokensKey = `${FAMILY_TOKENS_PREFIX}${familyId}`;
        const payloadData = {
            userId: payload.userId,
            createdAt: Date.now(),
            lastRotatedAt: Date.now(),
        };
        redis
            .multi()
            .set(familyKey, JSON.stringify(payloadData), 'PX', REFRESH_TOKEN_EXPIRY_MS * 2)
            .sadd(familyTokensKey, refreshToken)
            .pexpire(familyTokensKey, REFRESH_TOKEN_EXPIRY_MS * 2)
            .exec()
            .catch(() => {});
    }

    return { accessToken, refreshToken, expiresAt };
}

/**
 * Verify access token
 */
export async function verifyAccessToken(token: string): Promise<TokenPayload | null> {
    try {
        if (tokenBlacklist.has(token)) {
            return null;
        }

        const redis = getRedisClient();
        if (redis) {
            const exists = await redis.exists(`${BLACKLIST_KEY_PREFIX}${token}`);
            if (exists) {
                return null;
            }
        }

        const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET) as TokenPayload & { type: string };

        if (decoded.type !== 'access') {
            return null;
        }

        return decoded;
    } catch (error) {
        return null;
    }
}

/**
 * Rotate refresh token - issues new pair and invalidates old
 */
export async function rotateRefreshToken(oldRefreshToken: string): Promise<TokenPair | null> {
    try {
        // Verify the refresh token
        const decoded = jwt.verify(oldRefreshToken, REFRESH_TOKEN_SECRET) as TokenPayload & {
            type: string;
            familyId: string;
        };

        if (decoded.type !== 'refresh') {
            return null;
        }

        let family = refreshTokenFamilies.get(decoded.familyId);

        if (!family) {
            const redis = getRedisClient();
            if (redis) {
                const familyKey = `${FAMILY_KEY_PREFIX}${decoded.familyId}`;
                const familyTokensKey = `${FAMILY_TOKENS_PREFIX}${decoded.familyId}`;
                const [familyPayload, tokenExists] = await Promise.all([
                    redis.get(familyKey),
                    redis.sismember(familyTokensKey, oldRefreshToken),
                ]);
                if (!familyPayload || !tokenExists) {
                    console.warn('Unknown token family, possible theft detected');
                    return null;
                }
                const parsed = JSON.parse(familyPayload) as { userId: number; createdAt: number; lastRotatedAt: number };
                family = {
                    userId: parsed.userId,
                    createdAt: new Date(parsed.createdAt),
                    lastRotatedAt: new Date(parsed.lastRotatedAt),
                    tokens: new Set([oldRefreshToken]),
                };
                refreshTokenFamilies.set(decoded.familyId, family);
            }
        }

        if (!family) {
            // Unknown family - possible token theft, invalidate
            console.warn('Unknown token family, possible theft detected');
            return null;
        }

        // Check if token was already used (reuse detection)
        if (!family.tokens.has(oldRefreshToken)) {
            // Token reuse detected! Invalidate entire family
            console.warn('Refresh token reuse detected! Invalidating all tokens for user:', decoded.userId);
            invalidateTokenFamily(decoded.familyId);
            return null;
        }

        // Remove old token from valid set
        family.tokens.delete(oldRefreshToken);
        tokenBlacklist.add(oldRefreshToken);
        const redis = getRedisClient();
        if (redis) {
            redis.set(`${BLACKLIST_KEY_PREFIX}${oldRefreshToken}`, '1', 'PX', REFRESH_TOKEN_EXPIRY_MS).catch(() => {});
        }

        // Generate new pair
        const newPair = await generateTokenPair({
            userId: decoded.userId,
            email: decoded.email,
            role: decoded.role,
            sessionId: decoded.sessionId,
            fingerprint: decoded.fingerprint,
        });

        // Update family
        family.lastRotatedAt = new Date();
        family.tokens.add(newPair.refreshToken);

        if (redis) {
            const familyKey = `${FAMILY_KEY_PREFIX}${decoded.familyId}`;
            const familyTokensKey = `${FAMILY_TOKENS_PREFIX}${decoded.familyId}`;
            const payloadData = {
                userId: family.userId,
                createdAt: family.createdAt.getTime(),
                lastRotatedAt: family.lastRotatedAt.getTime(),
            };
            redis
                .multi()
                .set(familyKey, JSON.stringify(payloadData), 'PX', REFRESH_TOKEN_EXPIRY_MS * 2)
                .sadd(familyTokensKey, newPair.refreshToken)
                .srem(familyTokensKey, oldRefreshToken)
                .pexpire(familyTokensKey, REFRESH_TOKEN_EXPIRY_MS * 2)
                .exec()
                .catch(() => {});
        }

        return newPair;
    } catch (error) {
        return null;
    }
}

/**
 * Invalidate all tokens for a family (security measure)
 */
export function invalidateTokenFamily(familyId: string): void {
    const family = refreshTokenFamilies.get(familyId);
    if (family) {
        for (const token of family.tokens) {
            tokenBlacklist.add(token);
            const redis = getRedisClient();
            if (redis) {
                redis.set(`${BLACKLIST_KEY_PREFIX}${token}`, '1', 'PX', REFRESH_TOKEN_EXPIRY_MS).catch(() => {});
            }
        }
        refreshTokenFamilies.delete(familyId);
    }

    const redis = getRedisClient();
    if (redis) {
        redis.del(`${FAMILY_KEY_PREFIX}${familyId}`, `${FAMILY_TOKENS_PREFIX}${familyId}`).catch(() => {});
    }
}

/**
 * Invalidate all tokens for a user (logout all sessions)
 */
export function invalidateAllUserTokens(userId: number): void {
    for (const [familyId, family] of refreshTokenFamilies.entries()) {
        if (family.userId === userId) {
            invalidateTokenFamily(familyId);
        }
    }
}

/**
 * Blacklist a specific token
 */
export function blacklistToken(token: string): void {
    tokenBlacklist.add(token);
    const redis = getRedisClient();
    if (redis) {
        redis.set(`${BLACKLIST_KEY_PREFIX}${token}`, '1', 'PX', REFRESH_TOKEN_EXPIRY_MS).catch(() => {});
    }
}

/**
 * Clean up expired tokens from blacklist (run periodically)
 */
export function cleanupExpiredTokens(): void {
    const toRemove: string[] = [];

    for (const token of tokenBlacklist) {
        try {
            // If we can't decode it or it's expired, remove from blacklist
            jwt.verify(token, REFRESH_TOKEN_SECRET);
        } catch {
            toRemove.push(token);
        }
    }

    for (const token of toRemove) {
        tokenBlacklist.delete(token);
    }

    // Also cleanup old token families
    const now = Date.now();
    for (const [familyId, family] of refreshTokenFamilies.entries()) {
        if (now - family.createdAt.getTime() > REFRESH_TOKEN_EXPIRY_MS * 2) {
            refreshTokenFamilies.delete(familyId);
        }
    }
}

// Run cleanup every hour
setInterval(cleanupExpiredTokens, 60 * 60 * 1000);

/**
 * Extract token from Authorization header
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }
    return authHeader.substring(7);
}

// ============================================
// EXPRESS MIDDLEWARE
// ============================================

import { Request, Response, NextFunction } from 'express';

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
    const token = extractBearerToken(req.headers.authorization);

    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    const payload = await verifyAccessToken(token);

    if (!payload) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Attach user to request
    (req as any).user = payload;
    next();
}

// ============================================
// ROUTER
// ============================================

import { Router } from 'express';

export function createTokenRouter() {
    const router = Router();

    // Refresh token endpoint
    router.post('/refresh', async (req, res) => {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(400).json({ error: 'Refresh token required' });
        }

        const newPair = await rotateRefreshToken(refreshToken);

        if (!newPair) {
            return res.status(401).json({ error: 'Invalid refresh token' });
        }

        res.json({
            accessToken: newPair.accessToken,
            refreshToken: newPair.refreshToken,
            expiresAt: newPair.expiresAt.toISOString(),
        });
    });

    // Logout (single session)
    router.post('/logout', authMiddleware, (req, res) => {
        const token = extractBearerToken(req.headers.authorization);
        if (token) {
            blacklistToken(token);
        }
        res.json({ success: true });
    });

    // Logout all sessions
    router.post('/logout-all', authMiddleware, (req, res) => {
        const userId = (req as any).user?.userId;
        if (userId) {
            invalidateAllUserTokens(userId);
        }
        res.json({ success: true, message: 'All sessions terminated' });
    });

    return router;
}
