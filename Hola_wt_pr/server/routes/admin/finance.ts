import { Router } from "express";
import { storage } from "../../storage";
import { dbRead } from "../../db";
import { invoices, payments, users } from "@shared/schema";
import { sendPaymentEmail } from "../../services/genericEmailService";
import { auditLog, AuditActions } from "../../services/auditLogger";
import { and, desc, eq, gte, ilike, lte, sql, type SQL } from "drizzle-orm";

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

        const conditions: SQL[] = [];
        if (status) conditions.push(eq(payments.status, status));
        if (userId) conditions.push(eq(payments.userId, userId));
        if (dateFrom) conditions.push(gte(payments.createdAt, new Date(dateFrom)));
        if (dateTo) conditions.push(lte(payments.createdAt, new Date(dateTo)));

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const countQuery = whereClause
            ? dbRead.select({ count: sql<number>`count(*)` }).from(payments).where(whereClause)
            : dbRead.select({ count: sql<number>`count(*)` }).from(payments);

        const baseQuery = dbRead
            .select({
                payment: payments,
                userEmail: users.email,
                userFullName: users.fullName,
                userRole: users.role,
            })
            .from(payments)
            .leftJoin(users, eq(payments.userId, users.id));

        const [rows, totalResult] = await Promise.all([
            (whereClause ? baseQuery.where(whereClause) : baseQuery)
                .orderBy(desc(payments.createdAt), desc(payments.id))
                .limit(limitNum)
                .offset(offset),
            countQuery,
        ]);

        const paginatedPayments = rows.map((r: any) => ({
            ...(r.payment || r),
            user: r.userEmail
                ? {
                    id: (r.payment || r).userId,
                    email: r.userEmail,
                    fullName: r.userFullName,
                    role: r.userRole,
                }
                : null,
        }));

        const total = Number(totalResult[0]?.count || 0);

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
        const { format = "csv", limit = "10000", status, userId, dateFrom, dateTo, paymentId } = req.query as Record<string, string | undefined>;
        const limitNum = Math.min(Math.max(parseInt(limit || "10000", 10) || 10000, 1), 50000);

        const conditions: SQL[] = [];
        if (paymentId) conditions.push(eq(payments.id, paymentId));
        if (status) conditions.push(eq(payments.status, status));
        if (userId) conditions.push(eq(payments.userId, userId));
        if (dateFrom) conditions.push(gte(payments.createdAt, new Date(dateFrom)));
        if (dateTo) conditions.push(lte(payments.createdAt, new Date(dateTo)));

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
        const exportQuery = whereClause
            ? dbRead.select().from(payments).where(whereClause)
            : dbRead.select().from(payments);

        const exportRows = await exportQuery
            .orderBy(desc(payments.createdAt), desc(payments.id))
            .limit(limitNum);

        await auditLog(req, {
            action: AuditActions.ADMIN_EXPORT_DATA,
            resource: "payments",
            details: {
                format,
                recordCount: exportRows.length,
                filters: { paymentId, status, userId, dateFrom, dateTo },
            },
            category: "admin",
            severity: "warning",
        });

        if (format === "csv") {
            const headers = ["id", "userId", "amount", "currency", "status", "method", "createdAt"];
            const csvRows = [headers.join(",")];
            exportRows.forEach(p => {
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
            res.json(exportRows);
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
            status,
            userId,
            dateFrom,
            dateTo
        } = req.query as Record<string, string>;

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
        const offset = (pageNum - 1) * limitNum;

        const conditions: SQL[] = [];
        if (status) conditions.push(eq(invoices.status, status));
        if (userId) conditions.push(eq(invoices.userId, userId));
        if (dateFrom) conditions.push(gte(invoices.createdAt, new Date(dateFrom)));
        if (dateTo) conditions.push(lte(invoices.createdAt, new Date(dateTo)));

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const countQuery = whereClause
            ? dbRead.select({ count: sql<number>`count(*)` }).from(invoices).where(whereClause)
            : dbRead.select({ count: sql<number>`count(*)` }).from(invoices);

        const baseQuery = dbRead
            .select({
                invoice: invoices,
                userEmail: users.email,
                userFullName: users.fullName,
                userRole: users.role,
            })
            .from(invoices)
            .leftJoin(users, eq(invoices.userId, users.id));

        const [rows, totalResult] = await Promise.all([
            (whereClause ? baseQuery.where(whereClause) : baseQuery)
                .orderBy(desc(invoices.createdAt), desc(invoices.id))
                .limit(limitNum)
                .offset(offset),
            countQuery,
        ]);

        const paginatedInvoices = rows.map((r: any) => ({
            ...(r.invoice || r),
            user: r.userEmail
                ? {
                    id: (r.invoice || r).userId,
                    email: r.userEmail,
                    fullName: r.userFullName,
                    role: r.userRole,
                }
                : null,
        }));

        const total = Number(totalResult[0]?.count || 0);

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
        const [previousInvoice] = await dbRead
            .select()
            .from(invoices)
            .where(eq(invoices.id, req.params.id))
            .limit(1);

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
        const [invoice] = await dbRead
            .select()
            .from(invoices)
            .where(eq(invoices.id, req.params.id))
            .limit(1);

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
        const { format = "csv", limit = "10000", status, userId, dateFrom, dateTo, invoiceId } = req.query as Record<string, string | undefined>;
        const limitNum = Math.min(Math.max(parseInt(limit || "10000", 10) || 10000, 1), 50000);

        const conditions: SQL[] = [];
        if (invoiceId) conditions.push(eq(invoices.id, invoiceId));
        if (status) conditions.push(eq(invoices.status, status));
        if (userId) conditions.push(eq(invoices.userId, userId));
        if (dateFrom) conditions.push(gte(invoices.createdAt, new Date(dateFrom)));
        if (dateTo) conditions.push(lte(invoices.createdAt, new Date(dateTo)));

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
        const exportQuery = whereClause
            ? dbRead.select().from(invoices).where(whereClause)
            : dbRead.select().from(invoices);

        const exportRows = await exportQuery
            .orderBy(desc(invoices.createdAt), desc(invoices.id))
            .limit(limitNum);

        await auditLog(req, {
            action: AuditActions.ADMIN_EXPORT_DATA,
            resource: "invoices",
            details: {
                format,
                recordCount: exportRows.length,
                filters: { invoiceId, status, userId, dateFrom, dateTo },
            },
            category: "admin",
            severity: "warning",
        });

        if (format === "csv") {
            const headers = ["id", "userId", "amount", "currency", "status", "dueDate", "createdAt", "paidAt"];
            const csvRows = [headers.join(",")];
            exportRows.forEach(i => {
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
            res.json(exportRows);
        }
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});
