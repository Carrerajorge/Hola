import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import { TraceEmitter, createTraceEmitter } from "./TraceEmitter";
import { getStreamGateway } from "./StreamGateway";
import { getEventStore, initializeEventStore } from "./EventStore";
import { ProgressModel, createProgressModel } from "./ProgressModel";
import { ContractGuard, createContractGuard } from "./ContractGuard";
import { runAcademicPipeline, candidatesToSourceSignals } from "../academicPipeline";
import { AcademicCandidate } from "../openAlexClient";
import { EventEmitter } from "events";
import type { Plan, Step, Artifact } from "../../../../shared/executionProtocol";

interface RunRequest {
  prompt: string;
  targetCount?: number;
  yearStart?: number;
  yearEnd?: number;
}

interface RunContext {
  runId: string;
  emitter: TraceEmitter;
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
      const emitter = createTraceEmitter(runId);
      const progressModel = createProgressModel(emitter, targetCount);
      const contractGuard = createContractGuard(emitter);

      const context: RunContext = {
        runId,
        emitter,
        progressModel,
        contractGuard,
        status: "pending",
        createdAt: Date.now(),
        artifacts: [],
      };

      activeRuns.set(runId, context);

      const gateway = getStreamGateway();
      gateway.registerRun(runId, emitter);

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
    const fromQuery = req.query.from ? parseInt(req.query.from as string, 10) : 0;
    const lastEventIdHeader = req.headers["last-event-id"] 
      ? parseInt(req.headers["last-event-id"] as string, 10) 
      : 0;
    const lastEventId = Math.max(fromQuery, lastEventIdHeader);

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
    context.emitter.emitRunFailed("Run cancelled by user", "CANCELLED", false);

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
  const { emitter, progressModel, contractGuard } = context;
  const artifactId = `artifact_${context.runId}_xlsx`;

  const steps: Step[] = [
    { id: 's1', title: 'Planificar consultas', kind: 'plan', status: 'pending' },
    { id: 's2', title: 'Buscar en fuentes académicas', kind: 'research', status: 'pending' },
    { id: 's3', title: 'Verificar DOI/URL', kind: 'validate', status: 'pending' },
    { id: 's4', title: 'Exportar Excel (.xlsx)', kind: 'generate', status: 'pending' },
  ];

  const updateStepStatus = (stepId: string, status: Step['status'], progress?: number) => {
    const step = steps.find(s => s.id === stepId);
    if (step) {
      step.status = status;
      if (progress !== undefined) step.progress = progress;
      if (status === 'running') {
        step.started_at = Date.now();
        emitter.emitStepStarted(step);
      } else if (status === 'completed') {
        step.completed_at = Date.now();
        step.progress = 100;
        emitter.emitStepCompleted(step);
      }
    }
  };

  try {
    context.status = "running";
    
    const searchTopic = extractSearchTopic(prompt);
    
    emitter.emitRunStarted(
      "academic_search",
      `Starting academic search: ${prompt.substring(0, 100)}...`,
      60000,
      { targetCount: options.targetCount, yearStart: options.yearStart, yearEnd: options.yearEnd }
    );

    const plan: Plan = {
      plan_id: `plan_${context.runId}`,
      title: `Búsqueda académica: ${searchTopic}`,
      description: `Objetivo: ${options.targetCount} artículos (${options.yearStart}-${options.yearEnd})`,
      steps: steps.map(s => ({ ...s })),
      total_steps: 4,
      estimated_duration_ms: 60000,
    };
    plan.steps[0].status = 'running';
    emitter.emitPlanCreated(plan);

    const artifact: Artifact = {
      artifact_id: artifactId,
      kind: 'excel',
      filename: 'articles.xlsx',
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      status: 'declared',
    };
    emitter.emitArtifactDeclared(artifact, 's4');

    progressModel.setPhase("planning");
    updateStepStatus('s1', 'running');
    
    emitter.emitStepProgress('s1', 50, `Analyzing query: ${searchTopic}`);
    
    updateStepStatus('s1', 'completed');
    
    progressModel.setPhase("signals");
    updateStepStatus('s2', 'running');

    const pipelineEmitter = new EventEmitter();
    let searchProgress = 0;

    pipelineEmitter.on("pipeline_phase", (data: any) => {
      if (data.phase === "search") {
        searchProgress = Math.min(searchProgress + 10, 80);
        emitter.emitStepProgress('s2', searchProgress, `Searching: ${data.query || "..."}`, data.collected || 0, options.targetCount);
      } else if (data.phase === "verification") {
        updateStepStatus('s2', 'completed');
        progressModel.setPhase("verification");
        updateStepStatus('s3', 'running');
        emitter.emitStepProgress('s3', 20, "Verifying DOIs via CrossRef");
      } else if (data.phase === "enrichment") {
        emitter.emitStepProgress('s3', 60, "Enriching metadata");
        progressModel.setPhase("enrichment");
      } else if (data.phase === "export") {
        updateStepStatus('s3', 'completed');
        progressModel.setPhase("export");
        updateStepStatus('s4', 'running');
        emitter.emitArtifactProgress(artifactId, 10, { message: "Starting Excel generation" });
      }

      if (data.collected) {
        progressModel.addCollected(data.collected);
      }
      if (data.verified) {
        progressModel.addVerified(data.verified);
        emitter.emitStepProgress('s3', 40 + Math.min(data.verified * 2, 40), `Verified ${data.verified} DOIs`);
      }
    });

    pipelineEmitter.on("search_progress", (data: any) => {
      const { provider, query_idx, query_total, found, candidates_total } = data;
      progressModel.addCollected(found);
      emitter.searchProgress("SearchAgent", {
        provider: provider as "openalex" | "crossref" | "semantic_scholar",
        query_idx: query_idx || 1,
        query_total: query_total || 3,
        page: data.page || 1,
        found: found || 0,
        candidates_total: candidates_total || 0,
      });
      searchProgress = Math.min(searchProgress + 5, 80);
      emitter.emitStepProgress('s2', searchProgress, `${provider}: ${found} encontrados`, candidates_total, options.targetCount);
    });

    pipelineEmitter.on("verify_progress", (data: any) => {
      const { checked, ok, dead } = data;
      progressModel.addVerified(ok);
      emitter.verifyProgress("VerificationAgent", { checked: checked || 0, ok: ok || 0, dead: dead || 0 });
      emitter.emitStepProgress('s3', 20 + Math.min((ok / options.targetCount) * 60, 60), `Verificados: ${ok}/${checked}`);
    });

    pipelineEmitter.on("accepted_progress", (data: any) => {
      progressModel.addAccepted(data.accepted || 1);
      emitter.acceptedProgress("AcceptanceAgent", {
        accepted: data.accepted || 0,
        target: data.target || options.targetCount,
      });
    });

    pipelineEmitter.on("filter_progress", (data: any) => {
      emitter.filterProgress("FilterAgent", {
        regions: data.regions || [],
        geo_mismatch: data.geo_mismatch || 0,
        year_out_of_range: data.year_out_of_range || 0,
        duplicate: data.duplicate || 0,
        low_relevance: data.low_relevance || 0,
      });
    });

    pipelineEmitter.on("export_progress", (data: any) => {
      emitter.exportProgress("ExportAgent", {
        columns_count: data.columns_count || 0,
        rows_written: data.rows_written || 0,
        target: data.target || options.targetCount,
      });
    });

    const result = await runAcademicPipeline(searchTopic, pipelineEmitter, {
      targetCount: options.targetCount,
      yearStart: options.yearStart,
      yearEnd: options.yearEnd,
      maxSearchIterations: 4,
    });

    if (steps.find(s => s.id === 's2')?.status !== 'completed') {
      updateStepStatus('s2', 'completed');
    }

    for (const article of result.articles) {
      progressModel.addAccepted(1);
      if (article.doi) {
        emitter.sourceVerified("VerificationAgent", article.doi, 1.0);
      }
    }

    const validation = contractGuard.validateBatch(result.articles);

    if (!validation.valid) {
      for (const violation of validation.violations.filter(v => v.severity === "error")) {
        emitter.contractViolation("ContractGuard", violation.reason, {
          missing_fields: [violation.field],
        });
      }
    }

    if (result.artifact) {
      emitter.emitArtifactProgress(artifactId, 50, { 
        rowsWritten: result.articles.length / 2, 
        message: "Writing article data" 
      });
      
      emitter.emitArtifactProgress(artifactId, 90, { 
        rowsWritten: result.articles.length, 
        message: "Finalizing Excel file" 
      });

      progressModel.setExportStage(100);
      
      const readyArtifact: Artifact = {
        artifact_id: artifactId,
        kind: 'excel',
        filename: result.artifact.name,
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        status: 'ready',
        rows_count: result.articles.length,
        download_url: result.artifact.downloadUrl,
        progress: 100,
        created_at: Date.now(),
      };
      emitter.emitArtifactReady(readyArtifact);
      
      context.artifacts.push({
        id: result.artifact.id,
        type: "xlsx",
        name: result.artifact.name,
        url: result.artifact.downloadUrl,
      });
    }

    updateStepStatus('s4', 'completed');

    progressModel.setPhase("finalization");

    context.status = "completed";
    context.completedAt = Date.now();

    emitter.emitRunCompleted(4, 4, `Completed with ${result.articles.length} articles`);

  } catch (error: any) {
    console.error("[RunController] Execution error:", error);
    context.status = "failed";
    context.error = error.message;
    context.completedAt = Date.now();

    emitter.emitRunFailed(error.message, "EXECUTION_ERROR", false);
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
