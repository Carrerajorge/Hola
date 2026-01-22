import { Router } from "express";
import { storage } from "../../storage";
import { llmGateway } from "../../lib/llmGateway";

export const dashboardRouter = Router();

dashboardRouter.get("/", async (req, res) => {
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
            llmGateway.healthCheck().catch(() => ({ xai: { available: false }, gemini: { available: false } }))
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
                scheduled: 0 // scheduledReports not linked in storage.getReports()
            },
            settings: {
                total: settings.length,
                categories: [...new Set(settings.map(s => s.category))].length
            },
            systemHealth: {
                xai: (healthStatus as any)?.xai?.available ?? false,
                gemini: (healthStatus as any)?.gemini?.available ?? false,
                uptime: 99.9
            },
            recentActivity: auditLogs.slice(0, 5)
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});
