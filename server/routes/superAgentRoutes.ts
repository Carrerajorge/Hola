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

type IntentCategory = "academic_search" | "document_creation" | "data_analysis" | "general_chat";

interface ClassifiedIntent {
  category: IntentCategory;
  topic: string;
  targetCount: number;
  yearRange: { start: number; end: number };
  outputFormat: "xlsx" | "docx" | "pptx" | null;
  confidence: number;
}

function classifyPromptIntent(prompt: string): ClassifiedIntent {
  const lowerPrompt = prompt.toLowerCase();
  
  const academicPatterns = [
    /\b(artículos?|articulos?)\s*(científicos?|cientificos?|académicos?|academicos?)\b/i,
    /\b(papers?|publications?|research\s+articles?)\b/i,
    /\b(scopus|web\s*of\s*science|wos|pubmed|scholar|crossref|openalex)\b/i,
    /\b(revisión\s+sistemática|systematic\s+review)\b/i,
    /\b(literatura\s+científica|scientific\s+literature)\b/i,
    /\b(busca|encuentra|dame|genera?|consigue)\s+\d+\s*(artículos?|articulos?|fuentes?|papers?)/i,
  ];
  
  const documentPatterns = [
    /\b(crea|genera|escribe|redacta)\s+(un|una|el|la)?\s*(documento|word|docx|informe|reporte)\b/i,
    /\b(crear?|generar?)\s+(documento|word|docx)\b/i,
  ];
  
  const spreadsheetPatterns = [
    /\b(excel|xlsx|spreadsheet|hoja\s+de\s+cálculo)\b/i,
    /\b(tabla|cuadro)\s+con\s+datos\b/i,
  ];
  
  const isAcademic = academicPatterns.some(p => p.test(prompt));
  const isDocument = documentPatterns.some(p => p.test(prompt));
  const isSpreadsheet = spreadsheetPatterns.some(p => p.test(prompt));
  
  let topic = extractSearchTopic(prompt);
  const yearRange = extractYearRange(prompt);
  const targetCount = extractTargetCount(prompt);
  
  let category: IntentCategory = "general_chat";
  let outputFormat: "xlsx" | "docx" | "pptx" | null = null;
  let confidence = 0.5;
  
  if (isAcademic) {
    category = "academic_search";
    outputFormat = isSpreadsheet ? "xlsx" : "xlsx";
    confidence = 0.9;
  } else if (isDocument) {
    category = "document_creation";
    outputFormat = "docx";
    confidence = 0.85;
  } else if (isSpreadsheet) {
    category = "data_analysis";
    outputFormat = "xlsx";
    confidence = 0.85;
  }
  
  return {
    category,
    topic: topic || prompt.substring(0, 200),
    targetCount,
    yearRange,
    outputFormat,
    confidence,
  };
}

function extractSearchTopic(prompt: string): string {
  const aboutMatch = prompt.match(/(?:sobre|about|acerca\s+de)\s+(.+?)(?:\s+(?:del|from|en\s+excel|y\s+coloca|ordenado|con\s+\d+|\d{4}\s+al\s+\d{4}|$))/i);
  if (aboutMatch && aboutMatch[1]) {
    let topic = aboutMatch[1]
      .replace(/\s*\d+\s*(artículos?|articulos?|fuentes?|sources?|papers?).*$/i, "")
      .replace(/\s*(científicos?|cientificos?|académicos?)$/i, "")
      .trim();
    if (topic.length >= 5) {
      return topic.substring(0, 150);
    }
  }
  
  const cleanedPrompt = prompt
    .replace(/\b(dame|busca|genera|encuentra|crea|quiero|necesito)\b/gi, "")
    .replace(/\b\d+\s*(artículos?|articulos?|fuentes?|papers?|sources?)\b/gi, "")
    .replace(/\b(científicos?|cientificos?|académicos?|academicos?)\b/gi, "")
    .replace(/\b(en\s+excel|xlsx|del\s+\d{4}\s+al\s+\d{4})\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  
  return cleanedPrompt.substring(0, 150) || prompt.substring(0, 100);
}

function extractYearRange(prompt: string): { start: number; end: number } {
  const match = prompt.match(/(?:del|from)\s+(\d{4})\s+(?:al|to|hasta)\s+(\d{4})/i);
  if (match) {
    return { start: parseInt(match[1], 10), end: parseInt(match[2], 10) };
  }
  const singleYear = prompt.match(/\b(20\d{2})\b/);
  if (singleYear) {
    const year = parseInt(singleYear[1], 10);
    return { start: year - 3, end: year };
  }
  return { start: 2020, end: 2025 };
}

function extractTargetCount(prompt: string): number {
  const match = prompt.match(/\b(\d+)\s*(artículos?|articulos?|fuentes?|papers?|sources?)\b/i);
  if (match) {
    const count = parseInt(match[1], 10);
    return Math.min(Math.max(count, 10), 100);
  }
  return 50;
}

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

const activeAbortControllers = new Map<string, AbortController>();

router.post("/super/stream", async (req: Request, res: Response) => {
  try {
    const { prompt, session_id, run_id, options } = ChatRequestSchema.parse(req.body);
    const sessionId = session_id || randomUUID();
    const runId = run_id || `run_${randomUUID()}`;
    
    const classifiedIntent = classifyPromptIntent(prompt);
    console.log(`[SuperAgent] Intent classified: ${classifiedIntent.category}, topic: "${classifiedIntent.topic.substring(0, 50)}..."`);
    console.log(`[SuperAgent] Starting run with runId=${runId}, category=${classifiedIntent.category}`);
    
    const abortController = new AbortController();
    activeAbortControllers.set(runId, abortController);
    
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
          const searchData = event.data || {};
          articlesCollected = searchData.candidates_found || articlesCollected;
          traceBus.searchProgress("SuperAgent", {
            provider: (searchData.provider?.toLowerCase() || "openalex") as "openalex" | "crossref" | "semantic_scholar",
            query_idx: searchData.queries_current || 1,
            query_total: searchData.queries_total || 3,
            page: searchData.pages_searched || 1,
            found: searchData.candidates_found || 0,
            candidates_total: articlesCollected,
          });
          break;
        case "progress":
          const progressData = event.data || {};
          if (progressData.phase === "signals" && progressData.count) {
            articlesCollected = progressData.count;
            traceBus.progressUpdate("SuperAgent", Math.min(40, (articlesCollected / 50) * 40), {
              articles_collected: articlesCollected,
            });
          }
          break;
        case "verify_progress":
          const verifyData = event.data || {};
          articlesVerified = verifyData.ok || 0;
          traceBus.verifyProgress("SuperAgent", {
            checked: verifyData.checked || 0,
            ok: verifyData.ok || 0,
            dead: verifyData.dead || 0,
          });
          break;
        case "accepted_progress":
          const acceptedData = event.data || {};
          traceBus.acceptedProgress("SuperAgent", {
            accepted: acceptedData.accepted || 0,
            target: acceptedData.target || 50,
          });
          break;
        case "filter_progress":
          traceBus.progressUpdate("SuperAgent", 65, {
            articles_verified: articlesVerified,
          });
          break;
        case "export_progress":
          const exportData = event.data || {};
          traceBus.exportProgress("SuperAgent", {
            columns_count: exportData.columns_count || 15,
            rows_written: exportData.rows_written || articlesVerified,
            target: exportData.target || 50,
          });
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
      const signal = activeAbortControllers.get(runId)?.signal;
      await agent.execute(prompt, signal);
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
    activeAbortControllers.delete(runId);
    
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

router.post("/super/stream/:runId/cancel", async (req: Request, res: Response) => {
  const { runId } = req.params;
  const abortController = activeAbortControllers.get(runId);
  
  if (!abortController) {
    return res.status(404).json({ error: "Run not found or already completed" });
  }
  
  try {
    abortController.abort();
    activeAbortControllers.delete(runId);
    
    const gateway = getStreamGateway();
    gateway.unregisterRun(runId);
    
    console.log(`[SuperAgent] Run ${runId} cancelled by user`);
    
    res.json({ 
      success: true, 
      run_id: runId, 
      status: "cancelled",
      message: "Run cancelled successfully" 
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
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
