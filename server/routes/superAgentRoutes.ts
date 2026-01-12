import { Router, Request, Response } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { createSuperAgent, SSEEvent } from "../agent/superAgent";
import { getArtifact, getArtifactMeta, listArtifacts } from "../agent/superAgent/artifactTools";
import { parsePromptToContract, validateContract } from "../agent/superAgent/contractRouter";
import { shouldResearch } from "../agent/superAgent/researchPolicy";
import { createClient } from "redis";
import { promises as fs } from "fs";

const router = Router();

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const ChatRequestSchema = z.object({
  prompt: z.string().min(1).max(10000),
  session_id: z.string().optional(),
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
    const { prompt, session_id, options } = ChatRequestSchema.parse(req.body);
    const sessionId = session_id || randomUUID();
    
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Session-ID", sessionId);
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
    
    agent.on("sse", async (event: SSEEvent) => {
      sendSSE(event);
      
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
    }
    
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
