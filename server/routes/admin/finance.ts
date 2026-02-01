import { Router } from "express";
import { storage } from "../../storage";

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
        const { format = "csv" } = req.query;
        const payments = await storage.getPayments();

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
        } else {
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Content-Disposition", `attachment; filename=payments_${Date.now()}.json`);
            res.json(payments);
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
        const invoice = await storage.updateInvoice(req.params.id, {
            status: "paid",
            paidAt: new Date()
        });
        if (!invoice) {
            return res.status(404).json({ error: "Invoice not found" });
        }

        await storage.createAuditLog({
            action: "invoice_mark_paid",
            resource: "invoices",
            resourceId: req.params.id
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

        // TODO: Implement actual email sending
        // For now, just log the action
        await storage.createAuditLog({
            action: "invoice_resend",
            resource: "invoices",
            resourceId: req.params.id,
            details: { userId: invoice.userId }
        });

        res.json({ 
            success: true, 
            message: "Invoice resend scheduled",
            invoiceId: req.params.id
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/admin/finance/invoices/export - Export invoices
financeRouter.get("/invoices/export", async (req, res) => {
    try {
        const { format = "csv" } = req.query;
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
        } else {
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Content-Disposition", `attachment; filename=invoices_${Date.now()}.json`);
            res.json(invoices);
        }
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});
