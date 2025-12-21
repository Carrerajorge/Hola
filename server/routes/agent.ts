import { Router } from "express";
import { storage } from "../storage";
import { agentOrchestrator } from "../agent";

export const agentRouter = Router();

agentRouter.get("/runs/:id", async (req, res) => {
  try {
    const run = await storage.getAgentRun(req.params.id);
    if (!run) {
      return res.status(404).json({ error: "Run not found" });
    }
    const steps = await storage.getAgentSteps(req.params.id);
    const assets = await storage.getAgentAssets(req.params.id);
    res.json({ run, steps, assets });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to get agent run" });
  }
});

agentRouter.post("/runs/:id/cancel", async (req, res) => {
  try {
    const success = agentOrchestrator.cancelRun(req.params.id);
    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Run not found or already completed" });
    }
  } catch (error: any) {
    res.status(500).json({ error: "Failed to cancel run" });
  }
});
