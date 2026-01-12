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
    
    const traceBus = new TraceBus(runId);
    const gateway = getStreamGateway();
    
    const eventStore = getEventStore();
    
    traceBus.on("trace", async (event) => {
      gateway.publish(runId, event);
      try {
        await eventStore.append(event);
      } catch (e) {
        console.warn("[SuperAgent] Failed to persist trace event:", e);
      }
    });
    
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
          articlesCollected++;
          if (event.data?.doi) {
            traceBus.sourceCollected(
              "SuperAgent",
              event.data.doi,
              event.data.title || "Untitled",
              event.data.relevance || 0.8
            );
          }
          traceBus.toolProgress("SuperAgent", `Collected ${articlesCollected} sources`, 
            Math.min(40, (articlesCollected / 50) * 40),
            { articles_collected: articlesCollected }
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
      traceBus.destroy();
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
    
    traceBus.destroy();
    
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

router.get("/runs/:runId/events", async (req: Request, res: Response) => {
  const { runId } = req.params;
  const fromSeq = parseInt(req.query.from as string) || 0;
  
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();
  
  const gateway = getStreamGateway();
  let seq = fromSeq;
  let heartbeatInterval: NodeJS.Timeout | null = null;
  
  const unsubscribe = gateway.subscribe(runId, (event) => {
    seq++;
    const sseEvent = {
      ...event,
      seq,
    };
    res.write(`id: ${seq}\n`);
    res.write(`event: ${event.event_type}\n`);
    res.write(`data: ${JSON.stringify(sseEvent)}\n\n`);
  });
  
  seq++;
  res.write(`id: ${seq}\n`);
  res.write(`event: connected\n`);
  res.write(`data: ${JSON.stringify({ run_id: runId, seq, connected: true })}\n\n`);
  
  heartbeatInterval = setInterval(() => {
    seq++;
    res.write(`id: ${seq}\n`);
    res.write(`event: heartbeat\n`);
    res.write(`data: ${JSON.stringify({ run_id: runId, seq, ts: Date.now() })}\n\n`);
  }, 15000);
  
  req.on("close", () => {
    unsubscribe();
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }
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
