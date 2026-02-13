import { Router } from "express";
import crypto from "crypto";
import { storage } from "../storage";
import { db } from "../db";
import { getSecureUserId } from "../lib/anonUserHelper";
import { verifyAnonToken } from "../lib/anonToken";
import { notificationEventTypes, responsePreferencesSchema, userProfileSchema, featureFlagsSchema, integrationProviders, integrationTools, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { usageQuotaService } from "../services/usageQuotaService";
import { AuthenticatedRequest, getUserId } from "../types/express";
import { validateBody } from "../middleware/validateRequest";
import { z } from "zod";
import { requireAdmin } from "./admin/utils";
import { auditLog, AuditActions } from "../services/auditLogger";

export function createUserRouter() {
  const router = Router();

  const updateNotificationPreferenceSchema = z.object({
    eventTypeId: z.string().min(1),
    enabled: z.boolean().optional(),
    channels: z.enum(["push", "email", "push_email", "none"]).optional(),
  });

  async function hasElevatedRole(userId: string): Promise<boolean> {
    const [row] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const role = String(row?.role || "").toLowerCase().trim();
    return ["admin", "superadmin", "team_admin"].includes(role);
  }

  function requireCatalogSeedingEnabled(_req: any, res: any, next: any) {
    const flag = String(process.env.ALLOW_CATALOG_SEEDING || "").trim().toLowerCase();
    if (flag === "true" || flag === "1") return next();
    // Hide seed endpoints unless explicitly enabled.
    return res.status(404).json({ error: "Not found" });
  }

  router.get("/api/user/usage", async (req, res) => {
    try {
      let userId = getUserId(req);

      if (!userId) {
        const token = req.headers['x-anonymous-token'] as string;
        if (token) {
          const parts = token.split(':');
          if (parts.length >= 1 && parts[0].startsWith('anon_') && verifyAnonToken(parts[0], token)) {
            userId = parts[0];
          }
        }
      }

      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const usageStatus = await usageQuotaService.getUsageStatus(userId);
      res.json(usageStatus);
    } catch (error: any) {
      console.error("Error getting usage status:", error);
      res.status(500).json({ error: "Failed to get usage status" });
    }
  });

  router.get("/api/network-access/status", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const { getNetworkAccessPolicyForUser } = await import("../services/networkAccessPolicyService");
      const policy = await getNetworkAccessPolicyForUser(userId);
      res.json(policy);
    } catch (error: any) {
      console.error("Error getting network-access status:", error);
      res.status(500).json({ error: "Failed to get network-access status" });
    }
  });

  router.put("/api/network-access/user", validateBody(z.object({ enabled: z.boolean() })), async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const { setUserNetworkAccessEnabled } = await import("../services/networkAccessPolicyService");
      const policy = await setUserNetworkAccessEnabled(userId, req.body.enabled);
      res.json(policy);
    } catch (error: any) {
      console.error("Error setting user network-access:", error);
      res.status(500).json({ error: "Failed to update network-access" });
    }
  });

  router.put(
    "/api/network-access/org",
    validateBody(z.object({ enabled: z.boolean() })),
    async (req, res) => {
      try {
        const userId = getUserId(req);
        if (!userId) {
          return res.status(401).json({ error: "Unauthorized" });
        }

        const [dbUser] = await db.select().from(users).where(eq(users.id, userId));
        const role = (dbUser as any)?.role || "guest";
        if (!['admin', 'superadmin', 'team_admin'].includes(role)) {
          return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
        }

        const orgId = (dbUser as any)?.orgId || "default";
        const { setOrgNetworkAccessEnabled } = await import("../services/networkAccessPolicyService");
        const row = await setOrgNetworkAccessEnabled(orgId, req.body.enabled);
        res.json({ success: true, orgId, ...row });
      } catch (error: any) {
        console.error("Error setting org network-access:", error);
        res.status(500).json({ error: "Failed to update org network-access" });
      }
    }
  );

  router.get("/api/notification-event-types", async (req, res) => {
    try {
      const eventTypes = await storage.getNotificationEventTypes();
      res.json(eventTypes);
    } catch (error: any) {
      console.error("Error getting notification event types:", error);
      res.status(500).json({ error: "Failed to get notification event types" });
    }
  });

  router.get("/api/users/:id/notification-preferences", async (req, res) => {
    try {
      const { id } = req.params;
      const authUserId = getUserId(req);

      if (authUserId) {
        if (authUserId !== id) {
          const elevated = await hasElevatedRole(authUserId);
          if (!elevated) {
            await auditLog(req, {
              action: AuditActions.SECURITY_ALERT,
              resource: "notification_preferences",
              resourceId: id,
              details: { reason: "forbidden", actorUserId: authUserId, targetUserId: id, path: req.originalUrl || req.path },
              category: "security",
              severity: "warning",
            });
            return res.status(403).json({ error: "Forbidden" });
          }
        }
      } else {
        // Allow anonymous users to access their own preferences if token validates.
        const token = req.headers["x-anonymous-token"] as string;
        if (!id.startsWith("anon_") || !verifyAnonToken(id, token)) {
          return res.status(403).json({ error: "Access denied" });
        }
      }

      const eventTypes = await storage.getNotificationEventTypes();
      const preferences = await storage.getNotificationPreferences(id);

      const prefsWithEventTypes = eventTypes.map(eventType => {
        const pref = preferences.find(p => p.eventTypeId === eventType.id);
        return {
          eventType,
          preference: pref || null,
          enabled: pref ? pref.enabled : eventType.defaultChannels !== 'none',
          channels: pref ? pref.channels : eventType.defaultChannels
        };
      });

      res.json(prefsWithEventTypes);
    } catch (error: any) {
      console.error("Error getting notification preferences:", error);
      res.status(500).json({ error: "Failed to get notification preferences" });
    }
  });

  router.put("/api/users/:id/notification-preferences", validateBody(updateNotificationPreferenceSchema), async (req, res) => {
    try {
      const { id } = req.params;
      const { eventTypeId, enabled, channels } = req.body;

      const authUserId = getUserId(req);

      if (authUserId) {
        if (authUserId !== id) {
          const elevated = await hasElevatedRole(authUserId);
          if (!elevated) {
            await auditLog(req, {
              action: AuditActions.SECURITY_ALERT,
              resource: "notification_preferences",
              resourceId: id,
              details: { reason: "forbidden", actorUserId: authUserId, targetUserId: id, path: req.originalUrl || req.path },
              category: "security",
              severity: "warning",
            });
            return res.status(403).json({ error: "Forbidden" });
          }
        }
      } else {
        const token = req.headers["x-anonymous-token"] as string;
        if (!id.startsWith("anon_") || !verifyAnonToken(id, token)) {
          return res.status(403).json({ error: "Access denied" });
        }
      }

      const eventTypes = await storage.getNotificationEventTypes();
      if (!eventTypes.some((t) => t.id === eventTypeId)) {
        return res.status(400).json({ error: "Unknown eventTypeId" });
      }

      const preference = await storage.upsertNotificationPreference({
        userId: id,
        eventTypeId,
        enabled: enabled !== undefined ? (enabled ? "true" : "false") : "true",
        channels: channels || "push",
      });

      res.json(preference);
    } catch (error: any) {
      console.error("Error updating notification preference:", error);
      res.status(500).json({ error: "Failed to update notification preference" });
    }
  });

  router.post("/api/notification-event-types/seed", requireCatalogSeedingEnabled, requireAdmin, async (req, res) => {
    try {
      const eventTypesToSeed = [
        { id: 'ai_response_ready', name: 'Respuestas de IA', description: 'Notificaciones cuando una respuesta larga está lista', category: 'ai_updates', severity: 'normal', defaultChannels: 'push', sortOrder: 1 },
        { id: 'task_status_update', name: 'Actualizaciones de tareas', description: 'Cambios en tareas programadas', category: 'tasks', severity: 'normal', defaultChannels: 'push_email', sortOrder: 2 },
        { id: 'project_invitation', name: 'Invitaciones a proyectos', description: 'Invitaciones a chats compartidos', category: 'social', severity: 'high', defaultChannels: 'push_email', sortOrder: 3 },
        { id: 'product_recommendation', name: 'Recomendaciones', description: 'Sugerencias personalizadas', category: 'product', severity: 'low', defaultChannels: 'email', sortOrder: 4 },
        { id: 'feature_announcement', name: 'Novedades', description: 'Nuevas funciones disponibles', category: 'product', severity: 'low', defaultChannels: 'email', sortOrder: 5 }
      ];

      const existing = await storage.getNotificationEventTypes();
      const existingIds = new Set(existing.map(e => e.id));

      const toInsert = eventTypesToSeed.filter(e => !existingIds.has(e.id));

      if (toInsert.length > 0) {
        await db.insert(notificationEventTypes).values(toInsert);
      }

      await auditLog(req, {
        action: "system.notification_event_types_seeded",
        resource: "notification_event_types",
        details: { inserted: toInsert.length, totalAfter: existing.length + toInsert.length },
        category: "config",
        severity: "warning",
      });

      const allEventTypes = await storage.getNotificationEventTypes();
      res.json({
        message: `Seeded ${toInsert.length} new event types`,
        eventTypes: allEventTypes
      });
    } catch (error: any) {
      console.error("Error seeding notification event types:", error);
      res.status(500).json({ error: "Failed to seed notification event types" });
    }
  });

  router.get("/api/users/:id/settings", async (req, res) => {
    try {
      const { id } = req.params;

      // For authenticated users, verify ownership
      const authUserId = getUserId(req);

      if (authUserId) {
        // Authenticated user - must match
        if (authUserId !== id) {
          return res.status(403).json({ error: "Access denied: You can only access your own settings" });
        }
      } else {
        // Anonymous user - verify token for cryptographic authentication
        const token = req.headers['x-anonymous-token'] as string;
        if (!id.startsWith('anon_') || !verifyAnonToken(id, token)) {
          return res.status(403).json({ error: "Access denied" });
        }
      }

      const settings = await storage.getUserSettings(id);

      if (!settings) {
        res.json({
          userId: id,
          responsePreferences: {
            responseStyle: 'default',
            responseTone: 'professional',
            customInstructions: ''
          },
          userProfile: {
            nickname: '',
            occupation: '',
            bio: ''
          },
          featureFlags: {
            memoryEnabled: false,
            recordingHistoryEnabled: false,
            chatHistoryEnabled: true,
            webSearchAuto: true,
            codeInterpreterEnabled: true,
            canvasEnabled: true,
            voiceEnabled: true,
            voiceAdvanced: false,
            connectorSearchAuto: false
          }
        });
        return;
      }

      res.json(settings);
    } catch (error: any) {
      console.error("Error getting user settings:", error);
      res.status(500).json({ error: "Failed to get user settings" });
    }
  });

  const updateUserSettingsSchema = z.object({
    // Use patch semantics: only provided keys should be updated.
    // Important: avoid Zod defaults overwriting existing settings when a client omits a field.
    responsePreferences: responsePreferencesSchema.partial().optional(),
    userProfile: userProfileSchema.partial().optional(),
    featureFlags: featureFlagsSchema.partial().optional(),
  });

  router.put("/api/users/:id/settings", validateBody(updateUserSettingsSchema), async (req, res) => {
    try {
      const { id } = req.params;

      // For authenticated users, verify ownership
      const authUserId = getUserId(req);

      if (authUserId) {
        // Authenticated user - must match
        if (authUserId !== id) {
          return res.status(403).json({ error: "Access denied: You can only update your own settings" });
        }
      } else {
        // Anonymous user - verify token for cryptographic authentication
        const token = req.headers['x-anonymous-token'] as string;
        if (!id.startsWith('anon_') || !verifyAnonToken(id, token)) {
          return res.status(403).json({ error: "Access denied" });
        }
      }

      // Validated data is now in req.body (or req.validatedBody)
      const { responsePreferences, userProfile, featureFlags } = req.body;

      const updates: any = {};

      if (responsePreferences) updates.responsePreferences = responsePreferences;
      if (userProfile) updates.userProfile = userProfile;
      if (featureFlags) updates.featureFlags = featureFlags;

      // Audit-like consent log for sensitive user data controls.
      // Kept in consent_logs so both privacy & history toggles have a trail.
      const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string)?.split(',')[0] || undefined;
      const userAgent = req.headers['user-agent'] || undefined;
      if (featureFlags?.chatHistoryEnabled !== undefined) {
        await storage.logConsent(id, 'chat_history_enabled', String(featureFlags.chatHistoryEnabled), ipAddress, userAgent);
      }

      const settings = await storage.upsertUserSettings(id, updates);
      res.json(settings);
    } catch (error: any) {
      console.error("Error updating user settings:", error);
      res.status(500).json({ error: "Failed to update user settings" });
    }
  });

  router.get("/api/integrations/providers", async (req, res) => {
    try {
      const providers = await storage.getIntegrationProviders();
      res.json(providers);
    } catch (error: any) {
      console.error("Error getting providers:", error);
      res.status(500).json({ error: "Failed to get providers" });
    }
  });

  router.get("/api/integrations/tools", async (req, res) => {
    try {
      const { providerId } = req.query;
      const tools = await storage.getIntegrationTools(providerId as string | undefined);
      res.json(tools);
    } catch (error: any) {
      console.error("Error getting tools:", error);
      res.status(500).json({ error: "Failed to get tools" });
    }
  });

  router.post("/api/integrations/seed", requireCatalogSeedingEnabled, requireAdmin, async (req, res) => {
    try {
      const providersToSeed = [
        {
          id: "github",
          name: "GitHub",
          description: "Control de versiones y colaboración de código",
          iconUrl: "https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png",
          authType: "oauth2",
          authConfig: { authUrl: "https://github.com/login/oauth/authorize", tokenUrl: "https://github.com/login/oauth/access_token", scopes: ["repo", "user", "read:org"] },
          category: "development",
          isActive: "true"
        },
        {
          id: "figma",
          name: "Figma",
          description: "Diseño colaborativo y prototipado",
          iconUrl: "https://static.figma.com/app/icon/1/favicon.svg",
          authType: "oauth2",
          authConfig: { authUrl: "https://www.figma.com/oauth", tokenUrl: "https://www.figma.com/api/oauth/token", scopes: ["file_read", "file_write"] },
          category: "design",
          isActive: "true"
        },
        {
          id: "canva",
          name: "Canva",
          description: "Diseño gráfico y contenido visual",
          iconUrl: "https://static.canva.com/static/images/canva-logo.svg",
          authType: "oauth2",
          authConfig: { authUrl: "https://www.canva.com/api/oauth/authorize", tokenUrl: "https://www.canva.com/api/oauth/token", scopes: ["design:content:read", "design:content:write"] },
          category: "design",
          isActive: "true"
        },
        {
          id: "slack",
          name: "Slack",
          description: "Comunicación y mensajería de equipo",
          iconUrl: "https://a.slack-edge.com/80588/marketing/img/icons/icon_slack_hash_colored.png",
          authType: "oauth2",
          authConfig: { authUrl: "https://slack.com/oauth/v2/authorize", tokenUrl: "https://slack.com/api/oauth.v2.access", scopes: ["channels:read", "chat:write", "users:read"] },
          category: "communication",
          isActive: "true"
        },
        {
          id: "notion",
          name: "Notion",
          description: "Notas, documentación y gestión de proyectos",
          iconUrl: "https://www.notion.so/images/logo-ios.png",
          authType: "oauth2",
          authConfig: { authUrl: "https://api.notion.com/v1/oauth/authorize", tokenUrl: "https://api.notion.com/v1/oauth/token", scopes: [] },
          category: "productivity",
          isActive: "true"
        },
        {
          id: "google_drive",
          name: "Google Drive",
          description: "Almacenamiento y documentos en la nube",
          iconUrl: "https://ssl.gstatic.com/docs/doclist/images/drive_2022q3_32dp.png",
          authType: "oauth2",
          authConfig: { authUrl: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: "https://oauth2.googleapis.com/token", scopes: ["https://www.googleapis.com/auth/drive.readonly"] },
          category: "productivity",
          isActive: "true"
        }
      ];

      let insertedProviders = 0;
      for (const provider of providersToSeed) {
        const existing = await storage.getIntegrationProvider(provider.id);
        if (!existing) {
          await db.insert(integrationProviders).values(provider);
          insertedProviders++;
        }
      }

      const toolsToSeed = [
        { id: "github:list_repos", providerId: "github", name: "Listar repositorios", description: "Lista los repositorios del usuario", requiredScopes: ["repo"], dataAccessLevel: "read", confirmationRequired: "false" },
        { id: "github:create_issue", providerId: "github", name: "Crear issue", description: "Crea un nuevo issue en un repositorio", requiredScopes: ["repo"], dataAccessLevel: "write", confirmationRequired: "true" },
        { id: "github:get_file", providerId: "github", name: "Obtener archivo", description: "Lee el contenido de un archivo", requiredScopes: ["repo"], dataAccessLevel: "read", confirmationRequired: "false" },
        { id: "figma:get_file", providerId: "figma", name: "Obtener archivo", description: "Obtiene información de un archivo Figma", requiredScopes: ["file_read"], dataAccessLevel: "read", confirmationRequired: "false" },
        { id: "figma:export_frame", providerId: "figma", name: "Exportar frame", description: "Exporta un frame como imagen", requiredScopes: ["file_read"], dataAccessLevel: "read", confirmationRequired: "false" },
        { id: "canva:list_designs", providerId: "canva", name: "Listar diseños", description: "Lista los diseños del usuario", requiredScopes: ["design:content:read"], dataAccessLevel: "read", confirmationRequired: "false" },
        { id: "canva:export_design", providerId: "canva", name: "Exportar diseño", description: "Exporta un diseño como imagen", requiredScopes: ["design:content:read"], dataAccessLevel: "read", confirmationRequired: "false" },
        { id: "slack:send_message", providerId: "slack", name: "Enviar mensaje", description: "Envía un mensaje a un canal", requiredScopes: ["chat:write"], dataAccessLevel: "write", confirmationRequired: "true" },
        { id: "slack:list_channels", providerId: "slack", name: "Listar canales", description: "Lista los canales disponibles", requiredScopes: ["channels:read"], dataAccessLevel: "read", confirmationRequired: "false" },
        { id: "notion:search", providerId: "notion", name: "Buscar páginas", description: "Busca páginas en el workspace", requiredScopes: [], dataAccessLevel: "read", confirmationRequired: "false" },
        { id: "notion:get_page", providerId: "notion", name: "Obtener página", description: "Obtiene el contenido de una página", requiredScopes: [], dataAccessLevel: "read", confirmationRequired: "false" },
        { id: "google_drive:list_files", providerId: "google_drive", name: "Listar archivos", description: "Lista archivos en Drive", requiredScopes: ["https://www.googleapis.com/auth/drive.readonly"], dataAccessLevel: "read", confirmationRequired: "false" },
        { id: "google_drive:get_file", providerId: "google_drive", name: "Obtener archivo", description: "Obtiene contenido de un archivo", requiredScopes: ["https://www.googleapis.com/auth/drive.readonly"], dataAccessLevel: "read", confirmationRequired: "false" }
      ];

      let insertedTools = 0;
      for (const tool of toolsToSeed) {
        const existing = await db.select().from(integrationTools).where(eq(integrationTools.id, tool.id));
        if (existing.length === 0) {
          await db.insert(integrationTools).values({ ...tool, isActive: "true" });
          insertedTools++;
        }
      }

      const providers = await storage.getIntegrationProviders();
      const tools = await storage.getIntegrationTools();
      await auditLog(req, {
        action: "system.integration_catalog_seeded",
        resource: "integration_catalog",
        details: { insertedProviders, insertedTools, providersTotal: providers.length, toolsTotal: tools.length },
        category: "config",
        severity: "warning",
      });
      res.json({ message: "Catalog seeded", providers: providers.length, tools: tools.length });
    } catch (error: any) {
      console.error("Error seeding catalog:", error);
      res.status(500).json({ error: "Failed to seed catalog" });
    }
  });

  router.get("/api/users/:id/integrations", async (req, res) => {
    try {
      const authUserId = (req as AuthenticatedRequest).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const [accounts, policy, providers] = await Promise.all([
        storage.getIntegrationAccounts(id),
        storage.getIntegrationPolicy(id),
        storage.getIntegrationProviders()
      ]);

      res.json({ accounts, policy, providers });
    } catch (error: any) {
      console.error("Error getting user integrations:", error);
      res.status(500).json({ error: "Failed to get integrations" });
    }
  });

  router.put("/api/users/:id/integrations/policy", async (req, res) => {
    try {
      const authUserId = (req as AuthenticatedRequest).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const { enabledApps, enabledTools, disabledTools, resourceScopes, autoConfirmPolicy, sandboxMode, maxParallelCalls } = req.body;

      const policy = await storage.upsertIntegrationPolicy(id, {
        enabledApps,
        enabledTools,
        disabledTools,
        resourceScopes,
        autoConfirmPolicy,
        sandboxMode,
        maxParallelCalls
      });

      res.json(policy);
    } catch (error: any) {
      console.error("Error updating policy:", error);
      res.status(500).json({ error: "Failed to update policy" });
    }
  });

  router.post("/api/users/:id/integrations/:provider/connect", async (req, res) => {
    try {
      const authUserId = (req as AuthenticatedRequest).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id, provider } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const providerInfo = await storage.getIntegrationProvider(provider);
      if (!providerInfo) return res.status(404).json({ error: "Provider not found" });

      res.json({
        message: "OAuth flow not yet implemented",
        provider: providerInfo.name,
        authType: providerInfo.authType
      });
    } catch (error: any) {
      console.error("Error initiating connect:", error);
      res.status(500).json({ error: "Failed to initiate connection" });
    }
  });

  router.post("/api/users/:id/integrations/:provider/disconnect", async (req, res) => {
    try {
      const authUserId = (req as AuthenticatedRequest).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id, provider } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const account = await storage.getIntegrationAccountByProvider(id, provider);
      if (!account) return res.status(404).json({ error: "Account not found" });

      await storage.deleteIntegrationAccount(account.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error disconnecting:", error);
      res.status(500).json({ error: "Failed to disconnect" });
    }
  });

  router.get("/api/users/:id/integrations/logs", async (req, res) => {
    try {
      const authUserId = (req as AuthenticatedRequest).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const limit = parseInt(req.query.limit as string) || 50;
      const logs = await storage.getToolCallLogs(id, limit);
      res.json(logs);
    } catch (error: any) {
      console.error("Error getting logs:", error);
      res.status(500).json({ error: "Failed to get logs" });
    }
  });

  router.get("/api/users/:id/privacy", async (req, res) => {
    try {
      const { id } = req.params;
      const authUserId = getUserId(req);

      if (authUserId) {
        if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });
      } else {
        // Anonymous user access: require cryptographic token.
        const token = req.headers['x-anonymous-token'] as string;
        if (!id.startsWith("anon_") || !verifyAnonToken(id, token)) {
          return res.status(403).json({ error: "Forbidden" });
        }
      }

      const settings = await storage.getUserSettings(id);
      const logs = await storage.getConsentLogs(id, 10);
      const defaultPrivacySettings = { trainingOptIn: false, remoteBrowserDataAccess: false, analyticsTracking: true };
      res.json({
        privacySettings: { ...defaultPrivacySettings, ...(settings?.privacySettings || {}) },
        consentHistory: logs
      });
    } catch (error: any) {
      console.error("Error getting privacy settings:", error);
      res.status(500).json({ error: "Failed to get privacy settings" });
    }
  });

  const updatePrivacySettingsSchema = z.object({
    trainingOptIn: z.boolean().optional(),
    remoteBrowserDataAccess: z.boolean().optional(),
    analyticsTracking: z.boolean().optional(),
  });

  router.put("/api/users/:id/privacy", validateBody(updatePrivacySettingsSchema), async (req, res) => {
    try {
      const { id } = req.params;
      const authUserId = getUserId(req);
      if (authUserId) {
        if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });
      } else {
        // Anonymous user access: require cryptographic token.
        const token = req.headers['x-anonymous-token'] as string;
        if (!id.startsWith("anon_") || !verifyAnonToken(id, token)) {
          return res.status(403).json({ error: "Forbidden" });
        }
      }

      const { trainingOptIn, remoteBrowserDataAccess, analyticsTracking } = req.body;
      const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string)?.split(',')[0] || undefined;
      const userAgent = req.headers['user-agent'] || undefined;

      if (trainingOptIn !== undefined) {
        await storage.logConsent(id, 'training_opt_in', String(trainingOptIn), ipAddress, userAgent);
      }
      if (remoteBrowserDataAccess !== undefined) {
        await storage.logConsent(id, 'remote_browser_access', String(remoteBrowserDataAccess), ipAddress, userAgent);
      }
      if (analyticsTracking !== undefined) {
        await storage.logConsent(id, 'analytics_tracking', String(analyticsTracking), ipAddress, userAgent);
      }

      const privacyUpdates: Partial<{
        trainingOptIn: boolean;
        remoteBrowserDataAccess: boolean;
        analyticsTracking: boolean;
      }> = {};
      if (trainingOptIn !== undefined) privacyUpdates.trainingOptIn = trainingOptIn;
      if (remoteBrowserDataAccess !== undefined) privacyUpdates.remoteBrowserDataAccess = remoteBrowserDataAccess;
      if (analyticsTracking !== undefined) privacyUpdates.analyticsTracking = analyticsTracking;

      if (Object.keys(privacyUpdates).length === 0) {
        return res.status(400).json({ error: "No privacy settings provided" });
      }

      // Build a full settings object to satisfy typing and prevent accidental resets.
      const currentSettings = await storage.getUserSettings(id);
      const defaultPrivacySettings = { trainingOptIn: false, remoteBrowserDataAccess: false, analyticsTracking: true };
      const currentPrivacy = { ...defaultPrivacySettings, ...(currentSettings?.privacySettings || {}) };
      const nextPrivacy = { ...currentPrivacy, ...privacyUpdates };

      const settings = await storage.upsertUserSettings(id, { privacySettings: nextPrivacy });

      res.json(settings);
    } catch (error: any) {
      console.error("Error updating privacy settings:", error);
      res.status(500).json({ error: "Failed to update privacy settings" });
    }
  });

  router.get("/api/users/:id/shared-links", async (req, res) => {
    try {
      const authUserId = (req as AuthenticatedRequest).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const links = await storage.getSharedLinks(id);
      res.json(links);
    } catch (error: any) {
      console.error("Error getting shared links:", error);
      res.status(500).json({ error: "Failed to get shared links" });
    }
  });

  router.post("/api/users/:id/shared-links", async (req, res) => {
    try {
      const authUserId = (req as AuthenticatedRequest).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const { resourceType, resourceId, scope, permissions, expiresAt } = req.body;

      if (!resourceType || !resourceId) {
        return res.status(400).json({ error: "Missing required fields: resourceType, resourceId" });
      }

      const token = crypto.randomBytes(32).toString('hex');

      const link = await storage.createSharedLink({
        userId: id,
        resourceType,
        resourceId,
        token,
        scope: scope || 'link_only',
        permissions: permissions || 'read',
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        isRevoked: 'false'
      });

      res.json(link);
    } catch (error: any) {
      console.error("Error creating shared link:", error);
      res.status(500).json({ error: "Failed to create shared link" });
    }
  });

  router.delete("/api/users/:id/shared-links/:linkId", async (req, res) => {
    try {
      const authUserId = (req as AuthenticatedRequest).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id, linkId } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      await storage.revokeSharedLink(linkId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error revoking shared link:", error);
      res.status(500).json({ error: "Failed to revoke shared link" });
    }
  });

  router.post("/api/users/:id/shared-links/:linkId/rotate", async (req, res) => {
    try {
      const authUserId = (req as AuthenticatedRequest).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id, linkId } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const link = await storage.rotateSharedLinkToken(linkId);
      res.json(link);
    } catch (error: any) {
      console.error("Error rotating shared link token:", error);
      res.status(500).json({ error: "Failed to rotate shared link token" });
    }
  });

  router.patch("/api/users/:id/shared-links/:linkId", async (req, res) => {
    try {
      const authUserId = (req as AuthenticatedRequest).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id, linkId } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const { scope, permissions } = req.body;

      const link = await storage.updateSharedLink(linkId, { scope, permissions });
      res.json(link);
    } catch (error: any) {
      console.error("Error updating shared link:", error);
      res.status(500).json({ error: "Failed to update shared link" });
    }
  });

  router.get("/api/shared/:token", async (req, res) => {
    try {
      const { token } = req.params;

      const link = await storage.getSharedLinkByToken(token);

      if (!link) {
        return res.status(404).json({ error: "Shared link not found" });
      }

      if (link.isRevoked === 'true') {
        return res.status(410).json({ error: "This shared link has been revoked" });
      }

      if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
        return res.status(410).json({ error: "This shared link has expired" });
      }

      await storage.incrementSharedLinkAccess(link.id);

      res.json({
        resourceType: link.resourceType,
        resourceId: link.resourceId,
        scope: link.scope,
        permissions: link.permissions,
        accessCount: (link.accessCount || 0) + 1
      });
    } catch (error: any) {
      console.error("Error accessing shared link:", error);
      res.status(500).json({ error: "Failed to access shared link" });
    }
  });

  router.get("/api/users/:id/chats/archived", async (req, res) => {
    try {
      const authUserId = (req as AuthenticatedRequest).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const chats = await storage.getArchivedChats(id);
      res.json(chats);
    } catch (error: any) {
      console.error("Error getting archived chats:", error);
      res.status(500).json({ error: "Failed to get archived chats" });
    }
  });

  router.post("/api/users/:id/chats/:chatId/unarchive", async (req, res) => {
    try {
      const authUserId = (req as AuthenticatedRequest).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id, chatId } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      await storage.unarchiveChat(chatId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error unarchiving chat:", error);
      res.status(500).json({ error: "Failed to unarchive chat" });
    }
  });

  router.post("/api/users/:id/chats/archive-all", async (req, res) => {
    try {
      const authUserId = (req as AuthenticatedRequest).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const count = await storage.archiveAllChats(id);
      res.json({ count });
    } catch (error: any) {
      console.error("Error archiving all chats:", error);
      res.status(500).json({ error: "Failed to archive all chats" });
    }
  });

  router.get("/api/users/:id/chats/deleted", async (req, res) => {
    try {
      const authUserId = (req as AuthenticatedRequest).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const chats = await storage.getDeletedChats(id);
      res.json(chats);
    } catch (error: any) {
      console.error("Error getting deleted chats:", error);
      res.status(500).json({ error: "Failed to get deleted chats" });
    }
  });

  router.post("/api/users/:id/chats/delete-all", async (req, res) => {
    try {
      const { id } = req.params;
      const authUserId = getUserId(req);
      if (authUserId) {
        if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });
      } else {
        // Anonymous user access: require cryptographic token.
        const token = req.headers['x-anonymous-token'] as string;
        if (!id.startsWith("anon_") || !verifyAnonToken(id, token)) {
          return res.status(403).json({ error: "Forbidden" });
        }
      }

      const count = await storage.softDeleteAllChats(id);

      const links = await storage.getSharedLinks(id);
      for (const link of links) {
        if (link.resourceType === 'chat') {
          await storage.revokeSharedLink(link.id);
        }
      }

      await auditLog(req, {
        action: "user.chats_delete_all",
        resource: "chats",
        details: { targetUserId: id, count },
        category: "data",
        severity: "warning",
      });

      res.json({ count });
    } catch (error: any) {
      console.error("Error deleting all chats:", error);
      res.status(500).json({ error: "Failed to delete all chats" });
    }
  });

  router.post("/api/users/:id/chats/:chatId/restore", async (req, res) => {
    try {
      const authUserId = (req as AuthenticatedRequest).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id, chatId } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      await storage.restoreDeletedChat(chatId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error restoring chat:", error);
      res.status(500).json({ error: "Failed to restore chat" });
    }
  });

  router.get("/api/users/:id/company-knowledge", async (req, res) => {
    try {
      const authUserId = (req as AuthenticatedRequest).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const knowledge = await storage.getCompanyKnowledge(id);
      res.json(knowledge);
    } catch (error: any) {
      console.error("Error getting company knowledge:", error);
      res.status(500).json({ error: "Failed to get company knowledge" });
    }
  });

  router.post("/api/users/:id/company-knowledge", async (req, res) => {
    try {
      const authUserId = (req as AuthenticatedRequest).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const { title, content, category } = req.body;
      if (!title || !content) {
        return res.status(400).json({ error: "Title and content are required" });
      }

      const knowledge = await storage.createCompanyKnowledge({
        userId: id,
        title,
        content,
        category: category || "general",
        isActive: "true"
      });
      res.json(knowledge);
    } catch (error: any) {
      console.error("Error creating company knowledge:", error);
      res.status(500).json({ error: "Failed to create company knowledge" });
    }
  });

  router.put("/api/users/:id/company-knowledge/:knowledgeId", async (req, res) => {
    try {
      const authUserId = (req as any).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id, knowledgeId } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const { title, content, category, isActive } = req.body;
      const knowledge = await storage.updateCompanyKnowledge(knowledgeId, {
        ...(title !== undefined && { title }),
        ...(content !== undefined && { content }),
        ...(category !== undefined && { category }),
        ...(isActive !== undefined && { isActive: isActive ? "true" : "false" })
      });

      if (!knowledge) {
        return res.status(404).json({ error: "Knowledge entry not found" });
      }
      res.json(knowledge);
    } catch (error: any) {
      console.error("Error updating company knowledge:", error);
      res.status(500).json({ error: "Failed to update company knowledge" });
    }
  });

  router.delete("/api/users/:id/company-knowledge/:knowledgeId", async (req, res) => {
    try {
      const authUserId = (req as any).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id, knowledgeId } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      await storage.deleteCompanyKnowledge(knowledgeId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting company knowledge:", error);
      res.status(500).json({ error: "Failed to delete company knowledge" });
    }
  });

  // ============================================================================
  // User Preferences (General)
  // ============================================================================

  /**
   * GET /api/user/preferences - Get current user's preferences
   */
  router.get("/api/user/preferences", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json(user.preferences || {});
    } catch (error: any) {
      console.error("[Preferences] Error getting:", error);
      res.status(500).json({ error: "Failed to get preferences" });
    }
  });

  /**
   * PATCH /api/user/preferences - Update some preferences
   */
  router.patch("/api/user/preferences", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const updates = req.body;
      if (!updates || typeof updates !== "object") {
        return res.status(400).json({ error: "Invalid preferences" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const currentPrefs = (user.preferences as Record<string, unknown>) || {};
      const newPrefs = { ...currentPrefs, ...updates };

      await storage.updateUser(userId, { preferences: newPrefs });
      res.json(newPrefs);
    } catch (error: any) {
      console.error("[Preferences] Error updating:", error);
      res.status(500).json({ error: "Failed to update preferences" });
    }
  });

  /**
   * PUT /api/user/preferences - Replace all preferences
   */
  router.put("/api/user/preferences", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const preferences = req.body;
      if (!preferences || typeof preferences !== "object") {
        return res.status(400).json({ error: "Invalid preferences" });
      }

      await storage.updateUser(userId, { preferences });
      res.json(preferences);
    } catch (error: any) {
      console.error("[Preferences] Error replacing:", error);
      res.status(500).json({ error: "Failed to replace preferences" });
    }
  });

  // ============================================================================
  // GDPR Data Export
  // ============================================================================

  /**
   * GET /api/user/export - Export all user data (GDPR compliance)
   */
  router.get("/api/user/export", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Collect all user data
      const chats = await storage.getChatsByUserId(userId);
      const messages = [];
      for (const chat of chats.slice(0, 100)) { // Limit to last 100 chats
        const chatMessages = await storage.getMessagesByChatId(chat.id);
        messages.push(...chatMessages);
      }

      // Remove sensitive fields
      const { password, totpSecret, ...safeUser } = user as any;

      const exportData = {
        exportedAt: new Date().toISOString(),
        format: "IliaGPT Data Export v1.0",
        user: safeUser,
        statistics: {
          totalChats: chats.length,
          totalMessages: messages.length,
          tokensConsumed: user.tokensConsumed || 0,
          queryCount: user.queryCount || 0
        },
        chats: chats.map(c => ({
          id: c.id,
          title: c.title,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt
        })),
        messages: messages.map(m => ({
          id: m.id,
          chatId: m.chatId,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt
        })),
        preferences: user.preferences || {}
      };

      await auditLog(req, {
        action: "user.export_data",
        resource: "users",
        resourceId: userId,
        details: {
          format: exportData.format,
          totalChats: exportData.statistics.totalChats,
          totalMessages: exportData.statistics.totalMessages,
        },
        category: "data",
        severity: "info",
      });

      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="iliagpt-export-${userId.slice(0,8)}-${Date.now()}.json"`);
      res.json(exportData);

    } catch (error: any) {
      console.error("[Export] Error:", error);
      res.status(500).json({ error: "Failed to export data" });
    }
  });

  /**
   * DELETE /api/user/account - Delete user account (GDPR right to be forgotten)
   */
  router.delete("/api/user/account", async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { confirmation } = req.body;
      if (confirmation !== "DELETE_MY_ACCOUNT") {
        return res.status(400).json({ 
          error: "Please confirm deletion by sending: { confirmation: 'DELETE_MY_ACCOUNT' }" 
        });
      }

      // Soft delete - mark as deleted but keep for audit
      await storage.updateUser(userId, { 
        status: "deleted",
        deletedAt: new Date(),
        email: `deleted-${userId}@deleted.local`,
        phone: null,
        fullName: "Deleted User"
      });

      // Log for audit
      await storage.createAuditLog({
        action: "account_deletion",
        resource: "users",
        resourceId: userId,
        details: { 
          deletedAt: new Date().toISOString(),
          method: "user_request"
        }
      });

      res.json({ 
        success: true, 
        message: "Account scheduled for deletion. Data will be removed within 30 days." 
      });

    } catch (error: any) {
      console.error("[Delete Account] Error:", error);
      res.status(500).json({ error: "Failed to delete account" });
    }
  });

  return router;
}
