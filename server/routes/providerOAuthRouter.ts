/**
 * providerOAuthRouter — Multi-provider OAuth routes.
 *
 * OpenAI: PKCE OAuth flow
 * Gemini: Google OAuth2 flow
 * Anthropic: Manual API key submission
 *
 * Query param `?scope=global` stores token as global (admin only).
 */

import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { getUserId } from "../types/express";
import { providersService } from "../services/providersService";
import type { OAuthProvider } from "../services/providerAdapters";
import {
  getOpenAIWebOAuthAvailability,
  isGoogleGeminiDirectOAuthAvailable,
} from "../services/providerOAuthAvailability";

const router = Router();

// ─── In-memory PKCE store (short-lived) ──────────────────────────────────────

interface PkceFlowRecord {
  userId: string;
  codeVerifier: string;
  oauthState: string;
  provider: OAuthProvider;
  isGlobal: boolean;
  createdAt: number;
}

const pkceFlowStore = new Map<string, PkceFlowRecord>();
const FLOW_TTL_MS = 30 * 60 * 1000;

// Clean expired flows periodically
setInterval(() => {
  const now = Date.now();
  for (const [state, flow] of pkceFlowStore) {
    if (now - flow.createdAt > FLOW_TTL_MS) {
      pkceFlowStore.delete(state);
    }
  }
}, 5 * 60 * 1000);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function getCallbackUrl(req: Request, provider: string): string {
  const canonicalDomain = process.env.CANONICAL_DOMAIN || "iliagpt.com";
  if (process.env.NODE_ENV === "production") {
    return `https://${canonicalDomain}/api/oauth/providers/${provider}/callback`;
  }
  return `${req.protocol}://${req.get("host")}/api/oauth/providers/${provider}/callback`;
}

function isGlobalScope(req: Request): boolean {
  return req.query.scope === "global";
}

// ─── OpenAI OAuth (PKCE) ─────────────────────────────────────────────────────

const OPENAI_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";

router.post("/openai/start", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const isGlobal = isGlobalScope(req);
    if (isGlobal) {
      // Verify admin role
      const user = (req as any).user;
      if (!user || user.role !== "ADMIN") {
        return res.status(403).json({ error: "Admin role required for global tokens" });
      }
    }

    const openAIWebOAuth = getOpenAIWebOAuthAvailability();
    if (!openAIWebOAuth.available || !openAIWebOAuth.clientId) {
      return res.status(400).json({
        error:
          openAIWebOAuth.reason ||
          "OpenAI OAuth directo no está disponible en este despliegue.",
      });
    }

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const oauthState = crypto.randomBytes(16).toString("hex");
    const redirectUri = getCallbackUrl(req, "openai");

    pkceFlowStore.set(oauthState, {
      userId,
      codeVerifier,
      oauthState,
      provider: "openai",
      isGlobal,
      createdAt: Date.now(),
    });

    const params = new URLSearchParams({
      client_id: openAIWebOAuth.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openai.model.read openai.chat.completions.create",
      state: oauthState,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    const authUrl = `${OPENAI_AUTHORIZE_URL}?${params.toString()}`;

    res.json({ authUrl, state: oauthState });
  } catch (error: any) {
    console.error("[ProviderOAuth] OpenAI start error:", error);
    res.status(500).json({ error: "Failed to start OAuth flow" });
  }
});

router.get("/openai/callback", async (req: Request, res: Response) => {
  try {
    const { code, state, error: oauthError } = req.query;

    if (oauthError || !code || !state) {
      return res.status(400).send(renderCallbackPage("error", oauthError as string || "Missing parameters", "openai"));
    }

    const flow = pkceFlowStore.get(state as string);
    if (!flow) {
      return res.status(400).send(renderCallbackPage("error", "Invalid or expired state", "openai"));
    }

    const openAIWebOAuth = getOpenAIWebOAuthAvailability();
    if (!openAIWebOAuth.available || !openAIWebOAuth.clientId) {
      pkceFlowStore.delete(state as string);
      return res
        .status(400)
        .send(
          renderCallbackPage(
            "error",
            openAIWebOAuth.reason ||
              "OpenAI OAuth directo no está disponible en este despliegue.",
            "openai",
          ),
        );
    }

    pkceFlowStore.delete(state as string);

    const redirectUri = getCallbackUrl(req, "openai");

    // Exchange code for tokens
    const tokenResponse = await fetch(OPENAI_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code as string,
        redirect_uri: redirectUri,
        client_id: openAIWebOAuth.clientId,
        code_verifier: flow.codeVerifier,
      }),
    });

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text();
      console.error("[ProviderOAuth] OpenAI token exchange failed:", errorBody);
      return res.status(400).send(renderCallbackPage("error", "Token exchange failed", "openai"));
    }

    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      token_type: string;
    };

    const expiresAt = tokens.expires_in
      ? Date.now() + tokens.expires_in * 1000
      : null;

    if (flow.isGlobal) {
      await providersService.saveGlobalToken(
        "openai",
        tokens.access_token,
        tokens.refresh_token || null,
        expiresAt,
        "openai.model.read openai.chat.completions.create",
        "OpenAI Global",
        flow.userId,
      );
    } else {
      await providersService.saveUserToken(
        flow.userId,
        "openai",
        tokens.access_token,
        tokens.refresh_token || null,
        expiresAt,
        "openai.model.read openai.chat.completions.create",
      );
    }

    res.send(renderCallbackPage("success", "OpenAI conectado exitosamente", "openai"));
  } catch (error: any) {
    console.error("[ProviderOAuth] OpenAI callback error:", error);
    res.status(500).send(renderCallbackPage("error", error.message, "openai"));
  }
});

router.get("/openai/status", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const globalStatus = await providersService.getGlobalTokenStatus("openai");
    const userStatus = userId
      ? await providersService.getUserTokenStatus(userId, "openai")
      : { connected: false };
    const openAIWebOAuth = getOpenAIWebOAuthAvailability();

    res.json({
      provider: "openai",
      globalConnected: globalStatus.connected,
      globalLabel: globalStatus.label,
      userConnected: userStatus.connected,
      connected: userStatus.connected || globalStatus.connected,
      available: openAIWebOAuth.available,
      availabilityReason: openAIWebOAuth.reason,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/openai/disconnect", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const isGlobal = isGlobalScope(req);
    if (isGlobal) {
      await providersService.deleteGlobalToken("openai");
    } else {
      await providersService.deleteUserToken(userId, "openai");
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Gemini OAuth (Google OAuth2) ────────────────────────────────────────────

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GEMINI_SCOPE = "https://www.googleapis.com/auth/generative-language";

router.post("/gemini/start", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return res.status(500).json({ error: "Google OAuth not configured" });
    }

    const isGlobal = isGlobalScope(req);
    if (isGlobal) {
      const user = (req as any).user;
      if (!user || user.role !== "ADMIN") {
        return res.status(403).json({ error: "Admin role required for global tokens" });
      }
    }

    const oauthState = crypto.randomBytes(16).toString("hex");
    const codeVerifier = generateCodeVerifier();
    const redirectUri = getCallbackUrl(req, "gemini");

    pkceFlowStore.set(oauthState, {
      userId,
      codeVerifier,
      oauthState,
      provider: "gemini",
      isGlobal,
      createdAt: Date.now(),
    });

    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GEMINI_SCOPE,
      state: oauthState,
      access_type: "offline",
      prompt: "consent",
    });

    const authUrl = `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;

    res.json({ authUrl, state: oauthState });
  } catch (error: any) {
    console.error("[ProviderOAuth] Gemini start error:", error);
    res.status(500).json({ error: "Failed to start OAuth flow" });
  }
});

router.get("/gemini/callback", async (req: Request, res: Response) => {
  try {
    const { code, state, error: oauthError } = req.query;

    if (oauthError || !code || !state) {
      return res.status(400).send(renderCallbackPage("error", oauthError as string || "Missing parameters", "gemini"));
    }

    const flow = pkceFlowStore.get(state as string);
    if (!flow || flow.provider !== "gemini") {
      return res.status(400).send(renderCallbackPage("error", "Invalid or expired state", "gemini"));
    }

    pkceFlowStore.delete(state as string);

    const redirectUri = getCallbackUrl(req, "gemini");

    // Exchange code for tokens
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code as string,
        redirect_uri: redirectUri,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
      }),
    });

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text();
      console.error("[ProviderOAuth] Gemini token exchange failed:", errorBody);
      return res.status(400).send(renderCallbackPage("error", "Token exchange failed", "gemini"));
    }

    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    const expiresAt = tokens.expires_in
      ? Date.now() + tokens.expires_in * 1000
      : null;

    if (flow.isGlobal) {
      await providersService.saveGlobalToken(
        "gemini",
        tokens.access_token,
        tokens.refresh_token || null,
        expiresAt,
        GEMINI_SCOPE,
        "Gemini Global",
        flow.userId,
      );
    } else {
      await providersService.saveUserToken(
        flow.userId,
        "gemini",
        tokens.access_token,
        tokens.refresh_token || null,
        expiresAt,
        GEMINI_SCOPE,
      );
    }

    res.send(renderCallbackPage("success", "Google Gemini conectado exitosamente", "gemini"));
  } catch (error: any) {
    console.error("[ProviderOAuth] Gemini callback error:", error);
    res.status(500).send(renderCallbackPage("error", error.message, "gemini"));
  }
});

router.get("/gemini/status", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const globalStatus = await providersService.getGlobalTokenStatus("gemini");
    const userStatus = userId
      ? await providersService.getUserTokenStatus(userId, "gemini")
      : { connected: false };

    res.json({
      provider: "gemini",
      globalConnected: globalStatus.connected,
      globalLabel: globalStatus.label,
      userConnected: userStatus.connected,
      connected: userStatus.connected || globalStatus.connected,
      available: isGoogleGeminiDirectOAuthAvailable(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/gemini/disconnect", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const isGlobal = isGlobalScope(req);
    if (isGlobal) {
      await providersService.deleteGlobalToken("gemini");
    } else {
      await providersService.deleteUserToken(userId, "gemini");
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Anthropic (Manual API Key) ──────────────────────────────────────────────

router.post("/anthropic/key", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { apiKey, label } = req.body;
    if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length < 10) {
      return res.status(400).json({ error: "Invalid API key" });
    }

    const isGlobal = isGlobalScope(req);
    if (isGlobal) {
      const user = (req as any).user;
      if (!user || user.role !== "ADMIN") {
        return res.status(403).json({ error: "Admin role required for global tokens" });
      }
    }

    // Validate the key by making a test call
    try {
      const testResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey.trim(),
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 10,
          messages: [{ role: "user", content: "Hi" }],
        }),
      });

      if (!testResponse.ok) {
        const errorBody = await testResponse.text();
        console.error("[ProviderOAuth] Anthropic key validation failed:", errorBody);
        return res.status(400).json({ error: "API key validation failed. Please check the key." });
      }
    } catch (err: any) {
      return res.status(400).json({ error: `API key validation failed: ${err.message}` });
    }

    if (isGlobal) {
      await providersService.saveGlobalToken(
        "anthropic",
        apiKey.trim(),
        null,
        null, // API keys don't expire
        null,
        label || "Anthropic Global",
        userId,
      );
    } else {
      await providersService.saveUserToken(
        userId,
        "anthropic",
        apiKey.trim(),
        null,
        null,
        null,
      );
    }

    res.json({ success: true, provider: "anthropic" });
  } catch (error: any) {
    console.error("[ProviderOAuth] Anthropic key error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/anthropic/status", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const globalStatus = await providersService.getGlobalTokenStatus("anthropic");
    const userStatus = userId
      ? await providersService.getUserTokenStatus(userId, "anthropic")
      : { connected: false };

    res.json({
      provider: "anthropic",
      globalConnected: globalStatus.connected,
      globalLabel: globalStatus.label,
      userConnected: userStatus.connected,
      connected: userStatus.connected || globalStatus.connected,
      available: true,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/anthropic/disconnect", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const isGlobal = isGlobalScope(req);
    if (isGlobal) {
      await providersService.deleteGlobalToken("anthropic");
    } else {
      await providersService.deleteUserToken(userId, "anthropic");
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Combined Status ─────────────────────────────────────────────────────────

router.get("/status", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const providers: OAuthProvider[] = ["openai", "gemini", "anthropic"];
    const statuses: Record<string, any> = {};

    for (const provider of providers) {
      const globalStatus = await providersService.getGlobalTokenStatus(provider);
      const userStatus = userId
        ? await providersService.getUserTokenStatus(userId, provider)
        : { connected: false };
      const openAIWebOAuth =
        provider === "openai" ? getOpenAIWebOAuthAvailability() : null;

      statuses[provider] = {
        globalConnected: globalStatus.connected,
        globalLabel: globalStatus.label,
        userConnected: userStatus.connected,
        connected: userStatus.connected || globalStatus.connected,
        available:
          provider === "openai"
            ? openAIWebOAuth?.available ?? false
            : provider === "gemini"
              ? isGoogleGeminiDirectOAuthAvailable()
              : true,
        availabilityReason:
          provider === "openai" ? openAIWebOAuth?.reason ?? null : null,
      };
    }

    res.json({ providers: statuses });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Callback Page Renderer ──────────────────────────────────────────────────

function renderCallbackPage(status: "success" | "error", message: string, provider?: string): string {
  const nonce = crypto.randomBytes(16).toString("base64");
  const isSuccess = status === "success";

  const providerLogos: Record<string, string> = {
    openai: `<svg width="48" height="48" viewBox="0 0 24 24" fill="none"><path d="M22.28 9.37a5.99 5.99 0 0 0-.52-4.93 6.07 6.07 0 0 0-6.55-2.91A5.99 5.99 0 0 0 10.69.18a6.07 6.07 0 0 0-5.8 4.21 5.99 5.99 0 0 0-4.01 2.9 6.07 6.07 0 0 0 .74 7.12 5.99 5.99 0 0 0 .52 4.93 6.07 6.07 0 0 0 6.55 2.91 5.99 5.99 0 0 0 4.52 1.35 6.07 6.07 0 0 0 5.8-4.21 5.99 5.99 0 0 0 4.01-2.9 6.07 6.07 0 0 0-.74-7.12Z" fill="#10a37f"/></svg>`,
    gemini: `<svg width="48" height="48" viewBox="0 0 24 24" fill="none"><defs><linearGradient id="g" x1="4" y1="3" x2="20" y2="21" gradientUnits="userSpaceOnUse"><stop stop-color="#1A73E8"/><stop offset=".45" stop-color="#8E6CF8"/><stop offset="1" stop-color="#34A853"/></linearGradient></defs><path fill="url(#g)" d="M12 2.5c.46 3.63 1.24 5.96 2.42 7.08 1.11 1.05 3.45 1.84 7.08 2.42-3.63.58-5.97 1.37-7.08 2.42-1.18 1.12-1.96 3.45-2.42 7.08-.46-3.63-1.24-5.96-2.42-7.08-1.11-1.05-3.45-1.84-7.08-2.42 3.63-.58 5.97-1.37 7.08-2.42C10.76 8.46 11.54 6.13 12 2.5Z"/></svg>`,
    anthropic: `<svg width="48" height="48" viewBox="0 0 24 24" fill="none"><path d="M16.98 5.47L12 2 7.02 5.47 2 8.53v6.94l5.02 3.06L12 22l4.98-3.47L22 15.47V8.53l-5.02-3.06zM12 16.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5z" fill="#D97757" opacity="0.9"/></svg>`,
  };
  const logo = provider && providerLogos[provider] ? providerLogos[provider] : "";
  const providerNames: Record<string, string> = { openai: "ChatGPT", gemini: "Google Gemini", anthropic: "Claude" };
  const providerName = provider && providerNames[provider] ? providerNames[provider] : "Proveedor";

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${providerName} - OAuth ${isSuccess ? "Completado" : "Error"}</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #07131f; color: #f8fafc; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 24px; }
    .card { max-width: 440px; background: rgba(15, 23, 42, 0.92); border: 1px solid rgba(148, 163, 184, 0.22); border-radius: 20px; padding: 32px; text-align: center; }
    h1 { font-size: 22px; margin: 0 0 12px; color: ${isSuccess ? "#22c55e" : "#ef4444"}; }
    p { color: #94a3b8; margin: 8px 0; }
    .logo { margin-bottom: 16px; display: flex; justify-content: center; }
    .status-ring { width: 80px; height: 80px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 2px solid ${isSuccess ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}; background: ${isSuccess ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)"}; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo"><div class="status-ring">${logo || (isSuccess ? '<svg width="36" height="36" viewBox="0 0 24 24" fill="none"><path d="M9 12l2 2 4-4" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="10" stroke="#22c55e" stroke-width="1.5" opacity="0.4"/></svg>' : '<svg width="36" height="36" viewBox="0 0 24 24" fill="none"><path d="M15 9l-6 6M9 9l6 6" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round"/><circle cx="12" cy="12" r="10" stroke="#ef4444" stroke-width="1.5" opacity="0.4"/></svg>')}</div></div>
    <h1>${isSuccess ? `${providerName} conectado` : "Error de conexion"}</h1>
    <p>${message}</p>
    <p style="margin-top: 20px; font-size: 13px; color: #64748b;">Esta ventana se cerrara automaticamente.</p>
  </div>
  <script nonce="${nonce}">
    try {
      window.opener && window.opener.postMessage({
        type: "provider-oauth-result",
        status: "${status}",
        provider: ${JSON.stringify(provider || "")},
        message: ${JSON.stringify(message)}
      }, window.location.origin);
      setTimeout(() => window.close(), 2000);
    } catch(e) {}
  </script>
</body>
</html>`;
}

export default router;
