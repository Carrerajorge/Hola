import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { getUserId } from "../types/express";
import { storage } from "../storage";
import { invalidateIntegrationPolicyCache } from "../services/integrationPolicyCache";

const appIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/i, "Invalid app id");

// Map integration provider IDs used by backend OAuth flows to the app IDs used in the UI.
const PROVIDER_TO_APP_ID: Record<string, string> = {
  google_calendar: "google-calendar",
  outlook: "outlook-mail",
  outlook_calendar: "outlook-calendar",
  google_drive: "google-drive",
  // Integration Kernel connectors can store Google-family tokens under the provider-level id "google".
  google: "google-drive",
  google_forms: "google-forms",
};

const APP_ID_TO_PROVIDER: Record<string, string> = Object.fromEntries(
  Object.entries(PROVIDER_TO_APP_ID).map(([providerId, appId]) => [appId, providerId])
);

function resolveProviderId(appId: string): string {
  return APP_ID_TO_PROVIDER[appId] || appId;
}

function resolveAppIdFromProvider(providerId: string): string {
  return PROVIDER_TO_APP_ID[providerId] || providerId;
}

async function ensureProvider(providerId: string): Promise<void> {
  const existing = await storage.getIntegrationProvider(providerId);
  if (existing) return;

  await storage.createIntegrationProvider({
    id: providerId,
    name: providerId,
    description: `Integration for ${providerId}`,
    authType: "custom",
    category: "general",
    isActive: "true",
  } as any);
}

export function createAppsIntegrationRouter(): Router {
  const router = Router();

  // Batch: used by AppsView to avoid N requests on open.
  router.get("/status", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      return res.json({ statuses: {} });
    }

    try {
      const [accounts, gmailToken] = await Promise.all([
        storage.getIntegrationAccounts(userId),
        storage.getGmailOAuthToken(userId).catch(() => null),
      ]);

      const statuses: Record<string, { connected: boolean; email?: string; displayName?: string }> = {};

      for (const account of accounts) {
        if (!account || account.status !== "active") continue;
        const appId = resolveAppIdFromProvider(String(account.providerId));
        statuses[appId] = {
          connected: true,
          email: account.email || undefined,
          displayName: account.displayName || undefined,
        };
      }

      if (gmailToken) {
        statuses.gmail = {
          connected: true,
          email: gmailToken.accountEmail || undefined,
        };
      }

      // Figma integration is currently global (not per-user). Expose best-effort status.
      try {
        const { figmaService } = await import("../services/figmaService");
        const token = figmaService.getAccessToken();
        if (token) {
          statuses.figma = { connected: true };
        }
      } catch {
        // ignore
      }

      return res.json({ statuses });
    } catch (err: any) {
      console.error("[AppsIntegrationRouter] GET /status error:", err?.message || err);
      return res.status(500).json({ error: "Failed to load app statuses" });
    }
  });

  router.get("/:appId/status", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      return res.json({ connected: false });
    }

    const parsed = appIdSchema.safeParse(req.params.appId);
    if (!parsed.success) {
      return res.status(400).json({ connected: false, error: "Invalid app id" });
    }

    const appId = parsed.data;
    const providerId = resolveProviderId(appId);

    try {
      // Special cases
      if (appId === "gmail") {
        const token = await storage.getGmailOAuthToken(userId);
        if (!token) return res.json({ connected: false });
        return res.json({ connected: true, email: token.accountEmail });
      }

      if (appId === "figma") {
        try {
          const { figmaService } = await import("../services/figmaService");
          const token = figmaService.getAccessToken();
          return res.json({ connected: Boolean(token) });
        } catch {
          return res.json({ connected: false });
        }
      }

      const account = await storage.getIntegrationAccountByProvider(userId, providerId);
      if (!account || account.status !== "active") {
        return res.json({ connected: false });
      }

      const isExpired = Boolean(account.tokenExpiresAt && new Date(account.tokenExpiresAt) < new Date());
      return res.json({
        connected: true,
        email: account.email || undefined,
        displayName: account.displayName || undefined,
        tokenExpired: isExpired,
        providerId,
      });
    } catch (err: any) {
      console.error("[AppsIntegrationRouter] GET /:appId/status error:", err?.message || err);
      return res.status(500).json({ connected: false, error: "Failed to check status" });
    }
  });

  router.post("/:appId/connect", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const parsed = appIdSchema.safeParse(req.params.appId);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid app id" });
    }

    const appId = parsed.data;
    const providerId = resolveProviderId(appId);

    try {
      await ensureProvider(providerId);

      const existing = await storage.getIntegrationAccountByProvider(userId, providerId);
      const alreadyConnected = Boolean(existing && existing.status === "active");

      if (existing) {
        if (existing.status !== "active") {
          await storage.updateIntegrationAccount(existing.id, {
            status: "active" as any,
            updatedAt: new Date(),
            metadata: {
              ...(existing.metadata as any),
              connectedVia: "apps_stub",
              connectedAt: new Date().toISOString(),
            },
          } as any);
        }
      } else {
        await storage.createIntegrationAccount({
          userId,
          providerId,
          status: "active",
          isDefault: "true",
          metadata: {
            connectedVia: "apps_stub",
            connectedAt: new Date().toISOString(),
          },
        } as any);
      }

      const policy = await storage.getIntegrationPolicy(userId);
      const enabledApps = Array.from(new Set([...(policy?.enabledApps || []), providerId]));
      await storage.upsertIntegrationPolicy(userId, { enabledApps });
      invalidateIntegrationPolicyCache(userId);

      return res.json({
        success: true,
        connected: true,
        alreadyConnected,
        appId,
        providerId,
      });
    } catch (err: any) {
      console.error("[AppsIntegrationRouter] POST /:appId/connect error:", err?.message || err);
      return res.status(500).json({ error: "Failed to connect app" });
    }
  });

  router.post("/:appId/disconnect", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const parsed = appIdSchema.safeParse(req.params.appId);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid app id" });
    }

    const appId = parsed.data;
    const providerId = resolveProviderId(appId);

    try {
      // Special cases
      if (appId === "gmail") {
        await storage.deleteGmailOAuthToken(userId).catch(() => {});
        return res.json({ success: true });
      }

      if (appId === "figma") {
        try {
          const { figmaService } = await import("../services/figmaService");
          figmaService.setAccessToken("");
        } catch {
          // ignore
        }
        return res.json({ success: true });
      }

      const account = await storage.getIntegrationAccountByProvider(userId, providerId);
      if (account) {
        await storage.deleteIntegrationAccount(account.id);
      }

      const policy = await storage.getIntegrationPolicy(userId);
      if (policy?.enabledApps?.includes(providerId)) {
        await storage.upsertIntegrationPolicy(userId, {
          enabledApps: (policy.enabledApps || []).filter((p) => p !== providerId),
        });
      }
      invalidateIntegrationPolicyCache(userId);

      return res.json({ success: true, alreadyDisconnected: !account });
    } catch (err: any) {
      console.error("[AppsIntegrationRouter] POST /:appId/disconnect error:", err?.message || err);
      return res.status(500).json({ error: "Failed to disconnect app" });
    }
  });

  return router;
}
