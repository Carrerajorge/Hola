import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import { TraceBus, createTraceBus } from "./TraceBus";
import { getStreamGateway } from "./StreamGateway";
import { getEventStore, initializeEventStore } from "./EventStore";
import { ProgressModel, createProgressModel } from "./ProgressModel";
import { ContractGuard, createContractGuard } from "./ContractGuard";
import { runAcademicPipeline, candidatesToSourceSignals } from "../academicPipeline";
import { AcademicCandidate } from "../openAlexClient";
import { EventEmitter } from "events";

interface RunRequest {
  prompt: string;
  targetCount?: number;
  yearStart?: number;
  yearEnd?: number;
}

interface RunContext {
  runId: string;
  traceBus: TraceBus;
  progressModel: ProgressModel;
  contractGuard: ContractGuard;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  createdAt: number;
  completedAt?: number;
  error?: string;
  artifacts: Array<{ id: string; type: string; name: string; url: string }>;
}

const activeRuns: Map<string, RunContext> = new Map();

export function createRunController(): Router {
  const router = Router();

  router.post("/runs", async (req: Request, res: Response) => {
    try {
      const { prompt, targetCount = 50, yearStart = 2020, yearEnd = 2025 }: RunRequest = req.body;

      if (!prompt) {
        return res.status(400).json({ error: "prompt is required" });
      }

      await initializeEventStore();

      const runId = randomUUID();
      const traceBus = createTraceBus(runId);
      const progressModel = createProgressModel(traceBus, targetCount);
      const contractGuard = createContractGuard(traceBus);

      const context: RunContext = {
        runId,
        traceBus,
        progressModel,
        contractGuard,
        status: "pending",
        createdAt: Date.now(),
        artifacts: [],
      };

      activeRuns.set(runId, context);

      const gateway = getStreamGateway();
      gateway.registerRun(runId, traceBus);

      executeRun(context, prompt, { targetCount, yearStart, yearEnd }).catch(console.error);

      res.status(201).json({
        run_id: runId,
        status: "pending",
        stream_url: `/api/runs/${runId}/events`,
        created_at: context.createdAt,
      });
    } catch (error: any) {
      console.error("[RunController] Error creating run:", error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/runs/:runId", async (req: Request, res: Response) => {
    const { runId } = req.params;
    const context = activeRuns.get(runId);

    if (!context) {
      const summary = await getEventStore().getRunSummary(runId);
      if (summary) {
        return res.json({
          run_id: runId,
          status: summary.status,
          total_events: summary.totalEvents,
          phases: summary.phases,
          duration_ms: summary.duration_ms,
        });
      }
      return res.status(404).json({ error: "Run not found" });
    }

    res.json({
      run_id: context.runId,
      status: context.status,
      progress: context.progressModel.getProgress(),
      metrics: context.progressModel.getMetrics(),
      artifacts: context.artifacts,
      created_at: context.createdAt,
      completed_at: context.completedAt,
      error: context.error,
    });
  });

  router.get("/runs/:runId/events", async (req: Request, res: Response) => {
    const { runId } = req.params;
    const lastEventId = req.headers["last-event-id"] 
      ? parseInt(req.headers["last-event-id"] as string, 10) 
      : (req.query.from ? parseInt(req.query.from as string, 10) : 0);

    const context = activeRuns.get(runId);
    
    if (!context) {
      const events = await getEventStore().getEvents(runId, lastEventId);
      if (events.length === 0) {
        return res.status(404).json({ error: "Run not found" });
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      for (const event of events) {
        res.write(`id: ${event.seq}\n`);
        res.write(`event: ${event.event_type}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }

      res.write(`event: stream_end\n`);
      res.write(`data: {"message": "Historical replay complete"}\n\n`);
      res.end();
      return;
    }

    const gateway = getStreamGateway();
    await gateway.connect(res, runId, lastEventId);
  });

  router.post("/runs/:runId/cancel", async (req: Request, res: Response) => {
    const { runId } = req.params;
    const context = activeRuns.get(runId);

    if (!context) {
      return res.status(404).json({ error: "Run not found" });
    }

    if (context.status === "completed" || context.status === "failed") {
      return res.status(400).json({ error: "Run already finished" });
    }

    context.status = "cancelled";
    context.traceBus.runFailed("RunController", "Run cancelled by user", {
      error_code: "CANCELLED",
    });

    res.json({ run_id: runId, status: "cancelled" });
  });

  router.get("/runs", async (req: Request, res: Response) => {
    const runs = Array.from(activeRuns.values()).map(ctx => ({
      run_id: ctx.runId,
      status: ctx.status,
      progress: ctx.progressModel.getProgress(),
      created_at: ctx.createdAt,
      completed_at: ctx.completedAt,
    }));

    res.json({ runs, total: runs.length });
  });

  return router;
}

async function executeRun(
  context: RunContext,
  prompt: string,
  options: { targetCount: number; yearStart: number; yearEnd: number }
): Promise<void> {
  const { traceBus, progressModel, contractGuard } = context;

  try {
    context.status = "running";
    traceBus.runStarted("Orchestrator", `Starting academic search: ${prompt.substring(0, 100)}...`);

    progressModel.setPhase("planning");
    traceBus.phaseStarted("Planner", "planning", "Analyzing search query");

    const searchTopic = extractSearchTopic(prompt);
    
    traceBus.phaseCompleted("Planner", "planning", `Search topic: ${searchTopic}`);

    progressModel.setPhase("signals");
    traceBus.phaseStarted("SearchAgent", "signals", "Searching academic databases");

    const pipelineEmitter = new EventEmitter();

    pipelineEmitter.on("pipeline_phase", (data: any) => {
      if (data.phase === "search") {
        traceBus.toolProgress("SearchAgent", `Searching: ${data.query || "..."}`, 20, {
          articles_collected: data.collected || 0,
        });
      } else if (data.phase === "verification") {
        progressModel.setPhase("verification");
        traceBus.phaseStarted("VerificationAgent", "verification", "Verifying DOIs via CrossRef");
      } else if (data.phase === "enrichment") {
        progressModel.setPhase("enrichment");
        traceBus.phaseStarted("EnrichmentAgent", "enrichment", "Enriching metadata");
      } else if (data.phase === "export") {
        progressModel.setPhase("export");
        traceBus.phaseStarted("ExportAgent", "export", "Generating Excel file");
      }

      if (data.collected) {
        progressModel.addCollected(data.collected);
      }
      if (data.verified) {
        progressModel.addVerified(data.verified);
      }
    });

    const result = await runAcademicPipeline(searchTopic, pipelineEmitter, {
      targetCount: options.targetCount,
      yearStart: options.yearStart,
      yearEnd: options.yearEnd,
      maxSearchIterations: 4,
    });

    traceBus.phaseCompleted("SearchAgent", "signals", `Found ${result.articles.length} articles`);

    for (const article of result.articles) {
      progressModel.addAccepted(1);
      if (article.doi) {
        traceBus.sourceVerified("VerificationAgent", article.doi, 1.0);
      }
    }

    const validation = contractGuard.validateBatch(result.articles);

    if (!validation.valid) {
      for (const violation of validation.violations.filter(v => v.severity === "error")) {
        traceBus.contractViolation("ContractGuard", violation.reason, {
          missing_fields: [violation.field],
        });
      }
    }

    if (result.artifact) {
      progressModel.setExportStage(100);
      traceBus.artifactCreated("ExportAgent", "xlsx", result.artifact.name, result.artifact.downloadUrl);
      context.artifacts.push({
        id: result.artifact.id,
        type: "xlsx",
        name: result.artifact.name,
        url: result.artifact.downloadUrl,
      });
    }

    progressModel.setPhase("finalization");
    traceBus.phaseStarted("Finalizer", "finalization", "Completing run");

    context.status = "completed";
    context.completedAt = Date.now();

    traceBus.runCompleted("Orchestrator", `Completed with ${result.articles.length} articles`, {
      articles_collected: result.stats.totalFetched,
      articles_verified: result.stats.verifiedCount,
      articles_accepted: result.stats.finalCount,
      latency_ms: result.stats.durationMs,
    });

    traceBus.phaseCompleted("Finalizer", "finalization", "Run complete");

  } catch (error: any) {
    console.error("[RunController] Execution error:", error);
    context.status = "failed";
    context.error = error.message;
    context.completedAt = Date.now();

    traceBus.runFailed("Orchestrator", error.message, {
      error_code: "EXECUTION_ERROR",
      stacktrace_redacted: error.stack?.split("\n").slice(0, 5).join("\n"),
    });
  } finally {
    setTimeout(() => {
      const gateway = getStreamGateway();
      gateway.unregisterRun(context.runId);
      activeRuns.delete(context.runId);
    }, 60000);
  }
}

function extractSearchTopic(prompt: string): string {
  const aboutMatch = prompt.match(/(?:sobre|about|acerca\s+de)\s+(.+?)(?:\s+(?:del|from|en\s+excel|y\s+coloca|ordenado|con\s+\d+|\d{4}\s+al\s+\d{4}|$))/i);
  if (aboutMatch) {
    return aboutMatch[1].trim();
  }

  const cleanedPrompt = prompt
    .replace(/buscarme?\s+\d+\s+art[íi]culos?\s+cient[íi]ficos?\s+/i, "")
    .replace(/(?:del|from)\s+\d{4}\s+(?:al|to)\s+\d{4}/gi, "")
    .replace(/y\s+coloca.*/i, "")
    .replace(/ordenado.*/i, "")
    .trim();

  return cleanedPrompt || prompt.substring(0, 100);
}

export { activeRuns };
