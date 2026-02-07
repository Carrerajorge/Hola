import { Router } from "express";
import { storage } from "../../storage";
import { sendPaymentEmail } from "../../services/genericEmailService";
import { auditLog, AuditActions } from "../../services/auditLogger";
import ExcelJS from "exceljs";

export const financeRouter = Router();

// GET /api/admin/finance/payments - List payments with pagination and filters
financeRouter.get("/payments", async (req, res) => {
    try {
        const {
            page = "1",
            limit = "20",
            status,
            userId,
            dateFrom,
            dateTo
        } = req.query as Record<string, string>;

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
        const offset = (pageNum - 1) * limitNum;

        let payments = await storage.getPayments();

        // Apply filters
        if (status) {
            payments = payments.filter(p => p.status === status);
        }
        if (userId) {
            payments = payments.filter(p => p.userId === userId);
        }
        if (dateFrom) {
            const fromDate = new Date(dateFrom);
            payments = payments.filter(p => p.createdAt && new Date(p.createdAt) >= fromDate);
        }
        if (dateTo) {
            const toDate = new Date(dateTo);
            payments = payments.filter(p => p.createdAt && new Date(p.createdAt) <= toDate);
        }

        // Sort by date descending
        payments.sort((a, b) => {
            const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return dateB - dateA;
        });

        const total = payments.length;
        const paginatedPayments = payments.slice(offset, offset + limitNum);

        res.json({
            payments: paginatedPayments,
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

financeRouter.get("/payments/stats", async (req, res) => {
    try {
        const stats = await storage.getPaymentStats();
        res.json(stats);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/admin/finance/payments/export - Export payments to CSV/Excel
financeRouter.get("/payments/export", async (req, res) => {
    try {
        const format = String(req.query.format || "csv").toLowerCase();
        let payments = await storage.getPayments();

        // Apply same filters as listing endpoint
        const { status, userId, dateFrom, dateTo } = req.query as Record<string, string>;
        if (status) {
            payments = payments.filter(p => p.status === status);
        }
        if (userId) {
            payments = payments.filter(p => p.userId === userId);
        }
        if (dateFrom) {
            const fromDate = new Date(dateFrom);
            payments = payments.filter(p => p.createdAt && new Date(p.createdAt) >= fromDate);
        }
        if (dateTo) {
            const toDate = new Date(dateTo);
            payments = payments.filter(p => p.createdAt && new Date(p.createdAt) <= toDate);
        }

        await storage.createAuditLog({
            action: "payments_export",
            resource: "payments",
            details: { format, count: payments.length }
        });

        if (format === "csv") {
            const headers = ["id", "userId", "amount", "currency", "status", "method", "createdAt"];
            const csvRows = [headers.join(",")];
            payments.forEach(p => {
                csvRows.push([
                    p.id,
                    p.userId || "",
                    p.amount || 0,
                    p.currency || "USD",
                    p.status || "",
                    p.method || "",
                    p.createdAt?.toISOString?.() || p.createdAt || ""
                ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
            });
            res.setHeader("Content-Type", "text/csv");
            res.setHeader("Content-Disposition", `attachment; filename=payments_${Date.now()}.csv`);
            res.send(csvRows.join("\n"));
        } else if (format === "xlsx") {
            const workbook = new ExcelJS.Workbook();
            const sheet = workbook.addWorksheet("Payments");

            sheet.columns = [
                { header: "ID", key: "id", width: 36 },
                { header: "User ID", key: "userId", width: 28 },
                { header: "Amount", key: "amount", width: 14 },
                { header: "Currency", key: "currency", width: 10 },
                { header: "Status", key: "status", width: 14 },
                { header: "Method", key: "method", width: 18 },
                { header: "Created At", key: "createdAt", width: 20 },
            ];
            sheet.getRow(1).font = { bold: true };
            sheet.getColumn("createdAt").numFmt = "yyyy-mm-dd hh:mm";

            for (const p of payments) {
                sheet.addRow({
                    id: p.id,
                    userId: p.userId || "",
                    amount: Number(p.amount || 0),
                    currency: p.currency || "USD",
                    status: p.status || "",
                    method: p.method || "",
                    createdAt: p.createdAt ? new Date(p.createdAt as any) : null,
                });
            }

            const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
            res.setHeader(
                "Content-Type",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            );
            res.setHeader("Content-Disposition", `attachment; filename=payments_${Date.now()}.xlsx`);
            res.send(buffer);
        } else if (format === "json") {
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Content-Disposition", `attachment; filename=payments_${Date.now()}.json`);
            res.json(payments);
        } else {
            res.status(400).json({ error: "Invalid format. Use csv, xlsx, or json." });
        }
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

financeRouter.post("/payments", async (req, res) => {
    try {
        const payment = await storage.createPayment(req.body);
        res.json(payment);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

financeRouter.patch("/payments/:id", async (req, res) => {
    try {
        const payment = await storage.updatePayment(req.params.id, req.body);
        if (!payment) {
            return res.status(404).json({ error: "Payment not found" });
        }
        res.json(payment);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/admin/finance/invoices - List invoices with pagination
financeRouter.get("/invoices", async (req, res) => {
    try {
        const {
            page = "1",
            limit = "20",
            status
        } = req.query as Record<string, string>;

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
        const offset = (pageNum - 1) * limitNum;

        let invoices = await storage.getInvoices();

        if (status) {
            invoices = invoices.filter(i => i.status === status);
        }

        // Sort by date descending
        invoices.sort((a, b) => {
            const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return dateB - dateA;
        });

        const total = invoices.length;
        const paginatedInvoices = invoices.slice(offset, offset + limitNum);

        res.json({
            invoices: paginatedInvoices,
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

financeRouter.post("/invoices", async (req, res) => {
    try {
        const invoice = await storage.createInvoice(req.body);
        res.json(invoice);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

financeRouter.patch("/invoices/:id", async (req, res) => {
    try {
        const invoice = await storage.updateInvoice(req.params.id, req.body);
        if (!invoice) {
            return res.status(404).json({ error: "Invoice not found" });
        }
        res.json(invoice);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/admin/finance/invoices/:id/mark-paid - Mark invoice as paid
financeRouter.post("/invoices/:id/mark-paid", async (req, res) => {
    try {
        const previousInvoice = await storage.getInvoices().then(invoices => invoices.find(i => i.id === req.params.id));
        const invoice = await storage.updateInvoice(req.params.id, {
            status: "paid",
            paidAt: new Date()
        });
        if (!invoice) {
            return res.status(404).json({ error: "Invoice not found" });
        }

        await auditLog(req, {
            action: AuditActions.INVOICE_PAID,
            resource: "invoices",
            resourceId: req.params.id,
            details: {
                invoiceNumber: previousInvoice?.invoiceNumber,
                amount: previousInvoice?.amount,
                markedBy: (req as any).user?.email
            },
            category: "admin",
            severity: "info"
        });

        res.json({ success: true, invoice });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/admin/finance/invoices/:id/resend - Resend invoice notification
financeRouter.post("/invoices/:id/resend", async (req, res) => {
    try {
        const invoices = await storage.getInvoices();
        const invoice = invoices.find(i => i.id === req.params.id);
        if (!invoice) {
            return res.status(404).json({ error: "Invoice not found" });
        }

        // Get user email
        const user = await storage.getUser(invoice.userId);
        if (!user?.email) {
            return res.status(400).json({ error: "User has no email address" });
        }

        // Send email
        const emailResult = await sendPaymentEmail(user.email, {
            invoiceId: invoice.id,
            amount: invoice.amount || 0,
            currency: invoice.currency || "USD",
            status: (invoice.status as "paid" | "pending" | "failed") || "pending",
            invoiceUrl: `${process.env.APP_URL || "https://iliagpt.com"}/billing/invoices/${invoice.id}`
        });

        await auditLog(req, {
            action: AuditActions.INVOICE_SENT,
            resource: "invoices",
            resourceId: req.params.id,
            details: { 
                userId: invoice.userId, 
                emailSent: emailResult.success,
                recipientEmail: user.email,
                sentBy: (req as any).user?.email
            },
            category: "admin",
            severity: "info"
        });

        if (!emailResult.success) {
            return res.status(500).json({ error: "Failed to send email", details: emailResult.error });
        }

        res.json({ 
            success: true, 
            message: "Invoice sent successfully",
            invoiceId: req.params.id
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/admin/finance/invoices/export - Export invoices
financeRouter.get("/invoices/export", async (req, res) => {
    try {
        const format = String(req.query.format || "csv").toLowerCase();
        const invoices = await storage.getInvoices();

        await storage.createAuditLog({
            action: "invoices_export",
            resource: "invoices",
            details: { format, count: invoices.length }
        });

        if (format === "csv") {
            const headers = ["id", "userId", "amount", "currency", "status", "dueDate", "createdAt", "paidAt"];
            const csvRows = [headers.join(",")];
            invoices.forEach(i => {
                csvRows.push([
                    i.id,
                    i.userId || "",
                    i.amount || 0,
                    i.currency || "USD",
                    i.status || "",
                    i.dueDate?.toISOString?.() || i.dueDate || "",
                    i.createdAt?.toISOString?.() || i.createdAt || "",
                    i.paidAt?.toISOString?.() || i.paidAt || ""
                ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
            });
            res.setHeader("Content-Type", "text/csv");
            res.setHeader("Content-Disposition", `attachment; filename=invoices_${Date.now()}.csv`);
            res.send(csvRows.join("\n"));
        } else if (format === "xlsx") {
            const workbook = new ExcelJS.Workbook();
            const sheet = workbook.addWorksheet("Invoices");

            sheet.columns = [
                { header: "ID", key: "id", width: 36 },
                { header: "User ID", key: "userId", width: 28 },
                { header: "Invoice #", key: "invoiceNumber", width: 18 },
                { header: "Amount", key: "amount", width: 14 },
                { header: "Currency", key: "currency", width: 10 },
                { header: "Status", key: "status", width: 14 },
                { header: "Due Date", key: "dueDate", width: 14 },
                { header: "Created At", key: "createdAt", width: 20 },
                { header: "Paid At", key: "paidAt", width: 20 },
            ];
            sheet.getRow(1).font = { bold: true };
            sheet.getColumn("createdAt").numFmt = "yyyy-mm-dd hh:mm";
            sheet.getColumn("paidAt").numFmt = "yyyy-mm-dd hh:mm";
            sheet.getColumn("dueDate").numFmt = "yyyy-mm-dd";

            for (const i of invoices) {
                sheet.addRow({
                    id: i.id,
                    userId: i.userId || "",
                    invoiceNumber: (i as any).invoiceNumber || "",
                    amount: Number(i.amount || 0),
                    currency: i.currency || "USD",
                    status: i.status || "",
                    dueDate: i.dueDate ? new Date(i.dueDate as any) : null,
                    createdAt: i.createdAt ? new Date(i.createdAt as any) : null,
                    paidAt: i.paidAt ? new Date(i.paidAt as any) : null,
                });
            }

            const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
            res.setHeader(
                "Content-Type",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            );
            res.setHeader("Content-Disposition", `attachment; filename=invoices_${Date.now()}.xlsx`);
            res.send(buffer);
        } else if (format === "json") {
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Content-Disposition", `attachment; filename=invoices_${Date.now()}.json`);
            res.json(invoices);
        } else {
            res.status(400).json({ error: "Invalid format. Use csv, xlsx, or json." });
        }
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});
