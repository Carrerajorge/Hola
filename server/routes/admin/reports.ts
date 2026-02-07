import { Router } from "express";
import { getUserId } from "../../types/express";
import { storage } from "../../storage";
import { auditLog, AuditActions } from "../../services/auditLogger";
import { db, dbRead } from "../../db";
import { aiModels, auditLogs, generatedReports, payments, reportTemplates, users } from "@shared/schema";
import { and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";

export const reportsRouter = Router();

type ReportFormat = "json" | "csv";

function parseDateStart(value: unknown): Date | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    // HTML date inputs are YYYY-MM-DD. Parse in local time for predictable "whole day" filtering.
    const d = new Date(`${trimmed}T00:00:00`);
    if (Number.isNaN(d.getTime())) return undefined;
    return d;
}

function parseDateEnd(value: unknown): Date | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const d = new Date(`${trimmed}T23:59:59.999`);
    if (Number.isNaN(d.getTime())) return undefined;
    return d;
}

function normalizeFormat(format: unknown): ReportFormat {
    const f = String(format || "json").toLowerCase().trim();
    return f === "csv" ? "csv" : "json";
}

function normalizeText(value: unknown): string | undefined {
    if (value === null || value === undefined) return undefined;
    const s = String(value).trim();
    return s ? s : undefined;
}

function normalizeTextBool(value: unknown): "true" | "false" | undefined {
    if (typeof value === "boolean") return value ? "true" : "false";
    const s = String(value || "").trim().toLowerCase();
    if (!s) return undefined;
    if (["true", "1", "yes", "y", "on"].includes(s)) return "true";
    if (["false", "0", "no", "n", "off"].includes(s)) return "false";
    return undefined;
}

function sanitizeDownloadFileName(name: unknown): string {
    const base = String(name || "report")
        .replace(/[^a-z0-9-_]+/gi, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");
    return base || "report";
}

function csvCell(value: unknown): string {
    if (value === null || value === undefined) return "";
    let s: string;
    if (value instanceof Date) s = value.toISOString();
    else if (typeof value === "object") s = JSON.stringify(value);
    else s = String(value);

    // Normalize newlines for CSV.
    s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (s.includes('"')) s = s.replace(/"/g, '""');
    if (/[",\n]/.test(s)) s = `"${s}"`;
    return s;
}

function toCsv(rows: Record<string, any>[]): string {
    if (rows.length === 0) return "";
    const headers = Object.keys(rows[0] || {});
    const out: string[] = [headers.join(",")];
    for (const row of rows) {
        out.push(headers.map((h) => csvCell((row as any)[h])).join(","));
    }
    return out.join("\n");
}

async function pickNewestFile(reportsDir: string, fileNames: string[]): Promise<string | undefined> {
    if (fileNames.length === 0) return undefined;
    const fs = require("fs").promises;
    const path = require("path");

    const stats = await Promise.all(fileNames.map(async (f: string) => {
        try {
            const st = await fs.stat(path.join(reportsDir, f));
            return { f, mtimeMs: st.mtimeMs };
        } catch {
            return null;
        }
    }));

    const existing = stats.filter(Boolean) as { f: string; mtimeMs: number }[];
    existing.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return existing[0]?.f;
}

async function ensureSystemTemplates(): Promise<void> {
    const desired = [
        {
            name: "Users Report",
            type: "user_report",
            description: "Export all users with their plan, role, status, and last login information",
            columns: [
                { key: "id", label: "User ID", type: "string" },
                { key: "email", label: "Email", type: "string" },
                { key: "fullName", label: "Name", type: "string" },
                { key: "plan", label: "Plan", type: "string" },
                { key: "role", label: "Role", type: "string" },
                { key: "status", label: "Status", type: "string" },
                { key: "orgId", label: "Org", type: "string" },
                { key: "authProvider", label: "Auth Provider", type: "string" },
                { key: "lastLoginAt", label: "Last Login", type: "date" },
                { key: "lastIp", label: "Last IP", type: "string" },
                { key: "createdAt", label: "Created At", type: "date" },
            ],
            filters: [
                { key: "plan", label: "Plan", type: "select" },
                { key: "status", label: "Status", type: "select" },
                { key: "role", label: "Role", type: "select" },
                { key: "orgId", label: "Org", type: "select" },
                { key: "authProvider", label: "Auth Provider", type: "select" },
                { key: "email", label: "Email Contains", type: "string" },
            ],
            isSystem: "true",
        },
        {
            name: "AI Models Report",
            type: "ai_models_report",
            description: "Export all AI models with provider, status, enablement, and usage metadata",
            columns: [
                { key: "name", label: "Name", type: "string" },
                { key: "provider", label: "Provider", type: "string" },
                { key: "modelId", label: "Model ID", type: "string" },
                { key: "status", label: "Status", type: "string" },
                { key: "isEnabled", label: "Enabled", type: "boolean" },
                { key: "modelType", label: "Type", type: "string" },
                { key: "usagePercent", label: "Usage %", type: "number" },
                { key: "enabledAt", label: "Enabled At", type: "date" },
                { key: "enabledByAdminId", label: "Enabled By (User ID)", type: "string" },
                { key: "enabledByEmail", label: "Enabled By (Email)", type: "string" },
                { key: "createdAt", label: "Created At", type: "date" },
            ],
            filters: [
                { key: "provider", label: "Provider", type: "select" },
                { key: "isEnabled", label: "Enabled", type: "boolean" },
                { key: "status", label: "Status", type: "select" },
                { key: "modelType", label: "Model Type", type: "select" },
            ],
            isSystem: "true",
        },
        {
            name: "Security Audit Report",
            type: "security_report",
            description: "Export audit logs with full account linkage (userId/email) for security analysis",
            columns: [
                { key: "createdAt", label: "Timestamp", type: "date" },
                { key: "action", label: "Action", type: "string" },
                { key: "resource", label: "Resource", type: "string" },
                { key: "userId", label: "User ID", type: "string" },
                { key: "userEmail", label: "User Email", type: "string" },
                { key: "ipAddress", label: "IP Address", type: "string" },
                { key: "userAgent", label: "User Agent", type: "string" },
                { key: "details", label: "Details", type: "json" },
            ],
            filters: [
                { key: "action", label: "Action", type: "select" },
                { key: "resource", label: "Resource", type: "select" },
                { key: "userId", label: "User ID", type: "string" },
                { key: "userEmail", label: "User Email Contains", type: "string" },
            ],
            isSystem: "true",
        },
        {
            name: "Financial Summary",
            type: "financial_report",
            description: "Export payment and revenue data linked to user accounts",
            columns: [
                { key: "createdAt", label: "Date", type: "date" },
                { key: "amount", label: "Amount", type: "number" },
                { key: "currency", label: "Currency", type: "string" },
                { key: "status", label: "Status", type: "string" },
                { key: "method", label: "Method", type: "string" },
                { key: "userId", label: "User ID", type: "string" },
                { key: "userEmail", label: "User Email", type: "string" },
                { key: "stripePaymentId", label: "Stripe Payment ID", type: "string" },
            ],
            filters: [
                { key: "status", label: "Status", type: "select" },
                { key: "method", label: "Method", type: "select" },
                { key: "currency", label: "Currency", type: "select" },
                { key: "userId", label: "User ID", type: "string" },
                { key: "userEmail", label: "User Email Contains", type: "string" },
                { key: "stripePaymentId", label: "Stripe Payment ID", type: "string" },
            ],
            isSystem: "true",
        },
    ];

    const existing = await storage.getReportTemplates();
    const systemByType = new Map(existing.filter(t => t.isSystem === "true").map(t => [t.type, t]));

    for (const tmpl of desired) {
        const current = systemByType.get(tmpl.type);
        if (!current) {
            await storage.createReportTemplate(tmpl as any);
            continue;
        }

        const needsUpdate =
            current.name !== tmpl.name ||
            (current.description || "") !== (tmpl.description || "") ||
            JSON.stringify(current.columns || []) !== JSON.stringify(tmpl.columns || []) ||
            JSON.stringify(current.filters || []) !== JSON.stringify(tmpl.filters || []);

        if (needsUpdate) {
            await db.update(reportTemplates)
                .set({
                    name: tmpl.name,
                    description: tmpl.description,
                    columns: tmpl.columns as any,
                    filters: tmpl.filters as any,
                    isSystem: "true",
                })
                .where(eq(reportTemplates.id, current.id));
        }
    }
}

// Get all report templates
reportsRouter.get("/templates", async (req, res) => {
    try {
        await ensureSystemTemplates();
        const templates = await storage.getReportTemplates();
        res.json(templates);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Get single report template
reportsRouter.get("/templates/:id", async (req, res) => {
    try {
        const template = await storage.getReportTemplate(req.params.id);
        if (!template) {
            return res.status(404).json({ error: "Template not found" });
        }
        res.json(template);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Create custom template
reportsRouter.post("/templates", async (req, res) => {
    try {
        const { name, type, description, columns, filters, groupBy } = req.body;
        if (!name || !type || !columns) {
            return res.status(400).json({ error: "name, type, and columns are required" });
        }
        const template = await storage.createReportTemplate({
            name, type, description, columns, filters, groupBy, isSystem: "false"
        });
        res.json(template);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Get filter options for a report type (for select inputs)
reportsRouter.get("/filter-options", async (req, res) => {
    try {
        const type = normalizeText(req.query.type);
        if (!type) {
            return res.status(400).json({ error: "type is required" });
        }

        const options: Record<string, string[]> = {};

        switch (type) {
            case "user_report": {
                const [plans, statuses, roles, orgs, providers] = await Promise.all([
                    dbRead.select({ v: users.plan }).from(users).groupBy(users.plan).orderBy(users.plan).limit(50),
                    dbRead.select({ v: users.status }).from(users).groupBy(users.status).orderBy(users.status).limit(50),
                    dbRead.select({ v: users.role }).from(users).groupBy(users.role).orderBy(users.role).limit(50),
                    dbRead.select({ v: users.orgId }).from(users).groupBy(users.orgId).orderBy(users.orgId).limit(100),
                    dbRead.select({ v: users.authProvider }).from(users).groupBy(users.authProvider).orderBy(users.authProvider).limit(50),
                ]);

                options.plan = plans.map(r => r.v).filter(Boolean) as string[];
                options.status = statuses.map(r => r.v).filter(Boolean) as string[];
                options.role = roles.map(r => r.v).filter(Boolean) as string[];
                options.orgId = orgs.map(r => r.v).filter(Boolean) as string[];
                options.authProvider = providers.map(r => r.v).filter(Boolean) as string[];
                break;
            }
            case "ai_models_report": {
                const [providers, statuses, modelTypes] = await Promise.all([
                    dbRead.select({ v: aiModels.provider }).from(aiModels).groupBy(aiModels.provider).orderBy(aiModels.provider).limit(100),
                    dbRead.select({ v: aiModels.status }).from(aiModels).groupBy(aiModels.status).orderBy(aiModels.status).limit(50),
                    dbRead.select({ v: aiModels.modelType }).from(aiModels).groupBy(aiModels.modelType).orderBy(aiModels.modelType).limit(50),
                ]);

                options.provider = providers.map(r => r.v).filter(Boolean) as string[];
                options.status = statuses.map(r => r.v).filter(Boolean) as string[];
                options.modelType = modelTypes.map(r => r.v).filter(Boolean) as string[];
                break;
            }
            case "security_report": {
                const [actions, resources] = await Promise.all([
                    dbRead.select({ v: auditLogs.action }).from(auditLogs).groupBy(auditLogs.action).orderBy(auditLogs.action).limit(200),
                    dbRead.select({ v: auditLogs.resource }).from(auditLogs).groupBy(auditLogs.resource).orderBy(auditLogs.resource).limit(200),
                ]);

                options.action = actions.map(r => r.v).filter(Boolean) as string[];
                options.resource = resources.map(r => r.v).filter(Boolean) as string[];
                break;
            }
            case "financial_report": {
                const [statuses, methods, currencies] = await Promise.all([
                    dbRead.select({ v: payments.status }).from(payments).groupBy(payments.status).orderBy(payments.status).limit(50),
                    dbRead.select({ v: payments.method }).from(payments).groupBy(payments.method).orderBy(payments.method).limit(50),
                    dbRead.select({ v: payments.currency }).from(payments).groupBy(payments.currency).orderBy(payments.currency).limit(20),
                ]);

                options.status = statuses.map(r => r.v).filter(Boolean) as string[];
                options.method = methods.map(r => r.v).filter(Boolean) as string[];
                options.currency = currencies.map(r => r.v).filter(Boolean) as string[];
                break;
            }
            default:
                return res.status(400).json({ error: `Unknown report type: ${type}` });
        }

        res.json({ type, options });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

reportsRouter.get("/", async (req, res) => {
    try {
        const reports = await storage.getReports();
        res.json(reports);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

reportsRouter.post("/", async (req, res) => {
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

reportsRouter.patch("/:id", async (req, res) => {
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

// Get generated reports with pagination
reportsRouter.get("/generated", async (req, res) => {
    try {
        const {
            page = "1",
            limit = "20",
            status,
            type,
            format,
            q,
            dateFrom,
            dateTo,
        } = req.query;

        const pageNum = Math.max(parseInt(page as string) || 1, 1);
        const limitNum = Math.min(Math.max(parseInt(limit as string) || 20, 1), 100);
        const offset = (pageNum - 1) * limitNum;

        const createdFrom = parseDateStart(dateFrom);
        const createdTo = parseDateEnd(dateTo);

        const conditions: any[] = [];
        if (status && typeof status === "string") conditions.push(eq(generatedReports.status, status));
        if (type && typeof type === "string") conditions.push(eq(generatedReports.type, type));
        if (format && typeof format === "string") conditions.push(eq(generatedReports.format, normalizeFormat(format)));
        if (createdFrom) conditions.push(gte(generatedReports.createdAt, createdFrom));
        if (createdTo) conditions.push(lte(generatedReports.createdAt, createdTo));
        if (q && typeof q === "string" && q.trim()) {
            const term = q.trim();
            conditions.push(or(
                ilike(generatedReports.name, `%${term}%`),
                eq(generatedReports.id, term)
            ));
        }

        const whereClause = conditions.length ? and(...conditions) : undefined;

        const [countRow] = await dbRead
            .select({ count: sql<number>`count(*)` })
            .from(generatedReports)
            .where(whereClause);
        const total = countRow?.count || 0;

        const rows = await dbRead
            .select({
                id: generatedReports.id,
                templateId: generatedReports.templateId,
                name: generatedReports.name,
                type: generatedReports.type,
                status: generatedReports.status,
                parameters: generatedReports.parameters,
                resultSummary: generatedReports.resultSummary,
                filePath: generatedReports.filePath,
                format: generatedReports.format,
                generatedBy: generatedReports.generatedBy,
                generatedByEmail: users.email,
                generatedByName: users.fullName,
                createdAt: generatedReports.createdAt,
                completedAt: generatedReports.completedAt,
            })
            .from(generatedReports)
            .leftJoin(users, eq(users.id, generatedReports.generatedBy))
            .where(whereClause)
            .orderBy(desc(generatedReports.createdAt))
            .limit(limitNum)
            .offset(offset);

        res.json({
            data: rows,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.max(Math.ceil(total / limitNum), 1),
            }
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Preview generated report (small sample, not full download)
reportsRouter.get("/preview/:id", async (req, res) => {
    try {
        const report = await storage.getGeneratedReport(req.params.id);
        if (!report) {
            return res.status(404).json({ error: "Report not found" });
        }
        if (report.status !== "completed") {
            return res.status(400).json({ error: "Report is not ready for preview" });
        }

        // Track previews (GETs are not captured by adminActivityTracker/globalAuditMiddleware).
        await auditLog(req, {
            action: "report.previewed",
            resource: "reports",
            resourceId: report.id,
            details: { type: report.type, format: report.format, templateId: report.templateId || null },
            category: "data",
            severity: "info",
        });

        const limitRaw = req.query.limit;
        const limit = Math.min(Math.max(parseInt(String(limitRaw || "25")) || 25, 1), 200);

        const fs = require("fs").promises;
        const path = require("path");

        const reportsDir = path.join(process.cwd(), "generated_reports");
        const files = await fs.readdir(reportsDir).catch(() => []);

        let reportFile: string | undefined;
        const stored = report.filePath && typeof report.filePath === "string" ? report.filePath : null;
        if (stored && !stored.startsWith("/api/")) {
            reportFile = path.basename(stored);
        }
        if (!reportFile) {
            const byId = files.filter((f: string) => f.includes(report.id) && f.endsWith(`.${report.format}`));
            reportFile = await pickNewestFile(reportsDir, byId);
        }
        if (!reportFile) {
            const byType = files.filter((f: string) => f.includes(report.type) && f.endsWith(`.${report.format}`));
            reportFile = await pickNewestFile(reportsDir, byType);
        }

        if (!reportFile) {
            return res.status(404).json({ error: "Report file not found" });
        }

        const filePath = path.join(reportsDir, reportFile);
        const stat = await fs.stat(filePath).catch(() => null);
        const maxPreviewBytes = 5 * 1024 * 1024; // 5MB
        if (stat?.size && stat.size > maxPreviewBytes) {
            return res.json({
                id: report.id,
                name: report.name,
                type: report.type,
                format: report.format,
                rowCount: (report.resultSummary as any)?.rowCount ?? null,
                tooLarge: true,
                message: "Report is too large to preview. Please download it.",
            });
        }

        const content = await fs.readFile(filePath, "utf-8");
        if (report.format === "json") {
            let parsed: any = null;
            try {
                parsed = JSON.parse(content);
            } catch {
                return res.status(500).json({ error: "Failed to parse JSON report" });
            }
            const rows = Array.isArray(parsed) ? parsed : [];
            const preview = rows.slice(0, limit);
            const columns = preview.length > 0 ? Object.keys(preview[0]) : [];

            return res.json({
                id: report.id,
                name: report.name,
                type: report.type,
                format: report.format,
                rowCount: (report.resultSummary as any)?.rowCount ?? rows.length,
                columns,
                preview,
            });
        }

        // CSV: return first N lines as plain text preview (no parsing).
        const lines = content.split(/\r?\n/).slice(0, Math.min(limit + 1, 500));
        return res.json({
            id: report.id,
            name: report.name,
            type: report.type,
            format: report.format,
            rowCount: (report.resultSummary as any)?.rowCount ?? null,
            previewText: lines.join("\n"),
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Generate a new report
reportsRouter.post("/generate", async (req, res) => {
    try {
        const { templateId, name, parameters, format = "json" } = req.body;
        const normalizedFormat = normalizeFormat(format);
        const userId = getUserId(req) || null;
        const requesterIp = req.ip || (req.socket as any)?.remoteAddress || null;
        const requesterUa = req.headers["user-agent"] || null;

        // Get template if provided
        let template;
        let reportType = "custom";
        let reportName = name || "Custom Report";

        if (templateId) {
            template = await storage.getReportTemplate(templateId);
            if (!template) {
                return res.status(404).json({ error: "Template not found" });
            }
            reportType = template.type;
            reportName = name || template.name;
        }

        // Create report record
        const report = await storage.createGeneratedReport({
            templateId,
            name: reportName,
            type: reportType,
            status: "processing",
            parameters: parameters || {},
            format: normalizedFormat,
            generatedBy: userId
        });

        // Generate report data asynchronously
        (async () => {
            try {
                let data: any[] = [];
                let rowCount = 0;

                const dateFrom = parseDateStart(parameters?.dateFrom);
                const dateTo = parseDateEnd(parameters?.dateTo);

                switch (reportType) {
                    case "user_report":
                        {
                            const conditions: any[] = [];
                            if (dateFrom) conditions.push(gte(users.createdAt, dateFrom));
                            if (dateTo) conditions.push(lte(users.createdAt, dateTo));

                            const plan = normalizeText(parameters?.plan);
                            const status = normalizeText(parameters?.status);
                            const role = normalizeText(parameters?.role);
                            const orgId = normalizeText(parameters?.orgId);
                            const authProvider = normalizeText(parameters?.authProvider);
                            const email = normalizeText(parameters?.email);

                            if (plan && plan !== "all") conditions.push(eq(users.plan, plan));
                            if (status && status !== "all") conditions.push(eq(users.status, status));
                            if (role && role !== "all") conditions.push(eq(users.role, role));
                            if (orgId && orgId !== "all") conditions.push(eq(users.orgId, orgId));
                            if (authProvider && authProvider !== "all") conditions.push(eq(users.authProvider, authProvider));
                            if (email) conditions.push(ilike(users.email, `%${email}%`));
                            const whereClause = conditions.length ? and(...conditions) : undefined;

                            const rows = await dbRead
                                .select({
                                    id: users.id,
                                    email: users.email,
                                    username: users.username,
                                    fullName: users.fullName,
                                    plan: users.plan,
                                    role: users.role,
                                    status: users.status,
                                    orgId: users.orgId,
                                    authProvider: users.authProvider,
                                    lastLoginAt: users.lastLoginAt,
                                    lastIp: users.lastIp,
                                    createdAt: users.createdAt,
                                })
                                .from(users)
                                .where(whereClause)
                                .orderBy(desc(users.createdAt));

                            data = rows.map((u) => ({
                                id: u.id,
                                email: u.email,
                                fullName: u.fullName || u.username || u.email || "",
                                plan: u.plan,
                                role: u.role,
                                status: u.status,
                                orgId: u.orgId,
                                authProvider: u.authProvider,
                                lastLoginAt: u.lastLoginAt,
                                lastIp: u.lastIp,
                                createdAt: u.createdAt,
                            }));
                        }
                        break;

                    case "ai_models_report":
                        {
                            const conditions: any[] = [];
                            if (dateFrom) conditions.push(gte(aiModels.createdAt, dateFrom));
                            if (dateTo) conditions.push(lte(aiModels.createdAt, dateTo));

                            const provider = normalizeText(parameters?.provider);
                            const status = normalizeText(parameters?.status);
                            const isEnabled = normalizeTextBool(parameters?.isEnabled);
                            const modelType = normalizeText(parameters?.modelType);

                            if (provider && provider !== "all") conditions.push(eq(aiModels.provider, provider));
                            if (status && status !== "all") conditions.push(eq(aiModels.status, status));
                            if (isEnabled) conditions.push(eq(aiModels.isEnabled, isEnabled));
                            if (modelType && modelType !== "all") conditions.push(eq(aiModels.modelType, modelType));
                            const whereClause = conditions.length ? and(...conditions) : undefined;

                            const rows = await dbRead
                                .select({
                                    name: aiModels.name,
                                    provider: aiModels.provider,
                                    modelId: aiModels.modelId,
                                    status: aiModels.status,
                                    isEnabled: aiModels.isEnabled,
                                    modelType: aiModels.modelType,
                                    usagePercent: aiModels.usagePercent,
                                    enabledAt: aiModels.enabledAt,
                                    enabledByAdminId: aiModels.enabledByAdminId,
                                    enabledByEmail: users.email,
                                    createdAt: aiModels.createdAt,
                                })
                                .from(aiModels)
                                .leftJoin(users, eq(users.id, aiModels.enabledByAdminId))
                                .where(whereClause)
                                .orderBy(desc(aiModels.createdAt));

                            data = rows.map((m) => ({
                                name: m.name,
                                provider: m.provider,
                                modelId: m.modelId,
                                status: m.status,
                                isEnabled: m.isEnabled,
                                modelType: m.modelType,
                                usagePercent: m.usagePercent,
                                enabledAt: m.enabledAt,
                                enabledByAdminId: m.enabledByAdminId,
                                enabledByEmail: m.enabledByEmail,
                                createdAt: m.createdAt,
                            }));
                        }
                        break;

                    case "security_report":
                        {
                            const conditions: any[] = [];
                            if (dateFrom) conditions.push(gte(auditLogs.createdAt, dateFrom));
                            if (dateTo) conditions.push(lte(auditLogs.createdAt, dateTo));

                            const action = normalizeText(parameters?.action);
                            const resource = normalizeText(parameters?.resource);
                            const actorUserId = normalizeText(parameters?.userId);
                            const userEmail = normalizeText(parameters?.userEmail);

                            if (action && action !== "all") conditions.push(eq(auditLogs.action, action));
                            if (resource && resource !== "all") conditions.push(eq(auditLogs.resource, resource));
                            if (actorUserId) conditions.push(eq(auditLogs.userId, actorUserId));
                            if (userEmail) conditions.push(ilike(users.email, `%${userEmail}%`));
                            const whereClause = conditions.length ? and(...conditions) : undefined;

                            const rows = await dbRead
                                .select({
                                    createdAt: auditLogs.createdAt,
                                    action: auditLogs.action,
                                    resource: auditLogs.resource,
                                    userId: auditLogs.userId,
                                    userEmail: users.email,
                                    ipAddress: auditLogs.ipAddress,
                                    userAgent: auditLogs.userAgent,
                                    details: auditLogs.details,
                                })
                                .from(auditLogs)
                                .leftJoin(users, eq(users.id, auditLogs.userId))
                                .where(whereClause)
                                .orderBy(desc(auditLogs.createdAt));

                            data = rows.map((l) => ({
                                createdAt: l.createdAt,
                                action: l.action,
                                resource: l.resource,
                                userId: l.userId,
                                userEmail: l.userEmail,
                                ipAddress: l.ipAddress || "N/A",
                                userAgent: l.userAgent || "N/A",
                                details: l.details,
                            }));
                        }
                        break;

                    case "financial_report":
                        {
                            const conditions: any[] = [];
                            if (dateFrom) conditions.push(gte(payments.createdAt, dateFrom));
                            if (dateTo) conditions.push(lte(payments.createdAt, dateTo));

                            const status = normalizeText(parameters?.status);
                            const method = normalizeText(parameters?.method);
                            const currency = normalizeText(parameters?.currency);
                            const payerUserId = normalizeText(parameters?.userId);
                            const userEmail = normalizeText(parameters?.userEmail);
                            const stripePaymentId = normalizeText(parameters?.stripePaymentId);

                            if (status && status !== "all") conditions.push(eq(payments.status, status));
                            if (method && method !== "all") conditions.push(eq(payments.method, method));
                            if (currency && currency !== "all") conditions.push(eq(payments.currency, currency));
                            if (payerUserId) conditions.push(eq(payments.userId, payerUserId));
                            if (userEmail) conditions.push(ilike(users.email, `%${userEmail}%`));
                            if (stripePaymentId) conditions.push(ilike(payments.stripePaymentId, `%${stripePaymentId}%`));
                            const whereClause = conditions.length ? and(...conditions) : undefined;

                            const rows = await dbRead
                                .select({
                                    createdAt: payments.createdAt,
                                    amount: payments.amount,
                                    currency: payments.currency,
                                    status: payments.status,
                                    method: payments.method,
                                    userId: payments.userId,
                                    userEmail: users.email,
                                    stripePaymentId: payments.stripePaymentId,
                                })
                                .from(payments)
                                .leftJoin(users, eq(users.id, payments.userId))
                                .where(whereClause)
                                .orderBy(desc(payments.createdAt));

                            data = rows.map((p) => ({
                                createdAt: p.createdAt,
                                amount: p.amount,
                                currency: p.currency,
                                status: p.status,
                                method: p.method || "N/A",
                                userId: p.userId,
                                userEmail: p.userEmail,
                                stripePaymentId: p.stripePaymentId,
                            }));
                        }
                        break;

                    default:
                        data = [];
                }

                rowCount = data.length;

                // Save to file
                const fs = require("fs").promises;
                const path = require("path");
                const reportsDir = path.join(process.cwd(), "generated_reports");
                await fs.mkdir(reportsDir, { recursive: true });

                const timestamp = Date.now();
                const fileName = `${reportType}_${report.id}_${timestamp}.${normalizedFormat}`;
                const filePath = path.join(reportsDir, fileName);

                if (normalizedFormat === "json") {
                    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
                } else if (normalizedFormat === "csv") {
                    await fs.writeFile(filePath, toCsv(data), "utf-8");
                }

                // Update report status
                await storage.updateGeneratedReport(report.id, {
                    status: "completed",
                    filePath: fileName,
                    resultSummary: { rowCount, fileName },
                    completedAt: new Date()
                });

                // Explicit audit log for completion (generation happens async, outside adminActivityTracker timing).
                if (userId) {
                    await storage.createAuditLog({
                        userId,
                        action: AuditActions.REPORT_GENERATED,
                        resource: "reports",
                        resourceId: report.id,
                        details: { reportType, format: normalizedFormat, rowCount, templateId: templateId || null },
                        ipAddress: requesterIp,
                        userAgent: requesterUa,
                    });
                }
            } catch (err: any) {
                await storage.updateGeneratedReport(report.id, {
                    status: "failed",
                    resultSummary: { rowCount: 0, aggregates: { error: err.message } }
                });

                if (userId) {
                    await storage.createAuditLog({
                        userId,
                        action: "report.failed",
                        resource: "reports",
                        resourceId: report.id,
                        details: { error: err.message, reportType, format: normalizedFormat, templateId: templateId || null },
                        ipAddress: requesterIp,
                        userAgent: requesterUa,
                    });
                }
            }
        })();

        res.json(report);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Download generated report
reportsRouter.get("/download/:id", async (req, res) => {
    try {
        const report = await storage.getGeneratedReport(req.params.id);
        if (!report) {
            return res.status(404).json({ error: "Report not found" });
        }
        if (report.status !== "completed") {
            return res.status(400).json({ error: "Report is not ready for download" });
        }

        const fs = require("fs").promises;
        const path = require("path");

        const reportsDir = path.join(process.cwd(), "generated_reports");
        const files = await fs.readdir(reportsDir).catch(() => []);

        let reportFile: string | undefined;
        const stored = report.filePath && typeof report.filePath === "string" ? report.filePath : null;
        if (stored && !stored.startsWith("/api/")) {
            reportFile = path.basename(stored);
        }

        // Prefer an ID-specific file (new naming scheme).
        if (!reportFile) {
            const byId = files.filter((f: string) => f.includes(report.id) && f.endsWith(`.${report.format}`));
            reportFile = await pickNewestFile(reportsDir, byId);
        }

        // Backwards compat: fall back to newest by report.type + extension.
        if (!reportFile) {
            const byType = files.filter((f: string) => f.includes(report.type) && f.endsWith(`.${report.format}`));
            reportFile = await pickNewestFile(reportsDir, byType);
        }

        if (!reportFile) {
            return res.status(404).json({ error: "Report file not found" });
        }

        const filePath = path.join(reportsDir, reportFile);
        const content = await fs.readFile(filePath, "utf-8");

        const contentType = report.format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8";
        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Disposition", `attachment; filename="${sanitizeDownloadFileName(report.name)}.${report.format}"`);

        // Track exports (GETs are not captured by adminActivityTracker/globalAuditMiddleware).
        await auditLog(req, {
            action: AuditActions.REPORT_EXPORTED,
            resource: "reports",
            resourceId: report.id,
            details: { type: report.type, format: report.format, templateId: report.templateId || null },
            category: "data",
            severity: "info",
        });

        res.send(content);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Generate PDF report
reportsRouter.post("/generate-pdf/:id", async (req, res) => {
    try {
        const report = await storage.getGeneratedReport(req.params.id);
        if (!report) {
            return res.status(404).json({ error: "Report not found" });
        }

        // Simple HTML-to-PDF using template
        const fs = require("fs").promises;
        const path = require("path");

        const reportsDir = path.join(process.cwd(), "generated_reports");
        const files = await fs.readdir(reportsDir).catch(() => []);
        const stored = report.filePath && typeof report.filePath === "string" ? report.filePath : null;
        const storedJson = stored && !stored.startsWith("/api/") && stored.endsWith(".json") ? path.basename(stored) : null;

        let jsonFile: string | undefined = storedJson || undefined;
        if (!jsonFile) {
            const byId = files.filter((f: string) => f.includes(report.id) && f.endsWith(".json"));
            jsonFile = await pickNewestFile(reportsDir, byId);
        }
        if (!jsonFile) {
            const byType = files.filter((f: string) => f.includes(report.type) && f.endsWith(".json"));
            jsonFile = await pickNewestFile(reportsDir, byType);
        }

        let data: any[] = [];
        if (jsonFile) {
            const content = await fs.readFile(path.join(reportsDir, jsonFile), "utf-8");
            data = JSON.parse(content);
        }

        // Generate HTML for PDF
        const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>${report.name}</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 40px; }
        h1 { color: #333; border-bottom: 2px solid #667eea; padding-bottom: 10px; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th { background: #667eea; color: white; padding: 12px; text-align: left; }
        td { padding: 10px; border-bottom: 1px solid #ddd; }
        tr:nth-child(even) { background: #f9f9f9; }
        .footer { margin-top: 40px; color: #666; font-size: 12px; }
    </style>
</head>
<body>
    <h1>${report.name}</h1>
    <p>Generado: ${new Date().toLocaleDateString('es')}</p>
    <p>Total de registros: ${data.length}</p>
    
    <table>
        <thead>
            <tr>${data.length > 0 ? Object.keys(data[0]).map(k => `<th>${k}</th>`).join('') : ''}</tr>
        </thead>
        <tbody>
            ${data.slice(0, 100).map(row => 
                `<tr>${Object.values(row).map(v => `<td>${v ?? ''}</td>`).join('')}</tr>`
            ).join('')}
        </tbody>
    </table>
    
    <div class="footer">
        <p>IliaGPT - Reporte generado automáticamente</p>
    </div>
</body>
</html>`;

        // Return HTML that can be printed to PDF by browser
        res.setHeader("Content-Type", "text/html");
        res.setHeader("Content-Disposition", `attachment; filename="${report.name.replace(/\s+/g, "_")}.html"`);
        res.send(htmlContent);

    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Delete generated report
reportsRouter.delete("/generated/:id", async (req, res) => {
    try {
        const report = await storage.getGeneratedReport(req.params.id);
        await storage.deleteGeneratedReport(req.params.id);

        // Best-effort cleanup of the generated file on disk.
        try {
            const fs = require("fs").promises;
            const path = require("path");
            const reportsDir = path.join(process.cwd(), "generated_reports");
            const files = await fs.readdir(reportsDir).catch(() => []);

            const stored = report?.filePath && typeof report.filePath === "string" ? report.filePath : null;
            const storedFile = stored && !stored.startsWith("/api/") ? path.basename(stored) : null;

            const candidates = storedFile
                ? [storedFile]
                : files.filter((f: string) => f.includes(req.params.id));

            for (const f of candidates) {
                try {
                    await fs.unlink(path.join(reportsDir, f));
                } catch {
                    // ignore
                }
            }
        } catch {
            // ignore cleanup errors
        }

        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});
