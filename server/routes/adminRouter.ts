import { Router } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { users } from "@shared/schema";
import { llmGateway } from "../lib/llmGateway";

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

  return router;
}
