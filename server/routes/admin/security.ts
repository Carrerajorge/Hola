import { Router } from "express";
import { storage } from "../../storage";

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

        await storage.createAuditLog({
            action: "security_policy_create",
            resource: "security_policies",
            resourceId: policy.id,
            details: { policyName, policyType }
        });

        res.json(policy);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

securityRouter.put("/policies/:id", async (req, res) => {
    try {
        const policy = await storage.updateSecurityPolicy(req.params.id, req.body);
        if (!policy) {
            return res.status(404).json({ error: "Policy not found" });
        }

        await storage.createAuditLog({
            action: "security_policy_update",
            resource: "security_policies",
            resourceId: req.params.id,
            details: req.body
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

        await storage.createAuditLog({
            action: "security_policy_delete",
            resource: "security_policies",
            resourceId: req.params.id,
            details: { policyName: existing.policyName }
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
        const { action, resource, date_from, date_to, severity, status, page = "1", limit = "50" } = req.query;
        const pageNum = parseInt(page as string);
        const limitNum = Math.min(parseInt(limit as string), 100);

        let logs = await storage.getAuditLogs(500);

        if (action) {
            logs = logs.filter(l => l.action?.includes(action as string));
        }
        if (resource) {
            logs = logs.filter(l => l.resource === resource);
        }
        if (date_from) {
            const fromDate = new Date(date_from as string);
            logs = logs.filter(l => l.createdAt && new Date(l.createdAt) >= fromDate);
        }
        if (date_to) {
            const toDate = new Date(date_to as string);
            logs = logs.filter(l => l.createdAt && new Date(l.createdAt) <= toDate);
        }

        const total = logs.length;
        const paginatedLogs = logs.slice((pageNum - 1) * limitNum, pageNum * limitNum);

        res.json({
            data: paginatedLogs,
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

securityRouter.get("/stats", async (req, res) => {
    try {
        const [policies, auditLogs] = await Promise.all([
            storage.getSecurityPolicies(),
            storage.getAuditLogs(1000)
        ]);

        const now = new Date();
        const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        const activePolicies = policies.filter(p => p.isEnabled === "true").length;
        const logsToday = auditLogs.filter(l => l.createdAt && new Date(l.createdAt) >= startOfToday).length;

        const criticalActions = ["login_failed", "blocked", "unauthorized", "security_alert", "permission_denied"];
        const criticalAlerts = auditLogs.filter(l =>
            l.createdAt &&
            new Date(l.createdAt) >= twentyFourHoursAgo &&
            criticalActions.some(a => l.action?.includes(a))
        ).length;

        const severityCounts = {
            info: auditLogs.filter(l => !criticalActions.some(a => l.action?.includes(a)) && !l.action?.includes("warning")).length,
            warning: auditLogs.filter(l => l.action?.includes("warning")).length,
            critical: auditLogs.filter(l => criticalActions.some(a => l.action?.includes(a))).length
        };

        res.json({
            totalPolicies: policies.length,
            activePolicies,
            criticalAlerts24h: criticalAlerts,
            auditEventsToday: logsToday,
            severityCounts,
            policyTypeBreakdown: policies.reduce((acc: Record<string, number>, p) => {
                acc[p.policyType] = (acc[p.policyType] || 0) + 1;
                return acc;
            }, {})
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
