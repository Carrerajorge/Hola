/**
 * Gemini CLI OAuth Router
 *
 * Provides a web-based OAuth flow for Google Gemini / Antigravity authentication.
 * Uses PKCE (Proof Key for Code Exchange) for secure authorization.
 *
 * This router serves dual purposes:
 * 1. Login: Users can authenticate via their Google account (Gemini-branded flow)
 * 2. Token storage: The resulting tokens are stored per-session for Gemini API calls
 *
 * WARNING: This is an unofficial OAuth flow using Gemini CLI credentials.
 * Review Google's Terms of Service and account-risk warnings before use.
 */
import { Router, Request, Response } from "express";
import crypto from "crypto";
import { authStorage } from "../replit_integrations/auth/storage";
import { tokenManager } from "../lib/auth/tokenManager";
import { Logger } from "../lib/logger";

const router = Router();

// OAuth Configuration
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "openid",
];

// In-memory store for OAuth state (production should use Redis)
const oauthStateStore = new Map<
  string,
  {
    verifier: string;
    challenge: string;
    createdAt: number;
    clientId: string;
    clientSecret?: string;
    isLoginFlow: boolean;
  }
>();

// In-memory store for OAuth tokens per user session
const geminiOAuthTokenStore = new Map<
  string,
  {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    email?: string;
    projectId?: string;
  }
>();

// Cleanup expired states every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [state, data] of oauthStateStore.entries()) {
    if (now - data.createdAt > 10 * 60 * 1000) {
      oauthStateStore.delete(state);
    }
  }
}, 5 * 60 * 1000);

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString("hex");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function getCanonicalRedirectUri(req: Request): string {
  const CANONICAL_DOMAIN = process.env.CANONICAL_DOMAIN || "iliagpt.com";
  if (process.env.NODE_ENV === "production") {
    return `https://${CANONICAL_DOMAIN}/api/gemini-cli-oauth/callback`;
  }
  return `${req.protocol}://${req.get("host")}/api/gemini-cli-oauth/callback`;
}

/**
 * GET /api/gemini-cli-oauth/status
 * Returns whether Gemini CLI OAuth is available and current connection status
 */
router.get("/status", (req: Request, res: Response) => {
  const sessionId = req.sessionID || "anonymous";
  const tokenData = geminiOAuthTokenStore.get(sessionId);
  const isConnected = tokenData && tokenData.expiresAt > Date.now();

  const clientId =
    process.env.GEMINI_CLI_OAUTH_CLIENT_ID ||
    process.env.GOOGLE_CLIENT_ID;

  res.json({
    available: !!clientId,
    connected: !!isConnected,
    email: isConnected ? tokenData?.email : null,
    expiresAt: isConnected ? tokenData?.expiresAt : null,
  });
});

/**
 * POST /api/gemini-cli-oauth/initiate
 * Starts the Gemini CLI OAuth flow, returns the authorization URL.
 * When called from the login page, sets isLoginFlow=true so the callback
 * will create a proper user session.
 */
router.post("/initiate", (req: Request, res: Response) => {
  const clientId =
    process.env.GEMINI_CLI_OAUTH_CLIENT_ID ||
    process.env.GOOGLE_CLIENT_ID;
  const clientSecret =
    process.env.GEMINI_CLI_OAUTH_CLIENT_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId) {
    return res.status(503).json({
      error: "Gemini CLI OAuth no está configurado. Se requiere GEMINI_CLI_OAUTH_CLIENT_ID o GOOGLE_CLIENT_ID.",
    });
  }

  const state = crypto.randomBytes(32).toString("hex");
  const { verifier, challenge } = generatePkce();
  const redirectUri = getCanonicalRedirectUri(req);

  // Determine if this is a login flow (user not yet authenticated)
  const isAuthenticated = !!(req as any).user || !!(req as any).session?.passport?.user;
  const isLoginFlow = req.body?.loginFlow === true || !isAuthenticated;

  oauthStateStore.set(state, {
    verifier,
    challenge,
    createdAt: Date.now(),
    clientId,
    clientSecret,
    isLoginFlow,
  });

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPES.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    access_type: "offline",
    prompt: "consent select_account",
  });

  const authUrl = `${AUTH_URL}?${params.toString()}`;

  Logger.info("[Gemini OAuth] Initiated OAuth flow", {
    redirectUri,
    isLoginFlow,
  });

  res.json({ authUrl, state });
});

/**
 * GET /api/gemini-cli-oauth/callback
 * Handles the OAuth callback from Google.
 * If the flow was initiated as a login, creates a proper user session.
 */
router.get("/callback", async (req: Request, res: Response) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    Logger.error("[Gemini OAuth] OAuth error", { error, error_description });
    return res.redirect(
      `/login?error=${encodeURIComponent(String(error_description || "gemini_failed"))}`
    );
  }

  if (!code || !state) {
    Logger.error("[Gemini OAuth] Missing code or state");
    return res.redirect("/login?error=gemini_failed");
  }

  const stateData = oauthStateStore.get(state as string);
  if (!stateData) {
    Logger.error("[Gemini OAuth] Invalid or expired state");
    return res.redirect("/login?error=gemini_failed");
  }
  oauthStateStore.delete(state as string);

  try {
    const redirectUri = getCanonicalRedirectUri(req);

    // Exchange code for tokens
    const tokenBody = new URLSearchParams({
      client_id: stateData.clientId,
      code: code as string,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code_verifier: stateData.verifier,
    });
    if (stateData.clientSecret) {
      tokenBody.set("client_secret", stateData.clientSecret);
    }

    const tokenResponse = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        Accept: "*/*",
      },
      body: tokenBody,
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      Logger.error("[Gemini OAuth] Token exchange failed", { errorText });
      return res.redirect("/login?error=gemini_failed");
    }

    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      id_token?: string;
    };

    // Get user info from Google
    let email: string | undefined;
    let fullName: string | undefined;
    let profilePicture: string | undefined;
    let googleId: string | undefined;

    try {
      const userResponse = await fetch(USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (userResponse.ok) {
        const userData = (await userResponse.json()) as {
          id?: string;
          email?: string;
          name?: string;
          given_name?: string;
          family_name?: string;
          picture?: string;
          verified_email?: boolean;
        };
        email = userData.email;
        fullName = userData.name;
        profilePicture = userData.picture;
        googleId = userData.id;
      }
    } catch (e) {
      Logger.warn("[Gemini OAuth] Failed to get user info", { error: e });
    }

    if (!email) {
      Logger.error("[Gemini OAuth] No email received from Google");
      return res.redirect("/login?error=gemini_failed");
    }

    // Store tokens in memory for Gemini API access
    const sessionId = req.sessionID || "anonymous";
    const expiresAt = Date.now() + tokens.expires_in * 1000 - 5 * 60 * 1000;

    geminiOAuthTokenStore.set(sessionId, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || "",
      expiresAt,
      email,
    });

    // --- LOGIN FLOW: Create a proper user session ---
    if (stateData.isLoginFlow) {
      try {
        // Upsert user in the database (same pattern as Google Passport strategy)
        const userId = googleId ? `gemini_${googleId}` : `gemini_${email.replace(/[^a-zA-Z0-9]/g, "_")}`;

        // Check if user already exists by email (may have signed in via Google before)
        let user = await authStorage.getUserByEmail(email);
        const userData = {
          id: user?.id || userId,
          email,
          username: email.split("@")[0],
          fullName: fullName || email.split("@")[0],
          profileImageUrl: profilePicture,
          authProvider: "gemini",
          emailVerified: "true",
        };

        user = await authStorage.upsertUser(userData);

        // Persist tokens for this user (best-effort).
        // Use "google" provider since Gemini OAuth goes through Google's endpoints.
        try {
          await tokenManager.saveTokens(user.id, "google", {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token || "",
            expiry_date: Date.now() + tokens.expires_in * 1000,
            scope: SCOPES.join(" "),
          });
        } catch (tokenError) {
          Logger.warn("[Gemini OAuth] Token persistence failed", {
            userId: user.id,
            error: (tokenError as any)?.message || tokenError,
          });
        }

        // Create audit log for new registration
        try {
          const { storage } = await import("../storage");
          await storage.createAuditLog({
            action: "user_login",
            resource: "users",
            resourceId: user.id,
            details: {
              email,
              provider: "gemini",
              fullName,
              timestamp: new Date().toISOString(),
            },
          });
        } catch (auditError) {
          Logger.warn("[Gemini OAuth] Audit log failed", { error: auditError });
        }

        // Establish session via Passport's logIn
        const hydratedUser = {
          ...user,
          claims: {
            sub: user.id,
            email: user.email,
            name: user.fullName || user.username,
            picture: user.profileImageUrl,
          },
        };

        return (req as any).logIn(hydratedUser, (loginErr: any) => {
          if (loginErr) {
            Logger.error("[Gemini OAuth] Session login error", { error: loginErr });
            return res.redirect("/login?error=gemini_failed");
          }

          // Persist userId explicitly for robust auth across deployments
          const session = (req as any).session as any | undefined;
          if (session) {
            session.authUserId = String(user!.id);
            session.passport = session.passport || {};
            if (typeof session.passport.user !== "string") {
              session.passport.user = String(user!.id);
            }
          }

          const sess = (req as any).session;
          if (sess?.save) {
            sess.save((saveErr: any) => {
              if (saveErr) {
                Logger.error("[Gemini OAuth] Session save error", { error: saveErr });
                return res.redirect("/login?error=session_error");
              }
              Logger.info("[Gemini OAuth] Login successful", { email, userId: user!.id });
              res.redirect("/?auth=success&provider=gemini");
            });
            return;
          }

          Logger.info("[Gemini OAuth] Login successful (no session save)", { email });
          res.redirect("/?auth=success&provider=gemini");
        });
      } catch (loginError: any) {
        Logger.error("[Gemini OAuth] Login flow error", { error: loginError?.message || loginError });
        return res.redirect("/login?error=gemini_failed");
      }
    }

    // --- Non-login flow: just store tokens and redirect back ---
    Logger.info("[Gemini OAuth] Token-only auth successful", { email });
    return res.redirect(`/?gemini_oauth_success=true&gemini_email=${encodeURIComponent(email || "")}`);
  } catch (err: any) {
    Logger.error("[Gemini OAuth] Callback error", { error: err?.message || err });
    return res.redirect("/login?error=gemini_failed");
  }
});

/**
 * POST /api/gemini-cli-oauth/refresh
 * Refreshes the OAuth access token
 */
router.post("/refresh", async (req: Request, res: Response) => {
  const sessionId = req.sessionID || "anonymous";
  const tokenData = geminiOAuthTokenStore.get(sessionId);

  if (!tokenData?.refreshToken) {
    return res.status(401).json({ error: "No Gemini OAuth token found. Please re-authenticate." });
  }

  const clientId =
    process.env.GEMINI_CLI_OAUTH_CLIENT_ID ||
    process.env.GOOGLE_CLIENT_ID;
  const clientSecret =
    process.env.GEMINI_CLI_OAUTH_CLIENT_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId) {
    return res.status(503).json({ error: "OAuth client not configured" });
  }

  try {
    const body = new URLSearchParams({
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: tokenData.refreshToken,
    });
    if (clientSecret) {
      body.set("client_secret", clientSecret);
    }

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      Logger.error("[Gemini OAuth] Token refresh failed", { errorText });
      geminiOAuthTokenStore.delete(sessionId);
      return res.status(401).json({ error: "Token refresh failed. Please re-authenticate." });
    }

    const newTokens = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    tokenData.accessToken = newTokens.access_token;
    tokenData.expiresAt = Date.now() + newTokens.expires_in * 1000 - 5 * 60 * 1000;
    geminiOAuthTokenStore.set(sessionId, tokenData);

    res.json({
      success: true,
      expiresAt: tokenData.expiresAt,
      email: tokenData.email,
    });
  } catch (err: any) {
    Logger.error("[Gemini OAuth] Refresh error", { error: err?.message || err });
    res.status(500).json({ error: "Token refresh failed" });
  }
});

/**
 * POST /api/gemini-cli-oauth/disconnect
 * Disconnects the Gemini CLI OAuth session
 */
router.post("/disconnect", (req: Request, res: Response) => {
  const sessionId = req.sessionID || "anonymous";
  geminiOAuthTokenStore.delete(sessionId);
  Logger.info("[Gemini OAuth] Disconnected session", { sessionId });
  res.json({ success: true });
});

/**
 * Get the stored OAuth access token for a session.
 * Used by the Gemini client to authenticate API calls.
 */
export function getGeminiOAuthToken(sessionId: string): string | null {
  const tokenData = geminiOAuthTokenStore.get(sessionId);
  if (!tokenData) return null;
  if (tokenData.expiresAt <= Date.now()) return null;
  return tokenData.accessToken;
}

/**
 * Check if a session has a valid Gemini OAuth token
 */
export function hasGeminiOAuthToken(sessionId: string): boolean {
  return getGeminiOAuthToken(sessionId) !== null;
}

export default router;
