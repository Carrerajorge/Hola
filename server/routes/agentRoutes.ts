import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db } from "../db";
import { agentModeRuns, agentModeSteps, agentModeEvents } from "@shared/schema";
import { agentManager } from "../agent/agentOrchestrator";
import { eq, desc, asc } from "drizzle-orm";
import { randomUUID } from "crypto";

const createRunSchema = z.object({
  chatId: z.string().min(1, "chatId is required"),
  messageId: z.string().optional(),
  message: z.string().min(1, "message is required"),
  attachments: z.array(z.any()).optional(),
});

const cancelRunSchema = z.object({
  reason: z.string().optional(),
});

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
      const validation = createRunSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          error: "Validation failed", 
          details: validation.error.errors 
        });
      }

      const { chatId, messageId, message, attachments } = validation.data;
      const user = (req as any).user;
      const userId = user?.claims?.sub || user?.id;

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
      }).returning();

      (async () => {
        try {
          await db.update(agentModeRuns)
            .set({ status: "planning", startedAt: new Date() })
            .where(eq(agentModeRuns.id, runId));

          const orchestrator = await agentManager.startRun(
            runId,
            chatId,
            userId || "anonymous",
            message,
            attachments
          );

          orchestrator.on("progress", async (progress) => {
            try {
              const updateData: any = {
                status: progress.status === "executing" ? "running" : progress.status,
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

              await db.update(agentModeRuns)
                .set(updateData)
                .where(eq(agentModeRuns.id, runId));

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
          await db.update(agentModeRuns)
            .set({ 
              status: "failed", 
              error: err.message || "Failed to start agent run",
              completedAt: new Date(),
            })
            .where(eq(agentModeRuns.id, runId));
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
        status: run.status,
        plan: run.plan,
        currentStepIndex: run.currentStepIndex,
        totalSteps: run.totalSteps || planSteps.length,
        completedSteps: run.completedSteps,
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
        artifacts: run.artifacts,
        summary: run.summary,
        error: run.error,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        createdAt: run.createdAt,
      };

      res.json(response);
    } catch (error: any) {
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

      res.json(response);
    } catch (error: any) {
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

      await db.update(agentModeRuns)
        .set({ 
          status: "cancelled", 
          completedAt: new Date(),
        })
        .where(eq(agentModeRuns.id, id));

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

      await db.update(agentModeRuns)
        .set({ status: "paused" })
        .where(eq(agentModeRuns.id, id));

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

      await db.update(agentModeRuns)
        .set({ status: "running" })
        .where(eq(agentModeRuns.id, id));

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

      await db.update(agentModeRuns)
        .set({ 
          status: "running",
          error: null,
          completedAt: null,
          currentStepIndex: retryFromStep,
        })
        .where(eq(agentModeRuns.id, id));

      const plan = run.plan as any;
      if (plan && plan.objective) {
        (async () => {
          try {
            const orchestrator = await agentManager.startRun(
              id,
              run.chatId,
              userId || "anonymous",
              plan.objective,
              []
            );

            orchestrator.on("progress", async (progress) => {
              try {
                const updateData: any = {
                  status: progress.status === "executing" ? "running" : progress.status,
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

                await db.update(agentModeRuns)
                  .set(updateData)
                  .where(eq(agentModeRuns.id, id));
              } catch (err) {
                console.error(`[AgentRoutes] Error updating retry run ${id}:`, err);
              }
            });
          } catch (err: any) {
            console.error(`[AgentRoutes] Error retrying run ${id}:`, err);
            await db.update(agentModeRuns)
              .set({ 
                status: "failed", 
                error: err.message || "Failed to retry agent run",
                completedAt: new Date(),
              })
              .where(eq(agentModeRuns.id, id));
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

  return router;
}
