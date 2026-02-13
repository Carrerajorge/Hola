import { Router } from "express";
import { requireAdmin } from "./utils";
import { require2FA } from "../../middleware/auth";
import { adminActivityTracker } from "../../middleware/adminActivityTracker";
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
// Optional: enforce 2FA for all admin actions.
// NOTE: This will block admin access if the user has not completed 2FA setup/verification.
const requireAdmin2FA =
  String(process.env.ADMIN_REQUIRE_2FA || "").trim().toLowerCase() === "true" ||
  String(process.env.ADMIN_REQUIRE_2FA || "").trim() === "1";
if (requireAdmin2FA) {
  adminRouter.use(require2FA);
}
adminRouter.use(adminActivityTracker); // Auto-log all admin actions

adminRouter.use("/dashboard", dashboardRouter);
adminRouter.use("/users", usersRouter);
adminRouter.use("/analytics", analyticsRouter);
adminRouter.use("/security", securityRouter);
adminRouter.use("/models", modelsRouter);
adminRouter.use("/database", databaseRouter);
adminRouter.use("/settings", settingsRouter);
adminRouter.use("/reports", reportsRouter);
adminRouter.use("/conversations", conversationsRouter);
adminRouter.use("/agent", agentRouter);
adminRouter.use("/excel", excelRouter);
adminRouter.use("/finance", financeRouter);
adminRouter.use("/queues", setupBullBoard());

// Database status root endpoint for convenience
adminRouter.get("/db-status", (req, res) => {
    res.redirect("/api/admin/database/status");
});

// Seed status root endpoint (for backwards compatibility if needed)
adminRouter.get("/seed-status", (req, res) => {
    res.json({ seeded: true, message: "Use /api/admin/settings/seed to re-seed" });
});

export const createAdminRouter = () => adminRouter;
