/**
 * Google OAuth Authentication
 * Implements OAuth 2.0 for Google account login
 */
import { randomBytes } from "node:crypto";
import { Router, Request, Response } from "express";
import { authStorage } from "../replit_integrations/auth/storage";
import { storage } from "../storage";
import { env } from "../config/env";
import { handleGoogleGeminiCliOAuthCallback } from "./googleGeminiCliBridge";
import { buildSessionUserFromDbUser } from "../lib/sessionUser";

const router = Router();

// CANONICAL URL for OAuth redirects (avoid www/non-www mismatch)
// This MUST match exactly what's registered in Google Cloud Console
const CANONICAL_DOMAIN = process.env.CANONICAL_DOMAIN || "iliagpt.com";

// Helper to get canonical redirect URI (production uses HTTPS + canonical domain)
const getCanonicalRedirectUri = (req: Request, path: string): string => {
    if (env.NODE_ENV === "production") {
        // Always use canonical domain in production to avoid redirect_uri_mismatch
        return `https://${CANONICAL_DOMAIN}${path}`;
    }
    // Development: use request host
    return `${req.protocol}://${req.get("host")}${path}`;
};

// Google OAuth Configuration
const getGoogleConfig = () => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        console.warn("[Google Auth] Missing credentials:", {
            hasClientId: !!clientId,
            hasClientSecret: !!clientSecret,
        });
        return null;
    }

    return {
        clientId,
        clientSecret,
        authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        userInfoUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
    };
};

// Check if Google OAuth is configured
export const isGoogleConfigured = (): boolean => {
    return getGoogleConfig() !== null;
};

// Helper to generate random state for CSRF protection
const generateState = (): string => {
    return randomBytes(32).toString("hex");
};

function normalizeLoginHint(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }

    const normalized = value.trim().toLowerCase();
    if (!normalized) {
        return null;
    }

    if (
        normalized.length > 320 ||
        /\s/.test(normalized) ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
    ) {
        return null;
    }

    return normalized;
}

// Store states temporarily (in production, use Redis)
const stateStore = new Map<string, { createdAt: number; returnUrl: string; providerHint?: string }>();

// Cleanup old states every 5 minutes
setInterval(() => {
    const now = Date.now();
    const maxAge = 10 * 60 * 1000; // 10 minutes
    for (const [state, data] of stateStore.entries()) {
        if (now - data.createdAt > maxAge) {
            stateStore.delete(state);
        }
    }
}, 5 * 60 * 1000);

/**
 * GET /api/auth/google
 * Initiates Google OAuth login flow
 */
router.get("/google", (req: Request, res: Response) => {
    const config = getGoogleConfig();

    if (!config) {
        console.error("[Google Auth] Google OAuth not configured");
        return res.redirect("/login?error=google_not_configured");
    }

    const state = generateState();
    const returnUrl = (req.query.returnUrl as string) || "/";
    const providerHint = typeof req.query.provider_hint === "string" ? req.query.provider_hint.trim() : undefined;
    stateStore.set(state, { createdAt: Date.now(), returnUrl, providerHint });

    // Use canonical redirect URI to match Google Cloud Console configuration
    const redirectUri = getCanonicalRedirectUri(req, "/api/auth/google/callback");

    console.log("[Google Auth] Using redirect_uri:", redirectUri);
    console.log("[Google Auth] Request host:", req.get("host"));
    console.log("[Google Auth] Canonical domain:", CANONICAL_DOMAIN);

    const loginHint =
        normalizeLoginHint(req.query.loginHint) ??
        normalizeLoginHint(req.query.login_hint);

    // When provider_hint is gemini or antigravity, request Gemini-specific scopes
    // so the user only needs ONE OAuth login (no second popup).
    const isGeminiHint = providerHint === "gemini" || providerHint === "antigravity";
    const scopes = isGeminiHint
        ? "openid email profile https://www.googleapis.com/auth/generative-language https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile"
        : "openid email profile";

    const params = new URLSearchParams({
        client_id: config.clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: scopes,
        state,
        access_type: "offline",
        // For Gemini/Antigravity, always force consent to ensure expanded scopes are granted.
        prompt: isGeminiHint ? "select_account consent" : (loginHint ? "consent" : "select_account consent"),
    });
    if (loginHint) {
        params.set("login_hint", loginHint);
    }

    const authUrl = `${config.authorizationUrl}?${params.toString()}`;
    console.log("[Google Auth] Redirecting to Google login");
    res.redirect(authUrl);
});

/**
 * GET /api/auth/google/callback
 * Handles the OAuth callback from Google
 */
router.get("/google/callback", async (req: Request, res: Response) => {
    if (await handleGoogleGeminiCliOAuthCallback(req, res)) {
        return;
    }

    const { code, state, error, error_description } = req.query;

    if (error) {
        console.error("[Google Auth] OAuth error:", error, error_description);
        return res.redirect(`/login?error=google_auth_failed&message=${encodeURIComponent(error_description as string || "")}`);
    }

    if (!code || !state) {
        console.error("[Google Auth] Missing code or state");
        return res.redirect("/login?error=google_invalid_response");
    }

    // Verify state
    const stateData = stateStore.get(state as string);
    if (!stateData) {
        console.error("[Google Auth] Invalid or expired state");
        return res.redirect("/login?error=google_invalid_state");
    }
    stateStore.delete(state as string);

    const config = getGoogleConfig();
    if (!config) {
        return res.redirect("/login?error=google_not_configured");
    }

    try {
        // Use same canonical redirect URI as in /google route
        const redirectUri = getCanonicalRedirectUri(req, "/api/auth/google/callback");
        console.log("[Google Auth] Callback - Using redirect_uri:", redirectUri);

        // Exchange code for tokens
        const tokenResponse = await fetch(config.tokenUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                client_id: config.clientId,
                client_secret: config.clientSecret,
                code: code as string,
                redirect_uri: redirectUri,
                grant_type: "authorization_code",
            }),
        });

        if (!tokenResponse.ok) {
            const errorData = await tokenResponse.text();
            console.error("[Google Auth] Token exchange failed:", errorData);
            return res.redirect("/login?error=google_token_failed");
        }

        const tokens = await tokenResponse.json();

        // Get user info from Google
        const userResponse = await fetch(config.userInfoUrl, {
            headers: {
                Authorization: `Bearer ${tokens.access_token}`,
            },
        });

        if (!userResponse.ok) {
            console.error("[Google Auth] Failed to get user info");
            return res.redirect("/login?error=google_userinfo_failed");
        }

        const googleUser = await userResponse.json();
        console.log("[Google Auth] User info received:", {
            id: googleUser.id,
            email: googleUser.email,
            name: googleUser.name,
        });

        // Upsert user in database
        const email = googleUser.email;
        const firstName = googleUser.given_name || googleUser.name?.split(" ")[0] || "";
        const lastName = googleUser.family_name || googleUser.name?.split(" ").slice(1).join(" ") || "";
        const fullName = googleUser.name || [firstName, lastName].filter(Boolean).join(" ") || null;

        const resolvedUser = await authStorage.upsertUser({
            id: `google_${googleUser.id}`,
            email,
            username: email ? email.split("@")[0] : null,
            fullName,
            firstName,
            lastName,
            profileImageUrl: googleUser.picture || null,
            authProvider: "google",
            emailVerified: googleUser.verified_email ? "true" : "false",
        });

        // Create session
        const baseSessionUser = buildSessionUserFromDbUser(resolvedUser);
        const sessionUser = {
            ...baseSessionUser,
            claims: {
                ...baseSessionUser.claims,
                name: fullName,
                picture: googleUser.picture,
            },
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: Math.floor(Date.now() / 1000) + (tokens.expires_in || 3600),
        };

        req.login(sessionUser, async (loginErr) => {
            if (loginErr) {
                console.error("[Google Auth] Session creation failed:", loginErr);
                return res.redirect("/login?error=session_error");
            }

            console.log("[Google Auth] req.login() successful, sessionID:", req.sessionID);

            // Update last login
            try {
                await authStorage.updateUserLogin(resolvedUser.id, {
                    ipAddress: req.ip || req.socket.remoteAddress || null,
                    userAgent: req.headers["user-agent"] || null,
                });

                await storage.createAuditLog({
                    userId: resolvedUser.id,
                    action: "user_login",
                    resource: "auth",
                    details: {
                        email,
                        provider: "google_oauth",
                    },
                    ipAddress: req.ip || req.socket.remoteAddress || null,
                    userAgent: req.headers["user-agent"] || null,
                });
            } catch (auditError) {
                console.warn("[Google Auth] Failed to create audit log:", auditError);
            }

            // Force session save before redirect (critical for OAuth flow)
            req.session.save(async (saveErr: any) => {
                if (saveErr) {
                    console.error("[Google Auth] Session save failed:", saveErr);
                    return res.redirect("/login?error=session_save_error");
                }

                console.log("[Google Auth] Login successful for:", email);

                // Persist Google tokens to the token manager for later retrieval
                // (e.g., by Gemini CLI credential persistence or token refresh jobs).
                try {
                    const { tokenManager } = await import("../lib/auth/tokenManager.js");
                    await tokenManager.saveTokens(resolvedUser.id, "google", {
                        access_token: tokens.access_token,
                        refresh_token: tokens.refresh_token,
                        expiry_date: Math.floor(Date.now()) + (tokens.expires_in || 3600) * 1000,
                        scope: tokens.scope || "",
                    });
                } catch (tokenSaveError: any) {
                    // Non-blocking: TOKEN_ENCRYPTION_KEY may not be set in all environments
                    console.warn("[Google Auth] Token persistence to DB failed (non-blocking):", tokenSaveError?.message || tokenSaveError);
                }

                // If provider_hint is gemini or antigravity, persist Google tokens
                // as Gemini CLI credentials in a single step (no second OAuth popup needed).
                if (stateData.providerHint === "gemini" || stateData.providerHint === "antigravity") {
                    // Set session flag FIRST so the Gemini CLI status endpoint has
                    // a guaranteed fallback even if the async file/DB persistence
                    // calls below are slow or fail entirely.
                    (req.session as any).geminiCliConnected = {
                        hasAccessToken: true,
                        email: email || null,
                        connectedAt: Date.now(),
                        accessToken: tokens.access_token,
                        refreshToken: tokens.refresh_token || null,
                        expiresAt: Math.floor(Date.now() / 1000 + (tokens.expires_in || 3600)),
                    };

                    try {
                        const { persistGeminiCliCredentialsFromGoogleTokens } = await import("../services/googleGeminiCliOAuthService.js");
                        await persistGeminiCliCredentialsFromGoogleTokens(
                            resolvedUser.id,
                            email,
                            {
                                access_token: tokens.access_token,
                                refresh_token: tokens.refresh_token,
                                expires_at: Math.floor(Date.now() / 1000) + (tokens.expires_in || 3600),
                            },
                        );
                        console.log("[Google Auth] Gemini CLI credentials persisted for:", email);
                    } catch (geminiError: any) {
                        console.warn("[Google Auth] Gemini credential persistence failed (non-blocking):", geminiError?.message || geminiError);
                    }

                    // Also persist via the provider OAuth router's DB storage (dual persistence)
                    try {
                        const { providersService } = await import("../services/providersService.js");
                        const expiresAt = Date.now() + (tokens.expires_in || 3600) * 1000;
                        await providersService.saveUserToken(
                            resolvedUser.id,
                            "gemini",
                            tokens.access_token,
                            tokens.refresh_token || null,
                            expiresAt,
                            "https://www.googleapis.com/auth/generative-language",
                        );
                        console.log("[Google Auth] Gemini provider token saved to DB for:", email);
                    } catch (dbError: any) {
                        console.warn("[Google Auth] Gemini DB token persistence failed (non-blocking):", dbError?.message || dbError);
                    }
                }

                // If provider_hint is openai, persist Google tokens as OpenAI provider
                // tokens so the auto-connect can detect them via session fallback.
                if (stateData.providerHint === "openai") {
                    try {
                        const { providersService } = await import("../services/providersService.js");
                        const expiresAt = Date.now() + (tokens.expires_in || 3600) * 1000;
                        await providersService.saveUserToken(
                            resolvedUser.id,
                            "openai",
                            tokens.access_token,
                            tokens.refresh_token || null,
                            expiresAt,
                            "openid email profile",
                        );
                        console.log("[Google Auth] OpenAI provider token saved to DB for:", email);
                    } catch (dbError: any) {
                        console.warn("[Google Auth] OpenAI DB token persistence failed (non-blocking):", dbError?.message || dbError);
                    }
                }

                // If a provider_hint was set during login, redirect to a post-login
                // page that automatically triggers the corresponding OAuth flow.
                // The home page listens for ?provider=gemini|openai|antigravity to auto-open
                // the provider connection dialog (see home.tsx useEffect).
                // Pass the user's email so the provider OAuth can skip the account picker.
                //
                // IMPORTANT: If geminiCliConnected was set on the session after the
                // initial save (line 294), we must save again so the flag is persisted
                // to the session store before the redirect.  Without this second save
                // the /status endpoint would load a stale session that lacks the flag.
                const doRedirect = () => {
                    if (stateData.providerHint === "gemini" || stateData.providerHint === "openai" || stateData.providerHint === "antigravity") {
                        const emailParam = email ? `&email=${encodeURIComponent(email)}` : "";
                        res.redirect(`/?auth=success&provider=${encodeURIComponent(stateData.providerHint)}${emailParam}`);
                    } else {
                        res.redirect(stateData.returnUrl || "/?auth=success");
                    }
                };

                // Always save session before redirecting to ensure all flags
                // (geminiCliConnected, tokens, etc.) are persisted to the
                // session store. Without this, the /status endpoint may see
                // stale data and trigger a redundant OAuth popup.
                req.session.save((saveErr2: any) => {
                    if (saveErr2) {
                        console.warn("[Google Auth] Final session save before redirect failed:", saveErr2);
                    }
                    doRedirect();
                });
            });
        });

    } catch (error: any) {
        console.error("[Google Auth] Callback error:", error);
        return res.redirect("/login?error=google_error");
    }
});

/**
 * GET /api/auth/google/status
 * Returns whether Google OAuth is configured
 */
router.get("/google/status", (_req: Request, res: Response) => {
    const config = getGoogleConfig();
    res.json({
        configured: config !== null,
        hasClientId: !!process.env.GOOGLE_CLIENT_ID,
        hasClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
    });
});

/**
 * GET /api/auth/google/debug
 * Returns minimal session health info (no sensitive data exposed).
 */
router.get("/google/debug", (_req: Request, res: Response) => {
    res.json({
        configured: isGoogleConfigured(),
        canonicalDomain: CANONICAL_DOMAIN,
        nodeEnv: env.NODE_ENV,
    });
});

export default router;
