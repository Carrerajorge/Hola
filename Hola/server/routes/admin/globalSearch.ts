/**
 * Global Admin Search
 * Searches across users, payments, AI models, security events, and conversations.
 * GET /api/admin/search/global?q=term
 */
import { Router } from "express";
import { db } from "../../db";
import { sql, ilike, or, desc } from "drizzle-orm";
import { users } from "@shared/schema/auth";
import { payments, aiModels, securityEvents } from "@shared/schema/admin";

export const globalSearchRouter = Router();

globalSearchRouter.get("/global", async (req, res) => {
    try {
        const query = (req.query.q as string || "").trim();
        if (!query || query.length < 2) {
            return res.json({ results: [], query });
        }

        const searchTerm = `%${query}%`;
        const limit = 5;

        // Search across multiple tables in parallel
        const [userResults, paymentResults, modelResults, securityResults] = await Promise.all([
            // Users: search by email, username
            db.select({
                id: users.id,
                email: users.email,
                username: users.username,
                role: users.role,
            })
                .from(users)
                .where(or(
                    ilike(users.email, searchTerm),
                    ilike(users.username, searchTerm),
                ))
                .orderBy(desc(users.createdAt))
                .limit(limit),

            // Payments: search by description, stripe ID
            db.select({
                id: payments.id,
                amount: payments.amount,
                currency: payments.currency,
                status: payments.status,
                description: payments.description,
                stripePaymentId: payments.stripePaymentId,
            })
                .from(payments)
                .where(or(
                    ilike(payments.description, searchTerm),
                    ilike(payments.stripePaymentId, searchTerm),
                ))
                .orderBy(desc(payments.createdAt))
                .limit(limit),

            // AI Models: search by name, provider
            db.select({
                id: aiModels.id,
                name: aiModels.name,
                provider: aiModels.provider,
                status: aiModels.status,
            })
                .from(aiModels)
                .where(or(
                    ilike(aiModels.name, searchTerm),
                    ilike(aiModels.provider, searchTerm),
                    ilike(aiModels.modelId, searchTerm),
                ))
                .limit(limit),

            // Security Events: search by event type, IP
            db.select({
                id: securityEvents.id,
                eventType: securityEvents.eventType,
                severity: securityEvents.severity,
                ipAddress: securityEvents.ipAddress,
            })
                .from(securityEvents)
                .where(or(
                    ilike(securityEvents.eventType, searchTerm),
                    ilike(securityEvents.ipAddress, searchTerm),
                ))
                .orderBy(desc(securityEvents.createdAt))
                .limit(limit),
        ]);

        // Normalize results into a common shape
        const results = [
            ...userResults.map((u) => ({
                type: "user",
                id: u.id,
                label: u.email,
                name: u.username || u.email,
                detail: `Role: ${u.role || "user"}`,
            })),
            ...paymentResults.map((p) => ({
                type: "payment",
                id: p.id,
                label: `${p.currency || "EUR"} ${p.amount}`,
                name: p.description || p.stripePaymentId || p.id,
                detail: `Status: ${p.status || "unknown"}`,
            })),
            ...modelResults.map((m) => ({
                type: "model",
                id: m.id,
                label: m.name,
                name: m.name,
                detail: `Provider: ${m.provider} · ${m.status || "active"}`,
            })),
            ...securityResults.map((s) => ({
                type: "security",
                id: s.id,
                label: s.eventType,
                name: s.eventType,
                detail: `Severity: ${s.severity || "info"} · IP: ${s.ipAddress || "N/A"}`,
            })),
        ];

        res.json({ results, query, total: results.length });
    } catch (error: any) {
        console.error("[Admin GlobalSearch] Error:", error.message);
        res.status(500).json({ error: "Internal server error", results: [] });
    }
});
