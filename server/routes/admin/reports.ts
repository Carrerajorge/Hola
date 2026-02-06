import { Router } from "express";
import { getUserId } from "../../types/express";
import { storage } from "../../storage";
import { auditLog, AuditActions } from "../../services/auditLogger";
import { db, dbRead } from "../../db";
import { payments, scheduledReports, users } from "@shared/schema";
import { and, asc, desc, eq, gte, lte, or, sql, type SQL } from "drizzle-orm";

export const reportsRouter = Router();

function normalizeReportParameters(parameters: any): Record<string, any> {
    const params: Record<string, any> = { ...(parameters || {}) };

    // Backwards/forwards compatibility: the UI used dateFrom/dateTo while generators use createdFrom/createdTo.
    if (params.dateFrom && !params.createdFrom) params.createdFrom = params.dateFrom;
    if (params.dateTo && !params.createdTo) params.createdTo = params.dateTo;

    return params;
}

type ParsedCron = { minute: number; hour: number; dayOfWeek: number | null };

function parseSupportedCronExpression(expression: string): ParsedCron | null {
    const expr = String(expression || "").trim().replace(/\s+/g, " ");
    const parts = expr.split(" ");
    if (parts.length != 5) return null;

    const [minStr, hourStr, dom, mon, dowStr] = parts;
    if (dom != "*" || mon != "*") return null;

    const minute = Number.parseInt(minStr, 10);
    const hour = Number.parseInt(hourStr, 10);
    if (!Number.isFinite(minute) || minute < 0 || minute > 59) return null;
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;

    if (dowStr === "*") {
        return { minute, hour, dayOfWeek: null };
    }

    const rawDow = Number.parseInt(dowStr, 10);
    if (!Number.isFinite(rawDow)) return null;
    // Accept 0-6 (Sun-Sat) and 7 (Sun)
    const normalized = rawDow === 7 ? 0 : rawDow;
    if (normalized < 0 || normalized > 6) return null;

    return { minute, hour, dayOfWeek: normalized };
}

function computeNextRunAt(expression: string, from: Date = new Date()): Date | null {
    const parsed = parseSupportedCronExpression(expression);
    if (!parsed) return null;

    const base = new Date(from.getTime());
    const next = new Date(from.getTime());
    next.setSeconds(0, 0);
    next.setHours(parsed.hour, parsed.minute, 0, 0);

    if (parsed.dayOfWeek == null) {
        if (next.getTime() <= base.getTime()) {
            next.setDate(next.getDate() + 1);
        }
        return next;
    }

    const currentDow = base.getDay();
    let deltaDays = (parsed.dayOfWeek - currentDow) % 7;
    if (deltaDays < 0) deltaDays += 7;

    // If today is the day but time already passed, schedule next week.
    if (deltaDays == 0 && next.getTime() <= base.getTime()) {
        deltaDays = 7;
    }

    next.setDate(base.getDate() + deltaDays);
    next.setHours(parsed.hour, parsed.minute, 0, 0);
    return next;
}

async function generateReportData(reportType: string, parameters: any): Promise<any[]> {
    switch (reportType) {
        case "user_report": {
            // Safety: exporting every user doesn't scale. Support basic filtering + hard limits.
            const params = normalizeReportParameters(parameters);
            const limitParam = parseInt(String(params.limit ?? ""), 10);
            const limitNum = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : 5000, 1), 50000);

            const userConditions: SQL[] = [];
            if (params.plan) userConditions.push(eq(users.plan, String(params.plan)));
            if (params.status) userConditions.push(eq(users.status, String(params.status)));
            if (params.role) userConditions.push(eq(users.role, String(params.role)));
            if (params.createdFrom) userConditions.push(gte(users.createdAt, new Date(String(params.createdFrom))));
            if (params.createdTo) userConditions.push(lte(users.createdAt, new Date(String(params.createdTo))));

            if (params.search) {
                const q = `%${String(params.search)}%`;
                const searchCondition = or(
                    sql`${users.email} ilike ${q}`,
                    sql`${users.username} ilike ${q}`,
                    sql`${users.fullName} ilike ${q}`
                );
                if (searchCondition) userConditions.push(searchCondition);
            }

            const whereClause = userConditions.length > 0 ? and(...userConditions) : undefined;
            const userQuery = whereClause
                ? dbRead.select({
                    email: users.email,
                    fullName: users.fullName,
                    username: users.username,
                    plan: users.plan,
                    role: users.role,
                    status: users.status,
                    createdAt: users.createdAt,
                }).from(users).where(whereClause)
                : dbRead.select({
                    email: users.email,
                    fullName: users.fullName,
                    username: users.username,
                    plan: users.plan,
                    role: users.role,
                    status: users.status,
                    createdAt: users.createdAt,
                }).from(users);

            const userRows = await userQuery
                .orderBy(desc(users.createdAt), desc(users.id))
                .limit(limitNum);

            return userRows.map(u => ({
                email: u.email,
                fullName: u.fullName || u.username,
                plan: u.plan,
                role: u.role,
                status: u.status,
                createdAt: u.createdAt,
            }));
        }

        case "ai_models_report": {
            const models = await storage.getAiModels();
            return models.map(m => ({
                name: m.name,
                provider: m.provider,
                modelId: m.modelId,
                isEnabled: m.isEnabled,
                modelType: m.modelType || "text"
            }));
        }

        case "security_report": {
            const logs = await storage.getAuditLogs(1000);
            return logs.map(l => ({
                createdAt: l.createdAt,
                action: l.action,
                resource: l.resource,
                ipAddress: l.ipAddress || "N/A",
                details: l.details
            }));
        }

        case "financial_report": {
            // Safety: exporting every payment doesn't scale. Support basic filtering + hard limits.
            const paymentParams = normalizeReportParameters(parameters);
            const paymentLimitParam = parseInt(String(paymentParams.limit ?? ""), 10);
            const paymentLimitNum = Math.min(Math.max(Number.isFinite(paymentLimitParam) ? paymentLimitParam : 5000, 1), 50000);

            const paymentConditions: SQL[] = [];
            if (paymentParams.status) paymentConditions.push(eq(payments.status, String(paymentParams.status)));
            if (paymentParams.userId) paymentConditions.push(eq(payments.userId, String(paymentParams.userId)));
            if (paymentParams.createdFrom) paymentConditions.push(gte(payments.createdAt, new Date(String(paymentParams.createdFrom))));
            if (paymentParams.createdTo) paymentConditions.push(lte(payments.createdAt, new Date(String(paymentParams.createdTo))));

            const paymentWhereClause = paymentConditions.length > 0 ? and(...paymentConditions) : undefined;
            const paymentQuery = paymentWhereClause
                ? dbRead.select({
                    createdAt: payments.createdAt,
                    amount: payments.amount,
                    status: payments.status,
                    method: payments.method,
                }).from(payments).where(paymentWhereClause)
                : dbRead.select({
                    createdAt: payments.createdAt,
                    amount: payments.amount,
                    status: payments.status,
                    method: payments.method,
                }).from(payments);

            const paymentRows = await paymentQuery
                .orderBy(desc(payments.createdAt), desc(payments.id))
                .limit(paymentLimitNum);

            return paymentRows.map(p => ({
                createdAt: p.createdAt,
                amount: p.amount,
                status: p.status,
                method: p.method || "N/A"
            }));
        }

        default:
            return [];
    }
}

async function writeReportFile(reportId: string, reportType: string, format: string, data: any[]): Promise<string> {
    const fs = require("fs").promises;
    const path = require("path");
    const reportsDir = path.join(process.cwd(), "generated_reports");
    await fs.mkdir(reportsDir, { recursive: true });

    const safeType = String(reportType || "report").toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
    const safeId = String(reportId || Date.now()).replace(/[^a-z0-9_-]+/gi, "_");
    const safeFormat = format === "csv" ? "csv" : "json";

    const fileName = `${safeId}_${safeType}.${safeFormat}`;
    const filePath = path.join(reportsDir, fileName);

    if (safeFormat === "json") {
        await fs.writeFile(filePath, JSON.stringify(data, null, 2));
        return fileName;
    }

    // CSV
    if (data.length > 0) {
        const headers = Object.keys(data[0]);
        const csvRows = [headers.join(",")];
        for (const row of data) {
            csvRows.push(headers.map((h: string) => {
                const val = (row as any)[h];
                if (val === null || val === undefined) return "";
                if (typeof val === "object") return JSON.stringify(val).replace(/,/g, ";");
                return String(val).replace(/,/g, ";");
            }).join(","));
        }
        await fs.writeFile(filePath, csvRows.join("\n"));
    } else {
        await fs.writeFile(filePath, "");
    }
    return fileName;
}

function startReportGeneration(report: any, reportType: string, parameters: any, format: string): void {
    (async () => {
        try {
            const data = await generateReportData(reportType, parameters);
            const rowCount = data.length;

            const fileName = await writeReportFile(report.id, reportType, format, data);

            await storage.updateGeneratedReport(report.id, {
                status: "completed",
                filePath: fileName,
                resultSummary: { rowCount },
                completedAt: new Date()
            });
        } catch (err: any) {
            await storage.updateGeneratedReport(report.id, {
                status: "failed",
                resultSummary: { rowCount: 0, aggregates: { error: err?.message || String(err) } }
            });
        }
    })();
}

async function queueGeneratedReport(params: {
    templateId?: string | null;
    name: string;
    type: string;
    parameters?: any;
    format?: string;
    generatedBy?: string | null;
}): Promise<any> {
    const report = await storage.createGeneratedReport({
        templateId: params.templateId || null,
        name: params.name,
        type: params.type,
        status: "processing",
        parameters: params.parameters || {},
        format: params.format || "json",
        generatedBy: params.generatedBy || null
    });

    startReportGeneration(report, params.type, params.parameters || {}, params.format || "json");
    return report;
}

// Get all report templates
reportsRouter.get("/templates", async (req, res) => {
    try {
        let templates = await storage.getReportTemplates();

        // Seed system templates if none exist
        if (templates.length === 0) {
            const systemTemplates = [
                {
                    name: "Users Report",
                    type: "user_report",
                    description: "Export all users with their plan, role, and status information",
                    columns: [
                        { key: "email", label: "Email", type: "string" },
                        { key: "fullName", label: "Name", type: "string" },
                        { key: "plan", label: "Plan", type: "string" },
                        { key: "role", label: "Role", type: "string" },
                        { key: "status", label: "Status", type: "string" },
                        { key: "createdAt", label: "Created At", type: "date" }
                    ],
                    filters: [
                        { key: "plan", label: "Plan", type: "select" },
                        { key: "status", label: "Status", type: "select" },
                        { key: "role", label: "Role", type: "select" }
                    ],
                    isSystem: "true"
                },
                {
                    name: "AI Models Report",
                    type: "ai_models_report",
                    description: "Export all AI models with provider and usage information",
                    columns: [
                        { key: "name", label: "Name", type: "string" },
                        { key: "provider", label: "Provider", type: "string" },
                        { key: "modelId", label: "Model ID", type: "string" },
                        { key: "isEnabled", label: "Enabled", type: "boolean" },
                        { key: "modelType", label: "Type", type: "string" }
                    ],
                    filters: [
                        { key: "provider", label: "Provider", type: "select" },
                        { key: "isEnabled", label: "Enabled", type: "boolean" }
                    ],
                    isSystem: "true"
                },
                {
                    name: "Security Audit Report",
                    type: "security_report",
                    description: "Export audit logs for security analysis",
                    columns: [
                        { key: "createdAt", label: "Timestamp", type: "date" },
                        { key: "action", label: "Action", type: "string" },
                        { key: "resource", label: "Resource", type: "string" },
                        { key: "ipAddress", label: "IP Address", type: "string" },
                        { key: "details", label: "Details", type: "json" }
                    ],
                    filters: [
                        { key: "action", label: "Action", type: "select" },
                        { key: "resource", label: "Resource", type: "select" }
                    ],
                    isSystem: "true"
                },
                {
                    name: "Financial Summary",
                    type: "financial_report",
                    description: "Export payment and revenue data",
                    columns: [
                        { key: "createdAt", label: "Date", type: "date" },
                        { key: "amount", label: "Amount", type: "number" },
                        { key: "status", label: "Status", type: "string" },
                        { key: "method", label: "Method", type: "string" }
                    ],
                    filters: [
                        { key: "status", label: "Status", type: "select" }
                    ],
                    isSystem: "true"
                }
            ];

            for (const template of systemTemplates) {
                await storage.createReportTemplate(template as any);
            }
            templates = await storage.getReportTemplates();
        }

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
        const { page = "1", limit = "20" } = req.query;
        const pageNum = parseInt(page as string);
        const limitNum = Math.min(parseInt(limit as string), 100);

        const reports = await storage.getGeneratedReports(limitNum * pageNum);
        const paginatedReports = reports.slice((pageNum - 1) * limitNum, pageNum * limitNum);

        res.json({
            data: paginatedReports,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: reports.length,
                totalPages: Math.ceil(reports.length / limitNum)
            }
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Scheduled reports (recurring)
reportsRouter.get("/scheduled", async (_req, res) => {
    try {
        const rows = await dbRead
            .select()
            .from(scheduledReports)
            .orderBy(desc(scheduledReports.createdAt));
        res.json(rows);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

reportsRouter.post("/scheduled", async (req, res) => {
    try {
        const { name, type, parameters, schedule, recipients, isActive, format } = req.body || {};
        if (!name || !type || !schedule) {
            return res.status(400).json({ error: "name, type, and schedule are required" });
        }

        const createdBy = getUserId(req);
        if (!createdBy) {
            return res.status(401).json({ error: "Authentication required" });
        }

        const activeText = (isActive === false || isActive === "false" || isActive === 0 || isActive === "0") ? "false" : "true";
        const nextRunAt = activeText === "true" ? computeNextRunAt(String(schedule), new Date()) : null;
        if (activeText === "true" && !nextRunAt) {
            return res.status(400).json({ error: "Unsupported schedule format. Use 'm h * * *' or 'm h * * d'." });
        }

        const params: any = { ...(parameters || {}) };
        if (format && !params.format) params.format = String(format);

        const recipientList = Array.isArray(recipients)
            ? [
                ...new Set(
                    recipients
                        .map((r: any) => String(r || "").trim())
                        .filter(Boolean)
                )
            ]
            : [];

        const [row] = await db
            .insert(scheduledReports)
            .values({
                name: String(name),
                type: String(type),
                parameters: params,
                schedule: String(schedule),
                recipients: recipientList.length ? recipientList : null,
                isActive: activeText,
                lastRunAt: null,
                nextRunAt,
                createdBy,
                updatedAt: new Date(),
            })
            .returning();

        res.json(row);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

reportsRouter.patch("/scheduled/:id", async (req, res) => {
    try {
        const id = String(req.params.id || "").trim();
        if (!id) return res.status(400).json({ error: "id is required" });

        const [existing] = await dbRead.select().from(scheduledReports).where(eq(scheduledReports.id, id)).limit(1);
        if (!existing) return res.status(404).json({ error: "Scheduled report not found" });

        const body = req.body || {};
        const updates: any = { updatedAt: new Date() };

        if (body.name != null) updates.name = String(body.name);
        if (body.type != null) updates.type = String(body.type);

        const nextSchedule = body.schedule != null ? String(body.schedule) : String(existing.schedule);
        if (body.schedule != null) updates.schedule = nextSchedule;

        const nextActiveText = body.isActive != null
            ? ((body.isActive === false || body.isActive === "false" || body.isActive === 0 || body.isActive === "0") ? "false" : "true")
            : String(existing.isActive || "true");
        if (body.isActive != null) updates.isActive = nextActiveText;

        let nextRunAt = null;
        if (nextActiveText === "true") {
            nextRunAt = computeNextRunAt(nextSchedule, new Date());
            if (!nextRunAt) {
                return res.status(400).json({ error: "Unsupported schedule format. Use 'm h * * *' or 'm h * * d'." });
            }
        }
        updates.nextRunAt = nextRunAt;

        if (body.recipients != null) {
            const recipientList = Array.isArray(body.recipients)
                ? [
                    ...new Set(
                        body.recipients
                            .map((r: any) => String(r || "").trim())
                            .filter(Boolean)
                    )
                ]
                : [];
            updates.recipients = recipientList.length ? recipientList : null;
        }

        if (body.parameters != null) {
            updates.parameters = { ...(body.parameters || {}) };
        }
        if (body.format != null) {
            updates.parameters = { ...(updates.parameters || existing.parameters || {}), format: String(body.format) };
        }

        const [row] = await db
            .update(scheduledReports)
            .set(updates)
            .where(eq(scheduledReports.id, id))
            .returning();

        res.json(row);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

reportsRouter.delete("/scheduled/:id", async (req, res) => {
    try {
        const id = String(req.params.id || "").trim();
        if (!id) return res.status(400).json({ error: "id is required" });

        await db.delete(scheduledReports).where(eq(scheduledReports.id, id));
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

reportsRouter.post("/scheduled/:id/run-now", async (req, res) => {
    try {
        const id = String(req.params.id || "").trim();
        if (!id) return res.status(400).json({ error: "id is required" });

        const [sched] = await dbRead.select().from(scheduledReports).where(eq(scheduledReports.id, id)).limit(1);
        if (!sched) return res.status(404).json({ error: "Scheduled report not found" });

        const params: any = { ...(sched.parameters || {}), scheduledReportId: sched.id };
        const format = String((sched as any).parameters?.format || "json");

        const report = await queueGeneratedReport({
            templateId: null,
            name: sched.name,
            type: sched.type,
            parameters: params,
            format,
            generatedBy: sched.createdBy || getUserId(req) || null,
        });

        const now = new Date();
        const nextRunAt = String(sched.isActive || "true") === "true" ? computeNextRunAt(String(sched.schedule), now) : null;

        await db
            .update(scheduledReports)
            .set({
                lastRunAt: now,
                nextRunAt: nextRunAt || null,
                updatedAt: now,
            })
            .where(eq(scheduledReports.id, id));

        res.json({ success: true, report });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Generate a new report
reportsRouter.post("/generate", async (req, res) => {
    try {
        const { templateId, name, parameters, format = "json" } = req.body;
        const userId = getUserId(req) || null;

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

        const report = await queueGeneratedReport({
            templateId: templateId || null,
            name: reportName,
            type: reportType,
            parameters: parameters || {},
            format,
            generatedBy: userId,
        });

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

        const candidate = typeof report.filePath === "string" ? report.filePath.trim() : "";
        let reportFile = "";

        if (candidate && !candidate.startsWith("/") && candidate.endsWith(`.${report.format}`)) {
            reportFile = path.basename(candidate);
        }

        if (!reportFile) {
            // New format: `${id}_${type}.${ext}`
            reportFile = files.find((f: string) => f.startsWith(`${report.id}_`) && f.endsWith(`.${report.format}`)) || "";
        }

        if (!reportFile) {
            // Legacy fallback
            reportFile = files.find((f: string) => f.includes(report.type) && f.endsWith(`.${report.format}`)) || "";
        }

        if (!reportFile) {
            return res.status(404).json({ error: "Report file not found" });
        }

        const filePath = path.join(reportsDir, path.basename(reportFile));
        const content = await fs.readFile(filePath, "utf-8");

        const contentType = report.format === "json" ? "application/json" : "text/csv";
        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Disposition", `attachment; filename="${report.name.replace(/\s+/g, "_")}.${report.format}"`);
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

        const candidate = typeof report.filePath === "string" ? report.filePath.trim() : "";
        let jsonFile = "";

        if (candidate && !candidate.startsWith("/") && candidate.endsWith(".json")) {
            jsonFile = path.basename(candidate);
        }

        if (!jsonFile) {
            // Preferred: `${id}_${type}.json`
            jsonFile = files.find((f: string) => f.startsWith(`${report.id}_`) && f.endsWith(".json")) || "";
        }

        if (!jsonFile) {
            // Legacy fallback (may pick the wrong report if multiple exist)
            jsonFile = files.find((f: string) => f.includes(report.type) && f.endsWith(".json")) || "";
        }

        let data: any[] = [];
        if (jsonFile) {
            const content = await fs.readFile(path.join(reportsDir, path.basename(jsonFile)), "utf-8");
            data = JSON.parse(content);
        }

        // Generate HTML for PDF
        const escapeHtml = (value: any): string => {
            return String(value ?? "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#39;");
        };

        const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>${escapeHtml(report.name)}</title>
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
    <h1>${escapeHtml(report.name)}</h1>
    <p>Generado: ${new Date().toLocaleDateString('es')}</p>
    <p>Total de registros: ${data.length}</p>
    
    <table>
        <thead>
            <tr>${data.length > 0 ? Object.keys(data[0]).map(k => `<th>${escapeHtml(k)}</th>`).join('') : ''}</tr>
        </thead>
        <tbody>
            ${data.slice(0, 100).map(row => 
                `<tr>${Object.values(row).map(v => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`
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
        await storage.deleteGeneratedReport(req.params.id);
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});


// ============================================
// Scheduled Reports Runner (DB polling)
// ============================================

let scheduledReportsRunnerStarted = false;
let scheduledReportsRunnerInFlight = false;

function isScheduledReportsRunnerEnabled(): boolean {
    const raw = String(process.env.SCHEDULED_REPORTS_DISABLED || "").trim().toLowerCase();
    return raw !== "true" && raw !== "1";
}

async function runDueScheduledReports(): Promise<void> {
    if (scheduledReportsRunnerInFlight) return;
    scheduledReportsRunnerInFlight = true;

    try {
        const now = new Date();

        const due = await dbRead
            .select()
            .from(scheduledReports)
            .where(and(
                eq(scheduledReports.isActive, "true"),
                sql`${scheduledReports.nextRunAt} is not null`,
                lte(scheduledReports.nextRunAt, now)
            ))
            .orderBy(asc(scheduledReports.nextRunAt))
            .limit(10);

        for (const sched of due) {
            const next = computeNextRunAt(String(sched.schedule), now);

            // Claim the schedule by moving next_run_at forward (prevents duplicate runs across replicas).
            const [claimed] = await db
                .update(scheduledReports)
                .set({
                    lastRunAt: now,
                    nextRunAt: next || null,
                    updatedAt: now,
                    // If schedule becomes invalid, disable it.
                    isActive: next ? "true" : "false",
                })
                .where(and(
                    eq(scheduledReports.id, sched.id),
                    eq(scheduledReports.isActive, "true"),
                    sql`${scheduledReports.nextRunAt} is not null`,
                    lte(scheduledReports.nextRunAt, now)
                ))
                .returning();

            if (!claimed) continue;

            if (!next) {
                console.warn(`[ScheduledReports] Disabled invalid schedule id=${sched.id} schedule=${sched.schedule}`);
                continue;
            }

            try {
                const params: any = { ...(sched.parameters || {}), scheduledReportId: sched.id };
                const format = String((sched as any).parameters?.format || "json");

                await queueGeneratedReport({
                    templateId: null,
                    name: sched.name,
                    type: sched.type,
                    parameters: params,
                    format,
                    generatedBy: sched.createdBy || null,
                });
            } catch (err) {
                console.error(`[ScheduledReports] Failed to queue scheduled report id=${sched.id}:`, err);
            }
        }
    } catch (error) {
        console.error('[ScheduledReports] Runner tick failed:', error);
    } finally {
        scheduledReportsRunnerInFlight = false;
    }
}

function startScheduledReportsRunner(): void {
    if (scheduledReportsRunnerStarted) return;
    scheduledReportsRunnerStarted = true;

    const pollMsRaw = parseInt(String(process.env.SCHEDULED_REPORTS_POLL_MS || "60000"), 10);
    const pollMs = Number.isFinite(pollMsRaw) ? Math.max(pollMsRaw, 5000) : 60000;

    // Kick once on startup.
    runDueScheduledReports().catch(() => undefined);

    const timer = setInterval(() => {
        runDueScheduledReports().catch(() => undefined);
    }, pollMs);

    // Do not keep the process alive solely for scheduling.
    (timer as any).unref?.();

    console.log(`[ScheduledReports] Runner started (pollMs=${pollMs})`);
}

if (isScheduledReportsRunnerEnabled()) {
    startScheduledReportsRunner();
}
