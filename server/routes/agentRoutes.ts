import { Router, Request, Response, NextFunction } from "express";
import { db } from "../db";
import { agentModeRuns, agentModeSteps, agentModeEvents } from "@shared/schema";
import { agentManager } from "../agent/agentOrchestrator";
import { agentEventBus } from "../agent/eventBus";
import { eq, desc, asc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { CreateRunRequestSchema, RunResponseSchema, StepsArrayResponseSchema } from "../agent/contracts";
import { validateOrThrow, ValidationError } from "../agent/validation";
import { checkIdempotency } from "../agent/idempotency";
import { updateRunWithLock } from "../agent/dbTransactions";
import { toolRegistry, TOOL_CATEGORIES } from "../agent/registry/toolRegistry";
import { agentRegistry } from "../agent/registry/agentRegistry";

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user) {
    return res.status(401).json({ error: "Authentication required" });
  }
  next();
}

export function createAgentModeRouter() {
  const router = Router();

  router.post("/runs", requireAuth, async (req: Request, res: Response) => {
    try {
      const validatedBody = validateOrThrow(CreateRunRequestSchema, req.body, "POST /runs request body");
      const { chatId, messageId, message, attachments, idempotencyKey } = validatedBody;
      const user = (req as any).user;
      const userId = user?.claims?.sub || user?.id;
      const userPlan = (user?.plan === "pro" || user?.plan === "admin") ? user.plan : "free" as "free" | "pro" | "admin";

      if (idempotencyKey) {
        const idempotencyResult = await checkIdempotency(idempotencyKey, chatId);
        if (idempotencyResult.isDuplicate) {
          return res.status(200).json({
            id: idempotencyResult.existingRunId,
            runId: idempotencyResult.existingRunId,
            status: idempotencyResult.existingStatus,
            duplicate: true,
          });
        }
      }

      const runId = randomUUID();

      const [newRun] = await db.insert(agentModeRuns).values({
        id: runId,
        chatId,
        messageId: messageId || null,
        userId: userId || null,
        status: "queued",
        plan: null,
        artifacts: null,
        summary: null,
        error: null,
        totalSteps: 0,
        completedSteps: 0,
        currentStepIndex: 0,
        startedAt: null,
        completedAt: null,
        idempotencyKey: idempotencyKey || null,
      }).returning();

      (async () => {
        let currentStatus = "queued";
        try {
          const lockResult = await updateRunWithLock(runId, "queued", { 
            status: "planning", 
            startedAt: new Date() 
          });
          if (!lockResult.success) {
            console.warn(`[AgentRoutes] Failed to transition run ${runId} to planning: ${lockResult.error}`);
            return;
          }
          currentStatus = "planning";

          const orchestrator = await agentManager.startRun(
            runId,
            chatId,
            userId || "anonymous",
            message,
            attachments,
            userPlan
          );

          orchestrator.on("progress", async (progress) => {
            try {
              const newStatus = progress.status === "executing" ? "running" : progress.status;
              const updateData: any = {
                status: newStatus,
                currentStepIndex: progress.currentStepIndex,
                totalSteps: progress.totalSteps,
                completedSteps: progress.stepResults.filter((r: any) => r.success).length,
              };

              if (progress.plan) {
                updateData.plan = progress.plan;
              }

              if (progress.artifacts && progress.artifacts.length > 0) {
                updateData.artifacts = progress.artifacts;
              }

              if (progress.status === "completed") {
                updateData.status = "completed";
                updateData.completedAt = new Date();
                
                const summary = await orchestrator.generateSummary();
                updateData.summary = summary;
              }

              if (progress.status === "failed") {
                updateData.completedAt = new Date();
                updateData.error = progress.error || "Unknown error";
              }

              if (progress.status === "cancelled") {
                updateData.completedAt = new Date();
              }

              const lockResult = await updateRunWithLock(runId, currentStatus, updateData);
              if (lockResult.success) {
                currentStatus = newStatus;
              } else {
                console.warn(`[AgentRoutes] Optimistic lock failed for run ${runId}: ${lockResult.error}`);
              }

              for (const stepResult of progress.stepResults) {
                const existingStep = await db.select()
                  .from(agentModeSteps)
                  .where(eq(agentModeSteps.runId, runId))
                  .then(steps => steps.find(s => s.stepIndex === stepResult.stepIndex));

                if (!existingStep) {
                  await db.insert(agentModeSteps).values({
                    runId,
                    stepIndex: stepResult.stepIndex,
                    toolName: stepResult.toolName,
                    toolInput: progress.plan?.steps[stepResult.stepIndex]?.input || null,
                    toolOutput: stepResult.output,
                    status: stepResult.success ? "succeeded" : "failed",
                    error: stepResult.error || null,
                    startedAt: new Date(stepResult.startedAt),
                    completedAt: new Date(stepResult.completedAt),
                  });
                } else {
                  await db.update(agentModeSteps)
                    .set({
                      toolOutput: stepResult.output,
                      status: stepResult.success ? "succeeded" : "failed",
                      error: stepResult.error || null,
                      completedAt: new Date(stepResult.completedAt),
                    })
                    .where(eq(agentModeSteps.id, existingStep.id));
                }
              }
            } catch (err) {
              console.error(`[AgentRoutes] Error updating run ${runId} progress:`, err);
            }
          });

        } catch (err: any) {
          console.error(`[AgentRoutes] Error starting run ${runId}:`, err);
          await updateRunWithLock(runId, currentStatus, { 
            status: "failed", 
            error: err.message || "Failed to start agent run",
            completedAt: new Date(),
          });
        }
      })();

      res.status(201).json({ 
        id: newRun.id,
        runId: newRun.id, 
        status: "queued",
        steps: [],
        artifacts: [],
        plan: null,
        summary: null,
        error: null,
      });
    } catch (error: any) {
      if (error instanceof ValidationError) {
        return res.status(400).json({ 
          error: "Validation failed", 
          details: error.zodError.errors 
        });
      }
      console.error("[AgentRoutes] Error creating run:", error);
      res.status(500).json({ error: "Failed to create agent run" });
    }
  });

  router.get("/runs/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const [run] = await db.select()
        .from(agentModeRuns)
        .where(eq(agentModeRuns.id, id));

      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      const steps = await db.select()
        .from(agentModeSteps)
        .where(eq(agentModeSteps.runId, id))
        .orderBy(agentModeSteps.stepIndex);

      const planSteps = (run.plan as any)?.steps || [];
      
      const mergedSteps = planSteps.map((planStep: any, index: number) => {
        const dbStep = steps.find(s => s.stepIndex === index);
        if (dbStep) {
          return {
            stepIndex: dbStep.stepIndex,
            toolName: dbStep.toolName,
            description: planStep.description,
            status: dbStep.status,
            output: dbStep.toolOutput,
            error: dbStep.error,
            startedAt: dbStep.startedAt,
            completedAt: dbStep.completedAt,
          };
        }
        return {
          stepIndex: index,
          toolName: planStep.toolName,
          description: planStep.description,
          status: index < (run.currentStepIndex || 0) ? "pending" : 
                  index === (run.currentStepIndex || 0) && run.status === "running" ? "running" : "pending",
          output: null,
          error: null,
          startedAt: null,
          completedAt: null,
        };
      });

      const response = {
        id: run.id,
        chatId: run.chatId,
        status: run.status,
        plan: run.plan,
        currentStepIndex: run.currentStepIndex ?? 0,
        totalSteps: run.totalSteps ?? planSteps.length,
        completedSteps: run.completedSteps ?? 0,
        steps: mergedSteps.length > 0 ? mergedSteps : steps.map(s => ({
          stepIndex: s.stepIndex,
          toolName: s.toolName,
          description: null,
          status: s.status,
          output: s.toolOutput,
          error: s.error,
          startedAt: s.startedAt,
          completedAt: s.completedAt,
        })),
        artifacts: (run.artifacts as any[]) || [],
        summary: run.summary,
        error: run.error,
        startedAt: run.startedAt?.toISOString(),
        completedAt: run.completedAt?.toISOString(),
        createdAt: run.createdAt.toISOString(),
      };

      const validatedResponse = validateOrThrow(RunResponseSchema, response, `GET /runs/${id} response`);
      res.json(validatedResponse);
    } catch (error: any) {
      if (error instanceof ValidationError) {
        console.error(`[AgentRoutes] Response validation failed:`, error.zodError.errors);
        return res.status(500).json({ error: "Internal response validation failed" });
      }
      console.error("[AgentRoutes] Error getting run:", error);
      res.status(500).json({ error: "Failed to get agent run" });
    }
  });

  router.get("/runs/:id/steps", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const [run] = await db.select()
        .from(agentModeRuns)
        .where(eq(agentModeRuns.id, id));

      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      const steps = await db.select()
        .from(agentModeSteps)
        .where(eq(agentModeSteps.runId, id))
        .orderBy(agentModeSteps.stepIndex);

      const response = steps.map(s => ({
        stepIndex: s.stepIndex,
        toolName: s.toolName,
        status: s.status,
        output: s.toolOutput,
        error: s.error,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
      }));

      const validatedResponse = validateOrThrow(StepsArrayResponseSchema, response, `GET /runs/${id}/steps response`);
      res.json(validatedResponse);
    } catch (error: any) {
      if (error instanceof ValidationError) {
        console.error(`[AgentRoutes] Response validation failed:`, error.zodError.errors);
        return res.status(500).json({ error: "Internal response validation failed" });
      }
      console.error("[AgentRoutes] Error getting steps:", error);
      res.status(500).json({ error: "Failed to get agent run steps" });
    }
  });

  router.get("/runs/:id/events", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const [run] = await db.select()
        .from(agentModeRuns)
        .where(eq(agentModeRuns.id, id));

      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      const events = await db.select()
        .from(agentModeEvents)
        .where(eq(agentModeEvents.runId, id))
        .orderBy(asc(agentModeEvents.timestamp));

      const response = events.map(e => ({
        id: e.id,
        runId: e.runId,
        stepIndex: e.stepIndex,
        correlationId: e.correlationId,
        eventType: e.eventType,
        payload: e.payload,
        metadata: e.metadata,
        timestamp: e.timestamp,
      }));

      res.json(response);
    } catch (error: any) {
      console.error("[AgentRoutes] Error getting events:", error);
      res.status(500).json({ error: "Failed to get agent run events" });
    }
  });

  router.get("/runs/:id/events/stream", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const [run] = await db.select()
        .from(agentModeRuns)
        .where(eq(agentModeRuns.id, id));

      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      const clientId = agentEventBus.subscribe(id, res);
      console.log(`[AgentRoutes] SSE client ${clientId} connected to run ${id}`);

      req.on("close", () => {
        agentEventBus.removeClient(clientId);
        console.log(`[AgentRoutes] SSE client ${clientId} disconnected from run ${id}`);
      });
    } catch (error: any) {
      console.error("[AgentRoutes] Error setting up event stream:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to setup event stream" });
      }
    }
  });

  router.post("/runs/:id/cancel", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const [run] = await db.select()
        .from(agentModeRuns)
        .where(eq(agentModeRuns.id, id));

      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      if (["completed", "failed", "cancelled"].includes(run.status)) {
        return res.status(400).json({ 
          error: "Cannot cancel a run that has already finished",
          currentStatus: run.status,
        });
      }

      const cancelled = await agentManager.cancelRun(id);

      const lockResult = await updateRunWithLock(id, run.status, { 
        status: "cancelled", 
        completedAt: new Date(),
      });

      if (!lockResult.success) {
        return res.status(409).json({
          error: "Failed to cancel run due to concurrent modification",
          details: lockResult.error,
        });
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("[AgentRoutes] Error cancelling run:", error);
      res.status(500).json({ error: "Failed to cancel agent run" });
    }
  });

  router.post("/runs/:id/pause", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const [run] = await db.select()
        .from(agentModeRuns)
        .where(eq(agentModeRuns.id, id));

      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      if (run.status !== "running") {
        return res.status(400).json({ 
          error: "Can only pause running runs",
          currentStatus: run.status,
        });
      }

      if (typeof (agentManager as any).pauseRun === 'function') {
        await (agentManager as any).pauseRun(id);
      }

      const lockResult = await updateRunWithLock(id, "running", { status: "paused" });

      if (!lockResult.success) {
        return res.status(409).json({
          error: "Failed to pause run due to concurrent modification",
          details: lockResult.error,
        });
      }

      res.json({ success: true, status: "paused" });
    } catch (error: any) {
      console.error("[AgentRoutes] Error pausing run:", error);
      res.status(500).json({ error: "Failed to pause agent run" });
    }
  });

  router.post("/runs/:id/resume", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const [run] = await db.select()
        .from(agentModeRuns)
        .where(eq(agentModeRuns.id, id));

      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      if (run.status !== "paused") {
        return res.status(400).json({ 
          error: "Can only resume paused runs",
          currentStatus: run.status,
        });
      }

      if (typeof (agentManager as any).resumeRun === 'function') {
        await (agentManager as any).resumeRun(id);
      }

      const lockResult = await updateRunWithLock(id, "paused", { status: "running" });

      if (!lockResult.success) {
        return res.status(409).json({
          error: "Failed to resume run due to concurrent modification",
          details: lockResult.error,
        });
      }

      res.json({ success: true, status: "running" });
    } catch (error: any) {
      console.error("[AgentRoutes] Error resuming run:", error);
      res.status(500).json({ error: "Failed to resume agent run" });
    }
  });

  router.post("/runs/:id/retry", requireAuth, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const user = (req as any).user;
      const userId = user?.claims?.sub || user?.id;
      const userPlan = (user?.plan === "pro" || user?.plan === "admin") ? user.plan : "free" as "free" | "pro" | "admin";

      const [run] = await db.select()
        .from(agentModeRuns)
        .where(eq(agentModeRuns.id, id));

      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      if (run.status !== "failed") {
        return res.status(400).json({ 
          error: "Can only retry failed runs",
          currentStatus: run.status,
        });
      }

      const failedStep = await db.select()
        .from(agentModeSteps)
        .where(eq(agentModeSteps.runId, id))
        .orderBy(desc(agentModeSteps.stepIndex))
        .limit(1)
        .then(steps => steps.find(s => s.status === "failed"));

      const retryFromStep = failedStep?.stepIndex || 0;

      const retryLockResult = await updateRunWithLock(id, "failed", { 
        status: "running",
        error: null,
        completedAt: null,
        currentStepIndex: retryFromStep,
      });

      if (!retryLockResult.success) {
        return res.status(409).json({
          error: "Failed to acquire lock for retry",
          details: retryLockResult.error,
        });
      }

      const plan = run.plan as any;
      if (plan && plan.objective) {
        (async () => {
          let currentStatus = "running";
          try {
            const orchestrator = await agentManager.startRun(
              id,
              run.chatId,
              userId || "anonymous",
              plan.objective,
              [],
              userPlan
            );

            orchestrator.on("progress", async (progress) => {
              try {
                const newStatus = progress.status === "executing" ? "running" : progress.status;
                const updateData: any = {
                  status: newStatus,
                  currentStepIndex: progress.currentStepIndex,
                  completedSteps: progress.stepResults.filter((r: any) => r.success).length,
                };

                if (progress.artifacts && progress.artifacts.length > 0) {
                  updateData.artifacts = progress.artifacts;
                }

                if (progress.status === "completed") {
                  updateData.status = "completed";
                  updateData.completedAt = new Date();
                  const summary = await orchestrator.generateSummary();
                  updateData.summary = summary;
                }

                if (progress.status === "failed") {
                  updateData.completedAt = new Date();
                  updateData.error = progress.error || "Unknown error";
                }

                const lockResult = await updateRunWithLock(id, currentStatus, updateData);
                if (lockResult.success) {
                  currentStatus = newStatus;
                } else {
                  console.warn(`[AgentRoutes] Optimistic lock failed for retry run ${id}: ${lockResult.error}`);
                }
              } catch (err) {
                console.error(`[AgentRoutes] Error updating retry run ${id}:`, err);
              }
            });
          } catch (err: any) {
            console.error(`[AgentRoutes] Error retrying run ${id}:`, err);
            await updateRunWithLock(id, currentStatus, { 
              status: "failed", 
              error: err.message || "Failed to retry agent run",
              completedAt: new Date(),
            });
          }
        })();
      }

      res.json({ 
        success: true, 
        status: "running",
        retryFromStep,
      });
    } catch (error: any) {
      console.error("[AgentRoutes] Error retrying run:", error);
      res.status(500).json({ error: "Failed to retry agent run" });
    }
  });

  router.get("/skills", async (req: Request, res: Response) => {
    try {
      const allTools = toolRegistry.getAll();
      
      const categoryMap: Record<string, string> = {
        "Web": "research",
        "Generation": "media",
        "Processing": "data",
        "Data": "data",
        "Document": "documents",
        "Development": "code",
        "Diagram": "media",
        "API": "automation",
        "Productivity": "automation",
        "Security": "code",
        "Automation": "automation",
        "Database": "data",
        "Monitoring": "automation",
        "Utility": "automation",
        "Memory": "data",
        "Reasoning": "research",
        "Orchestration": "automation",
        "Communication": "communication",
        "AdvancedSystem": "automation",
      };
      
      const popularTools = new Set([
        "search_web", "generate_image", "doc_create", "spreadsheet_create",
        "code_generate", "data_analyze", "pdf_manipulate", "slides_create",
        "browser_navigate", "fetch_url"
      ]);
      
      const skills = allTools
        .filter(tool => tool.metadata.implementationStatus === "implemented")
        .map((tool) => {
          const category = categoryMap[tool.metadata.category] || "automation";
          return {
            id: tool.metadata.name.toLowerCase().replace(/_/g, "-"),
            name: tool.metadata.name.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
            description: tool.metadata.description,
            category,
            primaryAgent: `${tool.metadata.category}Agent`,
            tools: [tool.metadata.name],
            requiredInputs: [],
            outputType: "Resultado",
            tags: tool.metadata.tags,
            version: tool.metadata.version,
            popular: popularTools.has(tool.metadata.name),
            new: tool.metadata.experimental,
            deprecated: tool.metadata.deprecated,
            implementationStatus: tool.metadata.implementationStatus,
          };
        });

      res.json({ skills });
    } catch (error: any) {
      console.error("[AgentRoutes] Error getting skills:", error);
      res.status(500).json({ error: "Failed to get skills", skills: [] });
    }
  });

  router.get("/capabilities", async (req: Request, res: Response) => {
    try {
      const toolStats = toolRegistry.getStats();
      const agentStats = agentRegistry.getStats();
      const allTools = toolRegistry.getAll();
      
      const categoryNameMap: Record<string, string> = {
        "Web": "Investigación",
        "Generation": "Multimedia",
        "Processing": "Procesamiento",
        "Data": "Datos y Análisis",
        "Document": "Documentos",
        "Development": "Desarrollo",
        "Diagram": "Diagramas",
        "API": "APIs",
        "Productivity": "Productividad",
        "Security": "Seguridad",
        "Automation": "Automatización",
        "Database": "Base de Datos",
        "Monitoring": "Monitoreo",
        "Utility": "Utilidades",
        "Memory": "Memoria",
        "Reasoning": "Razonamiento",
        "Orchestration": "Orquestación",
        "Communication": "Comunicación",
        "AdvancedSystem": "Sistema Avanzado",
      };
      
      const categories = Object.entries(toolStats.byCategory).map(([id, count]) => ({
        id: id.toLowerCase(),
        name: categoryNameMap[id] || id,
        count,
      }));
      
      const implementedCount = allTools.filter(
        t => t.metadata.implementationStatus === "implemented"
      ).length;

      const stats = {
        totalTools: toolStats.totalTools,
        totalAgents: agentStats.totalAgents,
        totalSkills: implementedCount,
        categories,
        traces: toolStats.traces,
        byRole: agentStats.byRole,
      };

      res.json(stats);
    } catch (error: any) {
      console.error("[AgentRoutes] Error getting capabilities:", error);
      res.status(500).json({ 
        error: "Failed to get capabilities",
        totalTools: 0,
        totalAgents: 0,
        totalSkills: 0,
        categories: [],
      });
    }
  });

  return router;
}
