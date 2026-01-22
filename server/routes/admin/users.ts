import { Router } from "express";
import { storage } from "../../storage";
import { db } from "../../db";
import { users } from "@shared/schema";
import { hashPassword } from "../../utils/password";
import { validateBody } from "../../middleware/validateRequest";
import { asyncHandler } from "../../middleware/errorHandler";
import { createUserBodySchema } from "../../schemas/apiSchemas";

export const usersRouter = Router();

usersRouter.get("/", async (req, res) => {
    try {
        const users = await storage.getAllUsers();
        res.json(users);
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
