import { Router } from "express";
import crypto from "crypto";
import { storage } from "../storage";
import { db } from "../db";
import { getSecureUserId } from "../lib/anonUserHelper";
import { verifyAnonToken } from "../lib/anonToken";
import { notificationEventTypes, responsePreferencesSchema, userProfileSchema, featureFlagsSchema, integrationProviders, integrationTools } from "@shared/schema";
import { eq } from "drizzle-orm";
import { usageQuotaService } from "../services/usageQuotaService";
import { AuthenticatedRequest, getUserId } from "../types/express";
import { validateBody } from "../middleware/validateRequest";
import { z } from "zod";

export function createUserRouter() {
  const router = Router();

  router.get("/api/user/usage", async (req, res) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      let userId = user?.claims?.sub;

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

  router.put("/api/users/:id/notification-preferences", async (req, res) => {
    try {
      const { id } = req.params;
      const { eventTypeId, enabled, channels } = req.body;

      if (!eventTypeId) {
        return res.status(400).json({ error: "eventTypeId is required" });
      }

      const preference = await storage.upsertNotificationPreference({
        userId: id,
        eventTypeId,
        enabled: enabled !== undefined ? (enabled ? "true" : "false") : "true",
        channels: channels || "push"
      });

      res.json(preference);
    } catch (error: any) {
      console.error("Error updating notification preference:", error);
      res.status(500).json({ error: "Failed to update notification preference" });
    }
  });

  // SECURITY FIX #34: Restrict seed endpoint to development/admin only
  router.post("/api/notification-event-types/seed", async (req, res) => {
    // Only allow in development or for authenticated admin users
    const isProduction = process.env.NODE_ENV === 'production';
    const user = (req as AuthenticatedRequest).user;
    const userId = user?.claims?.sub;

    if (isProduction) {
      // In production, require admin authentication
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }
      // Check if user is admin
      const userEmail = user?.claims?.email?.toLowerCase();
      const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
      if (!adminEmails.includes(userEmail || '')) {
        return res.status(403).json({ error: "Admin access required" });
      }
    }

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
      const user = (req as AuthenticatedRequest).user;
      const authUserId = user?.claims?.sub;

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
    responsePreferences: responsePreferencesSchema.optional(),
    userProfile: userProfileSchema.optional(),
    featureFlags: featureFlagsSchema.optional(),
  });

  router.put("/api/users/:id/settings", validateBody(updateUserSettingsSchema), async (req, res) => {
    try {
      const { id } = req.params;

      // For authenticated users, verify ownership
      const user = (req as AuthenticatedRequest).user;
      const authUserId = user?.claims?.sub;

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

  // SECURITY FIX #35: Restrict seed endpoint to development/admin only
  router.post("/api/integrations/seed", async (req, res) => {
    const isProduction = process.env.NODE_ENV === 'production';
    const user = (req as AuthenticatedRequest).user;
    const userId = user?.claims?.sub;

    if (isProduction) {
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }
      const userEmail = user?.claims?.email?.toLowerCase();
      const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
      if (!adminEmails.includes(userEmail || '')) {
        return res.status(403).json({ error: "Admin access required" });
      }
    }

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

      for (const provider of providersToSeed) {
        const existing = await storage.getIntegrationProvider(provider.id);
        if (!existing) {
          await db.insert(integrationProviders).values(provider);
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

      for (const tool of toolsToSeed) {
        const existing = await db.select().from(integrationTools).where(eq(integrationTools.id, tool.id));
        if (existing.length === 0) {
          await db.insert(integrationTools).values({ ...tool, isActive: "true" });
        }
      }

      const providers = await storage.getIntegrationProviders();
      const tools = await storage.getIntegrationTools();
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
      const authUserId = (req as AuthenticatedRequest).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const settings = await storage.getUserSettings(id);
      const logs = await storage.getConsentLogs(id, 10);
      res.json({
        privacySettings: settings?.privacySettings || { trainingOptIn: false, remoteBrowserDataAccess: false },
        consentHistory: logs
      });
    } catch (error: any) {
      console.error("Error getting privacy settings:", error);
      res.status(500).json({ error: "Failed to get privacy settings" });
    }
  });

  router.put("/api/users/:id/privacy", async (req, res) => {
    try {
      const authUserId = (req as AuthenticatedRequest).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const { trainingOptIn, remoteBrowserDataAccess } = req.body;
      const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string)?.split(',')[0] || undefined;
      const userAgent = req.headers['user-agent'] || undefined;

      if (trainingOptIn !== undefined) {
        await storage.logConsent(id, 'training_opt_in', String(trainingOptIn), ipAddress, userAgent);
      }
      if (remoteBrowserDataAccess !== undefined) {
        await storage.logConsent(id, 'remote_browser_access', String(remoteBrowserDataAccess), ipAddress, userAgent);
      }

      const settings = await storage.upsertUserSettings(id, {
        privacySettings: { trainingOptIn: trainingOptIn ?? false, remoteBrowserDataAccess: remoteBrowserDataAccess ?? false }
      });

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
      const authUserId = (req as AuthenticatedRequest).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });

      const count = await storage.softDeleteAllChats(id);

      const links = await storage.getSharedLinks(id);
      for (const link of links) {
        if (link.resourceType === 'chat') {
          await storage.revokeSharedLink(link.id);
        }
      }

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

  return router;
}
