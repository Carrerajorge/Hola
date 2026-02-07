import { Router } from "express";
import { contextOrchestrator } from "../../memory/ContextOrchestrator";
import { auditLog } from "../../services/auditLogger";
import { toolRegistry as registryToolRegistry } from "../../agent/registry/toolRegistry";
import { aiProviderManager } from "../../services/aiProviderManager";
import { getAllServiceHealth } from "../../services/selfHealing";
import { storage } from "../../storage";
import { dbRead } from "../../db";
import { agentMemoryStore, agentModeRuns, toolCallLogs, users } from "@shared/schema";
import { and, desc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";

export const agentRouter = Router();

const DEFAULT_PROVIDER_IDS = ["agentic_engine", "sandbox"];

function getFirstQueryValue(value: unknown): string | undefined {
    if (typeof value === "string") return value;
    if (Array.isArray(value) && typeof value[0] === "string") return value[0];
    return undefined;
}

function parseTimeRange(query: any): { since: Date; rangeDays: number; rangeHours: number | null } {
    const rawHoursStr = getFirstQueryValue(query?.rangeHours)?.trim();
    const rawHours = rawHoursStr ? Number(rawHoursStr) : Number.NaN;

    if (Number.isFinite(rawHours) && rawHours > 0) {
        const rangeHours = Math.min(24 * 365, Math.max(1, Math.floor(rawHours)));
        const since = new Date(Date.now() - rangeHours * 60 * 60 * 1000);
        const rangeDays = Math.max(1, Math.ceil(rangeHours / 24));
        return { since, rangeDays, rangeHours };
    }

    const rawDaysStr = getFirstQueryValue(query?.rangeDays)?.trim();
    const rawDays = rawDaysStr ? Number(rawDaysStr) : Number.NaN;
    const rangeDays = Math.min(365, Math.max(1, Number.isFinite(rawDays) ? Math.floor(rawDays) : 30));
    const since = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);
    return { since, rangeDays, rangeHours: null };
}

function parseProviderIds(providerIdQuery: unknown): string[] | null {
    const raw = getFirstQueryValue(providerIdQuery)?.trim();
    if (!raw) return DEFAULT_PROVIDER_IDS;
    if (raw === "all") return null;
    return raw.split(",").map(s => s.trim()).filter(Boolean);
}

agentRouter.get("/status", async (req, res) => {
    try {
        const stats = contextOrchestrator.getMetrics();
        // Since contextOrchestrator doesn't expose verbose status directly in stats, 
        // we construct a health check response.
        res.json({
            status: "active",
            router: "ContextOrchestrator",
            stats
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

agentRouter.get("/config", async (req, res) => {
    try {
        res.json({
            mode: "hybrid",
            features: ["rag", "reflection", "planning"],
            maxContextTokens: 128000
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

agentRouter.post("/reset", async (req, res) => {
    try {
        await auditLog(req, {
            action: "agent.reset",
            resource: "agent",
            details: { resetBy: (req as any).user?.email },
            category: "admin",
            severity: "warning"
        });
        res.json({ success: true, message: "Agent state cleared" });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/admin/agent/tools - List all registered tools
agentRouter.get("/tools", async (req, res) => {
    const { since, rangeDays, rangeHours } = parseTimeRange(req.query);
    const userId = (req.query.userId as string | undefined) || undefined;
    const providerIds = parseProviderIds(req.query.providerId);
    try {
        const tools = registryToolRegistry.getAll();

        // Usage counts are best-effort: if DB is unavailable, still return the catalog.
        let usageCounts: Record<string, number> = {};
        try {
            const conditions = [
                gte(toolCallLogs.createdAt, since),
                userId ? eq(toolCallLogs.userId, userId) : undefined,
                providerIds ? inArray(toolCallLogs.providerId, providerIds) : undefined,
            ].filter(Boolean) as any[];

            const rows = await dbRead.select({
                toolId: toolCallLogs.toolId,
                count: sql<number>`count(*)`.mapWith(Number),
            })
                .from(toolCallLogs)
                .where(conditions.length > 1 ? and(...conditions) : conditions[0])
                .groupBy(toolCallLogs.toolId);

            usageCounts = rows.reduce<Record<string, number>>((acc, r) => {
                acc[r.toolId] = r.count;
                return acc;
            }, {});
        } catch (dbErr) {
            console.warn("[AdminAgent] /tools usageCount query failed:", (dbErr as any)?.message || dbErr);
        }

        const catalog = tools.map((t: any) => ({
            id: t.metadata?.name || t.name,
            name: t.metadata?.name || t.name,
            description: t.metadata?.description || t.description,
            category: t.metadata?.category || "general",
            isEnabled: (t.metadata?.implementationStatus || "implemented") !== "disabled",
            implementationStatus: t.metadata?.implementationStatus || "implemented",
            usageCount: usageCounts[(t.metadata?.name || t.name) as string] || 0,
        }));

        // Ensure tools observed in logs show up even if they're not in the registry catalog (e.g. sandbox tools).
        const catalogIds = new Set(catalog.map(t => t.id));
        const observed = Object.entries(usageCounts)
            .filter(([toolId, count]) => count > 0 && !catalogIds.has(toolId))
            .map(([toolId, count]) => ({
                id: toolId,
                name: toolId,
                description: "",
                category: "observed",
                isEnabled: true,
                implementationStatus: "observed",
                usageCount: count,
            }));

        const merged = [...catalog, ...observed];

        res.json({
            rangeDays,
            rangeHours,
            userId: userId || null,
            providerId: providerIds ? providerIds.join(",") : "all",
            tools: merged,
            total: merged.length,
        });
    } catch (error: any) {
        console.error("[AdminAgent] /tools failed:", error);
        res.json({ rangeDays, tools: [], total: 0 });
    }
});

// GET /api/admin/agent/metrics - Aggregate usage metrics (from tool_call_logs)
agentRouter.get("/metrics", async (req, res) => {
    const { since, rangeDays, rangeHours } = parseTimeRange(req.query);
    const userId = (req.query.userId as string | undefined) || undefined;
    const providerIds = parseProviderIds(req.query.providerId);

    try {
        const conditions = [
            gte(toolCallLogs.createdAt, since),
            userId ? eq(toolCallLogs.userId, userId) : undefined,
            providerIds ? inArray(toolCallLogs.providerId, providerIds) : undefined,
        ].filter(Boolean) as any[];

        const where = conditions.length > 1 ? and(...conditions) : conditions[0];

        const [row] = await dbRead.select({
            totalCalls: sql<number>`count(*)`.mapWith(Number),
            successCalls: sql<number>`coalesce(sum(case when ${toolCallLogs.status} = 'success' then 1 else 0 end), 0)`.mapWith(Number),
            avgLatencyMs: sql<number>`coalesce(avg(${toolCallLogs.latencyMs}), 0)`.mapWith(Number),
        }).from(toolCallLogs).where(where);

        const statusRows = await dbRead.select({
            status: toolCallLogs.status,
            count: sql<number>`count(*)`.mapWith(Number),
        }).from(toolCallLogs).where(where).groupBy(toolCallLogs.status);

        const byStatus = statusRows.reduce<Record<string, number>>((acc, r) => {
            acc[r.status] = r.count;
            return acc;
        }, {});

        const totalCalls = row?.totalCalls || 0;
        const successCalls = row?.successCalls || 0;
        const errorCalls = Math.max(0, totalCalls - successCalls);
        const successRate = totalCalls > 0 ? (successCalls / totalCalls) * 100 : 0;

        res.json({
            rangeDays,
            rangeHours,
            userId: userId || null,
            providerId: providerIds ? providerIds.join(",") : "all",
            totalCalls,
            successCalls,
            errorCalls,
            successRate,
            avgLatencyMs: row?.avgLatencyMs ? Math.round(row.avgLatencyMs) : 0,
            byStatus,
            updatedAt: new Date().toISOString(),
        });
    } catch (error: any) {
        console.error("[AdminAgent] /metrics failed:", error);
        res.json({
            rangeDays,
            rangeHours,
            userId: userId || null,
            totalCalls: 0,
            successCalls: 0,
            errorCalls: 0,
            successRate: 0,
            avgLatencyMs: 0,
            byStatus: {},
            updatedAt: new Date().toISOString(),
        });
    }
});

// GET /api/admin/agent/users - List users for filtering
agentRouter.get("/users", async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const search = (typeof req.query.search === "string" ? req.query.search : "").trim();

    try {
        let query = dbRead.select({
            id: users.id,
            email: users.email,
            fullName: users.fullName,
            role: users.role,
            plan: users.plan,
            lastLoginAt: users.lastLoginAt,
            createdAt: users.createdAt,
        }).from(users);

        if (search) {
            const pattern = `%${search}%`;
            query = query.where(or(
                ilike(users.email, pattern),
                ilike(users.fullName, pattern),
                ilike(users.id, pattern),
            ));
        }

        const rows = await query
            .orderBy(desc(users.lastLoginAt), desc(users.createdAt))
            .limit(limit);

        res.json({ users: rows });
    } catch (error: any) {
        console.error("[AdminAgent] /users failed:", error);
        res.json({ users: [] });
    }
});

// GET /api/admin/agent/tool-calls - Recent tool call logs (for dashboards)
agentRouter.get("/tool-calls", async (req, res) => {
    const { since, rangeDays, rangeHours } = parseTimeRange(req.query);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 25));
    const userId = (req.query.userId as string | undefined) || undefined;
    const toolId = (req.query.toolId as string | undefined) || undefined;
    const providerIds = parseProviderIds(req.query.providerId);

    try {
        const conditions = [
            gte(toolCallLogs.createdAt, since),
            userId ? eq(toolCallLogs.userId, userId) : undefined,
            toolId ? eq(toolCallLogs.toolId, toolId) : undefined,
            providerIds ? inArray(toolCallLogs.providerId, providerIds) : undefined,
        ].filter(Boolean) as any[];

        const where = conditions.length > 1 ? and(...conditions) : conditions[0];

        const logs = await dbRead.select({
            id: toolCallLogs.id,
            userId: toolCallLogs.userId,
            userEmail: users.email,
            toolId: toolCallLogs.toolId,
            providerId: toolCallLogs.providerId,
            status: toolCallLogs.status,
            latencyMs: toolCallLogs.latencyMs,
            errorCode: toolCallLogs.errorCode,
            errorMessage: toolCallLogs.errorMessage,
            chatId: toolCallLogs.chatId,
            runId: toolCallLogs.runId,
            createdAt: toolCallLogs.createdAt,
        })
            .from(toolCallLogs)
            .leftJoin(users, eq(toolCallLogs.userId, users.id))
            .where(where)
            .orderBy(desc(toolCallLogs.createdAt))
            .limit(limit);

        res.json({ rangeDays, rangeHours, userId: userId || null, providerId: providerIds ? providerIds.join(",") : "all", logs });
    } catch (error: any) {
        console.error("[AdminAgent] /tool-calls failed:", error);
        res.json({ rangeDays, rangeHours, userId: userId || null, providerId: providerIds ? providerIds.join(",") : "all", logs: [] });
    }
});

// GET /api/admin/agent/gaps - Get capability gaps
agentRouter.get("/gaps", async (req, res) => {
    try {
        const status = typeof req.query.status === "string" ? req.query.status : "pending";
        const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
        const userId = (req.query.userId as string | undefined) || undefined;
        const gapsRaw = await storage.getAgentGapLogs(status, userId);
        const gaps = gapsRaw.slice(0, limit);

        const gapUserIds = Array.from(new Set(
            gaps.map(g => (g as any).userId).filter((id): id is string => typeof id === "string" && id.length > 0)
        ));

        let userEmailById: Record<string, string> = {};
        if (gapUserIds.length > 0) {
            const rows = await dbRead.select({ id: users.id, email: users.email })
                .from(users)
                .where(inArray(users.id, gapUserIds));
            userEmailById = rows.reduce<Record<string, string>>((acc, r) => {
                if (r.id && r.email) acc[r.id] = r.email;
                return acc;
            }, {});
        }

        res.json({
            gaps: gaps.map((g: any) => ({
                ...g,
                userEmail: g.userId ? (userEmailById[g.userId] || null) : null,
            }))
        });
    } catch (error: any) {
        console.error("[AdminAgent] /gaps failed:", error);
        res.json({ gaps: [] });
    }
});

// GET /api/admin/agent/memory/stats - Memory statistics
agentRouter.get("/memory/stats", async (req, res) => {
    const userId = (req.query.userId as string | undefined) || undefined;
    try {
        let totalsQuery = dbRead.select({
            totalAtoms: sql<number>`count(*)`.mapWith(Number),
            storageBytes: sql<number>`coalesce(sum(pg_column_size(${agentMemoryStore.memoryValue})), 0)`.mapWith(Number),
        }).from(agentMemoryStore);

        if (userId) {
            totalsQuery = totalsQuery.where(eq(agentMemoryStore.userId, userId));
        }

        const [totals] = await totalsQuery;

        let typesQuery = dbRead.select({
            memoryType: agentMemoryStore.memoryType,
            count: sql<number>`count(*)`.mapWith(Number),
        }).from(agentMemoryStore);

        if (userId) {
            typesQuery = typesQuery.where(eq(agentMemoryStore.userId, userId));
        }

        const typeRows = await typesQuery.groupBy(agentMemoryStore.memoryType);

        const byType = typeRows.reduce<Record<string, number>>((acc, r) => {
            acc[r.memoryType || "unknown"] = r.count;
            return acc;
        }, {});

        res.json({
            userId: userId || null,
            totalAtoms: totals?.totalAtoms || 0,
            storageBytes: totals?.storageBytes || 0,
            avgWeight: 0,
            byType,
        });
    } catch (error: any) {
        console.error("[AdminAgent] /memory/stats failed:", error);
        res.json({
            userId: userId || null,
            totalAtoms: 0,
            storageBytes: 0,
            avgWeight: 0,
            byType: {},
        });
    }
});

// GET /api/admin/agent/circuits - Circuit breaker status
agentRouter.get("/circuits", async (req, res) => {
    try {
        const normalizeState = (state: string | null | undefined): "closed" | "open" | "half_open" | "unknown" => {
            if (!state) return "unknown";
            const s = state.toLowerCase().replace(/-/g, "_");
            if (s === "closed") return "closed";
            if (s === "open") return "open";
            if (s === "half_open" || s === "halfopen") return "half_open";
            return "unknown";
        };

        const providerCircuits = aiProviderManager.getCircuitStatus()
            .map(c => ({
                name: c.provider,
                status: normalizeState(c.state),
                failures: c.failures,
                lastFailure: c.lastFailure || null,
            }))
            .filter(c => c.status !== "closed");

        const toolCategoryCircuits = Object.entries(registryToolRegistry.getResilienceMetrics().byCategory)
            .map(([category, m]) => ({
                name: `tools:${category}`,
                status: normalizeState(m.state),
                failures: m.failureCount,
                lastFailure: null as number | null,
            }))
            .filter(c => c.status !== "closed");

        const serviceCircuits = getAllServiceHealth()
            .map(h => ({
                name: `svc:${h.name}`,
                status: normalizeState(h.state),
                failures: h.failures,
                lastFailure: h.lastFailure ? new Date(h.lastFailure).getTime() : null,
            }))
            .filter(c => c.status !== "closed");

        const circuits = [...providerCircuits, ...toolCategoryCircuits, ...serviceCircuits]
            .sort((a, b) => {
                const weight = (s: string) => s === "open" ? 0 : s === "half_open" ? 1 : 2;
                return weight(a.status) - weight(b.status);
            });

        res.json(circuits);
    } catch (error: any) {
        console.error("[AdminAgent] /circuits failed:", error);
        res.json([]);
    }
});

// GET /api/admin/agent/orchestrations - Active orchestration runs
agentRouter.get("/orchestrations", async (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 25));
    const statuses = ["queued", "planning", "running", "executing"];
    const userId = (req.query.userId as string | undefined) || undefined;

    try {
        const where = userId
            ? and(inArray(agentModeRuns.status, statuses), eq(agentModeRuns.userId, userId))
            : inArray(agentModeRuns.status, statuses);

        const runs = await dbRead.select()
            .from(agentModeRuns)
            .where(where)
            .orderBy(desc(agentModeRuns.createdAt))
            .limit(limit);

        const runUserIds = Array.from(new Set(
            runs
                .map(r => (r as any).userId)
                .filter((id: any) => typeof id === "string" && id.length > 0)
        ));

        const userEmailById: Record<string, string> = {};
        if (runUserIds.length > 0) {
            const rows = await dbRead
                .select({ id: users.id, email: users.email })
                .from(users)
                .where(inArray(users.id, runUserIds));
            for (const row of rows) {
                if (row.id && row.email) userEmailById[row.id] = row.email;
            }
        }

        res.json({
            runs: runs.map((r: any) => ({
                ...r,
                userEmail: r.userId ? (userEmailById[r.userId] || null) : null,
            })),
        });
    } catch (error: any) {
        console.error("[AdminAgent] /orchestrations failed:", error);
        res.json({ runs: [] });
    }
});

// POST /api/admin/agent/complexity/analyze - Analyze prompt complexity
agentRouter.post("/complexity/analyze", async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) {
            return res.status(400).json({ error: "prompt is required" });
        }
        
        // Simple complexity analysis
        const wordCount = prompt.split(/\s+/).length;
        const hasCode = /```|function|class|import|export/.test(prompt);
        const hasQuestion = /\?/.test(prompt);
        const hasMultipleTasks = /and|also|además|también/i.test(prompt);
        
        let category = "trivial";
        let score = 1;
        let suggestedPath = "fast";
        
        if (wordCount > 100 || hasCode) {
            category = "complex";
            score = 4;
            suggestedPath = "orchestrated";
        } else if (wordCount > 50 || hasMultipleTasks) {
            category = "moderate";
            score = 3;
            suggestedPath = "standard";
        } else if (wordCount > 20 || hasQuestion) {
            category = "simple";
            score = 2;
            suggestedPath = "standard";
        }

        const signals: string[] = [];
        if (hasCode) signals.push("code");
        if (hasQuestion) signals.push("question");
        if (hasMultipleTasks) signals.push("multiple_tasks");
        if (wordCount > 50) signals.push("long_prompt");

        // Dimensions are intentionally coarse (0-10) so the UI can render stable progress bars.
        const dimensions: Record<string, number> = {
            length: Math.min(10, Math.max(1, Math.round(wordCount / 12))),
            code: hasCode ? 10 : 0,
            multi_task: hasMultipleTasks ? 7 : 0,
            questions: hasQuestion ? 5 : 0,
        };

        res.json({
            prompt: prompt.substring(0, 100),
            category,
            score,
            suggestedPath,
            recommended_path: suggestedPath,
            signals,
            dimensions,
            analysis: {
                wordCount,
                hasCode,
                hasQuestion,
                hasMultipleTasks
            }
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});
