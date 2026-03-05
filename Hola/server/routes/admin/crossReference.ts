/**
 * Cross-Reference API
 * Fetches related data across all admin tables for a given resource.
 * GET /api/admin/cross-ref/:resource/:id
 * 
 * Examples:
 *   /api/admin/cross-ref/user/abc-123  → user + payments + invoices + conversations + security events
 *   /api/admin/cross-ref/payment/xyz   → payment + user + invoice
 */
import { Router } from "express";
import { db } from "../../db";
import { sql, eq, desc } from "drizzle-orm";
import { users } from "@shared/schema/auth";
import { payments, invoices, auditLogs, securityEvents, aiModelUsage } from "@shared/schema/admin";

export const crossReferenceRouter = Router();

crossReferenceRouter.get("/:resource/:id", async (req, res) => {
    try {
        const { resource, id } = req.params;
        const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

        switch (resource) {
            case "user": {
                // Fetch user + all related entities
                const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
                if (!user) return res.status(404).json({ error: "User not found" });

                const [userPayments, userInvoices, userAuditLogs, userSecurityEvents, userModelUsage] = await Promise.all([
                    db.select().from(payments).where(eq(payments.userId, id)).orderBy(desc(payments.createdAt)).limit(limit),
                    db.select().from(invoices).where(eq(invoices.userId, id)).orderBy(desc(invoices.createdAt)).limit(limit),
                    db.select().from(auditLogs).where(eq(auditLogs.userId, id)).orderBy(desc(auditLogs.createdAt)).limit(limit),
                    db.select().from(securityEvents).where(eq(securityEvents.userId, id)).orderBy(desc(securityEvents.createdAt)).limit(limit),
                    db.select().from(aiModelUsage).where(eq(aiModelUsage.userId, id)).orderBy(desc(aiModelUsage.createdAt)).limit(limit),
                ]);

                res.json({
                    resource: "user",
                    data: user,
                    related: {
                        payments: { items: userPayments, count: userPayments.length },
                        invoices: { items: userInvoices, count: userInvoices.length },
                        auditLogs: { items: userAuditLogs, count: userAuditLogs.length },
                        securityEvents: { items: userSecurityEvents, count: userSecurityEvents.length },
                        aiModelUsage: { items: userModelUsage, count: userModelUsage.length },
                    },
                });
                break;
            }

            case "payment": {
                const [payment] = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
                if (!payment) return res.status(404).json({ error: "Payment not found" });

                const related: Record<string, any> = {};

                if (payment.userId) {
                    const [user] = await db.select().from(users).where(eq(users.id, payment.userId)).limit(1);
                    related.user = user || null;
                    // Get related invoices for this payment
                    const paymentInvoices = await db.select().from(invoices).where(eq(invoices.paymentId, id)).limit(limit);
                    related.invoices = { items: paymentInvoices, count: paymentInvoices.length };
                }

                res.json({
                    resource: "payment",
                    data: payment,
                    related,
                });
                break;
            }

            case "invoice": {
                const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
                if (!invoice) return res.status(404).json({ error: "Invoice not found" });

                const related: Record<string, any> = {};
                if (invoice.userId) {
                    const [user] = await db.select().from(users).where(eq(users.id, invoice.userId)).limit(1);
                    related.user = user || null;
                }
                if (invoice.paymentId) {
                    const [payment] = await db.select().from(payments).where(eq(payments.id, invoice.paymentId)).limit(1);
                    related.payment = payment || null;
                }

                res.json({
                    resource: "invoice",
                    data: invoice,
                    related,
                });
                break;
            }

            default:
                res.status(400).json({ error: `Unknown resource type: ${resource}` });
        }
    } catch (error: any) {
        console.error("[Admin CrossRef] Error:", error.message);
        res.status(500).json({ error: "Internal server error" });
    }
});
