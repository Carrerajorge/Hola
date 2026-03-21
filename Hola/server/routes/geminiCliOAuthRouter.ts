/**
 * Gemini CLI OAuth Router
 *
 * Provides a web-based OAuth flow for Google Gemini CLI authentication.
 * Uses PKCE (Proof Key for Code Exchange) for secure authorization.
 *
 * WARNING: This is an unofficial OAuth flow using Gemini CLI credentials.
 * Review Google's Terms of Service and account-risk warnings before use.
 */
import { Router, Request, Response } from "express";
import crypto from "crypto";

const router = Router();

// OAuth Configuration
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v1/userinfo?alt=json";
const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
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
 * Starts the Gemini CLI OAuth flow, returns the authorization URL
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

  oauthStateStore.set(state, {
    verifier,
    challenge,
    createdAt: Date.now(),
    clientId,
    clientSecret,
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
    prompt: "consent",
  });

  const authUrl = `${AUTH_URL}?${params.toString()}`;

  console.log("[Gemini CLI OAuth] Initiated OAuth flow, redirect_uri:", redirectUri);

  res.json({ authUrl, state });
});

/**
 * GET /api/gemini-cli-oauth/callback
 * Handles the OAuth callback from Google
 */
router.get("/callback", async (req: Request, res: Response) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    console.error("[Gemini CLI OAuth] OAuth error:", error, error_description);
    return res.redirect(
      `/?gemini_oauth_error=${encodeURIComponent(String(error_description || error))}`
    );
  }

  if (!code || !state) {
    console.error("[Gemini CLI OAuth] Missing code or state");
    return res.redirect("/?gemini_oauth_error=missing_parameters");
  }

  const stateData = oauthStateStore.get(state as string);
  if (!stateData) {
    console.error("[Gemini CLI OAuth] Invalid or expired state");
    return res.redirect("/?gemini_oauth_error=invalid_state");
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
      console.error("[Gemini CLI OAuth] Token exchange failed:", errorText);
      return res.redirect("/?gemini_oauth_error=token_exchange_failed");
    }

    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    if (!tokens.refresh_token) {
      console.error("[Gemini CLI OAuth] No refresh token received");
      return res.redirect("/?gemini_oauth_error=no_refresh_token");
    }

    // Get user info
    let email: string | undefined;
    try {
      const userResponse = await fetch(USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (userResponse.ok) {
        const userData = (await userResponse.json()) as { email?: string };
        email = userData.email;
      }
    } catch (e) {
      console.warn("[Gemini CLI OAuth] Failed to get user email:", e);
    }

    // Store tokens
    const sessionId = req.sessionID || "anonymous";
    const expiresAt = Date.now() + tokens.expires_in * 1000 - 5 * 60 * 1000;

    geminiOAuthTokenStore.set(sessionId, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
      email,
    });

    console.log("[Gemini CLI OAuth] Successfully authenticated:", email || "unknown");

    return res.redirect(`/?gemini_oauth_success=true&gemini_email=${encodeURIComponent(email || "")}`);
  } catch (err: any) {
    console.error("[Gemini CLI OAuth] Callback error:", err);
    return res.redirect("/?gemini_oauth_error=callback_failed");
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
      console.error("[Gemini CLI OAuth] Token refresh failed:", errorText);
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
    console.error("[Gemini CLI OAuth] Refresh error:", err);
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
  console.log("[Gemini CLI OAuth] Disconnected session:", sessionId);
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
