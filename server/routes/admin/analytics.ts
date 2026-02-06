import { Router } from "express";
import { storage } from "../../storage";
import { llmGateway } from "../../lib/llmGateway";
import { dbRead } from "../../db";
import { payments, users } from "@shared/schema";
import { and, eq, gte, sql } from "drizzle-orm";

export const analyticsRouter = Router();

analyticsRouter.get("/", async (req, res) => {
    try {
        const days = parseInt(req.query.days as string) || 30;
        const snapshots = await storage.getAnalyticsSnapshots(days);
        res.json(snapshots);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

analyticsRouter.post("/snapshot", async (req, res) => {
    try {
        const snapshot = await storage.createAnalyticsSnapshot(req.body);
        res.json(snapshot);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

analyticsRouter.get("/kpi", async (req, res) => {
    try {
        const latestSnapshot = await storage.getLatestKpiSnapshot();
        const [userStats, paymentStats] = await Promise.all([
            storage.getUserStats(),
            storage.getPaymentStats()
        ]);

        // Map to frontend expected structure
        res.json({
            activeUsers: latestSnapshot?.activeUsersNow ?? userStats.active ?? 0,
            queriesPerMinute: latestSnapshot?.queriesPerMinute ?? 0,
            tokensConsumed: latestSnapshot?.tokensConsumedToday ?? 0,
            revenueToday: latestSnapshot?.revenueToday ?? paymentStats.thisMonth ?? 0,
            avgLatency: latestSnapshot?.avgLatencyMs ?? 0,
            errorRate: parseFloat(latestSnapshot?.errorRatePercentage?.toString() ?? "0"),
            activeUsersTrend: latestSnapshot?.activeUsersNow ? (latestSnapshot.activeUsersNow > 0 ? "up" : "neutral") : "neutral",
            queriesTrend: latestSnapshot?.queriesPerMinute ? (latestSnapshot.queriesPerMinute > 5 ? "up" : "neutral") : "neutral",
            tokensTrend: "up",
            revenueTrend: "up",
            latencyTrend: latestSnapshot?.avgLatencyMs ? (latestSnapshot.avgLatencyMs > 1000 ? "down" : "up") : "neutral",
            errorRateTrend: latestSnapshot?.errorRatePercentage ? (parseFloat(latestSnapshot.errorRatePercentage.toString()) > 5 ? "down" : "up") : "up",
            updatedAt: latestSnapshot?.createdAt ?? new Date()
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

analyticsRouter.get("/kpis", async (req, res) => {
    try {
        const latestSnapshot = await storage.getLatestKpiSnapshot();

        if (!latestSnapshot) {
            const [userStats, paymentStats] = await Promise.all([
                storage.getUserStats(),
                storage.getPaymentStats()
            ]);

            return res.json({
                activeUsersNow: userStats.active,
                queriesPerMinute: 0,
                tokensConsumedToday: 0,
                revenueToday: paymentStats.thisMonth || "0.00",
                avgLatencyMs: 0,
                errorRatePercentage: "0.00",
                createdAt: new Date()
            });
        }

        res.json(latestSnapshot);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

analyticsRouter.get("/charts", async (req, res) => {
    try {
        const granularity = (req.query.granularity as string) || "24h";
        const validGranularities = ["1h", "24h", "7d", "30d", "90d", "1y"];
        if (!validGranularities.includes(granularity)) {
            return res.status(400).json({ error: `Invalid granularity. Valid values: ${validGranularities.join(", ")}` });
        }

        const intervalMap: Record<string, number> = {
            "1h": 1 * 60 * 60 * 1000,
            "24h": 24 * 60 * 60 * 1000,
            "7d": 7 * 24 * 60 * 60 * 1000,
            "30d": 30 * 24 * 60 * 60 * 1000,
            "90d": 90 * 24 * 60 * 60 * 1000,
            "1y": 365 * 24 * 60 * 60 * 1000,
        };

        const startDate = new Date(Date.now() - intervalMap[granularity]);
        const endDate = new Date();

        // Fetch data for all charts in parallel
        const [userGrowthData, revenueRows, providerMetrics] = await Promise.all([
            storage.getUserGrowthData(granularity as '1h' | '24h' | '7d' | '30d' | '90d' | '1y'),
            dbRead.select({
                day: sql`date_trunc('day', ${payments.createdAt})`,
                amount: sql<string>`coalesce(sum(nullif(${payments.amount}, '')::numeric), 0)::text`,
            })
                .from(payments)
                .where(and(
                    gte(payments.createdAt, startDate),
                    eq(payments.status, "completed")
                ))
                .groupBy(sql`date_trunc('day', ${payments.createdAt})`)
                .orderBy(sql`date_trunc('day', ${payments.createdAt})`),
            storage.getProviderMetrics(undefined, startDate, endDate)
        ]);

        // Revenue trend (DB-aggregated; avoids loading all payments into memory)
        const revenueTrend = (revenueRows || []).map((r: any) => ({
            date: new Date(r.day).toISOString().split("T")[0],
            amount: parseFloat(r.amount || "0"),
        }));

        // Model usage grouped by date
        const modelUsageMap = new Map<string, Record<string, number>>();
        providerMetrics.forEach(m => {
            const dateKey = new Date(m.windowStart).toISOString().split("T")[0];
            if (!modelUsageMap.has(dateKey)) {
                modelUsageMap.set(dateKey, {});
            }
            const entry = modelUsageMap.get(dateKey)!;
            entry[m.provider] = (entry[m.provider] || 0) + (m.totalRequests || 0);
        });
        const modelUsage = Array.from(modelUsageMap.entries()).map(([date, providers]) => ({ date, ...providers }));

        // Latency by provider
        const latencyByProvider = providerMetrics.map(m => ({
            provider: m.provider,
            date: new Date(m.windowStart).toISOString().split("T")[0],
            avgLatency: m.avgLatency || 0,
            p95Latency: m.p95Latency || 0
        }));

        // Error rate
        const errorRate = providerMetrics.map(m => ({
            provider: m.provider,
            date: new Date(m.windowStart).toISOString().split("T")[0],
            errorCount: m.errorCount || 0,
            totalRequests: m.totalRequests || 0,
            errorRate: m.totalRequests ? ((m.errorCount || 0) / m.totalRequests * 100) : 0
        }));

        // Token consumption grouped by date
        const tokenMap = new Map<string, Record<string, number>>();
        providerMetrics.forEach(m => {
            const dateKey = new Date(m.windowStart).toISOString().split("T")[0];
            if (!tokenMap.has(dateKey)) {
                tokenMap.set(dateKey, {});
            }
            const entry = tokenMap.get(dateKey)!;
            entry[m.provider] = (entry[m.provider] || 0) + ((m.tokensIn || 0) + (m.tokensOut || 0));
        });
        const tokenConsumption = Array.from(tokenMap.entries()).map(([date, providers]) => ({ date, ...providers }));

        res.json({
            userGrowth: userGrowthData,
            revenueTrend,
            modelUsage,
            latencyByProvider,
            errorRate,
            tokenConsumption
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

analyticsRouter.get("/charts/:chartType", async (req, res) => {
    try {
        const { chartType } = req.params;
        const granularity = (req.query.granularity as string) || "24h";

        const validChartTypes = ["userGrowth", "revenue", "modelUsage", "latency", "errors", "tokens"];
        if (!validChartTypes.includes(chartType)) {
            return res.status(400).json({ error: `Invalid chartType. Valid types: ${validChartTypes.join(", ")}` });
        }

        const validGranularities = ["1h", "24h", "7d", "30d", "90d", "1y"];
        if (!validGranularities.includes(granularity)) {
            return res.status(400).json({ error: `Invalid granularity. Valid values: ${validGranularities.join(", ")}` });
        }

        const intervalMap: Record<string, number> = {
            "1h": 1 * 60 * 60 * 1000,
            "24h": 24 * 60 * 60 * 1000,
            "7d": 7 * 24 * 60 * 60 * 1000,
            "30d": 30 * 24 * 60 * 60 * 1000,
            "90d": 90 * 24 * 60 * 60 * 1000,
            "1y": 365 * 24 * 60 * 60 * 1000,
        };

        const startDate = new Date(Date.now() - intervalMap[granularity]);
        const endDate = new Date();

        let data: any[] = [];

        switch (chartType) {
            case "userGrowth":
                data = await storage.getUserGrowthData(granularity as '1h' | '24h' | '7d' | '30d' | '90d' | '1y');
                break;

            case "revenue":
                const revenueRows = await dbRead.select({
                    day: sql`date_trunc('day', ${payments.createdAt})`,
                    amount: sql<string>`coalesce(sum(nullif(${payments.amount}, '')::numeric), 0)::text`,
                })
                    .from(payments)
                    .where(and(
                        gte(payments.createdAt, startDate),
                        eq(payments.status, "completed")
                    ))
                    .groupBy(sql`date_trunc('day', ${payments.createdAt})`)
                    .orderBy(sql`date_trunc('day', ${payments.createdAt})`);
                data = (revenueRows || []).map((r: any) => ({
                    date: new Date(r.day).toISOString().split("T")[0],
                    amount: parseFloat(r.amount || "0"),
                }));
                break;

            case "modelUsage":
                const providerMetrics = await storage.getProviderMetrics(undefined, startDate, endDate);
                data = providerMetrics.map(m => ({
                    provider: m.provider,
                    date: m.windowStart,
                    totalRequests: m.totalRequests,
                    tokensIn: m.tokensIn,
                    tokensOut: m.tokensOut
                }));
                break;

            case "latency":
                const latencyMetrics = await storage.getProviderMetrics(undefined, startDate, endDate);
                data = latencyMetrics.map(m => ({
                    provider: m.provider,
                    date: m.windowStart,
                    avgLatency: m.avgLatency,
                    p50Latency: m.p50Latency,
                    p95Latency: m.p95Latency,
                    p99Latency: m.p99Latency
                }));
                break;

            case "errors":
                const errorMetrics = await storage.getProviderMetrics(undefined, startDate, endDate);
                data = errorMetrics.map(m => ({
                    provider: m.provider,
                    date: m.windowStart,
                    errorCount: m.errorCount,
                    totalRequests: m.totalRequests,
                    errorRate: m.totalRequests ? ((m.errorCount || 0) / m.totalRequests * 100).toFixed(2) : "0.00"
                }));
                break;

            case "tokens":
                const tokenMetrics = await storage.getProviderMetrics(undefined, startDate, endDate);
                data = tokenMetrics.map(m => ({
                    provider: m.provider,
                    date: m.windowStart,
                    tokensIn: m.tokensIn,
                    tokensOut: m.tokensOut,
                    totalTokens: (m.tokensIn || 0) + (m.tokensOut || 0)
                }));
                break;
        }

        res.json({
            chartType,
            granularity,
            startDate,
            endDate,
            data
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

analyticsRouter.get("/performance", async (req, res) => {
    try {
        const latestMetrics = await storage.getLatestProviderMetrics();

        const performanceData = latestMetrics.map(m => ({
            provider: m.provider,
            avgLatency: m.avgLatency || 0,
            p50: m.p50Latency || 0,
            p95: m.p95Latency || 0,
            p99: m.p99Latency || 0,
            successRate: parseFloat(m.successRate || "100"),
            totalRequests: m.totalRequests || 0,
            errorCount: m.errorCount || 0,
            status: parseFloat(m.successRate || "100") >= 99 ? "healthy" :
                parseFloat(m.successRate || "100") >= 95 ? "degraded" : "critical",
            windowStart: m.windowStart,
            windowEnd: m.windowEnd
        }));

        res.json(performanceData);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

analyticsRouter.get("/costs", async (req, res) => {
    try {
        const budgets = await storage.getCostBudgets();

        const costsWithAlerts = budgets.map(b => {
            const currentSpend = parseFloat(b.currentSpend || "0");
            const budgetLimit = parseFloat(b.budgetLimit || "100");
            const alertThreshold = b.alertThreshold || 80;
            const usagePercent = budgetLimit > 0 ? (currentSpend / budgetLimit) * 100 : 0;

            return {
                provider: b.provider,
                budgetLimit: b.budgetLimit,
                currentSpend: b.currentSpend,
                projectedMonthly: b.projectedMonthly,
                usagePercent: usagePercent.toFixed(2),
                alertThreshold: b.alertThreshold,
                isOverBudget: currentSpend >= budgetLimit,
                isNearThreshold: usagePercent >= alertThreshold,
                alertFlag: currentSpend >= budgetLimit ? "critical" :
                    usagePercent >= alertThreshold ? "warning" : "ok",
                periodStart: b.periodStart,
                periodEnd: b.periodEnd
            };
        });

        res.json(costsWithAlerts);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

analyticsRouter.get("/funnel", async (req, res) => {
    try {
        const eventStats = await storage.getAnalyticsEventStats();

        const [row] = await dbRead
            .select({
                signups: sql<number>`count(*)`,
                activeUsers: sql<number>`count(*) filter (where ${users.status} = 'active')`,
                trialUsers: sql<number>`count(*) filter (where ${users.plan} = 'free' and ${users.status} = 'active')`,
                proUsers: sql<number>`count(*) filter (where ${users.plan} = 'pro')`,
                enterpriseUsers: sql<number>`count(*) filter (where ${users.plan} = 'enterprise')`,
            })
            .from(users);

        const signups = Number(row?.signups || 0);
        const activeUsers = Number(row?.activeUsers || 0);
        const trialUsers = Number(row?.trialUsers || 0);
        const proUsers = Number(row?.proUsers || 0);
        const enterpriseUsers = Number(row?.enterpriseUsers || 0);

        const visitors = eventStats["page_view"] || signups * 3;

        const funnel = [
            { stage: "visitors", count: visitors, percentage: 100 },
            { stage: "signups", count: signups, percentage: visitors > 0 ? ((signups / visitors) * 100).toFixed(2) : "0.00" },
            { stage: "active", count: activeUsers, percentage: visitors > 0 ? ((activeUsers / visitors) * 100).toFixed(2) : "0.00" },
            { stage: "trial", count: trialUsers, percentage: visitors > 0 ? ((trialUsers / visitors) * 100).toFixed(2) : "0.00" },
            { stage: "pro", count: proUsers, percentage: visitors > 0 ? ((proUsers / visitors) * 100).toFixed(2) : "0.00" },
            { stage: "enterprise", count: enterpriseUsers, percentage: visitors > 0 ? ((enterpriseUsers / visitors) * 100).toFixed(2) : "0.00" }
        ];

        const conversionRates = {
            visitorsToSignups: visitors > 0 ? ((signups / visitors) * 100).toFixed(2) : "0.00",
            signupsToActive: signups > 0 ? ((activeUsers / signups) * 100).toFixed(2) : "0.00",
            activeToPro: activeUsers > 0 ? ((proUsers / activeUsers) * 100).toFixed(2) : "0.00",
            proToEnterprise: proUsers > 0 ? ((enterpriseUsers / proUsers) * 100).toFixed(2) : "0.00"
        };

        res.json({ funnel, conversionRates });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

analyticsRouter.get("/logs", async (req, res) => {
    try {
        const {
            page = "1",
            limit = "50",
            provider,
            status,
            model,
            dateFrom,
            dateTo
        } = req.query;

        const pageNum = parseInt(page as string);
        const limitNum = Math.min(parseInt(limit as string), 100);

        const filters: any = {
            page: pageNum,
            limit: limitNum
        };

        if (provider) filters.provider = provider as string;
        if (status) filters.statusCode = parseInt(status as string);
        if (dateFrom) filters.startDate = new Date(dateFrom as string);
        if (dateTo) filters.endDate = new Date(dateTo as string);

        const { logs, total } = await storage.getApiLogs(filters);

        let filteredLogs = logs;
        if (model) {
            filteredLogs = logs.filter(l => l.model === model);
        }

        res.json({
            data: filteredLogs,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum)
            }
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

analyticsRouter.get("/heatmap", async (req, res) => {
    try {
        const { logs } = await storage.getApiLogs({
            limit: 10000,
            startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        });

        const heatmapData: number[][] = Array(7).fill(null).map(() => Array(24).fill(0));

        for (const log of logs) {
            if (log.createdAt) {
                const date = new Date(log.createdAt);
                const dayOfWeek = date.getDay();
                const hour = date.getHours();
                heatmapData[dayOfWeek][hour]++;
            }
        }

        const maxValue = Math.max(...heatmapData.flat());
        const normalizedData = heatmapData.map(row =>
            row.map(val => maxValue > 0 ? parseFloat((val / maxValue).toFixed(3)) : 0)
        );

        const dayLabels = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const hourLabels = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, "0")}:00`);

        res.json({
            data: heatmapData,
            normalizedData,
            dayLabels,
            hourLabels,
            maxValue,
            periodDays: 7
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

analyticsRouter.get("/llm/metrics", async (req, res) => {
    try {
        const metrics = llmGateway.getMetrics();
        res.json(metrics);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Import analytics tracker
import { analyticsTracker } from "../../services/analyticsTracker";

// GET /api/admin/analytics/realtime - Real-time metrics
analyticsRouter.get("/realtime", async (req, res) => {
    try {
        const metrics = analyticsTracker.getRealTimeMetrics();
        res.json(metrics);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/admin/analytics/sessions/active - Active sessions
analyticsRouter.get("/sessions/active", async (req, res) => {
    try {
        const minutes = parseInt(req.query.minutes as string) || 5;
        const sessions = analyticsTracker.getActiveSessions(minutes);
        res.json({
            sessions,
            count: sessions.length
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/admin/analytics/track - Track event (for frontend)
analyticsRouter.post("/track", async (req, res) => {
    try {
        const { eventType, sessionId, page, action, metadata } = req.body;
        const userId = (req as any).user?.id;
        
        if (eventType === "page_view") {
            analyticsTracker.trackPageView(userId, sessionId, page, metadata);
        } else if (eventType === "action") {
            analyticsTracker.trackAction(userId, sessionId, action, metadata);
        } else if (eventType === "chat_query") {
            analyticsTracker.trackChatQuery(userId, sessionId, metadata);
        }
        
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});
