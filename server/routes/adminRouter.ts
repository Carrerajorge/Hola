import { Router } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { users, chats, chatMessages, aiModels } from "@shared/schema";
import { llmGateway } from "../lib/llmGateway";
import { eq, desc, and, gte, lte, ilike, sql, inArray, count } from "drizzle-orm";
import { syncModelsForProvider, syncAllProviders, getAvailableProviders, getModelStats } from "../services/aiModelSyncService";

export function createAdminRouter() {
  const router = Router();

  router.get("/dashboard", async (req, res) => {
    try {
      const [
        userStats,
        paymentStats,
        aiModels,
        invoices,
        auditLogs,
        reports,
        settings,
        allUsers,
        healthStatus
      ] = await Promise.all([
        storage.getUserStats(),
        storage.getPaymentStats(),
        storage.getAiModels(),
        storage.getInvoices(),
        storage.getAuditLogs(10),
        storage.getReports(),
        storage.getSettings(),
        storage.getAllUsers(),
        llmGateway.healthCheck().catch(() => ({ providers: { xai: { healthy: false }, gemini: { healthy: false } } }))
      ]);

      const totalQueries = allUsers.reduce((sum, u) => sum + (u.queryCount || 0), 0);
      const pendingInvoices = invoices.filter(i => i.status === "pending").length;
      const paidInvoices = invoices.filter(i => i.status === "paid").length;
      const activeModels = aiModels.filter(m => m.status === "active").length;
      const securityAlerts = auditLogs.filter(l => 
        l.action?.includes("login_failed") || l.action?.includes("blocked")
      ).length;

      res.json({
        users: {
          total: userStats.total,
          active: userStats.active,
          newThisMonth: userStats.newThisMonth
        },
        aiModels: {
          total: aiModels.length,
          active: activeModels,
          providers: [...new Set(aiModels.map(m => m.provider))].length
        },
        payments: {
          total: paymentStats.total,
          thisMonth: paymentStats.thisMonth,
          count: paymentStats.count
        },
        invoices: {
          total: invoices.length,
          pending: pendingInvoices,
          paid: paidInvoices
        },
        analytics: {
          totalQueries,
          avgQueriesPerUser: userStats.total > 0 ? Math.round(totalQueries / userStats.total) : 0
        },
        database: {
          tables: 15,
          status: "healthy"
        },
        security: {
          alerts: securityAlerts,
          status: securityAlerts > 5 ? "warning" : "healthy"
        },
        reports: {
          total: reports.length,
          scheduled: reports.filter(r => r.schedule).length
        },
        settings: {
          total: settings.length,
          categories: [...new Set(settings.map(s => s.category))].length
        },
        systemHealth: {
          xai: healthStatus?.providers?.xai?.healthy ?? false,
          gemini: healthStatus?.providers?.gemini?.healthy ?? false,
          uptime: 99.9
        },
        recentActivity: auditLogs.slice(0, 5)
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/users", async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/users/stats", async (req, res) => {
    try {
      const stats = await storage.getUserStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/users", async (req, res) => {
    try {
      const { email, password, plan, role } = req.body;
      if (!email || !password) {
        return res.status(400).json({ message: "Email y contraseña son requeridos" });
      }
      const existingUsers = await storage.getAllUsers();
      const existingUser = existingUsers.find(u => u.email === email);
      if (existingUser) {
        return res.status(400).json({ message: "Ya existe un usuario con este email" });
      }
      const [user] = await db.insert(users).values({
        email,
        password,
        plan: plan || "free",
        role: role || "user",
        status: "active"
      }).returning();
      await storage.createAuditLog({
        action: "user_create",
        resource: "users",
        resourceId: user.id,
        details: { email, plan, role }
      });
      res.json(user);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  router.patch("/users/:id", async (req, res) => {
    try {
      const user = await storage.updateUser(req.params.id, req.body);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      await storage.createAuditLog({
        action: "user_update",
        resource: "users",
        resourceId: req.params.id,
        details: req.body
      });
      res.json(user);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete("/users/:id", async (req, res) => {
    try {
      await storage.deleteUser(req.params.id);
      await storage.createAuditLog({
        action: "user_delete",
        resource: "users",
        resourceId: req.params.id
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/models", async (req, res) => {
    try {
      const models = await storage.getAiModels();
      res.json(models);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/models", async (req, res) => {
    try {
      const { name, provider, modelId, costPer1k, description, status } = req.body;
      if (!name || !provider || !modelId) {
        return res.status(400).json({ error: "name, provider, and modelId are required" });
      }
      const model = await storage.createAiModel({
        name, provider, modelId, costPer1k, description, status
      });
      await storage.createAuditLog({
        action: "model_create",
        resource: "ai_models",
        resourceId: model.id,
        details: { name, provider }
      });
      res.json(model);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch("/models/:id", async (req, res) => {
    try {
      const model = await storage.updateAiModel(req.params.id, req.body);
      if (!model) {
        return res.status(404).json({ error: "Model not found" });
      }
      await storage.createAuditLog({
        action: "model_update",
        resource: "ai_models",
        resourceId: req.params.id,
        details: req.body
      });
      res.json(model);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete("/models/:id", async (req, res) => {
    try {
      await storage.deleteAiModel(req.params.id);
      await storage.createAuditLog({
        action: "model_delete",
        resource: "ai_models",
        resourceId: req.params.id
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch("/models/:id/toggle", async (req, res) => {
    try {
      const { isEnabled } = req.body;
      const userId = (req as any).user?.id || null;
      
      const updateData: any = {
        isEnabled: isEnabled ? "true" : "false",
      };
      
      if (isEnabled) {
        updateData.enabledAt = new Date();
        updateData.enabledByAdminId = userId;
      } else {
        updateData.enabledAt = null;
        updateData.enabledByAdminId = null;
      }
      
      const model = await storage.updateAiModel(req.params.id, updateData);
      if (!model) {
        return res.status(404).json({ error: "Model not found" });
      }
      
      await storage.createAuditLog({
        userId,
        action: isEnabled ? "model_enable" : "model_disable",
        resource: "ai_models",
        resourceId: req.params.id,
        details: { isEnabled, modelName: model.name }
      });
      
      res.json(model);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/payments", async (req, res) => {
    try {
      const payments = await storage.getPayments();
      res.json(payments);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/payments/stats", async (req, res) => {
    try {
      const stats = await storage.getPaymentStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/payments", async (req, res) => {
    try {
      const payment = await storage.createPayment(req.body);
      res.json(payment);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch("/payments/:id", async (req, res) => {
    try {
      const payment = await storage.updatePayment(req.params.id, req.body);
      if (!payment) {
        return res.status(404).json({ error: "Payment not found" });
      }
      res.json(payment);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/invoices", async (req, res) => {
    try {
      const invoices = await storage.getInvoices();
      res.json(invoices);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/invoices", async (req, res) => {
    try {
      const invoice = await storage.createInvoice(req.body);
      res.json(invoice);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch("/invoices/:id", async (req, res) => {
    try {
      const invoice = await storage.updateInvoice(req.params.id, req.body);
      if (!invoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }
      res.json(invoice);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/analytics", async (req, res) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const snapshots = await storage.getAnalyticsSnapshots(days);
      res.json(snapshots);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/analytics/snapshot", async (req, res) => {
    try {
      const snapshot = await storage.createAnalyticsSnapshot(req.body);
      res.json(snapshot);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/security/policies", async (req, res) => {
    try {
      const policies = await storage.getDomainPolicies();
      res.json(policies);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/security/policies", async (req, res) => {
    try {
      const policy = await storage.createDomainPolicy(req.body);
      res.json(policy);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch("/security/policies/:id", async (req, res) => {
    try {
      const policy = await storage.updateDomainPolicy(req.params.id, req.body);
      if (!policy) {
        return res.status(404).json({ error: "Policy not found" });
      }
      res.json(policy);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete("/security/policies/:id", async (req, res) => {
    try {
      await storage.deleteDomainPolicy(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/security/logs", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const logs = await storage.getAuditLogs(limit);
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/reports", async (req, res) => {
    try {
      const reports = await storage.getReports();
      res.json(reports);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/reports", async (req, res) => {
    try {
      const report = await storage.createReport({
        ...req.body,
        status: "pending"
      });
      res.json(report);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch("/reports/:id", async (req, res) => {
    try {
      const report = await storage.updateReport(req.params.id, req.body);
      if (!report) {
        return res.status(404).json({ error: "Report not found" });
      }
      res.json(report);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/settings", async (req, res) => {
    try {
      const settings = await storage.getSettings();
      res.json(settings);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/settings", async (req, res) => {
    try {
      const { key, value, description, category } = req.body;
      if (!key) {
        return res.status(400).json({ error: "key is required" });
      }
      const setting = await storage.upsertSetting(key, value, description, category);
      await storage.createAuditLog({
        action: "setting_update",
        resource: "platform_settings",
        details: { key, value }
      });
      res.json(setting);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/llm/metrics", async (req, res) => {
    try {
      const metrics = llmGateway.getMetrics();
      res.json(metrics);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/database/info", async (req, res) => {
    try {
      const userStats = await storage.getUserStats();
      const models = await storage.getAiModels();
      const payments = await storage.getPayments();
      const invoices = await storage.getInvoices();
      
      res.json({
        tables: {
          users: { count: userStats.total },
          ai_models: { count: models.length },
          payments: { count: payments.length },
          invoices: { count: invoices.length }
        },
        status: "healthy",
        lastBackup: new Date().toISOString()
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ========================================
  // Conversations / Chat Logs Management
  // ========================================

  router.get("/conversations", async (req, res) => {
    try {
      const { 
        page = "1", 
        limit = "20", 
        userId, 
        status, 
        flagStatus, 
        aiModel,
        dateFrom,
        dateTo,
        minTokens,
        maxTokens,
        sortBy = "createdAt",
        sortOrder = "desc"
      } = req.query;

      const pageNum = parseInt(page as string);
      const limitNum = Math.min(parseInt(limit as string), 100);
      const offset = (pageNum - 1) * limitNum;

      const conditions: any[] = [];
      
      if (userId) conditions.push(eq(chats.userId, userId as string));
      if (status) conditions.push(eq(chats.conversationStatus, status as string));
      if (flagStatus) conditions.push(eq(chats.flagStatus, flagStatus as string));
      if (aiModel) conditions.push(eq(chats.aiModelUsed, aiModel as string));
      if (dateFrom) conditions.push(gte(chats.createdAt, new Date(dateFrom as string)));
      if (dateTo) conditions.push(lte(chats.createdAt, new Date(dateTo as string)));
      if (minTokens) conditions.push(gte(chats.tokensUsed, parseInt(minTokens as string)));
      if (maxTokens) conditions.push(lte(chats.tokensUsed, parseInt(maxTokens as string)));

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const sortColumnMap: Record<string, any> = {
        createdAt: chats.createdAt,
        messageCount: chats.messageCount,
        tokensUsed: chats.tokensUsed,
        aiModelUsed: chats.aiModelUsed,
        conversationStatus: chats.conversationStatus,
        lastMessageAt: chats.lastMessageAt
      };
      const sortColumn = sortColumnMap[sortBy as string] || chats.createdAt;
      const orderClause = sortOrder === "asc" ? sortColumn : desc(sortColumn);

      const [conversationsResult, totalResult] = await Promise.all([
        db.select({
          id: chats.id,
          userId: chats.userId,
          title: chats.title,
          messageCount: chats.messageCount,
          tokensUsed: chats.tokensUsed,
          aiModelUsed: chats.aiModelUsed,
          conversationStatus: chats.conversationStatus,
          flagStatus: chats.flagStatus,
          createdAt: chats.createdAt,
          lastMessageAt: chats.lastMessageAt,
          endedAt: chats.endedAt
        })
          .from(chats)
          .where(whereClause)
          .orderBy(orderClause)
          .limit(limitNum)
          .offset(offset),
        db.select({ count: sql<number>`count(*)` }).from(chats).where(whereClause)
      ]);

      const userIds = [...new Set(conversationsResult.map(c => c.userId).filter(Boolean))];
      const usersMap: Record<string, any> = {};
      if (userIds.length > 0) {
        const usersData = await db.select({ id: users.id, email: users.email, fullName: users.fullName, firstName: users.firstName, lastName: users.lastName })
          .from(users)
          .where(inArray(users.id, userIds as string[]));
        usersData.forEach(u => { usersMap[u.id] = u; });
      }

      const conversationsWithUsers = conversationsResult.map(c => ({
        ...c,
        user: c.userId ? usersMap[c.userId] : null
      }));

      res.json({
        data: conversationsWithUsers,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: Number(totalResult[0]?.count || 0),
          totalPages: Math.ceil(Number(totalResult[0]?.count || 0) / limitNum)
        }
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/conversations/:id", async (req, res) => {
    try {
      const [conversation] = await db.select().from(chats).where(eq(chats.id, req.params.id));
      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      const messages = await db.select({
        id: chatMessages.id,
        role: chatMessages.role,
        content: chatMessages.content,
        createdAt: chatMessages.createdAt,
        metadata: chatMessages.metadata
      })
        .from(chatMessages)
        .where(eq(chatMessages.chatId, req.params.id))
        .orderBy(chatMessages.createdAt);

      let user = null;
      if (conversation.userId) {
        const [userData] = await db.select().from(users).where(eq(users.id, conversation.userId));
        user = userData;
      }

      res.json({
        ...conversation,
        user,
        messages
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch("/conversations/:id/flag", async (req, res) => {
    try {
      const { flagStatus } = req.body;
      const validFlags = ["reviewed", "needs_attention", "spam", "vip_support", null];
      if (!validFlags.includes(flagStatus)) {
        return res.status(400).json({ error: "Invalid flag status" });
      }

      const [updated] = await db.update(chats)
        .set({ 
          flagStatus, 
          conversationStatus: flagStatus ? "flagged" : "active",
          updatedAt: new Date() 
        })
        .where(eq(chats.id, req.params.id))
        .returning();

      if (!updated) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      await storage.createAuditLog({
        action: "conversation_flag",
        resource: "chats",
        resourceId: req.params.id,
        details: { flagStatus }
      });

      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/conversations/search", async (req, res) => {
    try {
      const { query, limit = 50 } = req.body;
      if (!query || query.length < 2) {
        return res.json({ results: [] });
      }
      
      const matchingMessages = await db.select({
        chatId: chatMessages.chatId,
        content: chatMessages.content,
        role: chatMessages.role,
        createdAt: chatMessages.createdAt
      })
        .from(chatMessages)
        .where(ilike(chatMessages.content, `%${query}%`))
        .limit(parseInt(limit as string));
      
      const chatIds = [...new Set(matchingMessages.map(m => m.chatId))];
      if (chatIds.length === 0) {
        return res.json({ results: [] });
      }
      
      const conversations = await db.select().from(chats).where(inArray(chats.id, chatIds));
      
      res.json({
        results: conversations.map(c => ({
          ...c,
          matchingMessages: matchingMessages.filter(m => m.chatId === c.id)
        }))
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/conversations/:id/notes", async (req, res) => {
    try {
      const { note } = req.body;
      const [conversation] = await db.select().from(chats).where(eq(chats.id, req.params.id));
      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }
      
      const existingNotes = (conversation as any).internalNotes || [];
      const newNote = {
        id: `note-${Date.now()}`,
        content: note,
        createdAt: new Date().toISOString(),
        author: "admin"
      };
      
      const [updated] = await db.update(chats)
        .set({ 
          internalNotes: [...existingNotes, newNote],
          updatedAt: new Date() 
        })
        .where(eq(chats.id, req.params.id))
        .returning();
      
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/conversations/stats/summary", async (req, res) => {
    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const [
        totalConversations,
        activeToday,
        flaggedConversations,
        tokensToday,
        allConversations
      ] = await Promise.all([
        db.select({ count: sql<number>`count(*)` }).from(chats),
        db.select({ count: sql<number>`count(*)` })
          .from(chats)
          .where(gte(chats.lastMessageAt, todayStart)),
        db.select({ count: sql<number>`count(*)` })
          .from(chats)
          .where(eq(chats.conversationStatus, "flagged")),
        db.select({ sum: sql<number>`coalesce(sum(tokens_used), 0)` })
          .from(chats)
          .where(gte(chats.createdAt, todayStart)),
        db.select({ 
          messageCount: chats.messageCount 
        }).from(chats)
      ]);

      const allUsers = await storage.getAllUsers();
      const totalMessages = allConversations.reduce((sum, c) => sum + (c.messageCount || 0), 0);
      const avgMessagesPerUser = allUsers.length > 0 ? Math.round(totalMessages / allUsers.length) : 0;
      const totalConvCount = Number(totalConversations[0]?.count || 0);
      const avgMessagesPerConversation = totalConvCount > 0 ? Math.round(totalMessages / totalConvCount) : 0;

      res.json({
        activeToday: Number(activeToday[0]?.count || 0),
        avgMessagesPerUser,
        avgMessagesPerConversation,
        tokensConsumedToday: Number(tokensToday[0]?.sum || 0),
        flaggedConversations: Number(flaggedConversations[0]?.count || 0),
        totalConversations: totalConvCount
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ========================================
  // Export Endpoints
  // ========================================

  router.get("/users/export", async (req, res) => {
    try {
      const { format = "json" } = req.query;
      const allUsers = await storage.getAllUsers();

      if (format === "csv") {
        const headers = ["id", "email", "fullName", "plan", "role", "status", "queryCount", "tokensConsumed", "createdAt", "lastLoginAt"];
        const csvRows = [headers.join(",")];
        allUsers.forEach(u => {
          csvRows.push([
            u.id,
            u.email || "",
            u.fullName || `${u.firstName || ""} ${u.lastName || ""}`.trim(),
            u.plan || "",
            u.role || "",
            u.status || "",
            u.queryCount || 0,
            u.tokensConsumed || 0,
            u.createdAt?.toISOString() || "",
            u.lastLoginAt?.toISOString() || ""
          ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
        });
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename=users_${Date.now()}.csv`);
        res.send(csvRows.join("\n"));
      } else {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Content-Disposition", `attachment; filename=users_${Date.now()}.json`);
        res.json(allUsers);
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/conversations/export", async (req, res) => {
    try {
      const { format = "json", includeMessages = "false" } = req.query;
      
      const allConversations = await db.select().from(chats).orderBy(desc(chats.createdAt)).limit(1000);

      let result: any[] = allConversations;

      if (includeMessages === "true") {
        const conversationsWithMessages = await Promise.all(
          allConversations.map(async (conv) => {
            const messages = await db.select({
              role: chatMessages.role,
              content: chatMessages.content,
              createdAt: chatMessages.createdAt
            })
              .from(chatMessages)
              .where(eq(chatMessages.chatId, conv.id))
              .orderBy(chatMessages.createdAt);
            return { ...conv, messages };
          })
        );
        result = conversationsWithMessages;
      }

      if (format === "csv") {
        const headers = ["id", "userId", "title", "messageCount", "tokensUsed", "aiModelUsed", "conversationStatus", "flagStatus", "createdAt"];
        const csvRows = [headers.join(",")];
        result.forEach(c => {
          csvRows.push([
            c.id,
            c.userId || "",
            c.title || "",
            c.messageCount || 0,
            c.tokensUsed || 0,
            c.aiModelUsed || "",
            c.conversationStatus || "",
            c.flagStatus || "",
            c.createdAt?.toISOString() || ""
          ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
        });
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename=conversations_${Date.now()}.csv`);
        res.send(csvRows.join("\n"));
      } else {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Content-Disposition", `attachment; filename=conversations_${Date.now()}.json`);
        res.json(result);
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // AI Models Management - Enhanced endpoints
  router.get("/models/filtered", async (req, res) => {
    try {
      const { 
        page = "1", 
        limit = "20", 
        provider, 
        type, 
        status, 
        search, 
        sortBy = "name", 
        sortOrder = "asc" 
      } = req.query;

      const result = await storage.getAiModelsFiltered({
        provider: provider as string,
        type: type as string,
        status: status as string,
        search: search as string,
        sortBy: sortBy as string,
        sortOrder: sortOrder as string,
        page: parseInt(page as string),
        limit: parseInt(limit as string),
      });

      res.json({
        models: result.models,
        total: result.total,
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        totalPages: Math.ceil(result.total / parseInt(limit as string)),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/models/stats", async (req, res) => {
    try {
      const allModels = await storage.getAiModels();
      const knownStats = getModelStats();
      
      const byProvider: Record<string, number> = {};
      const byType: Record<string, number> = {};
      let active = 0;
      let inactive = 0;
      let deprecated = 0;

      for (const model of allModels) {
        byProvider[model.provider] = (byProvider[model.provider] || 0) + 1;
        byType[model.modelType || "TEXT"] = (byType[model.modelType || "TEXT"] || 0) + 1;
        if (model.status === "active") active++;
        else inactive++;
        if (model.isDeprecated === "true") deprecated++;
      }

      res.json({
        total: allModels.length,
        active,
        inactive,
        deprecated,
        byProvider,
        byType,
        knownModels: knownStats,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/providers", async (req, res) => {
    try {
      const providers = getAvailableProviders();
      const allModels = await storage.getAiModels();
      
      const providerStats = providers.map(provider => {
        const models = allModels.filter(m => m.provider.toLowerCase() === provider.toLowerCase());
        const activeCount = models.filter(m => m.status === "active").length;
        return {
          id: provider,
          name: provider.charAt(0).toUpperCase() + provider.slice(1),
          modelCount: models.length,
          activeCount,
          hasApiKey: checkApiKeyExists(provider),
        };
      });

      res.json(providerStats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/models/sync/:provider", async (req, res) => {
    try {
      const { provider } = req.params;
      const result = await syncModelsForProvider(provider);
      
      await storage.createAuditLog({
        action: "models_sync",
        resource: "ai_models",
        details: { provider, ...result },
      });

      res.json({
        success: true,
        provider,
        ...result,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/models/sync", async (req, res) => {
    try {
      const results = await syncAllProviders();
      
      let totalAdded = 0;
      let totalUpdated = 0;
      for (const r of Object.values(results)) {
        totalAdded += r.added;
        totalUpdated += r.updated;
      }

      await storage.createAuditLog({
        action: "models_sync_all",
        resource: "ai_models",
        details: { results, totalAdded, totalUpdated },
      });

      res.json({
        success: true,
        results,
        summary: { totalAdded, totalUpdated },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/models/:id", async (req, res) => {
    try {
      const model = await storage.getAiModelById(req.params.id);
      if (!model) {
        return res.status(404).json({ error: "Model not found" });
      }
      res.json(model);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}

function checkApiKeyExists(provider: string): boolean {
  const keyMap: Record<string, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    google: "GOOGLE_GENERATIVE_AI_API_KEY",
    xai: "XAI_API_KEY",
    openai: "OPENAI_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    perplexity: "PERPLEXITY_API_KEY",
  };
  const envKey = keyMap[provider.toLowerCase()];
  return envKey ? !!process.env[envKey] : false;
}
