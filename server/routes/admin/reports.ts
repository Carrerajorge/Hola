import { Router } from "express";
import { AuthenticatedRequest } from "../../types/express";
import { storage } from "../../storage";
import { auditLog, AuditActions } from "../../services/auditLogger";
import ExcelJS from "exceljs";
import * as fs from "node:fs/promises";
import path from "node:path";

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

                // Save to file (report.id ensures uniqueness across runs)
                const reportsDir = path.join(process.cwd(), "generated_reports");
                await fs.mkdir(reportsDir, { recursive: true });

                const normalizedFormat = String(format || "json").toLowerCase();
                const fileName = `${report.id}.${normalizedFormat}`;
                const filePath = path.join(reportsDir, fileName);

                if (normalizedFormat === "json") {
                    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
                } else if (normalizedFormat === "csv") {
                    // Simple CSV generation
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
                        await fs.writeFile(filePath, csvRows.join("\n"), "utf-8");
                    } else {
                        await fs.writeFile(filePath, "", "utf-8");
                    }
                } else if (normalizedFormat === "xlsx") {
                    const workbook = new ExcelJS.Workbook();
                    const sheet = workbook.addWorksheet(reportType.substring(0, 31) || "Report");

                    const keys = data.length > 0 ? Object.keys(data[0]) : [];
                    sheet.columns = keys.map((key) => ({ header: key, key, width: Math.min(40, Math.max(12, key.length + 2)) }));
                    sheet.getRow(1).font = { bold: true };

                    for (const row of data) {
                        // Ensure we only include known keys to keep column order stable.
                        const record: Record<string, any> = {};
                        for (const key of keys) record[key] = row?.[key];
                        sheet.addRow(record);
                    }

                    await workbook.xlsx.writeFile(filePath);
                } else {
                    throw new Error(`Unsupported report format: ${normalizedFormat}`);
                }

                // Update report status
                await storage.updateGeneratedReport(report.id, {
                    status: "completed",
                    filePath: fileName,
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

        const reportsDir = path.join(process.cwd(), "generated_reports");

        const normalizedFormat = String(report.format || "json").toLowerCase();
        const preferredFile = report.filePath ? path.resolve(reportsDir, report.filePath) : null;
        const safePrefix = path.resolve(reportsDir) + path.sep;

        let filePath: string | null = null;
        if (preferredFile && preferredFile.startsWith(safePrefix)) {
            const exists = await fs.stat(preferredFile).then(() => true).catch(() => false);
            if (exists) filePath = preferredFile;
        }

        // Backward compatibility: older reports used name-based search and stored an API URL in filePath.
        if (!filePath) {
            const files = await fs.readdir(reportsDir).catch(() => []);
            const found = files.find((f: string) => f.includes(report.type) && f.endsWith(`.${normalizedFormat}`));
            if (found) filePath = path.join(reportsDir, found);
        }

        if (!filePath) {
            return res.status(404).json({ error: "Report file not found" });
        }

        const buffer = await fs.readFile(filePath);
        const contentType =
            normalizedFormat === "json" ? "application/json" :
            normalizedFormat === "csv" ? "text/csv" :
            normalizedFormat === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" :
            "application/octet-stream";

        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Disposition", `attachment; filename="${report.name.replace(/\s+/g, "_")}.${normalizedFormat}"`);
        res.send(buffer);
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
        const jsonFile = files.find((f: string) => f.includes(report.type) && f.endsWith('.json'));

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
        await storage.deleteGeneratedReport(req.params.id);
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});
