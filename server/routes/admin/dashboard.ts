import { Router } from "express";
import { storage } from "../../storage";
import { llmGateway } from "../../lib/llmGateway";
import { getRealtimeMetrics, getExtendedDashboardStats } from "../../services/realtimeMetrics";
import { dbRead } from "../../db";
import { auditLogs, chats, generatedReports, invoices, platformSettings, scheduledReports, users } from "@shared/schema";
import { and, desc, eq, gte, ilike, or, sql } from "drizzle-orm";

export const dashboardRouter = Router();

// GET /api/admin/dashboard/realtime - Real-time metrics endpoint
dashboardRouter.get("/realtime", async (req, res) => {
    try {
        const metrics = await getRealtimeMetrics();
        res.json(metrics);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/admin/dashboard/extended - Extended stats with trends
dashboardRouter.get("/extended", async (req, res) => {
    try {
        const stats = await getExtendedDashboardStats();
        res.json(stats);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

dashboardRouter.get("/", async (req, res) => {
    try {
        const [
            userStats,
            paymentStats,
            aiModels,
            invoiceStats,
            queryStats,
            recentAuditLogs,
            reportStats,
            scheduledReportStats,
            settingsStats,
            securityAlerts24h,
            healthStatus
        ] = await Promise.all([
            storage.getUserStats(),
            storage.getPaymentStats(),
            storage.getAiModels(),
            dbRead.select({
                total: sql<number>`count(*)`,
                pending: sql<number>`count(*) filter (where ${invoices.status} = 'pending')`,
                paid: sql<number>`count(*) filter (where ${invoices.status} = 'paid')`,
            }).from(invoices),
            dbRead.select({
                totalQueries: sql<number>`coalesce(sum(${users.queryCount}), 0)`,
            }).from(users),
            storage.getAuditLogs(10),
            dbRead.select({ total: sql<number>`count(*)` }).from(generatedReports),
            dbRead.select({
                total: sql<number>`count(*)`,
                active: sql<number>`count(*) filter (where ${scheduledReports.isActive} = 'true')`,
            }).from(scheduledReports),
            dbRead.select({
                total: sql<number>`count(*)`,
                categories: sql<number>`count(distinct ${platformSettings.category})`,
            }).from(platformSettings),
            dbRead.select({ count: sql<number>`count(*)` })
                .from(auditLogs)
                .where(and(
                    gte(auditLogs.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
                    or(
                        ilike(auditLogs.action, "%login_failed%"),
                        ilike(auditLogs.action, "%blocked%"),
                        ilike(auditLogs.action, "%rate_limit%"),
                        ilike(auditLogs.action, "%unauthorized%")
                    )
                )),
            llmGateway.healthCheck().catch(() => ({
                xai: { available: false },
                gemini: { available: false },
                openai: { available: false },
                anthropic: { available: false },
                deepseek: { available: false },
            }))
        ]);

        const totalQueries = Number(queryStats[0]?.totalQueries || 0);
        const pendingInvoices = Number(invoiceStats[0]?.pending || 0);
        const paidInvoices = Number(invoiceStats[0]?.paid || 0);
        const totalInvoices = Number(invoiceStats[0]?.total || 0);
        const activeModels = aiModels.filter(m => m.status === "active").length;
        const securityAlerts = Number(securityAlerts24h[0]?.count || 0);
        const totalReports = Number(reportStats[0]?.total || 0);
        const activeScheduledReports = Number((scheduledReportStats as any)?.[0]?.active || 0);
        const totalSettings = Number(settingsStats[0]?.total || 0);
        const settingsCategories = Number(settingsStats[0]?.categories || 0);

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
                total: totalInvoices,
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
                total: totalReports,
                scheduled: activeScheduledReports
            },
            settings: {
                total: totalSettings,
                categories: settingsCategories
            },
            systemHealth: {
                xai: (healthStatus as any)?.xai?.available ?? false,
                gemini: (healthStatus as any)?.gemini?.available ?? false,
                openai: (healthStatus as any)?.openai?.available ?? false,
                anthropic: (healthStatus as any)?.anthropic?.available ?? false,
                deepseek: (healthStatus as any)?.deepseek?.available ?? false,
                uptime: 99.9
            },
            recentActivity: recentAuditLogs.slice(0, 5)
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/admin/dashboard/new-users - Recent user registrations
dashboardRouter.get("/new-users", async (req, res) => {
    try {
        const { hours = "24", limit = "200" } = req.query as Record<string, string>;
        const hoursNum = parseInt(hours as string, 10) || 24;
        const since = new Date(Date.now() - hoursNum * 60 * 60 * 1000);
        const limitNum = Math.min(Math.max(parseInt(limit as string, 10) || 200, 1), 1000);

        const newUsers = await dbRead
            .select({
                id: users.id,
                email: users.email,
                fullName: users.fullName,
                authProvider: users.authProvider,
                createdAt: users.createdAt,
                status: users.status,
            })
            .from(users)
            .where(gte(users.createdAt, since))
            .orderBy(desc(users.createdAt))
            .limit(limitNum);

        res.json({
            newUsers,
            count: newUsers.length,
            since: since.toISOString(),
            hoursAgo: hoursNum
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/admin/dashboard/active-sessions - Currently active users
dashboardRouter.get("/active-sessions", async (req, res) => {
    try {
        const { minutes = "15", limit = "200" } = req.query as Record<string, string>;
        const now = Date.now();
        const minutesNum = Math.min(Math.max(parseInt(minutes as string, 10) || 15, 1), 1440);
        const limitNum = Math.min(Math.max(parseInt(limit as string, 10) || 200, 1), 1000);
        const since = new Date(now - minutesNum * 60 * 1000);

        const activeSessions = await dbRead
            .select({
                id: users.id,
                email: users.email,
                fullName: users.fullName,
                lastLoginAt: users.lastLoginAt,
                plan: users.plan,
            })
            .from(users)
            .where(gte(users.lastLoginAt, since))
            .orderBy(desc(users.lastLoginAt))
            .limit(limitNum);

        res.json({
            activeSessions,
            count: activeSessions.length,
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/admin/dashboard/user-activity - User activity summary
dashboardRouter.get("/user-activity", async (req, res) => {
    try {
        const { userId } = req.query;
        
        if (!userId) {
            return res.status(400).json({ error: "userId required" });
        }

        const user = await storage.getUser(userId as string);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const [conversationStats, recentConversations, recentAuditLogs] = await Promise.all([
            dbRead.select({ count: sql<number>`count(*)` }).from(chats).where(eq(chats.userId, userId as string)),
            dbRead.select({
                id: chats.id,
                title: chats.title,
                createdAt: chats.createdAt,
                updatedAt: chats.updatedAt,
                lastMessageAt: chats.lastMessageAt,
                messageCount: chats.messageCount,
                tokensUsed: chats.tokensUsed,
            })
                .from(chats)
                .where(eq(chats.userId, userId as string))
                .orderBy(desc(chats.updatedAt))
                .limit(10),
            dbRead.select()
                .from(auditLogs)
                .where(or(eq(auditLogs.userId, userId as string), eq(auditLogs.resourceId, userId as string)))
                .orderBy(desc(auditLogs.createdAt))
                .limit(20),
        ]);

        res.json({
            user: {
                id: user.id,
                email: user.email,
                fullName: user.fullName,
                plan: user.plan,
                status: user.status,
                createdAt: user.createdAt,
                lastLoginAt: user.lastLoginAt,
                queryCount: user.queryCount,
                tokensConsumed: user.tokensConsumed
            },
            activity: {
                conversationCount: Number(conversationStats[0]?.count || 0),
                recentConversations,
                recentAuditLogs: recentAuditLogs.slice(0, 10)
            }
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Import admin notifications
import { adminNotifications } from "../../services/adminNotifications";

// GET /api/admin/dashboard/notifications - Get admin notifications
dashboardRouter.get("/notifications", async (req, res) => {
    try {
        const { includeRead = "true" } = req.query;
        const notifications = adminNotifications.getAll(includeRead === "true");
        res.json({
            notifications,
            unreadCount: adminNotifications.getUnreadCount()
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/admin/dashboard/notifications/:id/read - Mark notification as read
dashboardRouter.post("/notifications/:id/read", async (req, res) => {
    try {
        const success = adminNotifications.markAsRead(req.params.id);
        res.json({ success });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/admin/dashboard/notifications/read-all - Mark all as read
dashboardRouter.post("/notifications/read-all", async (req, res) => {
    try {
        const count = adminNotifications.markAllAsRead();
        res.json({ success: true, markedRead: count });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/admin/dashboard/notifications/:id - Delete notification
dashboardRouter.delete("/notifications/:id", async (req, res) => {
    try {
        const success = adminNotifications.delete(req.params.id);
        res.json({ success });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});
