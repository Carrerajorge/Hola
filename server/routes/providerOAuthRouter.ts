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

const PROVIDER_LOGOS: Record<string, string> = {
  openai: `<svg width="48" height="48" viewBox="0 0 24 24" fill="none"><path d="M22.28 9.37a5.99 5.99 0 0 0-.52-4.93 6.07 6.07 0 0 0-6.55-2.91A5.99 5.99 0 0 0 10.69.18a6.07 6.07 0 0 0-5.8 4.21 5.99 5.99 0 0 0-4.01 2.9 6.07 6.07 0 0 0 .74 7.12 5.99 5.99 0 0 0 .52 4.93 6.07 6.07 0 0 0 6.55 2.91 5.99 5.99 0 0 0 4.52 1.35 6.07 6.07 0 0 0 5.8-4.21 5.99 5.99 0 0 0 4.01-2.9 6.07 6.07 0 0 0-.74-7.12Zm-8.06 13.8a4.5 4.5 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.78.78 0 0 0 .39-.67v-6.74l2.02 1.17a.07.07 0 0 1 .04.06v5.58a4.52 4.52 0 0 1-4.49 4.48Zm-9.67-4.12a4.48 4.48 0 0 1-.54-3.03l.14.08 4.78 2.76a.77.77 0 0 0 .78 0l5.83-3.37v2.33a.07.07 0 0 1-.03.06l-4.83 2.79a4.52 4.52 0 0 1-6.13-1.62ZM3.24 7.83a4.49 4.49 0 0 1 2.34-1.97V11.6a.77.77 0 0 0 .39.68l5.83 3.37-2.02 1.16a.07.07 0 0 1-.07 0L4.88 14a4.52 4.52 0 0 1-1.64-6.17Zm16.6 3.87-5.84-3.37L16.02 7.17a.07.07 0 0 1 .07 0l4.83 2.79a4.51 4.51 0 0 1-.7 8.14V12.37a.78.78 0 0 0-.38-.67Zm2.01-3.04-.14-.08-4.78-2.76a.77.77 0 0 0-.78 0l-5.83 3.37V6.86a.07.07 0 0 1 .03-.06l4.83-2.79a4.52 4.52 0 0 1 6.67 4.65ZM8.02 13.15 6 11.98a.07.07 0 0 1-.04-.06V6.34a4.52 4.52 0 0 1 7.37-3.48l-.14.08-4.78 2.76a.78.78 0 0 0-.39.68v6.77Zm1.1-2.37 2.6-1.5 2.6 1.5v3l-2.6 1.5-2.6-1.5v-3Z" fill="#10a37f"/></svg>`,
  gemini: `<svg width="48" height="48" viewBox="0 0 24 24" fill="none"><defs><linearGradient id="g" x1="4" y1="3" x2="20" y2="21" gradientUnits="userSpaceOnUse"><stop stop-color="#1A73E8"/><stop offset=".45" stop-color="#8E6CF8"/><stop offset="1" stop-color="#34A853"/></linearGradient></defs><path fill="url(#g)" d="M12 2.5c.46 3.63 1.24 5.96 2.42 7.08 1.11 1.05 3.45 1.84 7.08 2.42-3.63.58-5.97 1.37-7.08 2.42-1.18 1.12-1.96 3.45-2.42 7.08-.46-3.63-1.24-5.96-2.42-7.08-1.11-1.05-3.45-1.84-7.08-2.42 3.63-.58 5.97-1.37 7.08-2.42C10.76 8.46 11.54 6.13 12 2.5Z"/></svg>`,
  google: `<svg width="48" height="48" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09A6.57 6.57 0 0 1 5.49 12c0-.72.13-1.43.35-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>`,
  antigravity: `<svg width="48" height="48" viewBox="0 0 24 24" fill="none"><path d="M12 3.25c-4.83 0-8.75 3.92-8.75 8.75S7.17 20.75 12 20.75c2.85 0 5.38-1.37 6.98-3.48" stroke="#4285F4" stroke-width="1.8" stroke-linecap="round"/><path d="M14.25 7.25c3.04 0 5.5 2.46 5.5 5.5 0 1.96-1.02 3.67-2.56 4.65" stroke="#34A853" stroke-width="1.8" stroke-linecap="round" opacity=".8"/><circle cx="12" cy="12" r="2.4" fill="#EA4335" opacity=".92"/><path d="M16.8 6.2l.95 2.05 2.05.95-2.05.95-.95 2.05-.95-2.05-2.05-.95 2.05-.95.95-2.05Z" fill="#FBBC05"/></svg>`,
  anthropic: `<svg width="48" height="48" viewBox="0 0 24 24" fill="none"><path d="M13.83 3H16.7l5.3 18h-2.87l-1.27-4.53H12.3L11 20.78h-2.87L13.83 3Zm-.55 10.96h3.8l-1.9-6.72-1.9 6.72ZM7.17 3h2.87L4.74 21H1.87L7.17 3Z" fill="#D97706"/></svg>`,
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderCallbackPage(status: "success" | "error", message: string, provider?: string): string {
  const nonce = crypto.randomBytes(16).toString("base64");
  const isSuccess = status === "success";
  const safeMessage = escapeHtml(message);
  const logo = PROVIDER_LOGOS[provider || ""] || "";
  const providerName = provider === "openai" ? "OpenAI" : provider === "gemini" ? "Gemini" : provider === "antigravity" ? "Antigravity" : provider === "anthropic" ? "Anthropic" : "";
  const title = providerName ? `${providerName} OAuth` : "OAuth";

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} ${isSuccess ? "Completado" : "Error"} | ILIAGPT</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #07131f; color: #f8fafc; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 24px; }
    .card { max-width: 440px; background: rgba(15, 23, 42, 0.92); border: 1px solid rgba(148, 163, 184, 0.22); border-radius: 20px; padding: 32px; text-align: center; box-shadow: 0 24px 80px rgba(0,0,0,.35); }
    .logo { margin-bottom: 16px; display: flex; justify-content: center; }
    h1 { font-size: 22px; margin: 0 0 12px; color: ${isSuccess ? "#22c55e" : "#ef4444"}; }
    p { color: #94a3b8; margin: 8px 0; line-height: 1.5; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 999px; border: 1px solid rgba(148,163,184,.2); background: rgba(15,23,42,.6); font-size: 13px; color: #cbd5e1; margin-bottom: 16px; }
    .status-icon { font-size: 36px; margin-bottom: 8px; }
  </style>
</head>
<body>
  <div class="card">
    ${logo ? `<div class="logo">${logo}</div>` : ""}
    ${providerName ? `<div class="badge">${providerName}</div>` : ""}
    <div class="status-icon">${isSuccess ? "✅" : "❌"}</div>
    <h1>${isSuccess ? "Conexión exitosa" : "Error de conexión"}</h1>
    <p>${safeMessage}</p>
    <p style="margin-top: 20px; font-size: 14px; color: #64748b;">Esta ventana se cerrará automáticamente.</p>
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
