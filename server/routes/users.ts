import { Router } from "express";
import crypto from "crypto";
import { storage } from "../storage";
import { db } from "../db";
import { notificationEventTypes, integrationProviders, integrationTools, responsePreferencesSchema, userProfileSchema, featureFlagsSchema } from "@shared/schema";
import { eq } from "drizzle-orm";

export const usersRouter = Router();

usersRouter.get("/notification-event-types", async (req, res) => {
  try {
    const eventTypes = await storage.getNotificationEventTypes();
    res.json(eventTypes);
  } catch (error: any) {
    console.error("Error getting notification event types:", error);
    res.status(500).json({ error: "Failed to get notification event types" });
  }
});

usersRouter.get("/:id/notification-preferences", async (req, res) => {
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

usersRouter.put("/:id/notification-preferences", async (req, res) => {
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

usersRouter.post("/notification-event-types/seed", async (req, res) => {
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

usersRouter.get("/:id/settings", async (req, res) => {
  try {
    const { id } = req.params;
    
    const user = (req as any).user;
    const userId = user?.claims?.sub;
    
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }
    
    if (userId !== id) {
      return res.status(403).json({ error: "Access denied: You can only access your own settings" });
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
          memoryEnabled: true,
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

usersRouter.put("/:id/settings", async (req, res) => {
  try {
    const { id } = req.params;
    
    const user = (req as any).user;
    const userId = user?.claims?.sub;
    
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }
    
    if (userId !== id) {
      return res.status(403).json({ error: "Access denied: You can only update your own settings" });
    }
    
    const { responsePreferences, userProfile, featureFlags } = req.body;
    
    const updates: any = {};
    const validationErrors: string[] = [];
    
    if (responsePreferences !== undefined) {
      const parsed = responsePreferencesSchema.safeParse(responsePreferences);
      if (!parsed.success) {
        validationErrors.push(`responsePreferences: ${parsed.error.errors.map(e => e.message).join(', ')}`);
      } else {
        updates.responsePreferences = parsed.data;
      }
    }
    
    if (userProfile !== undefined) {
      const parsed = userProfileSchema.safeParse(userProfile);
      if (!parsed.success) {
        validationErrors.push(`userProfile: ${parsed.error.errors.map(e => e.message).join(', ')}`);
      } else {
        updates.userProfile = parsed.data;
      }
    }
    
    if (featureFlags !== undefined) {
      const parsed = featureFlagsSchema.safeParse(featureFlags);
      if (!parsed.success) {
        validationErrors.push(`featureFlags: ${parsed.error.errors.map(e => e.message).join(', ')}`);
      } else {
        updates.featureFlags = parsed.data;
      }
    }
    
    if (validationErrors.length > 0) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validationErrors 
      });
    }
    
    const settings = await storage.upsertUserSettings(id, updates);
    res.json(settings);
  } catch (error: any) {
    console.error("Error updating user settings:", error);
    res.status(500).json({ error: "Failed to update user settings" });
  }
});

usersRouter.get("/integrations/providers", async (req, res) => {
  try {
    const providers = await storage.getIntegrationProviders();
    res.json(providers);
  } catch (error: any) {
    console.error("Error getting providers:", error);
    res.status(500).json({ error: "Failed to get providers" });
  }
});

usersRouter.get("/integrations/tools", async (req, res) => {
  try {
    const { providerId } = req.query;
    const tools = await storage.getIntegrationTools(providerId as string | undefined);
    res.json(tools);
  } catch (error: any) {
    console.error("Error getting tools:", error);
    res.status(500).json({ error: "Failed to get tools" });
  }
});

usersRouter.get("/:id/integrations", async (req, res) => {
  try {
    const authUserId = (req as any).user?.claims?.sub;
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

usersRouter.put("/:id/integrations/policy", async (req, res) => {
  try {
    const authUserId = (req as any).user?.claims?.sub;
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

usersRouter.post("/:id/integrations/:provider/connect", async (req, res) => {
  try {
    const authUserId = (req as any).user?.claims?.sub;
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

usersRouter.post("/:id/integrations/:provider/disconnect", async (req, res) => {
  try {
    const authUserId = (req as any).user?.claims?.sub;
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

usersRouter.get("/:id/integrations/logs", async (req, res) => {
  try {
    const authUserId = (req as any).user?.claims?.sub;
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

usersRouter.get("/:id/privacy", async (req, res) => {
  try {
    const authUserId = (req as any).user?.claims?.sub;
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

usersRouter.put("/:id/privacy", async (req, res) => {
  try {
    const authUserId = (req as any).user?.claims?.sub;
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

usersRouter.get("/:id/shared-links", async (req, res) => {
  try {
    const authUserId = (req as any).user?.claims?.sub;
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

usersRouter.post("/:id/shared-links", async (req, res) => {
  try {
    const authUserId = (req as any).user?.claims?.sub;
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

usersRouter.delete("/:id/shared-links/:linkId", async (req, res) => {
  try {
    const authUserId = (req as any).user?.claims?.sub;
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

usersRouter.post("/:id/shared-links/:linkId/rotate", async (req, res) => {
  try {
    const authUserId = (req as any).user?.claims?.sub;
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

usersRouter.patch("/:id/shared-links/:linkId", async (req, res) => {
  try {
    const authUserId = (req as any).user?.claims?.sub;
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

usersRouter.get("/:id/chats/archived", async (req, res) => {
  try {
    const authUserId = (req as any).user?.claims?.sub;
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

usersRouter.post("/:id/chats/:chatId/unarchive", async (req, res) => {
  try {
    const authUserId = (req as any).user?.claims?.sub;
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

usersRouter.post("/:id/chats/archive-all", async (req, res) => {
  try {
    const authUserId = (req as any).user?.claims?.sub;
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

usersRouter.get("/:id/chats/deleted", async (req, res) => {
  try {
    const authUserId = (req as any).user?.claims?.sub;
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

usersRouter.post("/:id/chats/delete-all", async (req, res) => {
  try {
    const authUserId = (req as any).user?.claims?.sub;
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

usersRouter.post("/:id/chats/:chatId/restore", async (req, res) => {
  try {
    const authUserId = (req as any).user?.claims?.sub;
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
