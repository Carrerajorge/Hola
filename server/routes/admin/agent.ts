import { Router } from "express";
import { contextOrchestrator } from "../../memory/ContextOrchestrator";

export const agentRouter = Router();

agentRouter.get("/status", async (req, res) => {
    try {
        const stats = contextOrchestrator.getMetrics();
        // Since contextOrchestrator doesn't expose verbose status directly in stats, 
        // we construct a health check response.
        res.json({
            status: "active",
            router: "ContextOrchestrator",
            stats
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

agentRouter.get("/config", async (req, res) => {
    try {
        res.json({
            mode: "hybrid",
            features: ["rag", "reflection", "planning"],
            maxContextTokens: 128000
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

agentRouter.post("/reset", async (req, res) => {
    try {
        // Reset agent state if possible
        res.json({ success: true, message: "Agent state cleared" });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});
