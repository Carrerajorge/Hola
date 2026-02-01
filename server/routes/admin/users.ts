import { Router } from "express";
import { storage } from "../../storage";
import { db } from "../../db";
import { users } from "@shared/schema";
import { hashPassword } from "../../utils/password";
import { validateBody } from "../../middleware/validateRequest";
import { asyncHandler } from "../../middleware/errorHandler";
import { createUserBodySchema } from "../../schemas/apiSchemas";
import { sql, ilike, or, desc, asc } from "drizzle-orm";

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
    await storage.createAuditLog({
        action: "user_create",
        resource: "users",
        resourceId: user.id,
        details: { email, plan, role }
    });
    res.json(user);
}));

usersRouter.patch("/:id", async (req, res) => {
    try {
        const user = await storage.updateUser(req.params.id, req.body);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        await storage.createAuditLog({
            action: "user_update",
            resource: "users",
            resourceId: req.params.id,
            details: req.body
        });
        res.json(user);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

usersRouter.delete("/:id", async (req, res) => {
    try {
        await storage.deleteUser(req.params.id);
        await storage.createAuditLog({
            action: "user_delete",
            resource: "users",
            resourceId: req.params.id
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
        const user = await storage.updateUser(req.params.id, { 
            status: "blocked",
            blockedAt: new Date(),
            blockReason: reason || "Blocked by admin"
        });
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        await storage.createAuditLog({
            action: "user_block",
            resource: "users",
            resourceId: req.params.id,
            details: { reason }
        });
        res.json({ success: true, user });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/admin/users/:id/unblock - Unblock a user
usersRouter.post("/:id/unblock", async (req, res) => {
    try {
        const user = await storage.updateUser(req.params.id, { 
            status: "active",
            blockedAt: null,
            blockReason: null
        });
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        await storage.createAuditLog({
            action: "user_unblock",
            resource: "users",
            resourceId: req.params.id
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

// Export endpoints
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
