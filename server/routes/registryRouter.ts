import { Router, Request, Response } from "express";
import {
  toolRegistry,
  agentRegistry,
  orchestrator,
  capabilitiesReportRunner,
  initializeAgentSystem,
  getSystemStatus,
  isInitialized,
} from "../agent/registry";

export function createRegistryRouter(): Router {
  const router = Router();

  router.get("/registry/status", async (_req: Request, res: Response) => {
    try {
      const status = getSystemStatus();
      res.json({
        success: true,
        data: status,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.post("/registry/initialize", async (req: Request, res: Response) => {
    try {
      const { runSmokeTest = false } = req.body;
      const result = await initializeAgentSystem({ runSmokeTest });
      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get("/registry/tools", async (_req: Request, res: Response) => {
    try {
      const tools = toolRegistry.getAll().map(t => ({
        name: t.metadata.name,
        description: t.metadata.description,
        category: t.metadata.category,
        version: t.metadata.version,
        config: t.config,
      }));
      
      res.json({
        success: true,
        count: tools.length,
        data: tools,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get("/registry/tools/:name", async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const tool = toolRegistry.get(name);
      
      if (!tool) {
        return res.status(404).json({
          success: false,
          error: `Tool "${name}" not found`,
        });
      }
      
      res.json({
        success: true,
        data: {
          metadata: tool.metadata,
          config: tool.config,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.post("/registry/tools/:name/execute", async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const { input, options } = req.body;
      
      const result = await toolRegistry.execute(name, input, options);
      
      res.json({
        success: result.success,
        data: result.data,
        error: result.error,
        trace: {
          requestId: result.trace.requestId,
          toolName: result.trace.toolName,
          durationMs: result.trace.durationMs,
          status: result.trace.status,
          retryCount: result.trace.retryCount,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get("/registry/tools/category/:category", async (req: Request, res: Response) => {
    try {
      const { category } = req.params;
      const tools = toolRegistry.getByCategory(category as any).map(t => ({
        name: t.metadata.name,
        description: t.metadata.description,
      }));
      
      res.json({
        success: true,
        count: tools.length,
        category,
        data: tools,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get("/registry/agents", async (_req: Request, res: Response) => {
    try {
      const agents = agentRegistry.getAll().map(a => ({
        name: a.config.name,
        description: a.config.description,
        role: a.config.role,
        tools: a.config.tools,
        capabilities: a.getCapabilities().map(c => c.name),
        state: a.state,
      }));
      
      res.json({
        success: true,
        count: agents.length,
        data: agents,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get("/registry/agents/:name", async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const agent = agentRegistry.get(name);
      
      if (!agent) {
        return res.status(404).json({
          success: false,
          error: `Agent "${name}" not found`,
        });
      }
      
      res.json({
        success: true,
        data: {
          config: agent.config,
          state: agent.state,
          capabilities: agent.getCapabilities(),
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.post("/registry/route", async (req: Request, res: Response) => {
    try {
      const { query } = req.body;
      
      if (!query || typeof query !== "string") {
        return res.status(400).json({
          success: false,
          error: "Query is required",
        });
      }
      
      const result = await orchestrator.route(query);
      
      res.json({
        success: true,
        data: {
          intent: result.intent,
          agentName: result.agentName,
          tools: result.tools,
          workflow: result.workflow,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.post("/registry/execute", async (req: Request, res: Response) => {
    try {
      const { query } = req.body;
      
      if (!query || typeof query !== "string") {
        return res.status(400).json({
          success: false,
          error: "Query is required",
        });
      }
      
      const result = await orchestrator.executeTask(query);
      
      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get("/registry/traces", async (req: Request, res: Response) => {
    try {
      const { toolName, category, status, limit } = req.query;
      
      const traces = toolRegistry.getTraces({
        toolName: toolName as string,
        category: category as string,
        status: status as any,
        limit: limit ? parseInt(limit as string) : 100,
      });
      
      res.json({
        success: true,
        count: traces.length,
        data: traces,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get("/registry/stats", async (_req: Request, res: Response) => {
    try {
      const toolStats = toolRegistry.getStats();
      const agentStats = agentRegistry.getStats();
      const orchestratorStats = orchestrator.getStats();
      
      res.json({
        success: true,
        data: {
          tools: toolStats,
          agents: agentStats,
          orchestrator: orchestratorStats,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.post("/registry/capabilities-report", async (req: Request, res: Response) => {
    try {
      const { full = false } = req.body;
      
      const report = full
        ? await capabilitiesReportRunner.runFullReport()
        : await capabilitiesReportRunner.runQuickSmokeTest();
      
      res.json({
        success: true,
        data: report,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get("/registry/capabilities-report/junit", async (_req: Request, res: Response) => {
    try {
      const report = capabilitiesReportRunner.getLastReport();
      
      if (!report) {
        return res.status(404).json({
          success: false,
          error: "No report available. Run /registry/capabilities-report first.",
        });
      }
      
      const junit = capabilitiesReportRunner.toJUnit();
      res.type("application/xml").send(junit);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  router.get("/registry/health", async (_req: Request, res: Response) => {
    try {
      const [toolHealth, agentHealth] = await Promise.all([
        toolRegistry.runHealthChecks(),
        agentRegistry.runHealthChecks(),
      ]);
      
      const toolsHealthy = Array.from(toolHealth.values()).every(h => h);
      const agentsHealthy = Array.from(agentHealth.values()).every(h => h);
      
      res.json({
        success: true,
        healthy: toolsHealthy && agentsHealthy,
        data: {
          tools: Object.fromEntries(toolHealth),
          agents: Object.fromEntries(agentHealth),
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  return router;
}
