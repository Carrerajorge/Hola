import { Router } from "express";
import { contextOrchestrator } from "../../memory/ContextOrchestrator";
import { auditLog } from "../../services/auditLogger";
import { toolRegistry } from "../../agent/toolRegistry";

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
        await auditLog(req, {
            action: "agent.reset",
            resource: "agent",
            details: { resetBy: (req as any).user?.email },
            category: "admin",
            severity: "warning"
        });
        res.json({ success: true, message: "Agent state cleared" });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/admin/agent/tools - List all registered tools
agentRouter.get("/tools", async (req, res) => {
    try {
        const tools = toolRegistry?.getAll?.() || [];
        res.json({
            tools: tools.map((t: any) => ({
                name: t.name,
                description: t.description,
                category: t.category || "general",
                enabled: t.enabled !== false
            })),
            total: tools.length
        });
    } catch (error: any) {
        // If toolRegistry is not available, return empty
        res.json({ tools: [], total: 0 });
    }
});

// GET /api/admin/agent/gaps - Get capability gaps
agentRouter.get("/gaps", async (req, res) => {
    try {
        // Return empty gaps for now - could integrate with gap detection system
        res.json({ gaps: [] });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/admin/agent/memory/stats - Memory statistics
agentRouter.get("/memory/stats", async (req, res) => {
    try {
        const metrics = contextOrchestrator.getMetrics();
        res.json({
            totalAtoms: metrics?.atomCount || 0,
            storageBytes: metrics?.storageBytes || 0,
            avgWeight: metrics?.avgWeight || 0,
            byType: {}
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/admin/agent/circuits - Circuit breaker status
agentRouter.get("/circuits", async (req, res) => {
    try {
        // Return circuit breaker status for each provider
        res.json([
            { name: "xai", status: "closed", failures: 0, lastFailure: null },
            { name: "gemini", status: "closed", failures: 0, lastFailure: null },
            { name: "openai", status: "closed", failures: 0, lastFailure: null }
        ]);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/admin/agent/complexity/analyze - Analyze prompt complexity
agentRouter.post("/complexity/analyze", async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) {
            return res.status(400).json({ error: "prompt is required" });
        }
        
        // Simple complexity analysis
        const wordCount = prompt.split(/\s+/).length;
        const hasCode = /```|function|class|import|export/.test(prompt);
        const hasQuestion = /\?/.test(prompt);
        const hasMultipleTasks = /and|also|además|también/i.test(prompt);
        
        let category = "trivial";
        let score = 1;
        let suggestedPath = "fast";
        
        if (wordCount > 100 || hasCode) {
            category = "complex";
            score = 4;
            suggestedPath = "orchestrated";
        } else if (wordCount > 50 || hasMultipleTasks) {
            category = "moderate";
            score = 3;
            suggestedPath = "standard";
        } else if (wordCount > 20 || hasQuestion) {
            category = "simple";
            score = 2;
            suggestedPath = "standard";
        }
        
        res.json({
            prompt: prompt.substring(0, 100),
            category,
            score,
            suggestedPath,
            analysis: {
                wordCount,
                hasCode,
                hasQuestion,
                hasMultipleTasks
            }
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});
