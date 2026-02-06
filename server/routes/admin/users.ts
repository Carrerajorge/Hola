import { Router } from "express";
import { storage } from "../../storage";
import { db, dbRead } from "../../db";
import { users } from "@shared/schema";
import { hashPassword } from "../../utils/password";
import { validateBody } from "../../middleware/validateRequest";
import { asyncHandler } from "../../middleware/errorHandler";
import { createUserBodySchema } from "../../schemas/apiSchemas";
import { sql, ilike, or, desc, asc, and, eq, type SQL } from "drizzle-orm";
import { auditLog, AuditActions } from "../../services/auditLogger";
import { z } from "zod";

const adminUpdateDataControlsSchema = z.object({
    trainingOptIn: z.boolean().optional(),
    remoteBrowserDataAccess: z.boolean().optional(),
    analyticsTracking: z.boolean().optional(),
    chatHistoryEnabled: z.boolean().optional(),
});

export const usersRouter = Router();

// GET /api/admin/users - List with pagination, search, and filters
usersRouter.get("/", async (req, res) => {
    try {
        const {
            page = "1",
            limit = "20",
            search = "",
            sortBy = "createdAt",
            sortOrder = "desc",
            status,
            role,
            plan,
            exclude_admin,
        } = req.query as Record<string, string>;

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
        const offset = (pageNum - 1) * limitNum;

        const conditions: SQL[] = [];

        if (search) {
            const q = `%${search}%`;
            conditions.push(or(
                ilike(users.email, q),
                ilike(users.username, q),
                ilike(users.firstName, q),
                ilike(users.lastName, q),
                ilike(users.fullName, q)
            ));
        }

        if (status) conditions.push(eq(users.status, status));
        if (role) conditions.push(eq(users.role, role));
        if (plan) conditions.push(eq(users.plan, plan));
        if (exclude_admin === "true") {
            conditions.push(sql`coalesce(${users.role}, 'user') NOT IN ('admin', 'superadmin', 'team_admin')`);
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const sortColumnMap: Record<string, any> = {
            createdAt: users.createdAt,
            email: users.email,
            queryCount: users.queryCount,
            tokensConsumed: users.tokensConsumed,
            lastLoginAt: users.lastLoginAt
        };

        const sortColumn = sortColumnMap[sortBy] || users.createdAt;
        const orderClause = sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);

        const usersQuery = whereClause
            ? dbRead.select().from(users).where(whereClause)
            : dbRead.select().from(users);

        const countQuery = whereClause
            ? dbRead.select({ count: sql<number>`count(*)` }).from(users).where(whereClause)
            : dbRead.select({ count: sql<number>`count(*)` }).from(users);

        const [paginatedUsers, totalResult] = await Promise.all([
            usersQuery
                .orderBy(orderClause, desc(users.id))
                .limit(limitNum)
                .offset(offset),
            countQuery
        ]);

        const total = Number(totalResult[0]?.count || 0);

        res.json({
            users: paginatedUsers,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum),
                hasNext: pageNum * limitNum < total,
                hasPrev: pageNum > 1
            }
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

usersRouter.get("/stats", async (req, res) => {
    try {
        const stats = await storage.getUserStats();
        res.json(stats);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/admin/users/:id/data-controls - View privacy + history controls for a user
usersRouter.get("/:id/data-controls", async (req, res) => {
    try {
        const { id } = req.params;
        const user = await storage.getUser(id);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const settings = await storage.getUserSettings(id);

        const defaultPrivacySettings = { trainingOptIn: false, remoteBrowserDataAccess: false, analyticsTracking: true };
        const defaultFeatureFlags = { chatHistoryEnabled: true };

        const privacySettings = { ...defaultPrivacySettings, ...(settings?.privacySettings || {}) };
        const featureFlags = { ...defaultFeatureFlags, ...(settings?.featureFlags || {}) };

        const consentHistory = await storage.getConsentLogs(id, 25);

        res.json({
            user: {
                id: user.id,
                email: user.email,
                fullName: user.fullName,
                role: user.role,
                status: user.status,
                plan: user.plan,
            },
            privacySettings,
            featureFlags: { chatHistoryEnabled: featureFlags.chatHistoryEnabled },
            consentHistory,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// PATCH /api/admin/users/:id/data-controls - Update privacy + history controls for a user
usersRouter.patch("/:id/data-controls", validateBody(adminUpdateDataControlsSchema), async (req, res) => {
    try {
        const { id } = req.params;
        const user = await storage.getUser(id);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const {
            trainingOptIn,
            remoteBrowserDataAccess,
            analyticsTracking,
            chatHistoryEnabled,
        } = req.body as z.infer<typeof adminUpdateDataControlsSchema>;

        const updates: any = {};
        const privacyPatch: any = {};
        const featurePatch: any = {};

        if (trainingOptIn !== undefined) privacyPatch.trainingOptIn = trainingOptIn;
        if (remoteBrowserDataAccess !== undefined) privacyPatch.remoteBrowserDataAccess = remoteBrowserDataAccess;
        if (analyticsTracking !== undefined) privacyPatch.analyticsTracking = analyticsTracking;
        if (Object.keys(privacyPatch).length > 0) updates.privacySettings = privacyPatch;

        if (chatHistoryEnabled !== undefined) featurePatch.chatHistoryEnabled = chatHistoryEnabled;
        if (Object.keys(featurePatch).length > 0) updates.featureFlags = featurePatch;

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: "No updates provided" });
        }

        const before = await storage.getUserSettings(id);
        const settings = await storage.upsertUserSettings(id, updates);

        const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string)?.split(',')[0] || undefined;
        const userAgent = req.headers['user-agent'] || undefined;

        // Keep consent history consistent with user-driven changes.
        // Note: This does not distinguish admin vs user actor (audit logs do).
        if (trainingOptIn !== undefined) {
            await storage.logConsent(id, 'training_opt_in', String(trainingOptIn), ipAddress, userAgent);
        }
        if (remoteBrowserDataAccess !== undefined) {
            await storage.logConsent(id, 'remote_browser_access', String(remoteBrowserDataAccess), ipAddress, userAgent);
        }
        if (analyticsTracking !== undefined) {
            await storage.logConsent(id, 'analytics_tracking', String(analyticsTracking), ipAddress, userAgent);
        }
        if (chatHistoryEnabled !== undefined) {
            await storage.logConsent(id, 'chat_history_enabled', String(chatHistoryEnabled), ipAddress, userAgent);
        }

        await auditLog(req, {
            action: "admin.user_data_controls_updated",
            resource: "users",
            resourceId: id,
            details: {
                targetEmail: user.email,
                changes: req.body,
                previous: {
                    privacySettings: before?.privacySettings || null,
                    featureFlags: before?.featureFlags || null,
                },
            },
            category: "admin",
            severity: "warning",
        });

        res.json({ success: true, settings });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/admin/users/:id/chats/delete-all - Clear user chat history (soft delete)
usersRouter.post("/:id/chats/delete-all", async (req, res) => {
    try {
        const { id } = req.params;
        const user = await storage.getUser(id);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const count = await storage.softDeleteAllChats(id);

        const links = await storage.getSharedLinks(id);
        for (const link of links) {
            if (link.resourceType === 'chat') {
                await storage.revokeSharedLink(link.id);
            }
        }

        await auditLog(req, {
            action: "admin.user_chats_delete_all",
            resource: "chats",
            resourceId: id,
            details: { targetEmail: user.email, count },
            category: "admin",
            severity: "critical",
        });

        res.json({ success: true, count });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

usersRouter.post("/", validateBody(createUserBodySchema), asyncHandler(async (req, res) => {
    const { email, password, plan, role } = req.body;
    const existingUser = await storage.getUserByEmail(email);
    if (existingUser) {
        return res.status(409).json({ message: "A user with this email already exists" });
    }
    const hashedPassword = await hashPassword(password);
    const [user] = await db.insert(users).values({
        email,
        password: hashedPassword,
        plan: plan || "free",
        role: role || "user",
        status: "active"
    }).returning();
    
    // Enhanced audit log with full context
    await auditLog(req, {
        action: AuditActions.USER_CREATED,
        resource: "users",
        resourceId: user.id,
        details: { email, plan, role, createdBy: (req as any).user?.claims?.email || (req as any).user?.email },
        category: "admin",
        severity: "info"
    });
    
    res.json(user);
}));

usersRouter.patch("/:id", async (req, res) => {
    try {
        const previousUser = await storage.getUserById(req.params.id);
        const user = await storage.updateUser(req.params.id, req.body);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        
        // Enhanced audit log with before/after details
        await auditLog(req, {
            action: AuditActions.USER_UPDATED,
            resource: "users",
            resourceId: req.params.id,
            details: { 
                changes: req.body,
                previousValues: previousUser ? {
                    email: previousUser.email,
                    role: previousUser.role,
                    plan: previousUser.plan,
                    status: previousUser.status
                } : null,
                updatedBy: (req as any).user?.claims?.email || (req as any).user?.email
            },
            category: "admin",
            severity: "info"
        });
        
        res.json(user);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

usersRouter.delete("/:id", async (req, res) => {
    try {
        const userToDelete = await storage.getUserById(req.params.id);
        await storage.deleteUser(req.params.id);
        
        // Enhanced audit log with deleted user info
        await auditLog(req, {
            action: AuditActions.USER_DELETED,
            resource: "users",
            resourceId: req.params.id,
            details: {
                deletedUser: userToDelete ? {
                    email: userToDelete.email,
                    role: userToDelete.role,
                    plan: userToDelete.plan
                } : null,
                deletedBy: (req as any).user?.claims?.email || (req as any).user?.email
            },
            category: "admin",
            severity: "warning"
        });
        
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/admin/users/:id - Get single user details
usersRouter.get("/:id", async (req, res) => {
    try {
        const user = await storage.getUser(req.params.id);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        res.json(user);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/admin/users/:id/block - Block a user
usersRouter.post("/:id/block", async (req, res) => {
    try {
        const { reason } = req.body || {};
        const previousUser = await storage.getUser(req.params.id);
        const user = await storage.updateUser(req.params.id, { 
            status: "blocked",
            blockedAt: new Date(),
            blockReason: reason || "Blocked by admin"
        });
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        await auditLog(req, {
            action: AuditActions.USER_BLOCKED,
            resource: "users",
            resourceId: req.params.id,
            details: { 
                reason,
                userEmail: previousUser?.email,
                blockedBy: (req as any).user?.email
            },
            category: "security",
            severity: "warning"
        });
        res.json({ success: true, user });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/admin/users/:id/unblock - Unblock a user
usersRouter.post("/:id/unblock", async (req, res) => {
    try {
        const previousUser = await storage.getUser(req.params.id);
        const user = await storage.updateUser(req.params.id, { 
            status: "active",
            blockedAt: null,
            blockReason: null
        });
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        await auditLog(req, {
            action: AuditActions.USER_UNBLOCKED,
            resource: "users",
            resourceId: req.params.id,
            details: {
                userEmail: previousUser?.email,
                unblockedBy: (req as any).user?.email
            },
            category: "security",
            severity: "info"
        });
        res.json({ success: true, user });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// PATCH /api/admin/users/:id/role - Update user role
usersRouter.patch("/:id/role", async (req, res) => {
    try {
        const { role } = req.body;
        if (!role || !["user", "admin", "moderator"].includes(role)) {
            return res.status(400).json({ error: "Invalid role. Must be: user, admin, or moderator" });
        }
        const previousUser = await storage.getUser(req.params.id);
        const user = await storage.updateUser(req.params.id, { role });
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        await storage.createAuditLog({
            action: "user_role_change",
            resource: "users",
            resourceId: req.params.id,
            details: { newRole: role }
        });
        res.json({ success: true, user });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/admin/users/:id/conversations - Get all conversations of a user (admin monitoring)
usersRouter.get("/:id/conversations", async (req, res) => {
    try {
        const userId = req.params.id;
        const user = await storage.getUser(userId);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const conversations = await storage.getConversationsByUserId(userId);
        
        // Get message counts for each conversation
        const conversationsWithStats = await Promise.all(
            conversations.map(async (conv: any) => {
                const messages = await storage.getMessagesByConversationId(conv.id);
                return {
                    ...conv,
                    messageCount: messages?.length || 0,
                    lastMessage: messages?.[messages.length - 1] || null
                };
            })
        );

        await storage.createAuditLog({
            action: "admin_view_user_conversations",
            resource: "users",
            resourceId: userId,
            details: { conversationCount: conversationsWithStats.length }
        });

        res.json({
            user: { id: user.id, email: user.email, fullName: user.fullName },
            conversations: conversationsWithStats,
            total: conversationsWithStats.length
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/admin/users/:id/conversations - Delete all conversations of a user
usersRouter.delete("/:id/conversations", async (req, res) => {
    try {
        const userId = req.params.id;
        const user = await storage.getUser(userId);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const conversations = await storage.getConversationsByUserId(userId);
        let deletedCount = 0;

        for (const conv of conversations) {
            await storage.deleteConversation(conv.id);
            deletedCount++;
        }

        await storage.createAuditLog({
            action: "admin_delete_user_conversations",
            resource: "users",
            resourceId: userId,
            details: { deletedCount }
        });

        res.json({ success: true, deletedCount });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/admin/users/:id/impersonate - Generate impersonation token (for support)
usersRouter.post("/:id/impersonate", async (req, res) => {
    try {
        const userId = req.params.id;
        const user = await storage.getUser(userId);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        // Generate a temporary token for impersonation (valid for 1 hour)
        const crypto = await import("crypto");
        const token = crypto.randomBytes(32).toString("hex");
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

        // Store impersonation token
        await storage.createImpersonationToken({
            token,
            adminId: (req as any).user?.id,
            targetUserId: userId,
            expiresAt
        });

        await storage.createAuditLog({
            action: "admin_impersonate_user",
            resource: "users",
            resourceId: userId,
            details: { expiresAt: expiresAt.toISOString() }
        });

        res.json({ 
            success: true, 
            token,
            expiresAt,
            warning: "Use this token responsibly. All actions will be logged."
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/admin/users/:id/reset - Reset user to clean state
usersRouter.post("/:id/reset", async (req, res) => {
    try {
        const userId = req.params.id;
        const { deleteConversations = true, resetStats = false } = req.body;

        const user = await storage.getUser(userId);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        let deletedConversations = 0;

        // Delete all conversations if requested
        if (deleteConversations) {
            const conversations = await storage.getConversationsByUserId(userId);
            for (const conv of conversations) {
                await storage.deleteConversation(conv.id);
                deletedConversations++;
            }
        }

        // Reset stats if requested
        if (resetStats) {
            await storage.updateUser(userId, {
                queryCount: 0,
                tokensConsumed: 0
            });
        }

        await storage.createAuditLog({
            action: "admin_reset_user",
            resource: "users",
            resourceId: userId,
            details: { deleteConversations, resetStats, deletedConversations }
        });

        res.json({ 
            success: true, 
            deletedConversations,
            statsReset: resetStats
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Export endpoints
usersRouter.get("/export", async (req, res) => {
    try {
        const { format = "json", limit = "5000" } = req.query as Record<string, string>;
        const limitNum = Math.min(Math.max(parseInt(limit, 10) || 5000, 1), 50000);

        // Safety: exporting "all users" doesn't scale; export the most recent N users.
        const exportedUsers = await dbRead
            .select({
                id: users.id,
                email: users.email,
                username: users.username,
                firstName: users.firstName,
                lastName: users.lastName,
                fullName: users.fullName,
                plan: users.plan,
                role: users.role,
                status: users.status,
                queryCount: users.queryCount,
                tokensConsumed: users.tokensConsumed,
                createdAt: users.createdAt,
                lastLoginAt: users.lastLoginAt,
            })
            .from(users)
            .orderBy(desc(users.createdAt), desc(users.id))
            .limit(limitNum);

        if (format === "csv") {
            const headers = ["id", "email", "fullName", "plan", "role", "status", "queryCount", "tokensConsumed", "createdAt", "lastLoginAt"];
            const csvRows = [headers.join(",")];
            exportedUsers.forEach(u => {
                csvRows.push([
                    u.id,
                    u.email || "",
                    u.fullName || `${u.firstName || ""} ${u.lastName || ""}`.trim(),
                    u.plan || "",
                    u.role || "",
                    u.status || "",
                    u.queryCount || 0,
                    u.tokensConsumed || 0,
                    u.createdAt?.toISOString() || "",
                    u.lastLoginAt?.toISOString() || ""
                ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
            });
            res.setHeader("Content-Type", "text/csv");
            res.setHeader("Content-Disposition", `attachment; filename=users_${Date.now()}.csv`);
            res.send(csvRows.join("\n"));
        } else {
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Content-Disposition", `attachment; filename=users_${Date.now()}.json`);
            res.json(exportedUsers);
        }
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});
