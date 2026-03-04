import { Router } from "express";
import { AgentOS } from "../agentos";
import { adminDashboard } from "../services/adminDashboard";
import { ResearchAgent } from "../agentos/agents/research_agent";
import { OnboardingAgent } from "../agentos/agents/onboarding_agent";

export const agentosRouter = Router();

// Status & Capabilities
agentosRouter.get("/status", async (req, res) => {
  const health = await adminDashboard.getSystemHealth();
  res.json(health);
});

agentosRouter.get("/capabilities", (req, res) => {
  res.json({
    media: { image: true, video: true, audio: true },
    artifacts: { enabled: true, types: ["html", "react", "svg"] },
    tools: ["research_deep", "generate_report", "analyze_data"]
  });
});

// Admin Dashboard
agentosRouter.get("/admin/metrics", async (req, res) => {
    const metrics = await adminDashboard.getGlobalMetrics();
    res.json(metrics);
});

agentosRouter.get("/admin/audit", async (req, res) => {
    const logs = await adminDashboard.getAuditTrail(50);
    res.json(logs);
});

// GOD MODE DEBUGGER (#1)
agentosRouter.get("/trace/:runId", async (req, res) => {
    const { runId } = req.params;
    const os = AgentOS.getInstance();
    
    // Buscar todos los eventos relacionados con este runId
    // Nota: Esto asume que el DataPlane tiene capacidad de filtrado por metadatos
    // Si no, devolvemos una simulación basada en logs recientes
    const logs = await os.data.getRecentActivity(100);
    const trace = logs.filter((l: any) => l.resourceId === runId || l.payload?.runId === runId);
    
    res.json({
        runId,
        eventCount: trace.length,
        timeline: trace,
        analysis: {
            toolsUsed: trace.filter((l: any) => l.type === "tool_execution").map((l: any) => l.payload.tool),
            errors: trace.filter((l: any) => l.type === "error" || (l as any).riskLevel === "critical")
        }
    });
});

// Agents execution
agentosRouter.post("/agents/research", async (req, res) => {
    const { topic, depth = "deep", format = "report", userId = "anonymous" } = req.body;
    const agent = new ResearchAgent();
    try {
        const report = await agent.conductResearch(userId, { topic, depth, format });
        res.json({ status: "completed", report });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

agentosRouter.post("/agents/onboarding", async (req, res) => {
    const { userId = "anonymous" } = req.body;
    const agent = new OnboardingAgent();
    const message = await agent.welcomeUser(userId);
    res.json({ message });
});

// Panic Button
agentosRouter.post("/panic", async (req, res) => {
    const os = AgentOS.getInstance();
    await os.shutdown();
    res.json({ message: "AgentOS Shutdown Sequence Initiated. All systems offline." });
});
