/**
 * Connector OAuth Router Factory
 *
 * Creates Express routers for OAuth2 connector flows.
 * Reuses the existing oauthStates DB table for state management
 * (multi-replica safe, unlike in-memory Maps).
 */

import { Router, type Request, type Response } from "express";
import { randomBytes, randomUUID } from "crypto";
import { connectorRegistry } from "../integrations/kernel/connectorRegistry";
import { credentialVault } from "../integrations/kernel/credentialVault";
import type { OAuthConfig } from "../integrations/kernel/types";

const STATE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

/** Get the base URL for OAuth redirects */
function getBaseUrl(): string {
  if (process.env.BASE_URL) return process.env.BASE_URL;
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  return `http://localhost:${process.env.PORT || 5000}`;
}

/** Create an OAuth2 router for a specific connector */
export function createConnectorOAuthRouter(connectorId: string): Router {
  const router = Router();

  // GET /start — Initiate OAuth flow
  router.get("/start", async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id || (req as any).userId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const manifest = connectorRegistry.get(connectorId);
      if (!manifest) {
        return res.status(404).json({ error: `Connector "${connectorId}" not found` });
      }

      if (!manifest.authConfig || !("authorizationUrl" in manifest.authConfig)) {
        return res.status(400).json({ error: `Connector "${connectorId}" does not use OAuth` });
      }

      const oauthConfig = manifest.authConfig as OAuthConfig;
      const state = randomBytes(32).toString("hex");
      const redirectUri = `${getBaseUrl()}/api/connectors/oauth/${connectorId}/callback`;

      // Store state in DB (oauthStates table)
      try {
        const { db } = await import("../db");
        const { oauthStates } = await import("../../shared/schema/auth");

        await db.insert(oauthStates).values({
          state,
          returnUrl: (req.query.returnUrl as string) || "/settings",
          provider: connectorId,
          expiresAt: new Date(Date.now() + STATE_EXPIRY_MS),
          // Store userId in metadata
          metadata: JSON.stringify({ userId }),
        } as any);
      } catch {
        // Fallback: If oauthStates table doesn't exist, use session
        if ((req as any).session) {
          (req as any).session.oauthState = { state, userId, connectorId };
        }
      }

      // Build authorization URL
      const params = new URLSearchParams({
        response_type: "code",
        client_id: getClientId(connectorId),
        redirect_uri: redirectUri,
        scope: oauthConfig.scopes.join(" "),
        state,
        ...(oauthConfig.offlineAccess ? { access_type: "offline", prompt: "consent" } : {}),
        ...(oauthConfig.extraAuthParams || {}),
      });

      const authUrl = `${oauthConfig.authorizationUrl}?${params.toString()}`;
      return res.redirect(authUrl);
    } catch (err: any) {
      console.error(`[ConnectorOAuth] Error starting OAuth for ${connectorId}:`, err?.message);
      return res.status(500).json({ error: "Failed to start OAuth flow" });
    }
  });

  // GET /callback — Handle OAuth callback
  router.get("/callback", async (req: Request, res: Response) => {
    try {
      const { code, state, error: oauthError } = req.query;

      if (oauthError) {
        return res.redirect(`/settings?error=${encodeURIComponent(String(oauthError))}&connector=${connectorId}`);
      }

      if (!code || !state) {
        return res.redirect(`/settings?error=missing_params&connector=${connectorId}`);
      }

      // Validate state
      let userId: string | undefined;
      try {
        const { db } = await import("../db");
        const { oauthStates } = await import("../../shared/schema/auth");
        const { eq } = await import("drizzle-orm");

        const [stateRecord] = await db
          .select()
          .from(oauthStates)
          .where(eq(oauthStates.state, String(state)))
          .limit(1);

        if (!stateRecord || new Date() > new Date(stateRecord.expiresAt)) {
          return res.redirect(`/settings?error=invalid_state&connector=${connectorId}`);
        }

        // Extract userId from metadata
        const metadata = typeof stateRecord.metadata === "string"
          ? JSON.parse(stateRecord.metadata)
          : stateRecord.metadata;
        userId = metadata?.userId;

        // Delete used state
        await db.delete(oauthStates).where(eq(oauthStates.state, String(state)));
      } catch {
        // Fallback: check session
        const sessionState = (req as any).session?.oauthState;
        if (sessionState?.state === String(state)) {
          userId = sessionState.userId;
          delete (req as any).session.oauthState;
        }
      }

      if (!userId) {
        userId = (req as any).user?.id || (req as any).userId;
      }
      if (!userId) {
        return res.redirect(`/settings?error=auth_required&connector=${connectorId}`);
      }

      const manifest = connectorRegistry.get(connectorId);
      if (!manifest || !("tokenUrl" in (manifest.authConfig || {}))) {
        return res.redirect(`/settings?error=connector_not_found&connector=${connectorId}`);
      }

      const oauthConfig = manifest.authConfig as OAuthConfig;
      const redirectUri = `${getBaseUrl()}/api/connectors/oauth/${connectorId}/callback`;

      // Exchange code for tokens
      const tokenBody = new URLSearchParams({
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: redirectUri,
        client_id: getClientId(connectorId),
        client_secret: getClientSecret(connectorId),
      });

      const tokenResponse = await fetch(oauthConfig.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: tokenBody,
        signal: AbortSignal.timeout(15_000),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text().catch(() => "");
        console.error(`[ConnectorOAuth] Token exchange failed for ${connectorId}: ${tokenResponse.status} ${errorText}`);
        return res.redirect(`/settings?error=token_exchange_failed&connector=${connectorId}`);
      }

      const tokenData = (await tokenResponse.json()) as Record<string, unknown>;
      const accessToken = String(tokenData.access_token || "");
      const refreshToken = tokenData.refresh_token ? String(tokenData.refresh_token) : undefined;
      const expiresIn = typeof tokenData.expires_in === "number" ? tokenData.expires_in : 3600;
      const expiresAt = new Date(Date.now() + expiresIn * 1000);
      const scopes = typeof tokenData.scope === "string"
        ? tokenData.scope.split(/[\s,]+/)
        : oauthConfig.scopes;

      if (!accessToken) {
        return res.redirect(`/settings?error=no_access_token&connector=${connectorId}`);
      }

      // Store credential
      const providerId = manifest.providerId || connectorId;
      await credentialVault.store(userId, providerId, {
        accessToken,
        refreshToken,
        expiresAt,
        scopes,
      });

      // Also ensure the provider exists in integrationProviders
      try {
        const { db } = await import("../db");
        const { integrationProviders } = await import("../../shared/schema/integration");
        await db
          .insert(integrationProviders)
          .values({
            id: providerId,
            name: manifest.displayName,
            description: manifest.description,
            iconUrl: manifest.iconUrl,
            authType: manifest.authType,
            category: manifest.category,
            isActive: "true",
          })
          .onConflictDoNothing();
      } catch {
        // Provider may already exist — that's OK
      }

      return res.redirect(`/settings?connected=${connectorId}`);
    } catch (err: any) {
      console.error(`[ConnectorOAuth] Callback error for ${connectorId}:`, err?.message);
      return res.redirect(`/settings?error=callback_failed&connector=${connectorId}`);
    }
  });

  // DELETE /disconnect — Revoke credentials
  router.delete("/disconnect", async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id || (req as any).userId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const manifest = connectorRegistry.get(connectorId);
      const providerId = manifest?.providerId || connectorId;
      await credentialVault.revoke(userId, providerId);

      return res.json({ success: true, disconnected: connectorId });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "Failed to disconnect" });
    }
  });

  // GET /status — Check connection status
  router.get("/status", async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id || (req as any).userId;
      if (!userId) {
        return res.status(401).json({ connected: false });
      }

      const manifest = connectorRegistry.get(connectorId);
      const providerId = manifest?.providerId || connectorId;
      const credential = await credentialVault.resolve(userId, providerId);

      return res.json({
        connected: credential !== null,
        connectorId,
        providerId,
        scopes: credential?.scopes || [],
        expiresAt: credential?.expiresAt?.toISOString() || null,
      });
    } catch {
      return res.json({ connected: false, connectorId });
    }
  });

  return router;
}

// ─── Env var helpers ────────────────────────────────────────────────

function getClientId(connectorId: string): string {
  const prefix = connectorId.toUpperCase().replace(/-/g, "_");
  // Try connector-specific first, then provider-level
  return (
    process.env[`${prefix}_CLIENT_ID`] ||
    process.env.GOOGLE_CLIENT_ID || // fallback for Google family
    ""
  );
}

function getClientSecret(connectorId: string): string {
  const prefix = connectorId.toUpperCase().replace(/-/g, "_");
  return (
    process.env[`${prefix}_CLIENT_SECRET`] ||
    process.env.GOOGLE_CLIENT_SECRET ||
    ""
  );
}
