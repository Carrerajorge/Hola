/**
 * Computer Control Router — REST API for Shell, Desktop, and Browser tools.
 *
 * Endpoints:
 * - POST   /api/computer-control/shell/execute      — Execute a shell command
 * - POST   /api/computer-control/shell/assess-risk   — Assess command risk
 * - POST   /api/computer-control/desktop/action      — Execute a desktop action
 * - POST   /api/computer-control/desktop/arm         — Arm desktop control
 * - POST   /api/computer-control/desktop/disarm      — Disarm desktop control
 * - POST   /api/computer-control/browser/session      — Create browser session
 * - DELETE /api/computer-control/browser/session/:id  — Close browser session
 * - POST   /api/computer-control/browser/action       — Execute browser action
 * - GET    /api/computer-control/browser/sessions     — List browser sessions
 * - GET    /api/computer-control/status               — Get control plane status
 * - POST   /api/computer-control/kill-switch/activate — Activate kill switch
 * - POST   /api/computer-control/kill-switch/deactivate — Deactivate kill switch
 * - PATCH  /api/computer-control/mode                 — Change control mode
 * - GET    /api/computer-control/audit                — Get unified audit log
 */

import { Router, Request, Response } from "express";
import { ComputerControlPlane } from "./computer-control";

export function createComputerControlRouter() {
  const router = Router();
  const controlPlane = new ComputerControlPlane({
    mode: "SUPERVISED",
    shellEnabled: true,
    desktopEnabled: true,
    browserEnabled: true,
  });

  // ══ SHELL ═══════════════════════════════════════

  router.post("/shell/execute", async (req: Request, res: Response) => {
    const { command, cwd, env, timeout, stream, dryRun, confirmationToken } = req.body;
    if (!command) return res.status(400).json({ error: "command is required" });

    try {
      const result = await controlPlane.executeCommand({
        command,
        cwd,
        env,
        timeout,
        stream,
        dryRun,
        userId: (req as any).user?.id || "anonymous",
        sessionId: (req as any).sessionId || "default",
        confirmationToken,
      });
      return res.json(result);
    } catch (error) {
      return res.status(403).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post("/shell/assess-risk", (req: Request, res: Response) => {
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: "command is required" });
    return res.json(controlPlane.assessCommandRisk(command));
  });

  // ══ DESKTOP ═════════════════════════════════════

  router.post("/desktop/action", async (req: Request, res: Response) => {
    const { action } = req.body;
    if (!action || !action.type) return res.status(400).json({ error: "action with type is required" });

    try {
      const result = await controlPlane.executeDesktopAction(
        action,
        (req as any).user?.id || "anonymous",
        (req as any).sessionId || "default",
      );
      return res.json(result);
    } catch (error) {
      return res.status(403).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post("/desktop/arm", (_req: Request, res: Response) => {
    controlPlane.armDesktop();
    return res.json({ armed: true });
  });

  router.post("/desktop/disarm", (_req: Request, res: Response) => {
    controlPlane.disarmDesktop();
    return res.json({ armed: false });
  });

  router.get("/desktop/status", (_req: Request, res: Response) => {
    return res.json({ armed: controlPlane.isDesktopArmed() });
  });

  // ══ BROWSER ═════════════════════════════════════

  router.post("/browser/session", async (req: Request, res: Response) => {
    const { viewport } = req.body;
    try {
      const sessionId = await controlPlane.createBrowserSession({ viewport });
      return res.json({ sessionId });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.delete("/browser/session/:id", async (req: Request, res: Response) => {
    await controlPlane.closeBrowserSession(req.params.id);
    return res.json({ closed: true });
  });

  router.post("/browser/action", async (req: Request, res: Response) => {
    const { sessionId, action } = req.body;
    if (!sessionId || !action) return res.status(400).json({ error: "sessionId and action are required" });

    try {
      const result = await controlPlane.executeBrowserAction(
        sessionId,
        action,
        (req as any).user?.id || "anonymous",
        (req as any).sessionId || "default",
      );
      return res.json(result);
    } catch (error) {
      return res.status(403).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // ══ CONTROL PLANE ═══════════════════════════════

  router.get("/status", (_req: Request, res: Response) => {
    return res.json(controlPlane.getStatus());
  });

  router.post("/kill-switch/activate", (_req: Request, res: Response) => {
    controlPlane.activateKillSwitch();
    return res.json({ killSwitch: true, message: "Kill switch activated. All tools halted." });
  });

  router.post("/kill-switch/deactivate", (_req: Request, res: Response) => {
    controlPlane.deactivateKillSwitch();
    return res.json({ killSwitch: false, message: "Kill switch deactivated." });
  });

  router.patch("/mode", (req: Request, res: Response) => {
    const { mode } = req.body;
    if (!["SAFE", "SUPERVISED", "AUTOPILOT"].includes(mode)) {
      return res.status(400).json({ error: "mode must be SAFE, SUPERVISED, or AUTOPILOT" });
    }
    controlPlane.setMode(mode);
    return res.json({ mode: controlPlane.getMode() });
  });

  router.get("/audit", (req: Request, res: Response) => {
    const limit = parseInt(String(req.query.limit || "200"), 10);
    return res.json({ entries: controlPlane.getAuditLog(limit) });
  });

  return router;
}
