import { Router } from "express";
import { storage } from "../../storage";
import { sendPaymentEmail } from "../../services/genericEmailService";
import { auditLog, AuditActions } from "../../services/auditLogger";
import { dbRead } from "../../db";
import { payments, users } from "@shared/schema";
import { getStripeClient } from "../../stripeClient";
import {
    getStripeCustomerIdFromInvoice,
    resolveUserIdFromStripeCustomerId,
    upsertPaymentFromStripeInvoice,
} from "../../services/paymentIngestionService";
import { and, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";

export const financeRouter = Router();

function parseDateInput(value: string | undefined): Date | null {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d;
}

function buildPaymentsWhereClause(params: {
    status?: string;
    userId?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
}): SQL | undefined {
    const conditions: SQL[] = [];

    const status = String(params.status || "").trim();
    const userId = String(params.userId || "").trim();
    const search = String(params.search || "").trim();

    if (status) conditions.push(eq(payments.status, status));
    if (userId) conditions.push(eq(payments.userId, userId));

    const fromDate = parseDateInput(params.dateFrom);
    if (fromDate) conditions.push(gte(payments.createdAt, fromDate));

    const toDate = parseDateInput(params.dateTo);
    if (toDate) conditions.push(lte(payments.createdAt, toDate));

    if (search) {
        const like = `%${search}%`;
        conditions.push(
            or(
                ilike(payments.id, like),
                ilike(payments.userId, like),
                ilike(payments.stripePaymentId, like),
                ilike(users.email, like),
            )!,
        );
    }

    return conditions.length ? and(...conditions) : undefined;
}

// GET /api/admin/finance/payments - List payments with pagination and filters
financeRouter.get("/payments", async (req, res) => {
    try {
        const {
            page = "1",
            limit = "20",
            status,
            userId,
            search,
            dateFrom,
            dateTo
        } = req.query as Record<string, string>;

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
        const offset = (pageNum - 1) * limitNum;

        const whereClause = buildPaymentsWhereClause({ status, userId, search, dateFrom, dateTo });

        let countQuery = dbRead
            .select({ count: sql<number>`count(*)::int` })
            .from(payments)
            .leftJoin(users, eq(payments.userId, users.id));
        if (whereClause) countQuery = countQuery.where(whereClause);
        const [{ count: total = 0 } = {} as any] = await countQuery;

        let listQuery = dbRead
            .select({
                id: payments.id,
                userId: payments.userId,
                userEmail: users.email,
                userName: users.fullName,
                amount: payments.amount,
                currency: payments.currency,
                status: payments.status,
                method: payments.method,
                description: payments.description,
                stripePaymentId: payments.stripePaymentId,
                createdAt: payments.createdAt,
            })
            .from(payments)
            .leftJoin(users, eq(payments.userId, users.id));
        if (whereClause) listQuery = listQuery.where(whereClause);

        const paginatedPayments = await listQuery
            .orderBy(desc(payments.createdAt))
            .limit(limitNum)
            .offset(offset);

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

// POST /api/admin/finance/payments/sync-stripe - Backfill payments from Stripe invoices (paid)
financeRouter.post("/payments/sync-stripe", async (req, res) => {
    try {
        const limitRaw = (req.body?.limit ?? req.query?.limit ?? 100) as any;
        const startingAfterRaw = (req.body?.startingAfter ?? req.query?.startingAfter) as any;

        const limit = Math.min(250, Math.max(1, Number(limitRaw) || 100));
        const startingAfter = typeof startingAfterRaw === "string" && startingAfterRaw.trim() ? startingAfterRaw.trim() : undefined;

        let stripe;
        try {
            stripe = getStripeClient();
        } catch (e: any) {
            return res.status(400).json({ error: e?.message || "Stripe is not configured" });
        }

        let result: any;
        try {
            result = await stripe.invoices.list({
                limit,
                ...(startingAfter ? { starting_after: startingAfter } : {}),
                status: "paid",
            });
        } catch (e) {
            // Fallback for API versions that don't accept `status` as list param.
            result = await stripe.invoices.list({
                limit,
                ...(startingAfter ? { starting_after: startingAfter } : {}),
            });
        }

        const invoices = (result?.data || []) as any[];
        const paidInvoices = invoices.filter((inv) => inv?.status === "paid" || inv?.paid === true);

        let synced = 0;
        let matchedUsers = 0;
        let unmatchedUsers = 0;

        for (const invoice of paidInvoices) {
            const stripeCustomerId = getStripeCustomerIdFromInvoice(invoice);
            const userId = await resolveUserIdFromStripeCustomerId(stripeCustomerId);

            if (userId) matchedUsers += 1;
            else unmatchedUsers += 1;

            await upsertPaymentFromStripeInvoice({
                invoice,
                status: "completed",
                userId,
                plan: null,
            });
            synced += 1;
        }

        await auditLog(req as any, {
            action: AuditActions.ADMIN_IMPORT_DATA,
            resource: "payments",
            resourceId: null,
            details: {
                source: "stripe",
                fetched: invoices.length,
                paid: paidInvoices.length,
                synced,
                matchedUsers,
                unmatchedUsers,
                limit,
                startingAfter: startingAfter || null,
            },
            category: "admin",
            severity: "info",
        });

        const nextCursor =
            result?.has_more && invoices.length > 0
                ? String(invoices[invoices.length - 1]?.id || "")
                : null;

        res.json({
            success: true,
            fetched: invoices.length,
            paid: paidInvoices.length,
            synced,
            matchedUsers,
            unmatchedUsers,
            hasMore: !!result?.has_more,
            nextCursor: nextCursor || null,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message || "Failed to sync payments from Stripe" });
    }
});

// GET /api/admin/finance/payments/export - Export payments to CSV/Excel
financeRouter.get("/payments/export", async (req, res) => {
    try {
        const { format = "csv" } = req.query;
        const { status, userId, search, dateFrom, dateTo } = req.query as Record<string, string>;
        const whereClause = buildPaymentsWhereClause({ status, userId, search, dateFrom, dateTo });

        let exportQuery = dbRead
            .select({
                id: payments.id,
                userId: payments.userId,
                userEmail: users.email,
                amount: payments.amount,
                currency: payments.currency,
                status: payments.status,
                method: payments.method,
                description: payments.description,
                stripePaymentId: payments.stripePaymentId,
                createdAt: payments.createdAt,
            })
            .from(payments)
            .leftJoin(users, eq(payments.userId, users.id))
            .orderBy(desc(payments.createdAt));
        if (whereClause) exportQuery = exportQuery.where(whereClause);

        const paymentRows = await exportQuery;

        await storage.createAuditLog({
            action: "payments_export",
            resource: "payments",
            details: { format, count: paymentRows.length, status, userId, search, dateFrom, dateTo }
        });

        if (format === "csv") {
            const headers = ["id", "userId", "userEmail", "amount", "currency", "status", "method", "description", "stripePaymentId", "createdAt"];
            const csvRows = [headers.join(",")];
            paymentRows.forEach(p => {
                csvRows.push([
                    p.id,
                    p.userId || "",
                    p.userEmail || "",
                    p.amount || 0,
                    p.currency || "EUR",
                    p.status || "",
                    p.method || "",
                    p.description || "",
                    p.stripePaymentId || "",
                    p.createdAt?.toISOString?.() || p.createdAt || ""
                ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
            });
            res.setHeader("Content-Type", "text/csv");
            res.setHeader("Content-Disposition", `attachment; filename=payments_${Date.now()}.csv`);
            res.send(csvRows.join("\n"));
        } else {
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Content-Disposition", `attachment; filename=payments_${Date.now()}.json`);
            res.json(paymentRows);
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
