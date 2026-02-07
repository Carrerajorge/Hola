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
import { and, asc, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";

export const financeRouter = Router();

function parseDateInput(value: string | undefined, mode: "start" | "end" = "start"): Date | null {
    if (!value) return null;

    // <input type="date" /> values come in as YYYY-MM-DD. Treat them as local dates.
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [y, m, d] = value.split("-").map((n) => Number(n));
        if (!y || !m || !d) return null;
        return mode === "end"
            ? new Date(y, m - 1, d, 23, 59, 59, 999)
            : new Date(y, m - 1, d, 0, 0, 0, 0);
    }

    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d;
}

function parseNumberInput(value: string | undefined): number | null {
    if (!value) return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return n;
}

function amountAsNumeric(): SQL<number> {
    // Make amount filtering/sorting resilient to minor formatting (currency symbols, commas).
    // We keep this server-side to avoid blowing up on bad data.
    return sql<number>`
        nullif(
            case
                when position('.' in ${payments.amount}) > 0 and position(',' in ${payments.amount}) > 0
                    then replace(regexp_replace(${payments.amount}, '[^0-9.,-]', '', 'g'), ',', '')
                else replace(regexp_replace(${payments.amount}, '[^0-9.,-]', '', 'g'), ',', '.')
            end,
            ''
        )::numeric
    `;
}

function buildPaymentsWhereClause(params: {
    status?: string;
    userId?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    currency?: string;
    minAmount?: string;
    maxAmount?: string;
}): SQL | undefined {
    const conditions: SQL[] = [];

    const status = String(params.status || "").trim();
    const userId = String(params.userId || "").trim();
    const search = String(params.search || "").trim();
    const currency = String(params.currency || "").trim().toUpperCase();

    if (status && status !== "all") conditions.push(eq(payments.status, status));
    if (userId) conditions.push(eq(payments.userId, userId));
    if (currency && currency !== "ALL") conditions.push(eq(payments.currency, currency));

    const fromDate = parseDateInput(params.dateFrom, "start");
    if (fromDate) conditions.push(gte(payments.createdAt, fromDate));

    const toDate = parseDateInput(params.dateTo, "end");
    if (toDate) conditions.push(lte(payments.createdAt, toDate));

    const minAmount = parseNumberInput(params.minAmount);
    if (minAmount !== null) conditions.push(gte(amountAsNumeric(), minAmount));

    const maxAmount = parseNumberInput(params.maxAmount);
    if (maxAmount !== null) conditions.push(lte(amountAsNumeric(), maxAmount));

    if (search) {
        const like = `%${search}%`;
        conditions.push(
            or(
                ilike(payments.id, like),
                ilike(payments.userId, like),
                ilike(payments.stripePaymentId, like),
                ilike(payments.description, like),
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
            dateTo,
            currency,
            minAmount,
            maxAmount,
            sortBy = "createdAt",
            sortOrder = "desc",
        } = req.query as Record<string, string>;

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
        const offset = (pageNum - 1) * limitNum;

        const sortBySafe = sortBy === "amount" ? "amount" : "createdAt";
        const sortOrderSafe = sortOrder === "asc" ? "asc" : "desc";

        const orderByClause =
            sortBySafe === "amount"
                ? (sortOrderSafe === "asc" ? asc(amountAsNumeric()) : desc(amountAsNumeric()))
                : (sortOrderSafe === "asc" ? asc(payments.createdAt) : desc(payments.createdAt));

        const whereClause = buildPaymentsWhereClause({ status, userId, search, dateFrom, dateTo, currency, minAmount, maxAmount });

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
            .orderBy(orderByClause, desc(payments.createdAt))
            .limit(limitNum)
            .offset(offset);

        res.json({
            payments: paginatedPayments,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum)
            },
            sort: {
                sortBy: sortBySafe,
                sortOrder: sortOrderSafe,
            },
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
        // Backwards-compatible params: accept both `maxInvoices` and legacy `limit`.
        const maxInvoicesRaw = (req.body?.maxInvoices ?? req.query?.maxInvoices ?? req.body?.limit ?? req.query?.limit ?? 200) as any;
        const startingAfterRaw = (req.body?.startingAfter ?? req.query?.startingAfter) as any;
        const dateFromRaw = (req.body?.dateFrom ?? req.query?.dateFrom) as any;
        const dateToRaw = (req.body?.dateTo ?? req.query?.dateTo) as any;

        const maxInvoices = Math.min(2000, Math.max(1, Number(maxInvoicesRaw) || 200));
        const startingAfter = typeof startingAfterRaw === "string" && startingAfterRaw.trim() ? startingAfterRaw.trim() : undefined;

        const defaultFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // last 30 days
        const fromDate = parseDateInput(typeof dateFromRaw === "string" ? dateFromRaw : undefined, "start") || defaultFrom;
        const toDate = parseDateInput(typeof dateToRaw === "string" ? dateToRaw : undefined, "end") || new Date();
        if (fromDate > toDate) {
            return res.status(400).json({ error: "`dateFrom` must be before `dateTo`" });
        }

        const createdFilter = {
            gte: Math.floor(fromDate.getTime() / 1000),
            lte: Math.floor(toDate.getTime() / 1000),
        };

        let stripe;
        try {
            stripe = getStripeClient();
        } catch (e: any) {
            return res.status(400).json({ error: e?.message || "Stripe is not configured" });
        }

        const userCache = new Map<string, string | null>();

        let fetched = 0;
        let paid = 0;
        let synced = 0;
        let created = 0;
        let updated = 0;
        let matchedUsers = 0;
        let unmatchedUsers = 0;
        let errors = 0;
        const unmatchedInvoiceIds: string[] = [];

        let cursor: string | undefined = startingAfter;
        let stripeHasMore = false;
        let brokeEarly = false;

        while (synced < maxInvoices) {
            const pageLimit = Math.min(100, maxInvoices - synced);

            let result: any;
            try {
                result = await stripe.invoices.list({
                    limit: pageLimit,
                    ...(cursor ? { starting_after: cursor } : {}),
                    created: createdFilter,
                    status: "paid",
                } as any);
            } catch (e) {
                // Fallback for API versions that don't accept `status` as list param.
                result = await stripe.invoices.list({
                    limit: pageLimit,
                    ...(cursor ? { starting_after: cursor } : {}),
                    created: createdFilter,
                } as any);
            }

            const invoices = (result?.data || []) as any[];
            fetched += invoices.length;
            stripeHasMore = !!result?.has_more;

            if (invoices.length === 0) {
                stripeHasMore = false;
                break;
            }

            let lastInvoiceId: string | undefined;

            for (let i = 0; i < invoices.length; i += 1) {
                const invoice = invoices[i];
                if (typeof invoice?.id === "string") lastInvoiceId = invoice.id;

                const isPaid = invoice?.status === "paid" || invoice?.paid === true;
                if (!isPaid) continue;

                paid += 1;

                const metadataUserId = typeof invoice?.metadata?.userId === "string" ? invoice.metadata.userId : null;
                const stripeCustomerId = getStripeCustomerIdFromInvoice(invoice);

                let userId: string | null = metadataUserId;
                if (!userId) {
                    if (stripeCustomerId && userCache.has(stripeCustomerId)) {
                        userId = userCache.get(stripeCustomerId)!;
                    } else {
                        userId = await resolveUserIdFromStripeCustomerId(stripeCustomerId);
                        if (stripeCustomerId) userCache.set(stripeCustomerId, userId);
                    }
                }

                if (userId) {
                    matchedUsers += 1;
                } else {
                    unmatchedUsers += 1;
                    if (typeof invoice?.id === "string" && unmatchedInvoiceIds.length < 25) {
                        unmatchedInvoiceIds.push(invoice.id);
                    }
                }

                try {
                    const r = await upsertPaymentFromStripeInvoice({
                        invoice,
                        status: "completed",
                        userId,
                        plan: null,
                    });
                    synced += 1;
                    if (r.created) created += 1;
                    else updated += 1;
                } catch {
                    errors += 1;
                }

                if (synced >= maxInvoices) {
                    if (i < invoices.length - 1) {
                        brokeEarly = true;
                    }
                    break;
                }
            }

            if (lastInvoiceId) cursor = lastInvoiceId;

            if (synced >= maxInvoices) {
                break;
            }

            if (!stripeHasMore || !cursor) {
                break;
            }
        }

        await auditLog(req as any, {
            action: AuditActions.ADMIN_IMPORT_DATA,
            resource: "payments",
            resourceId: null,
            details: {
                source: "stripe",
                window: {
                    dateFrom: fromDate.toISOString(),
                    dateTo: toDate.toISOString(),
                },
                fetched,
                paid,
                synced,
                created,
                updated,
                matchedUsers,
                unmatchedUsers,
                errors,
                maxInvoices,
                startingAfter: startingAfter || null,
            },
            category: "admin",
            severity: "info",
        });

        res.json({
            success: true,
            window: {
                dateFrom: fromDate.toISOString(),
                dateTo: toDate.toISOString(),
            },
            fetched,
            paid,
            synced,
            created,
            updated,
            matchedUsers,
            unmatchedUsers,
            errors,
            unmatchedInvoiceIds,
            hasMore: (stripeHasMore || brokeEarly) && !!cursor,
            nextCursor: ((stripeHasMore || brokeEarly) && cursor) ? cursor : null,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message || "Failed to sync payments from Stripe" });
    }
});

// GET /api/admin/finance/payments/export - Export payments to CSV/Excel
financeRouter.get("/payments/export", async (req, res) => {
    try {
        const { format = "csv" } = req.query;
        const { status, userId, search, dateFrom, dateTo, currency, minAmount, maxAmount, sortBy = "createdAt", sortOrder = "desc" } = req.query as Record<string, string>;
        const whereClause = buildPaymentsWhereClause({ status, userId, search, dateFrom, dateTo, currency, minAmount, maxAmount });

        const sortBySafe = sortBy === "amount" ? "amount" : "createdAt";
        const sortOrderSafe = sortOrder === "asc" ? "asc" : "desc";
        const orderByClause =
            sortBySafe === "amount"
                ? (sortOrderSafe === "asc" ? asc(amountAsNumeric()) : desc(amountAsNumeric()))
                : (sortOrderSafe === "asc" ? asc(payments.createdAt) : desc(payments.createdAt));

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
            .orderBy(orderByClause, desc(payments.createdAt));
        if (whereClause) exportQuery = exportQuery.where(whereClause);

        const paymentRows = await exportQuery;

        await storage.createAuditLog({
            action: "payments_export",
            resource: "payments",
            details: { format, count: paymentRows.length, status, userId, search, dateFrom, dateTo, currency, minAmount, maxAmount, sortBy: sortBySafe, sortOrder: sortOrderSafe }
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
            res.setHeader("Content-Type", "text/csv; charset=utf-8");
            res.setHeader("Content-Disposition", `attachment; filename=payments_${Date.now()}.csv`);
            // Add UTF-8 BOM for Excel compatibility.
            res.send("\uFEFF" + csvRows.join("\r\n"));
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
