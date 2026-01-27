/**
 * Google OAuth Authentication - FIX HOST para producción
 * 
 * PROBLEMA: req.get("host") devuelve "localhost:5001" en lugar de "iliagpt.com"
 * porque Express no confía en el proxy por defecto.
 * 
 * SOLUCIÓN: Usar X-Forwarded-Host o APP_URL configurado en producción
 */
import { Router, Request, Response } from "express";
import { authStorage } from "../replit_integrations/auth/storage";
import { storage } from "../storage";
import { env } from "../config/env";
import { db } from "../db";
import { oauthStates } from "../../shared/schema/auth";
import { eq, lt } from "drizzle-orm";

const router = Router();

// Google OAuth Configuration
const getGoogleConfig = () => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
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
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

// Helper to get the correct host for redirects
const getAppHost = (req: Request): string => {
    // En producción, usar el dominio configurado o X-Forwarded-Host
    if (env.NODE_ENV === "production") {
        // Prioridad: APP_URL env var > X-Forwarded-Host > Host header
        const appUrl = process.env.APP_URL;
        if (appUrl) {
            // Extraer solo el host de la URL
            try {
                const url = new URL(appUrl);
                return url.host;
            } catch {
                return appUrl;
            }
        }

        const forwardedHost = req.get("x-forwarded-host");
        if (forwardedHost) {
            return forwardedHost;
        }

        // Fallback al Host header (que nginx debería pasar correctamente)
        const host = req.get("host");
        if (host && !host.includes("localhost") && !host.includes("127.0.0.1")) {
            return host;
        }

        // Último fallback: dominio hardcodeado
        return "iliagpt.com";
    }

    // En desarrollo, usar el host del request
    return req.get("host") || "localhost:5001";
};

// Cleanup old states every 5 minutes
setInterval(async () => {
    try {
        const now = new Date();
        await db.delete(oauthStates).where(lt(oauthStates.expiresAt, now));
        console.log("[Google Auth] Cleaned up expired OAuth states");
    } catch (error) {
        console.error("[Google Auth] Error cleaning up expired states:", error);
    }
}, 5 * 60 * 1000);

/**
 * GET /api/auth/google
 * Initiates Google OAuth login flow
 */
router.get("/google", async (req: Request, res: Response) => {
    const config = getGoogleConfig();

    if (!config) {
        console.error("[Google Auth] Google OAuth not configured");
        return res.redirect("/login?error=google_not_configured");
    }

    const state = generateState();
    const returnUrl = (req.query.returnUrl as string) || "/";

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos

    try {
        await db.insert(oauthStates).values({
            state,
            returnUrl,
            provider: "google",
            expiresAt,
        });
    } catch (error) {
        console.error("[Google Auth] Error saving state:", error);
        return res.redirect("/login?error=internal_error");
    }

    // Usar el helper para obtener el host correcto
    const protocol = env.NODE_ENV === "production" ? "https" : req.protocol;
    const host = getAppHost(req);
    const redirectUri = `${protocol}://${host}/api/auth/google/callback`;

    console.log("[Google Auth] Building redirect with:", { protocol, host, redirectUri });

    const params = new URLSearchParams({
        client_id: config.clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: "openid email profile",
        state,
        access_type: "offline",
        prompt: "consent",
    });

    const authUrl = `${config.authorizationUrl}?${params.toString()}`;
    console.log("[Google Auth] Redirecting to Google login");
    return res.redirect(authUrl);
});

/**
 * GET /api/auth/google/callback
 * Handles the OAuth callback from Google
 */
router.get("/google/callback", async (req: Request, res: Response) => {
    const { code, state, error, error_description } = req.query;

    if (error) {
        console.error("[Google Auth] OAuth error:", error, error_description);
        return res.redirect(`/login?error=google_auth_failed&message=${encodeURIComponent(error_description as string || "")}`);
    }

    if (!code || !state) {
        console.error("[Google Auth] Missing code or state");
        return res.redirect("/login?error=google_invalid_response");
    }

    // Verificar estado desde la base de datos
    let stateData: { returnUrl: string } | null = null;
    try {
        const [stateRecord] = await db
            .select()
            .from(oauthStates)
            .where(eq(oauthStates.state, state as string));

        if (!stateRecord) {
            console.error("[Google Auth] Invalid state - not found in database");
            return res.redirect("/login?error=invalid_state");
        }

        // Verificar expiración
        if (new Date() > stateRecord.expiresAt) {
            console.error("[Google Auth] State expired");
            await db.delete(oauthStates).where(eq(oauthStates.state, state as string));
            return res.redirect("/login?error=state_expired");
        }

        stateData = { returnUrl: stateRecord.returnUrl || "/" };

        // Eliminar el estado usado
        await db.delete(oauthStates).where(eq(oauthStates.state, state as string));
    } catch (error) {
        console.error("[Google Auth] Error verifying state:", error);
        return res.redirect("/login?error=state_verification_failed");
    }

    const finalReturnUrl = stateData?.returnUrl || "/";

    try {
        const config = getGoogleConfig();
        if (!config) {
            return res.redirect("/login?error=google_not_configured");
        }

        // Usar el mismo helper para el callback
        const protocol = env.NODE_ENV === "production" ? "https" : req.protocol;
        const host = getAppHost(req);
        const redirectUri = `${protocol}://${host}/api/auth/google/callback`;

        // Exchange code for tokens
        const tokenResponse = await fetch(config.tokenUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                code: code as string,
                client_id: config.clientId,
                client_secret: config.clientSecret,
                redirect_uri: redirectUri,
                grant_type: "authorization_code",
            }),
        });

        if (!tokenResponse.ok) {
            const errorText = await tokenResponse.text();
            console.error("[Google Auth] Token exchange failed:", errorText);
            return res.redirect("/login?error=google_token_failed");
        }

        const tokens = await tokenResponse.json() as {
            access_token: string;
            refresh_token?: string;
            expires_in?: number;
            token_type: string;
        };

        // Get user info from Google
        const userInfoResponse = await fetch(config.userInfoUrl, {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
        });

        if (!userInfoResponse.ok) {
            console.error("[Google Auth] Failed to get user info");
            return res.redirect("/login?error=google_userinfo_failed");
        }

        const googleUser = await userInfoResponse.json() as {
            id: string;
            email: string;
            verified_email: boolean;
            name: string;
            given_name?: string;
            family_name?: string;
            picture?: string;
        };

        const email = googleUser.email;
        if (!email) {
            console.error("[Google Auth] No email in Google response");
            return res.redirect("/login?error=google_no_email");
        }

        // Find or create user
        let user = await authStorage.getUserByEmail(email);

        if (!user) {
            user = await authStorage.upsertUser({
                id: `google_${googleUser.id}`,
                email,
                username: email.split("@")[0],
                fullName: googleUser.name,
                firstName: googleUser.given_name || null,
                lastName: googleUser.family_name || null,
                profileImageUrl: googleUser.picture || null,
                authProvider: "google",
                emailVerified: googleUser.verified_email ? "true" : "false",
            });
            console.log("[Google Auth] Created new user:", email);
        } else {
            user = await authStorage.upsertUser({
                id: user.id,
                email,
                fullName: googleUser.name,
                firstName: googleUser.given_name || user.firstName,
                lastName: googleUser.family_name || user.lastName,
                profileImageUrl: googleUser.picture || user.profileImageUrl,
                authProvider: "google",
                emailVerified: googleUser.verified_email ? "true" : "false",
            });
            console.log("[Google Auth] Updated existing user:", email);
        }

        // Create session
        const sessionUser = {
            id: user.id,
            email: user.email,
            username: user.username,
            fullName: user.fullName,
            firstName: user.firstName,
            lastName: user.lastName,
            profileImageUrl: user.profileImageUrl,
            role: user.role,
            plan: user.plan,
            authProvider: "google",
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expires_at: Math.floor(Date.now() / 1000) + (tokens.expires_in || 3600),
        };

        // Usar promesa para manejar req.login correctamente
        await new Promise<void>((resolve, reject) => {
            req.login(sessionUser, (loginErr) => {
                if (loginErr) {
                    reject(loginErr);
                } else {
                    resolve();
                }
            });
        });

        // Update last login (no bloquear la respuesta)
        authStorage.updateUserLogin(user.id, {
            ipAddress: req.ip || req.socket.remoteAddress || null,
            userAgent: req.headers["user-agent"] || null,
        }).catch(err => console.warn("[Google Auth] Failed to update login:", err));

        storage.createAuditLog({
            userId: user.id,
            action: "user_login",
            resource: "auth",
            details: {
                email,
                provider: "google_oauth",
            },
            ipAddress: req.ip || req.socket.remoteAddress || null,
            userAgent: req.headers["user-agent"] || null,
        }).catch(err => console.warn("[Google Auth] Failed to create audit log:", err));

        console.log("[Google Auth] Login successful for:", email);

        // HARDENING: Wrap redirect in session.save to prevent race conditions with Postgres session store
        return new Promise<void>((resolve, reject) => {
            req.session.save((err) => {
                if (err) {
                    console.error("[Google Auth] Session save error:", err);
                    // Still try to redirect, but log the error
                    res.redirect("/login?error=session_save_error");
                    resolve();
                    return;
                }
                res.redirect(finalReturnUrl + "?auth=success");
                resolve();
            });
        });

    } catch (error: any) {
        console.error("[Google Auth] Callback error:", error);
        if (!res.headersSent) {
            return res.redirect("/login?error=google_error");
        }
    }
});

/**
 * GET /api/auth/google/status
 * Returns whether Google OAuth is configured
 */
router.get("/google/status", (_req: Request, res: Response) => {
    res.json({ configured: isGoogleConfigured() });
});

export default router;
