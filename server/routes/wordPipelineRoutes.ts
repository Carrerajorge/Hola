import { Router, Request, Response } from "express";
import { z } from "zod";
import { createWordPipeline, PipelineEvent, PIPELINE_VERSION, SupportedLocaleSchema } from "../agent/word-pipeline";

const router = Router();

const ExecuteRequestSchema = z.object({
  query: z.string().min(1).max(5000),
  locale: SupportedLocaleSchema.optional(),
  maxIterations: z.number().int().min(1).max(5).optional(),
  enableSemanticCache: z.boolean().optional(),
});

const activePipelines = new Map<string, { abort: () => void }>();

router.post("/execute", async (req: Request, res: Response) => {
  try {
    const body = ExecuteRequestSchema.parse(req.body);
    
    const pipeline = createWordPipeline({
      maxIterations: body.maxIterations || 3,
      enableSemanticCache: body.enableSemanticCache ?? true,
    });

    const result = await pipeline.execute(body.query, {
      locale: body.locale,
    });

    if (result.success && result.artifacts.length > 0) {
      const artifact = result.artifacts[0];
      res.json({
        success: true,
        runId: result.state.runId,
        pipelineVersion: PIPELINE_VERSION,
        artifact: {
          id: artifact.id,
          filename: artifact.filename,
          mimeType: artifact.mimeType,
          sizeBytes: artifact.sizeBytes,
        },
        metrics: {
          totalDurationMs: result.state.totalDurationMs,
          totalTokensUsed: result.state.totalTokensUsed,
          stageCount: result.state.stageResults.length,
          qualityGatesPassed: result.state.qualityGates.filter(g => g.passed).length,
          qualityGatesTotal: result.state.qualityGates.length,
          claimsVerified: result.state.claims.filter(c => c.verified).length,
          claimsTotal: result.state.claims.length,
          gapsDetected: result.state.gaps.length,
          iterations: result.state.currentIteration,
        },
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.state.error || "Pipeline failed to produce artifacts",
        runId: result.state.runId,
      });
    }
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid request", details: error.errors });
    } else {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

router.get("/execute/stream", async (req: Request, res: Response) => {
  const query = req.query.query as string;
  const locale = req.query.locale as string | undefined;
  
  if (!query) {
    res.status(400).json({ error: "Query parameter required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const sendEvent = (event: PipelineEvent) => {
    res.write(`event: ${event.eventType}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const pipeline = createWordPipeline({
    maxIterations: 3,
    enableSemanticCache: true,
  });

  const runIdPromise = new Promise<string>((resolve) => {
    pipeline.once("event", (event: PipelineEvent) => {
      resolve(event.runId);
    });
  });

  const executePromise = pipeline.execute(query, {
    locale: locale as any,
    onEvent: sendEvent,
  });

  const runId = await runIdPromise;
  activePipelines.set(runId, { abort: () => pipeline.abort() });

  req.on("close", () => {
    const pipelineRef = activePipelines.get(runId);
    if (pipelineRef) {
      pipelineRef.abort();
      activePipelines.delete(runId);
    }
  });

  try {
    const result = await executePromise;
    
    if (result.success && result.artifacts.length > 0) {
      const artifact = result.artifacts[0];
      sendEvent({
        runId: result.state.runId,
        eventType: "artifact.created",
        data: {
          id: artifact.id,
          filename: artifact.filename,
          mimeType: artifact.mimeType,
          sizeBytes: artifact.sizeBytes,
          downloadUrl: `/api/word-pipeline/download/${result.state.runId}`,
        },
        timestamp: new Date().toISOString(),
      });
    }
    
    res.write("event: done\n");
    res.write(`data: ${JSON.stringify({ success: result.success, runId: result.state.runId })}\n\n`);
  } catch (error: any) {
    sendEvent({
      runId,
      eventType: "pipeline.failed",
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  } finally {
    activePipelines.delete(runId);
    res.end();
  }
});

router.post("/abort/:runId", (req: Request, res: Response) => {
  const { runId } = req.params;
  const pipeline = activePipelines.get(runId);
  
  if (pipeline) {
    pipeline.abort();
    activePipelines.delete(runId);
    res.json({ success: true, message: "Pipeline aborted" });
  } else {
    res.status(404).json({ success: false, error: "Pipeline not found or already completed" });
  }
});

router.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "healthy",
    pipelineVersion: PIPELINE_VERSION,
    activePipelines: activePipelines.size,
    timestamp: new Date().toISOString(),
  });
});

router.get("/version", (_req: Request, res: Response) => {
  res.json({
    version: PIPELINE_VERSION,
    stages: [
      "DocumentPlanner",
      "EvidenceBuilder",
      "SemanticAnalyzer",
      "DataNormalizer",
      "SectionWriter",
      "ClaimExtractor",
      "FactVerifier",
      "ConsistencyCritic",
      "WordAssembler",
    ],
    features: {
      qualityGates: true,
      circuitBreaker: true,
      semanticCache: true,
      sseStreaming: true,
      gapDetection: true,
      claimVerification: true,
    },
  });
});

export default router;
