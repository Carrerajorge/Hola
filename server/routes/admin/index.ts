import { Router } from "express";
import { requireAdmin } from "./utils";
import { require2FA } from "../../middleware/auth";
import { adminActivityTracker } from "../../middleware/adminActivityTracker";
import { getRolePermissions, requireAnyPermission, requirePermission } from "../../services/rbac";
import { dashboardRouter } from "./dashboard";
import { usersRouter } from "./users";
import { analyticsRouter } from "./analytics";
import { securityRouter } from "./security";
import { modelsRouter } from "./models";
import { databaseRouter } from "./database";
import { settingsRouter } from "./settings";
import { reportsRouter } from "./reports";
import { conversationsRouter } from "./conversations";
import { agentRouter } from "./agent";
import { excelRouter } from "./excel";
import { financeRouter } from "./finance";
import { setupBullBoard } from "../../lib/bullBoard";

export const adminRouter = Router();

// Apply admin middleware to all routes
adminRouter.use(requireAdmin);
adminRouter.use(require2FA);
adminRouter.use(adminActivityTracker); // Auto-log all admin actions

const ADMIN_PANEL_PERMISSIONS = [
  "admin:users",
  "admin:billing",
  "admin:analytics",
  "admin:settings",
  "admin:audit",
  "api:admin",
] as const;

// Probe endpoint (useful for admin UI gates).
adminRouter.get("/probe", (req, res) => {
  const anyReq = req as any;
  const role =
    anyReq.user?.role ||
    anyReq.user?.claims?.role ||
    anyReq.session?.passport?.user?.role ||
    anyReq.session?.passport?.user?.claims?.role ||
    "admin";

  res.json({
    ok: true,
    role,
    permissions: getRolePermissions(String(role)),
  });
});

adminRouter.use("/dashboard", requireAnyPermission(...ADMIN_PANEL_PERMISSIONS), dashboardRouter);
adminRouter.use("/users", requirePermission("admin:users"), usersRouter);
adminRouter.use("/analytics", requirePermission("admin:analytics"), analyticsRouter);
adminRouter.use("/security", requirePermission("admin:audit"), securityRouter);
adminRouter.use("/models", requirePermission("admin:settings"), modelsRouter);
adminRouter.use("/database", requirePermission("api:admin"), databaseRouter);
adminRouter.use("/settings", requirePermission("admin:settings"), settingsRouter);
adminRouter.use("/reports", requirePermission("admin:analytics"), reportsRouter);
adminRouter.use("/conversations", requireAnyPermission("admin:users", "admin:audit"), conversationsRouter);
adminRouter.use("/agent", requirePermission("api:admin"), agentRouter);
adminRouter.use("/excel", requirePermission("api:admin"), excelRouter);
adminRouter.use("/finance", requirePermission("admin:billing"), financeRouter);
adminRouter.use("/queues", requirePermission("api:admin"), setupBullBoard());

// Database status root endpoint for convenience
adminRouter.get("/db-status", (req, res) => {
    res.redirect("/api/admin/database/status");
});

// Seed status root endpoint (for backwards compatibility if needed)
adminRouter.get("/seed-status", (req, res) => {
    res.json({ seeded: true, message: "Use /api/admin/settings/seed to re-seed" });
});

export const createAdminRouter = () => adminRouter;
