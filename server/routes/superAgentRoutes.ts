import { Router, Request, Response } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { createSuperAgent, SSEEvent } from "../agent/superAgent";
import { getArtifact, getArtifactMeta, listArtifacts } from "../agent/superAgent/artifactTools";
import { parsePromptToContract, validateContract } from "../agent/superAgent/contractRouter";
import { shouldResearch } from "../agent/superAgent/researchPolicy";
import { TraceBus } from "../agent/superAgent/tracing/TraceBus";
import { getStreamGateway } from "../agent/superAgent/tracing/StreamGateway";
import { getEventStore } from "../agent/superAgent/tracing/EventStore";
import { createClient } from "redis";
import { promises as fs } from "fs";

const router = Router();

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const ChatRequestSchema = z.object({
  prompt: z.string().min(1).max(10000),
  session_id: z.string().optional(),
  run_id: z.string().optional(),
  options: z.object({
    enforce_min_sources: z.boolean().optional(),
    max_iterations: z.number().int().min(1).max(5).optional(),
  }).optional(),
});

router.post("/super/analyze", async (req: Request, res: Response) => {
  try {
    const { prompt, options } = ChatRequestSchema.parse(req.body);
    
    const contract = parsePromptToContract(prompt, {
      enforceMinSources: options?.enforce_min_sources ?? true,
    });
    
    const validation = validateContract(contract);
    const researchDecision = shouldResearch(prompt);
    
    res.json({
      contract,
      validation,
      research_decision: researchDecision,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/super/stream", async (req: Request, res: Response) => {
  try {
    const { prompt, session_id, run_id, options } = ChatRequestSchema.parse(req.body);
    const sessionId = session_id || randomUUID();
    const runId = run_id || `run_${randomUUID()}`;
    
    console.log(`[SuperAgent] Starting run with runId=${runId}, from_client=${!!run_id}`);
    
    const traceBus = new TraceBus(runId);
    const gateway = getStreamGateway();
    
    // Register the TraceBus with the gateway - this enables:
    // 1. SSE clients to receive live TraceEvents with full metrics
    // 2. Automatic EventStore persistence via gateway's trace listener
    // 3. Proper heartbeat management and cleanup
    gateway.registerRun(runId, traceBus);
    
    console.log(`[SuperAgent] Registered run ${runId} with StreamGateway`);
    
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Session-ID", sessionId);
    res.setHeader("X-Run-ID", runId);
    res.setHeader("Access-Control-Expose-Headers", "X-Run-ID, X-Session-ID");
    res.flushHeaders();
    
    const sendSSE = (event: SSEEvent) => {
      res.write(`id: ${event.event_id}\n`);
      res.write(`event: ${event.event_type}\n`);
      res.write(`data: ${JSON.stringify(event.data)}\n\n`);
    };
    
    let redisClient: ReturnType<typeof createClient> | null = null;
    
    try {
      redisClient = createClient({ url: REDIS_URL });
      await redisClient.connect();
    } catch (redisError) {
      console.warn("[SuperAgent] Redis not available, SSE-only mode");
    }
    
    const agent = createSuperAgent(sessionId, {
      maxIterations: options?.max_iterations ?? 3,
      emitHeartbeat: true,
      heartbeatIntervalMs: 5000,
      enforceContract: options?.enforce_min_sources ?? true,
    });
    
    let redisAvailable = redisClient?.isReady ?? false;
    let articlesCollected = 0;
    let articlesVerified = 0;
    let currentPhase: "planning" | "signals" | "verification" | "export" | "completed" = "planning";
    let runCompleted = false;
    
    traceBus.runStarted("SuperAgent", `Starting research: ${prompt.substring(0, 100)}...`);
    traceBus.phaseStarted("SuperAgent", "planning", "Analyzing research request");
    
    agent.on("sse", async (event: SSEEvent) => {
      sendSSE(event);
      
      switch (event.event_type) {
        case "contract":
          if (currentPhase === "planning") {
            traceBus.phaseCompleted("SuperAgent", "planning", "Contract established");
            traceBus.phaseStarted("SuperAgent", "signals", "Collecting sources from academic databases");
            currentPhase = "signals";
          }
          break;
        case "source":
        case "source_signal":
          // Both source and source_signal events increment article counter
          articlesCollected++;
          console.log(`[SuperAgent] source_signal received: articlesCollected=${articlesCollected}, type=${event.event_type}`);
          const sourceData = event.data || {};
          if (sourceData.doi || sourceData.title) {
            traceBus.sourceCollected(
              "SuperAgent",
              sourceData.doi || `unknown-${articlesCollected}`,
              sourceData.title || "Untitled",
              sourceData.relevance || sourceData.score || 0.8
            );
          }
          traceBus.toolProgress("SuperAgent", `Collected ${articlesCollected} sources`, 
            Math.min(40, (articlesCollected / 50) * 40),
            { 
              articles_collected: articlesCollected,
              candidates_found: articlesCollected 
            }
          );
          break;
        case "verify":
          if (currentPhase === "signals") {
            traceBus.phaseCompleted("SuperAgent", "signals", `Collected ${articlesCollected} sources`);
            traceBus.phaseStarted("SuperAgent", "verification", "Verifying source quality");
            currentPhase = "verification";
          }
          break;
        case "source_verified":
          articlesVerified++;
          if (event.data?.doi) {
            traceBus.sourceVerified("SuperAgent", event.data.doi, event.data.title_similarity || 0.9);
          }
          traceBus.toolProgress("SuperAgent", `Verified ${articlesVerified} sources`,
            40 + Math.min(40, (articlesVerified / 50) * 40),
            { articles_verified: articlesVerified, articles_accepted: articlesVerified }
          );
          break;
        case "artifact":
          if (currentPhase === "verification") {
            traceBus.phaseCompleted("SuperAgent", "verification", `Verified ${articlesVerified} sources`);
            traceBus.phaseStarted("SuperAgent", "export", "Generating Excel file");
            currentPhase = "export";
          }
          traceBus.artifactCreated(
            "SuperAgent", 
            event.data?.type || "xlsx",
            event.data?.name || "output.xlsx", 
            event.data?.url || `/api/super/artifacts/${event.data?.id}/download`
          );
          break;
        case "final":
          if (!runCompleted) {
            if (currentPhase === "export") {
              traceBus.phaseCompleted("SuperAgent", "export", "Excel file generated");
            }
            traceBus.runCompleted("SuperAgent", "Research completed successfully", {
              articles_collected: articlesCollected,
              articles_verified: articlesVerified,
              articles_accepted: articlesVerified,
            });
            currentPhase = "completed";
            runCompleted = true;
          }
          break;
        case "error":
          if (!runCompleted) {
            traceBus.runFailed("SuperAgent", event.data?.message || "Unknown error", {
              error_code: "EXECUTION_ERROR",
              fail_reason: event.data?.message,
            });
            runCompleted = true;
          }
          break;
        case "heartbeat":
          traceBus.heartbeat();
          break;
        case "search_progress":
          // Emit search progress to TraceBus so frontend receives it
          const searchData = event.data || {};
          traceBus.toolProgress(
            searchData.provider || "OpenAlex",
            `Searching: ${searchData.queries_current || 0}/${searchData.queries_total || 4} queries, ${searchData.candidates_found || 0} candidates`,
            Math.min(30, ((searchData.queries_current || 0) / (searchData.queries_total || 4)) * 30),
            {
              queries_current: searchData.queries_current || 0,
              queries_total: searchData.queries_total || 4,
              pages_searched: searchData.pages_searched || 0,
              candidates_found: searchData.candidates_found || 0,
            }
          );
          break;
        case "progress":
          // Emit generic progress events to TraceBus
          const progressData = event.data || {};
          if (progressData.phase === "signals" && progressData.count) {
            articlesCollected = progressData.count;
            traceBus.toolProgress(
              "SuperAgent",
              `Found ${articlesCollected} candidates`,
              Math.min(40, (articlesCollected / 50) * 40),
              { articles_collected: articlesCollected, candidates_found: articlesCollected }
            );
          }
          break;
      }
      
      if (redisAvailable && redisClient) {
        try {
          const streamKey = `super:stream:${sessionId}`;
          await redisClient.xAdd(streamKey, "*", {
            event_id: event.event_id,
            event_type: event.event_type,
            data: JSON.stringify(event.data),
            timestamp: event.timestamp.toString(),
          });
          
          await redisClient.expire(streamKey, 3600);
        } catch (e) {
          redisAvailable = false;
        }
      }
    });
    
    req.on("close", () => {
      console.log(`[SuperAgent] Client disconnected: ${sessionId}`);
      gateway.unregisterRun(runId);
      if (redisClient?.isReady) {
        redisClient.quit().catch(() => {});
      }
    });
    
    try {
      await agent.execute(prompt);
    } catch (error: any) {
      sendSSE({
        event_id: `${sessionId}_error`,
        event_type: "error",
        timestamp: Date.now(),
        data: { message: error.message, recoverable: false },
        session_id: sessionId,
      });
      traceBus.runFailed("SuperAgent", error.message, {
        error_code: "EXECUTION_ERROR",
        fail_reason: error.message,
      });
    }
    
    // Cleanup: unregister run from gateway (handles traceBus.destroy() internally)
    gateway.unregisterRun(runId);
    
    if (redisClient?.isReady) {
      await redisClient.quit();
    }
    
    res.end();
    
  } catch (error: any) {
    if (!res.headersSent) {
      res.status(400).json({ error: error.message });
    }
  }
});

router.get("/super/stream/:sessionId/replay", async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const lastEventId = req.headers["last-event-id"] as string | undefined;
    
    let redisClient: ReturnType<typeof createClient> | null = null;
    
    try {
      redisClient = createClient({ url: REDIS_URL });
      await redisClient.connect();
    } catch {
      return res.status(503).json({ error: "Redis not available for replay" });
    }
    
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    
    const streamKey = `super:stream:${sessionId}`;
    const startId = lastEventId || "0";
    
    const events = await redisClient.xRange(streamKey, startId, "+");
    
    for (const entry of events) {
      const data = entry.message;
      res.write(`id: ${data.event_id}\n`);
      res.write(`event: ${data.event_type}\n`);
      res.write(`data: ${data.data}\n\n`);
    }
    
    res.write(`event: replay_complete\n`);
    res.write(`data: ${JSON.stringify({ events_replayed: events.length })}\n\n`);
    
    await redisClient.quit();
    res.end();
    
  } catch (error: any) {
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

router.get("/super/artifacts", async (req: Request, res: Response) => {
  try {
    const artifacts = listArtifacts();
    res.json({ artifacts });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/super/artifacts/:id", async (req: Request, res: Response) => {
  try {
    const meta = getArtifactMeta(req.params.id);
    if (!meta) {
      return res.status(404).json({ error: "Artifact not found" });
    }
    res.json(meta);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/super/artifacts/:id/download", async (req: Request, res: Response) => {
  try {
    const artifact = await getArtifact(req.params.id);
    if (!artifact) {
      return res.status(404).json({ error: "Artifact not found" });
    }
    
    const mimeTypes: Record<string, string> = {
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    };
    
    res.setHeader("Content-Type", mimeTypes[artifact.type] || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${artifact.name}"`);
    
    const fileBuffer = await fs.readFile(artifact.path);
    res.send(fileBuffer);
    
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

const runStatusCache = new Map<string, {
  status: string;
  phase: string;
  progress: number;
  metrics: { articles_collected: number; articles_verified: number; articles_accepted: number };
  artifacts: Array<{ id: string; type: string; name: string; url: string }>;
  error?: string;
  lastUpdate: number;
}>();

router.get("/runs/:runId/events", async (req: Request, res: Response) => {
  const { runId } = req.params;
  const fromSeq = parseInt(req.query.from as string) || 0;
  
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Access-Control-Allow-Origin", "*");
  
  res.flushHeaders();
  
  const gateway = getStreamGateway();
  let seq = fromSeq;
  let heartbeatInterval: NodeJS.Timeout | null = null;
  
  const writeSSE = (eventType: string, data: any) => {
    seq++;
    const payload = JSON.stringify({ ...data, seq, run_id: runId, ts: Date.now() });
    res.write(`id: ${seq}\n`);
    res.write(`event: ${eventType}\n`);
    res.write(`data: ${payload}\n\n`);
    if (typeof (res as any).flush === "function") {
      (res as any).flush();
    }
  };
  
  writeSSE("connected", { connected: true, event_type: "connected" });
  
  writeSSE("run_started", { 
    event_type: "run_started",
    phase: "planning", 
    message: "Research agent initialized",
    agent: "SuperAgent",
    status: "running"
  });
  
  const unsubscribe = gateway.subscribe(runId, (event) => {
    writeSSE(event.event_type, event);
    
    const cached = runStatusCache.get(runId) || {
      status: "running",
      phase: "planning",
      progress: 0,
      metrics: { articles_collected: 0, articles_verified: 0, articles_accepted: 0 },
      artifacts: [],
      lastUpdate: Date.now(),
    };
    
    if (event.phase) cached.phase = event.phase;
    if (event.status) cached.status = event.status;
    if (event.progress !== undefined) cached.progress = event.progress;
    if (event.metrics) Object.assign(cached.metrics, event.metrics);
    if (event.event_type === "run_completed") cached.status = "completed";
    if (event.event_type === "run_failed") {
      cached.status = "failed";
      cached.error = event.message;
    }
    cached.lastUpdate = Date.now();
    runStatusCache.set(runId, cached);
  });
  
  heartbeatInterval = setInterval(() => {
    writeSSE("heartbeat", { event_type: "heartbeat", agent: "System" });
  }, 800);
  
  req.on("close", () => {
    unsubscribe();
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }
  });
});

router.get("/runs/:runId/status", async (req: Request, res: Response) => {
  const { runId } = req.params;
  
  const cached = runStatusCache.get(runId);
  if (cached) {
    return res.json(cached);
  }
  
  res.json({
    status: "pending",
    phase: "idle",
    progress: 0,
    metrics: { articles_collected: 0, articles_verified: 0, articles_accepted: 0 },
    artifacts: [],
    error: null,
  });
});

router.get("/super/health", async (req: Request, res: Response) => {
  let redisOk = false;
  
  try {
    const client = createClient({ url: REDIS_URL });
    await client.connect();
    await client.ping();
    await client.quit();
    redisOk = true;
  } catch {
    redisOk = false;
  }
  
  res.json({
    status: redisOk ? "healthy" : "degraded",
    redis: redisOk,
    features: {
      signals_100: true,
      deep_dive: true,
      create_xlsx: true,
      create_docx: true,
      quality_gate: true,
      sse_streaming: true,
      redis_persistence: redisOk,
      replay: redisOk,
    },
  });
});

export default router;
