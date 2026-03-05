/**
 * Super Agent Controller API Routes
 *
 * REST + SSE endpoints for the unified super agent system:
 * - POST /api/super-agent/process — Main entry point
 * - GET  /api/super-agent/status — System status
 * - POST /api/super-agent/research — Parallel research
 * - POST /api/super-agent/background-task — Create background task
 * - GET  /api/super-agent/background-tasks — List background tasks
 * - POST /api/super-agent/background-task/:id/pause — Pause task
 * - POST /api/super-agent/background-task/:id/resume — Resume task
 * - DELETE /api/super-agent/background-task/:id — Cancel task
 * - POST /api/super-agent/connector — Execute connector action
 * - GET  /api/super-agent/connectors — List connectors
 * - POST /api/super-agent/route — Route analysis (dry run)
 * - GET  /api/super-agent/models — Available models
 * - GET  /api/super-agent/cost-report — Cost report
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { superAgentController } from "../agent/superAgentController";
import { superAgentRouter } from "../agent/superAgentRouter";
import { backgroundTaskManager } from "../agent/backgroundTaskManager";
import { parallelResearchEngine } from "../agent/parallelResearchEngine";
import { toolConnectorHub } from "../agent/toolConnectorHub";

const router = Router();

// ============================================
// Main Processing Endpoint
// ============================================

const processSchema = z.object({
  message: z.string().min(1),
  chatId: z.string().optional(),
  attachments: z.array(z.any()).optional(),
  context: z.object({
    modelOverride: z.string().optional(),
    enableBackgroundTasks: z.boolean().optional(),
    enableParallelResearch: z.boolean().optional(),
    enableToolConnectors: z.boolean().optional(),
    enableComputerUse: z.boolean().optional(),
  }).optional(),
});

router.post("/process", async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Authentication required" });

    const body = processSchema.parse(req.body);

    const result = await superAgentController.process({
      userId: String(user.id),
      chatId: body.chatId || `chat-${Date.now()}`,
      message: body.message,
      attachments: body.attachments,
      context: {
        ...body.context,
        userPlan: user.plan || "free",
      },
    });

    res.json(result);
  } catch (err: any) {
    if (err.name === "ZodError") {
      return res.status(400).json({ error: "Invalid request", details: err.errors });
    }
    console.error("[SuperAgent] Process error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// SSE Streaming Endpoint
// ============================================

router.post("/process/stream", async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Authentication required" });

    const body = processSchema.parse(req.body);

    // Set up SSE
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const sendEvent = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Listen for events
    const onProgress = (data: any) => sendEvent("progress", data);
    const onEvent = (data: any) => sendEvent("agent_event", data);
    const onResearch = (data: any) => sendEvent("research_progress", data);

    superAgentController.on("agent_progress", onProgress);
    superAgentController.on("agent_event", onEvent);
    superAgentController.on("research_progress", onResearch);

    try {
      const result = await superAgentController.process({
        userId: String(user.id),
        chatId: body.chatId || `chat-${Date.now()}`,
        message: body.message,
        attachments: body.attachments,
        context: {
          ...body.context,
          userPlan: user.plan || "free",
        },
      });

      sendEvent("completed", result);
    } catch (err: any) {
      sendEvent("error", { message: err.message });
    } finally {
      superAgentController.off("agent_progress", onProgress);
      superAgentController.off("agent_event", onEvent);
      superAgentController.off("research_progress", onResearch);
      res.end();
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// System Status
// ============================================

router.get("/status", (_req: Request, res: Response) => {
  try {
    const status = superAgentController.getStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// Route Analysis (Dry Run)
// ============================================

router.post("/route", async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Authentication required" });

    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "message required" });

    const decision = await superAgentRouter.route(message, String(user.id));
    res.json(decision);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// Parallel Research
// ============================================

const researchSchema = z.object({
  topic: z.string().min(1),
  depth: z.enum(["quick", "moderate", "deep", "exhaustive"]).optional().default("moderate"),
  sources: z.array(z.string()).optional(),
  maxSources: z.number().optional(),
  language: z.string().optional(),
  outputFormat: z.enum(["summary", "report", "raw_data", "structured"]).optional(),
});

router.post("/research", async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Authentication required" });

    const body = researchSchema.parse(req.body);

    const result = await parallelResearchEngine.research({
      ...body,
      userId: String(user.id),
      sources: body.sources as any,
    });

    res.json(result);
  } catch (err: any) {
    if (err.name === "ZodError") {
      return res.status(400).json({ error: "Invalid request", details: err.errors });
    }
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// Background Tasks
// ============================================

router.post("/background-task", async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Authentication required" });

    const task = await backgroundTaskManager.registerTask({
      ...req.body,
      userId: String(user.id),
    });

    res.status(201).json(task);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/background-tasks", (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Authentication required" });

    const tasks = backgroundTaskManager.listTasks(String(user.id));
    res.json(tasks);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/background-task/:id", (req: Request, res: Response) => {
  try {
    const task = backgroundTaskManager.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found" });
    res.json(task);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/background-task/:id/pause", (req: Request, res: Response) => {
  try {
    backgroundTaskManager.pauseTask(req.params.id);
    res.json({ success: true, message: "Task paused" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/background-task/:id/resume", async (req: Request, res: Response) => {
  try {
    await backgroundTaskManager.resumeTask(req.params.id);
    res.json({ success: true, message: "Task resumed" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/background-task/:id", (req: Request, res: Response) => {
  try {
    backgroundTaskManager.cancelTask(req.params.id);
    res.json({ success: true, message: "Task cancelled" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// Tool Connectors
// ============================================

router.get("/connectors", (_req: Request, res: Response) => {
  try {
    const connectors = toolConnectorHub.listConnectors();
    res.json(connectors);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/connector/execute", async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Authentication required" });

    const { connector, action, params } = req.body;
    if (!connector || !action) return res.status(400).json({ error: "connector and action required" });

    const result = await toolConnectorHub.execute({
      connector,
      action,
      params: params || {},
      userId: String(user.id),
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// Models & Cost
// ============================================

router.get("/models", (_req: Request, res: Response) => {
  res.json({
    models: [
      { id: "opus", name: "Claude Opus 4.6", role: "Main brain — complex reasoning", provider: "anthropic" },
      { id: "gemini", name: "Gemini 2.5 Pro", role: "Deep research — long context", provider: "google" },
      { id: "grok", name: "Grok 3", role: "Fast responses — real-time data", provider: "xai" },
      { id: "chatgpt", name: "ChatGPT 5.2", role: "Broad search — long-term memory", provider: "openai" },
      { id: "nano_banana", name: "Nano Banana", role: "Image generation", provider: "nano_banana" },
      { id: "veo", name: "Veo 3.1", role: "Video generation", provider: "google" },
    ],
  });
});

router.get("/cost-report", (_req: Request, res: Response) => {
  try {
    const report = superAgentController.getCostReport();
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
