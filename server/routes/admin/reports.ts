import { Router } from "express";
import { AuthenticatedRequest } from "../../types/express";
import { storage } from "../../storage";

// SECURITY FIX #48: CSV formula injection prevention
// Characters that trigger formula execution in spreadsheet applications
const CSV_INJECTION_CHARS = ['=', '+', '-', '@', '\t', '\r', '\n'];

function sanitizeCsvValue(value: any): string {
    if (value === null || value === undefined) return "";

    let str = typeof value === "object" ? JSON.stringify(value) : String(value);

    // Escape double quotes by doubling them
    str = str.replace(/"/g, '""');

    // If value starts with dangerous characters, prefix with single quote (standard CSV protection)
    if (CSV_INJECTION_CHARS.some(char => str.startsWith(char))) {
        str = "'" + str;
    }

    // Wrap in quotes if contains comma, newline, or quote
    if (str.includes(',') || str.includes('\n') || str.includes('\r') || str.includes('"')) {
        str = `"${str}"`;
    }

    return str;
}

export const reportsRouter = Router();

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

// Generate a new report
reportsRouter.post("/generate", async (req, res) => {
    try {
        const { templateId, name, parameters, format = "json" } = req.body;
        const userId = (req as AuthenticatedRequest).user?.id || null;

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
            format,
            generatedBy: userId
        });

        // Generate report data asynchronously
        (async () => {
            try {
                let data: any[] = [];
                let rowCount = 0;

                switch (reportType) {
                    case "user_report":
                        const users = await storage.getAllUsers();
                        data = users.map(u => ({
                            email: u.email,
                            fullName: u.fullName || u.username,
                            plan: u.plan,
                            role: u.role,
                            status: u.status,
                            createdAt: u.createdAt
                        }));
                        break;

                    case "ai_models_report":
                        const models = await storage.getAiModels();
                        data = models.map(m => ({
                            name: m.name,
                            provider: m.provider,
                            modelId: m.modelId,
                            isEnabled: m.isEnabled,
                            modelType: m.modelType || "text"
                        }));
                        break;

                    case "security_report":
                        const logs = await storage.getAuditLogs(1000);
                        data = logs.map(l => ({
                            createdAt: l.createdAt,
                            action: l.action,
                            resource: l.resource,
                            ipAddress: l.ipAddress || "N/A",
                            details: l.details
                        }));
                        break;

                    case "financial_report":
                        const payments = await storage.getPayments();
                        data = payments.map(p => ({
                            createdAt: p.createdAt,
                            amount: p.amount,
                            status: p.status,
                            method: p.method || "N/A"
                        }));
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
                const fileName = `${reportType}_${timestamp}.${format}`;
                const filePath = path.join(reportsDir, fileName);

                if (format === "json") {
                    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
                } else if (format === "csv") {
                    // SECURITY FIX #49: Secure CSV generation with formula injection protection
                    if (data.length > 0) {
                        const headers = Object.keys(data[0]);
                        const csvRows = [headers.map(h => sanitizeCsvValue(h)).join(",")];
                        for (const row of data) {
                            csvRows.push(headers.map((h: string) => {
                                const val = (row as any)[h];
                                return sanitizeCsvValue(val);
                            }).join(","));
                        }
                        await fs.writeFile(filePath, csvRows.join("\n"));
                    } else {
                        await fs.writeFile(filePath, "");
                    }
                }

                // Update report status
                await storage.updateGeneratedReport(report.id, {
                    status: "completed",
                    filePath: `/api/admin/reports/download/${report.id}`,
                    resultSummary: { rowCount },
                    completedAt: new Date()
                });

            } catch (err: any) {
                await storage.updateGeneratedReport(report.id, {
                    status: "failed",
                    resultSummary: { rowCount: 0, aggregates: { error: err.message } }
                });
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
        const files = await fs.readdir(reportsDir);
        const reportFile = files.find((f: string) => f.includes(report.type) && f.endsWith(`.${report.format}`));

        if (!reportFile) {
            return res.status(404).json({ error: "Report file not found" });
        }

        const filePath = path.join(reportsDir, reportFile);
        const content = await fs.readFile(filePath, "utf-8");

        const contentType = report.format === "json" ? "application/json" : "text/csv";
        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Disposition", `attachment; filename="${report.name.replace(/\s+/g, "_")}.${report.format}"`);
        res.send(content);
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
