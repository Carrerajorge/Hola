/**
 * Google OAuth Authentication
 * Implements OAuth 2.0 for Google account login
 */
import { Router, Request, Response } from "express";
import { authStorage } from "../replit_integrations/auth/storage";
import { storage } from "../storage";

const router = Router();

// Get the base URL for OAuth callbacks
const getBaseUrl = (): string => {
    // Use APP_URL from environment (e.g., https://iliagpt.com)
    if (process.env.APP_URL) {
        return process.env.APP_URL.replace(/\/$/, ''); // Remove trailing slash
    }
    // Fallback for development
    const port = process.env.PORT || 5000;
    return `http://localhost:${port}`;
};

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

// Store states temporarily (in production, use Redis)
const stateStore = new Map<string, { createdAt: number; returnUrl: string }>();

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
    stateStore.set(state, { createdAt: Date.now(), returnUrl });

    // Use APP_URL for production or GOOGLE_CALLBACK_URL if set
    const redirectUri = process.env.GOOGLE_CALLBACK_URL || `${getBaseUrl()}/api/auth/google/callback`;
    console.log("[Google Auth] Starting OAuth flow");
    console.log("[Google Auth] Using redirect URI:", redirectUri);
    console.log("[Google Auth] Generated state:", state.substring(0, 10) + "...");
    console.log("[Google Auth] State store now has", stateStore.size, "entries");

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
    res.redirect(authUrl);
});

/**
 * GET /api/auth/google/callback
 * Handles the OAuth callback from Google
 */
router.get("/google/callback", async (req: Request, res: Response) => {
    // Log all query parameters for debugging
    console.log("[Google Auth] Callback received with query:", JSON.stringify(req.query));
    console.log("[Google Auth] Callback full URL:", req.originalUrl);

    const { code, state, error, error_description } = req.query;

    if (error) {
        console.error("[Google Auth] OAuth error:", error, error_description);
        return res.redirect(`/login?error=google_auth_failed&message=${encodeURIComponent(error_description as string || "")}`);
    }

    if (!code || !state) {
        console.error("[Google Auth] Missing code or state. Query params:", req.query);
        console.error("[Google Auth] State store has", stateStore.size, "entries");
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
        // Use APP_URL for production or GOOGLE_CALLBACK_URL if set
        const redirectUri = process.env.GOOGLE_CALLBACK_URL || `${getBaseUrl()}/api/auth/google/callback`;

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

        await authStorage.upsertUser({
            id: `google_${googleUser.id}`,
            email,
            firstName,
            lastName,
            profileImageUrl: googleUser.picture || null,
        });

        // Create session
        const sessionUser = {
            claims: {
                sub: `google_${googleUser.id}`,
                email,
                first_name: firstName,
                last_name: lastName,
                name: googleUser.name,
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

            // Update last login
            try {
                await authStorage.updateUserLogin(`google_${googleUser.id}`, {
                    ipAddress: req.ip || req.socket.remoteAddress || null,
                    userAgent: req.headers["user-agent"] || null,
                });

                await storage.createAuditLog({
                    userId: `google_${googleUser.id}`,
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

            console.log("[Google Auth] Login successful for:", email);
            res.redirect(stateData.returnUrl || "/?auth=success");
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
    res.json({ configured: isGoogleConfigured() });
});

export default router;
