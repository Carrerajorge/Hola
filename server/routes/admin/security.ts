import { Router } from "express";
import { storage } from "../../storage";
import { auditLog, AuditActions } from "../../services/auditLogger";
import { dbRead } from "../../db";
import { auditLogs, securityPolicies, users } from "@shared/schema";
import { and, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";

export const securityRouter = Router();

securityRouter.get("/policies", async (req, res) => {
    try {
        const { type, appliedTo, isEnabled } = req.query;
        let policies = await storage.getSecurityPolicies();

        if (type) {
            policies = policies.filter(p => p.policyType === type);
        }
        if (appliedTo) {
            policies = policies.filter(p => p.appliedTo === appliedTo);
        }
        if (isEnabled !== undefined) {
            policies = policies.filter(p => p.isEnabled === isEnabled);
        }

        res.json(policies);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

securityRouter.post("/policies", async (req, res) => {
    try {
        const { policyName, policyType, rules, priority, appliedTo, createdBy } = req.body;
        if (!policyName || !policyType || !rules) {
            return res.status(400).json({ error: "policyName, policyType, and rules are required" });
        }

        const policy = await storage.createSecurityPolicy({
            policyName,
            policyType,
            rules,
            priority: priority || 0,
            appliedTo: appliedTo || "global",
            createdBy
        });

        await auditLog(req, {
            action: AuditActions.SECURITY_POLICY_CREATED,
            resource: "security_policies",
            resourceId: policy.id,
            details: { policyName, policyType, rules, priority, appliedTo, createdBy: (req as any).user?.email },
            category: "security",
            severity: "warning"
        });

        res.json(policy);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

securityRouter.put("/policies/:id", async (req, res) => {
    try {
        const previousPolicy = await storage.getSecurityPolicy(req.params.id);
        const policy = await storage.updateSecurityPolicy(req.params.id, req.body);
        if (!policy) {
            return res.status(404).json({ error: "Policy not found" });
        }

        await auditLog(req, {
            action: AuditActions.SECURITY_POLICY_UPDATED,
            resource: "security_policies",
            resourceId: req.params.id,
            details: { 
                changes: req.body,
                previousValues: previousPolicy ? {
                    policyName: previousPolicy.policyName,
                    policyType: previousPolicy.policyType,
                    isEnabled: previousPolicy.isEnabled
                } : null,
                updatedBy: (req as any).user?.email
            },
            category: "security",
            severity: "warning"
        });

        res.json(policy);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

securityRouter.delete("/policies/:id", async (req, res) => {
    try {
        const existing = await storage.getSecurityPolicy(req.params.id);
        if (!existing) {
            return res.status(404).json({ error: "Policy not found" });
        }

        await storage.deleteSecurityPolicy(req.params.id);

        await auditLog(req, {
            action: AuditActions.SECURITY_POLICY_DELETED,
            resource: "security_policies",
            resourceId: req.params.id,
            details: { 
                deletedPolicy: {
                    policyName: existing.policyName,
                    policyType: existing.policyType
                },
                deletedBy: (req as any).user?.email
            },
            category: "security",
            severity: "critical"
        });

        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

securityRouter.patch("/policies/:id/toggle", async (req, res) => {
    try {
        const { isEnabled } = req.body;
        const policy = await storage.toggleSecurityPolicy(req.params.id, isEnabled);
        if (!policy) {
            return res.status(404).json({ error: "Policy not found" });
        }

        await storage.createAuditLog({
            action: isEnabled ? "security_policy_enable" : "security_policy_disable",
            resource: "security_policies",
            resourceId: req.params.id,
            details: { policyName: policy.policyName }
        });

        res.json(policy);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

securityRouter.get("/audit-logs", async (req, res) => {
    try {
        const {
            action,
            resource,
            userId,
            role,
            exclude_admin,
            category,
            severity,
            date_from,
            date_to,
            page = "1",
            limit = "50",
        } = req.query as Record<string, string | undefined>;

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
        const offset = (pageNum - 1) * limitNum;

        const conditions: SQL[] = [];

        if (action) {
            conditions.push(ilike(auditLogs.action, `%${action}%`));
        }
        if (resource) {
            conditions.push(ilike(auditLogs.resource, `%${resource}%`));
        }
        if (userId) {
            conditions.push(eq(auditLogs.userId, userId));
        }
        if (date_from) {
            conditions.push(gte(auditLogs.createdAt, new Date(date_from)));
        }
        if (date_to) {
            conditions.push(lte(auditLogs.createdAt, new Date(date_to)));
        }
        if (severity) {
            conditions.push(sql`coalesce(${auditLogs.details} ->> 'severity', 'info') = ${severity}`);
        }
        if (category) {
            conditions.push(sql`coalesce(${auditLogs.details} ->> 'category', 'system') = ${category}`);
        }
        if (role) {
            conditions.push(eq(users.role, role));
        }
        if (exclude_admin === "true") {
            conditions.push(sql`coalesce(${users.role}, 'anonymous') not in ('admin', 'superadmin', 'team_admin')`);
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const baseQuery = dbRead
            .select({
                log: auditLogs,
                userEmail: users.email,
                userRole: users.role,
                userFullName: users.fullName,
            })
            .from(auditLogs)
            .leftJoin(users, eq(auditLogs.userId, users.id));

        const countQuery = dbRead
            .select({ count: sql<number>`count(*)` })
            .from(auditLogs)
            .leftJoin(users, eq(auditLogs.userId, users.id));

        const [rows, totalResult] = await Promise.all([
            (whereClause ? baseQuery.where(whereClause) : baseQuery)
                .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
                .limit(limitNum)
                .offset(offset),
            whereClause ? countQuery.where(whereClause) : countQuery,
        ]);

        const paginatedLogs = rows.map((row) => {
            const log = row.log as any;
            const details = { ...(log.details || {}) } as Record<string, any>;
            if (row.userEmail && !details.actorEmail) details.actorEmail = row.userEmail;
            if (row.userRole && !details.actorRole) details.actorRole = row.userRole;
            return {
                ...log,
                details,
                user: row.userEmail ? { id: log.userId, email: row.userEmail, role: row.userRole, fullName: row.userFullName } : null,
            };
        });

        const total = Number(totalResult[0]?.count || 0);

        res.json({
            logs: paginatedLogs,
            data: paginatedLogs, // Backwards compatibility
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum),
            },
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

securityRouter.get("/stats", async (req, res) => {
    try {
        const now = new Date();
        const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        const [
            policyCounts,
            policyTypeRows,
            logsTodayResult,
            criticalAlertsResult,
            severityCountsResult
        ] = await Promise.all([
            dbRead.select({
                total: sql<number>`count(*)`,
                active: sql<number>`count(*) filter (where ${securityPolicies.isEnabled} = 'true')`,
            }).from(securityPolicies),
            dbRead.select({
                policyType: securityPolicies.policyType,
                count: sql<number>`count(*)`,
            }).from(securityPolicies).groupBy(securityPolicies.policyType),
            dbRead.select({ count: sql<number>`count(*)` })
                .from(auditLogs)
                .where(gte(auditLogs.createdAt, startOfToday)),
            dbRead.select({ count: sql<number>`count(*)` })
                .from(auditLogs)
                .where(and(
                    gte(auditLogs.createdAt, twentyFourHoursAgo),
                    or(
                        ilike(auditLogs.action, "%login_failed%"),
                        ilike(auditLogs.action, "%blocked%"),
                        ilike(auditLogs.action, "%rate_limit%"),
                        ilike(auditLogs.action, "%unauthorized%"),
                        ilike(auditLogs.action, "%permission_denied%"),
                        ilike(auditLogs.action, "%security_alert%")
                    )
                )),
            dbRead.select({
                info: sql<number>`count(*) filter (where coalesce(${auditLogs.details} ->> 'severity', 'info') = 'info')`,
                warning: sql<number>`count(*) filter (where coalesce(${auditLogs.details} ->> 'severity', 'info') = 'warning')`,
                error: sql<number>`count(*) filter (where coalesce(${auditLogs.details} ->> 'severity', 'info') = 'error')`,
                critical: sql<number>`count(*) filter (where coalesce(${auditLogs.details} ->> 'severity', 'info') = 'critical')`,
            })
                .from(auditLogs)
                .where(gte(auditLogs.createdAt, twentyFourHoursAgo)),
        ]);

        const policyTypeBreakdown = (policyTypeRows || []).reduce((acc: Record<string, number>, row: any) => {
            acc[String(row.policyType)] = Number(row.count || 0);
            return acc;
        }, {});

        res.json({
            totalPolicies: Number(policyCounts[0]?.total || 0),
            activePolicies: Number(policyCounts[0]?.active || 0),
            criticalAlerts24h: Number(criticalAlertsResult[0]?.count || 0),
            auditEventsToday: Number(logsTodayResult[0]?.count || 0),
            severityCounts: {
                info: Number(severityCountsResult[0]?.info || 0),
                warning: Number(severityCountsResult[0]?.warning || 0),
                error: Number(severityCountsResult[0]?.error || 0),
                critical: Number(severityCountsResult[0]?.critical || 0),
            },
            policyTypeBreakdown
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

securityRouter.get("/logs", async (req, res) => {
    try {
        const limit = parseInt(req.query.limit as string) || 100;
        const logs = await storage.getAuditLogs(limit);
        res.json(logs);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/admin/security/config - Get current security configuration
securityRouter.get("/config", async (req, res) => {
    try {
        const config = {
            csp: {
                enabled: true,
                directives: {
                    defaultSrc: ["'self'"],
                    scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
                    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
                    fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
                    imgSrc: ["'self'", "data:", "blob:", "https:"],
                    connectSrc: ["'self'", "https://api.x.ai", "https://generativelanguage.googleapis.com", "wss:", "ws:"]
                }
            },
            cors: {
                enabled: true,
                origins: process.env.CORS_ORIGINS?.split(",") || ["*"],
                credentials: true
            },
            rateLimit: {
                enabled: true,
                windowMs: 60000,
                maxRequests: 100,
                byUser: true,
                byIp: true
            },
            csrf: {
                enabled: true,
                cookieName: "XSRF-TOKEN",
                headerName: "X-CSRF-Token"
            },
            headers: {
                xFrameOptions: "SAMEORIGIN",
                xContentTypeOptions: "nosniff",
                referrerPolicy: "strict-origin-when-cross-origin"
            }
        };

        res.json(config);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/admin/security/threats - Get recent threat analysis
securityRouter.get("/threats", async (req, res) => {
    try {
        const now = new Date();
        const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        const [summaryRows, suspiciousIpsRows, recentThreats] = await Promise.all([
            dbRead.select({
                loginFailures: sql<number>`count(*) filter (where ${auditLogs.action} ILIKE '%login_failed%')`,
                blockedRequests: sql<number>`count(*) filter (where ${auditLogs.action} ILIKE '%blocked%' OR ${auditLogs.action} ILIKE '%rate_limit%')`,
                unauthorizedAccess: sql<number>`count(*) filter (where ${auditLogs.action} ILIKE '%unauthorized%' OR ${auditLogs.action} ILIKE '%403%')`,
            })
                .from(auditLogs)
                .where(gte(auditLogs.createdAt, last24h)),
            dbRead.select({
                ip: auditLogs.ipAddress,
                failedAttempts: sql<number>`count(*)`,
            })
                .from(auditLogs)
                .where(and(
                    gte(auditLogs.createdAt, last24h),
                    ilike(auditLogs.action, "%login_failed%")
                ))
                .groupBy(auditLogs.ipAddress)
                .having(sql`count(*) >= 5`)
                .orderBy(desc(sql`count(*)`))
                .limit(50),
            dbRead.select({
                action: auditLogs.action,
                ip: auditLogs.ipAddress,
                timestamp: auditLogs.createdAt,
                details: auditLogs.details,
            })
                .from(auditLogs)
                .where(and(
                    gte(auditLogs.createdAt, last24h),
                    or(
                        ilike(auditLogs.action, "%login_failed%"),
                        ilike(auditLogs.action, "%blocked%"),
                        ilike(auditLogs.action, "%rate_limit%"),
                        ilike(auditLogs.action, "%unauthorized%"),
                        ilike(auditLogs.action, "%403%")
                    )
                ))
                .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
                .limit(20),
        ]);

        const summaryRow = summaryRows[0] || ({} as any);

        res.json({
            summary: {
                loginFailures: Number(summaryRow.loginFailures || 0),
                blockedRequests: Number(summaryRow.blockedRequests || 0),
                unauthorizedAccess: Number(summaryRow.unauthorizedAccess || 0),
                totalThreats:
                    Number(summaryRow.loginFailures || 0) +
                    Number(summaryRow.blockedRequests || 0) +
                    Number(summaryRow.unauthorizedAccess || 0)
            },
            suspiciousIps: (suspiciousIpsRows || []).map((r: any) => ({
                ip: r.ip || "unknown",
                failedAttempts: Number(r.failedAttempts || 0)
            })),
            recentThreats: (recentThreats || []).map((l: any) => ({
                action: l.action,
                ip: l.ip,
                timestamp: l.timestamp,
                details: l.details
            })),
            period: "24h"
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/admin/security/ip/block - Block an IP address
securityRouter.post("/ip/block", async (req, res) => {
    try {
        const { ip, reason, duration } = req.body;
        if (!ip) {
            return res.status(400).json({ error: "IP address is required" });
        }

        // Create a security policy for the blocked IP
        const policy = await storage.createSecurityPolicy({
            policyName: `Block IP: ${ip}`,
            policyType: "ip_block",
            rules: { ip, blockedAt: new Date().toISOString(), duration: duration || "permanent" },
            priority: 100,
            appliedTo: "global",
            isEnabled: "true"
        });

        await storage.createAuditLog({
            action: "ip_blocked",
            resource: "security",
            details: { ip, reason, duration }
        });

        res.json({ success: true, policy });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/admin/security/ip/unblock/:ip - Unblock an IP address
securityRouter.delete("/ip/unblock/:ip", async (req, res) => {
    try {
        const ip = req.params.ip;
        const policies = await storage.getSecurityPolicies();
        const blockPolicy = policies.find(p => 
            p.policyType === "ip_block" && 
            (p.rules as any)?.ip === ip
        );

        if (!blockPolicy) {
            return res.status(404).json({ error: "IP block policy not found" });
        }

        await storage.deleteSecurityPolicy(blockPolicy.id);

        await storage.createAuditLog({
            action: "ip_unblocked",
            resource: "security",
            details: { ip }
        });

        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/admin/security/audit-logs/export - Export audit logs as CSV
securityRouter.get("/audit-logs/export", async (req, res) => {
    try {
        const { format = "csv", date_from, date_to, action, limit = "10000" } = req.query as Record<string, string | undefined>;
        const limitNum = Math.min(Math.max(parseInt(limit || "10000", 10) || 10000, 1), 50000);

        const conditions: SQL[] = [];
        if (action) {
            conditions.push(ilike(auditLogs.action, `%${action}%`));
        }
        if (date_from) {
            conditions.push(gte(auditLogs.createdAt, new Date(date_from)));
        }
        if (date_to) {
            conditions.push(lte(auditLogs.createdAt, new Date(date_to)));
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const exportQuery = whereClause
            ? dbRead.select().from(auditLogs).where(whereClause)
            : dbRead.select().from(auditLogs);

        const logs = await exportQuery
            .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
            .limit(limitNum);
        
        // Log the export action
        await auditLog(req, {
            action: AuditActions.ADMIN_EXPORT_DATA,
            resource: "audit_logs",
            details: { 
                format, 
                recordCount: logs.length,
                exportedBy: (req as any).user?.claims?.email || (req as any).user?.email 
            },
            category: "security",
            severity: "warning"
        });
        
        if (format === "json") {
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Content-Disposition", `attachment; filename=audit_logs_${new Date().toISOString().split("T")[0]}.json`);
            return res.json(logs);
        }
        
        // Default: CSV
        const csvHeaders = ["id", "action", "resource", "resourceId", "userId", "ipAddress", "userAgent", "createdAt", "details"];
        const csvRows = logs.map(log => [
            log.id,
            log.action,
            log.resource || "",
            log.resourceId || "",
            log.userId || "",
            log.ipAddress || "",
            (log.userAgent || "").replace(/,/g, ";").substring(0, 100),
            log.createdAt ? new Date(log.createdAt).toISOString() : "",
            JSON.stringify(log.details || {}).replace(/,/g, ";")
        ]);
        
        const csv = [csvHeaders.join(","), ...csvRows.map(row => row.join(","))].join("\n");
        
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename=audit_logs_${new Date().toISOString().split("T")[0]}.csv`);
        res.send(csv);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Import security alerts service
import { securityAlerts } from "../../services/securityAlerts";

// GET /api/admin/security/alerts - Get security alerts
securityRouter.get("/alerts", async (req, res) => {
    try {
        const { limit = "50", unresolved } = req.query;
        const alerts = securityAlerts.getAlerts(
            parseInt(limit as string),
            unresolved === "true"
        );
        res.json({
            alerts,
            stats: securityAlerts.getStats()
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/admin/security/alerts/:id/resolve - Resolve an alert
securityRouter.post("/alerts/:id/resolve", async (req, res) => {
    try {
        const success = securityAlerts.resolveAlert(req.params.id);
        if (!success) {
            return res.status(404).json({ error: "Alert not found" });
        }
        
        await auditLog(req, {
            action: "security.alert_resolved",
            resource: "security_alerts",
            resourceId: req.params.id,
            details: { resolvedBy: (req as any).user?.email },
            category: "security",
            severity: "info"
        });
        
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/admin/security/alerts/stats - Get alert statistics
securityRouter.get("/alerts/stats", async (req, res) => {
    try {
        res.json(securityAlerts.getStats());
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});
