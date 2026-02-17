import { Router } from "express";
import { storage } from "../../storage";
import { db } from "../../db";
import { users } from "@shared/schema";
import { hashPassword } from "../../utils/password";
import { validateBody } from "../../middleware/validateRequest";
import { asyncHandler } from "../../middleware/errorHandler";
import { createUserBodySchema } from "../../schemas/apiSchemas";
import { auditLog, AuditActions } from "../../services/auditLogger";
import { requireRecentAuth } from "../../middleware/jitElevation";

export const usersRouter = Router();
const USER_ID_PARAM_PATTERN = /^[a-zA-Z0-9_-]{4,128}$/;
const RESERVED_USER_ID_SEGMENTS = new Set(["stats", "export", "probe"]);

usersRouter.param("id", (req, res, next, value) => {
  const userId = String(value || "").trim();
  const normalizedUserId = userId.toLowerCase();
  if (!USER_ID_PARAM_PATTERN.test(userId) || RESERVED_USER_ID_SEGMENTS.has(normalizedUserId)) {
    res.status(400).json({
      error: "Invalid user identifier",
      code: "INVALID_USER_ID",
    });
    return;
  }
  next();
});

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
            plan
        } = req.query as Record<string, string>;

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
        const offset = (pageNum - 1) * limitNum;

        // Build query with search
        let allUsers = await storage.getAllUsers();
        
        // Apply search filter
        if (search) {
            const searchLower = search.toLowerCase();
            allUsers = allUsers.filter(u => 
                u.email?.toLowerCase().includes(searchLower) ||
                u.firstName?.toLowerCase().includes(searchLower) ||
                u.lastName?.toLowerCase().includes(searchLower) ||
                u.fullName?.toLowerCase().includes(searchLower)
            );
        }

        // Apply status filter
        if (status) {
            allUsers = allUsers.filter(u => u.status === status);
        }

        // Apply role filter
        if (role) {
            allUsers = allUsers.filter(u => u.role === role);
        }

        // Apply plan filter
        if (plan) {
            allUsers = allUsers.filter(u => u.plan === plan);
        }

        // Sort
        const validSortFields = ["createdAt", "email", "queryCount", "tokensConsumed", "lastLoginAt"];
        const sortField = validSortFields.includes(sortBy) ? sortBy : "createdAt";
        allUsers.sort((a, b) => {
            const aVal = (a as any)[sortField] ?? 0;
            const bVal = (b as any)[sortField] ?? 0;
            if (sortOrder === "asc") {
                return aVal > bVal ? 1 : -1;
            }
            return aVal < bVal ? 1 : -1;
        });

        const total = allUsers.length;
        const paginatedUsers = allUsers.slice(offset, offset + limitNum);

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

usersRouter.get("/export", async (req, res) => {
    try {
        const { format = "json" } = req.query;
        const allUsers = await storage.getAllUsers();

        if (format === "csv") {
            const headers = ["id", "email", "fullName", "plan", "role", "status", "queryCount", "tokensConsumed", "createdAt", "lastLoginAt"];
            const csvRows = [headers.join(",")];
            allUsers.forEach(u => {
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
            res.json(allUsers);
        }
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

usersRouter.post("/", validateBody(createUserBodySchema), asyncHandler(async (req, res) => {
    const { email, password, plan, role } = req.body;
    const existingUsers = await storage.getAllUsers();
    const existingUser = existingUsers.find(u => u.email === email);
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
        details: { email, plan, role, createdBy: (req as any).user?.email },
        category: "admin",
        severity: "info"
    });
    
    res.json(user);
}));

usersRouter.patch("/:id", async (req, res) => {
    try {
        // SECURITY: Field allowlist — prevent mass assignment of sensitive fields
        const ALLOWED_PATCH_FIELDS = new Set([
          "email", "firstName", "lastName", "fullName", "plan", "role",
          "status", "profileImageUrl", "blockedAt", "blockReason",
          "queryCount", "tokensConsumed",
        ]);
        const VALID_ROLES = new Set(["user", "admin", "moderator"]);
        const VALID_STATUSES = new Set(["active", "blocked", "suspended", "pending"]);
        const VALID_PLANS = new Set(["free", "pro", "enterprise", "unlimited"]);

        const sanitizedBody: Record<string, any> = {};
        for (const [key, value] of Object.entries(req.body)) {
          if (!ALLOWED_PATCH_FIELDS.has(key)) continue;
          sanitizedBody[key] = value;
        }
        // Validate enum fields
        if (sanitizedBody.role && !VALID_ROLES.has(sanitizedBody.role)) {
          return res.status(400).json({ error: `Invalid role. Must be one of: ${[...VALID_ROLES].join(", ")}` });
        }
        if (sanitizedBody.status && !VALID_STATUSES.has(sanitizedBody.status)) {
          return res.status(400).json({ error: `Invalid status. Must be one of: ${[...VALID_STATUSES].join(", ")}` });
        }
        if (sanitizedBody.plan && !VALID_PLANS.has(sanitizedBody.plan)) {
          return res.status(400).json({ error: `Invalid plan. Must be one of: ${[...VALID_PLANS].join(", ")}` });
        }
        if (Object.keys(sanitizedBody).length === 0) {
          return res.status(400).json({ error: "No valid fields to update" });
        }

        const previousUser = await storage.getUserById(req.params.id);
        const user = await storage.updateUser(req.params.id, sanitizedBody);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        
        // Enhanced audit log with before/after details
        await auditLog(req, {
            action: AuditActions.USER_UPDATED,
            resource: "users",
            resourceId: req.params.id,
            details: {
                changes: sanitizedBody,
                previousValues: previousUser ? {
                    email: previousUser.email,
                    role: previousUser.role,
                    plan: previousUser.plan,
                    status: previousUser.status
                } : null,
                updatedBy: (req as any).user?.email
            },
            category: "admin",
            severity: "info"
        });
        
        res.json(user);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

usersRouter.delete("/:id", requireRecentAuth(), async (req, res) => {
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
                deletedBy: (req as any).user?.email
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
usersRouter.post("/:id/block", requireRecentAuth(), async (req, res) => {
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
usersRouter.post("/:id/unblock", requireRecentAuth(), async (req, res) => {
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
usersRouter.patch("/:id/role", requireRecentAuth(), async (req, res) => {
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
usersRouter.delete("/:id/conversations", requireRecentAuth(), async (req, res) => {
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
usersRouter.post("/:id/impersonate", requireRecentAuth(), async (req, res) => {
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
usersRouter.post("/:id/reset", requireRecentAuth(), async (req, res) => {
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
