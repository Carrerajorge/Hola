import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { ObjectStorageService } from "./objectStorage";
import { processDocument } from "./services/documentProcessing";
import { chunkText, generateEmbeddingsBatch } from "./embeddingService";
import { StepUpdate } from "./agent";
import { browserSessionManager, SessionEvent } from "./agent/browser";
import { fileProcessingQueue, FileStatusUpdate } from "./lib/fileProcessingQueue";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import { pptExportRouter } from "./routes/pptExport";
import { createChatsRouter } from "./routes/chatsRouter";
import { createFilesRouter } from "./routes/filesRouter";
import { createGptRouter } from "./routes/gptRouter";
import { createDocumentsRouter } from "./routes/documentsRouter";
import { createAdminRouter } from "./routes/adminRouter";
import { createAgentRouter } from "./routes/agentRouter";
import { createFigmaRouter } from "./routes/figmaRouter";
import { createLibraryRouter } from "./routes/libraryRouter";
import { createCodeRouter } from "./routes/codeRouter";
import { createUserRouter } from "./routes/userRouter";
import { createChatAiRouter } from "./routes/chatAiRouter";
import { createGoogleFormsRouter } from "./routes/googleFormsRouter";
import { createGmailRouter } from "./routes/gmailRouter";
import gmailOAuthRouter from "./routes/gmailOAuthRouter";
import { createGmailMcpRouter } from "./mcp/gmailMcpServer";
import { createAuthenticatedWebSocketHandler, AuthenticatedWebSocket } from "./lib/wsAuth";
import { llmGateway } from "./lib/llmGateway";
import { getUserConfig, setUserConfig, getDefaultConfig, validatePatterns, getFilterStats } from "./services/contentFilter";

const agentClients: Map<string, Set<WebSocket>> = new Map();
const browserClients: Map<string, Set<WebSocket>> = new Map();
const fileStatusClients: Map<string, Set<WebSocket>> = new Map();

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);
  registerAuthRoutes(app);
  
  app.use("/api/ppt", pptExportRouter);
  app.use("/api", createChatsRouter());
  app.use(createFilesRouter());
  app.use("/api", createGptRouter());
  app.use("/api/documents", createDocumentsRouter());
  app.use("/api/admin", createAdminRouter());
  app.use("/api", createAgentRouter(broadcastBrowserEvent));
  app.use(createFigmaRouter());
  app.use(createLibraryRouter());
  app.use(createCodeRouter());
  app.use(createUserRouter());
  app.use("/api", createChatAiRouter(broadcastAgentUpdate));
  app.use("/api/integrations/google/forms", createGoogleFormsRouter());
  app.use("/api/integrations/google/gmail", createGmailRouter());
  app.use("/api/oauth/google/gmail", gmailOAuthRouter);
  app.use("/mcp/gmail", createGmailMcpRouter());

  // ===== AI Quality Stats & Content Filter Endpoints =====
  
  // GET /api/ai/quality-stats - Return quality statistics
  app.get("/api/ai/quality-stats", (req: Request, res: Response) => {
    try {
      const sinceParam = req.query.since as string | undefined;
      const since = sinceParam ? new Date(sinceParam) : undefined;
      
      const stats = llmGateway.getQualityStats(since);
      const filterStats = getFilterStats();
      
      res.json({
        success: true,
        data: {
          qualityStats: stats,
          filterStats,
        },
      });
    } catch (error: any) {
      console.error("[QualityStats] Error getting stats:", error);
      res.status(500).json({ 
        success: false, 
        error: error.message || "Failed to get quality stats" 
      });
    }
  });

  // GET /api/ai/content-filter - Get current filter config
  app.get("/api/ai/content-filter", (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id || "anonymous";
      const config = getUserConfig(userId);
      
      res.json({
        success: true,
        data: config,
      });
    } catch (error: any) {
      console.error("[ContentFilter] Error getting config:", error);
      res.status(500).json({ 
        success: false, 
        error: error.message || "Failed to get filter config" 
      });
    }
  });

  // PUT /api/ai/content-filter - Update filter config
  app.put("/api/ai/content-filter", (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id || "anonymous";
      const { enabled, sensitivityLevel, customPatterns } = req.body;
      
      // Validate sensitivity level
      if (sensitivityLevel && !["low", "medium", "high"].includes(sensitivityLevel)) {
        return res.status(400).json({
          success: false,
          error: "Invalid sensitivity level. Must be 'low', 'medium', or 'high'",
        });
      }
      
      // Validate custom patterns if provided
      if (customPatterns && Array.isArray(customPatterns)) {
        const validation = validatePatterns(customPatterns);
        if (!validation.valid) {
          return res.status(400).json({
            success: false,
            error: `Invalid regex patterns: ${validation.invalidPatterns.join(", ")}`,
          });
        }
      }
      
      const newConfig = setUserConfig(userId, {
        enabled: enabled !== undefined ? Boolean(enabled) : undefined,
        sensitivityLevel,
        customPatterns,
      });
      
      res.json({
        success: true,
        data: newConfig,
      });
    } catch (error: any) {
      console.error("[ContentFilter] Error updating config:", error);
      res.status(500).json({ 
        success: false, 
        error: error.message || "Failed to update filter config" 
      });
    }
  });

  // GET /api/ai/content-filter/default - Get default filter config
  app.get("/api/ai/content-filter/default", (_req: Request, res: Response) => {
    try {
      const defaultConfig = getDefaultConfig();
      res.json({
        success: true,
        data: defaultConfig,
      });
    } catch (error: any) {
      res.status(500).json({ 
        success: false, 
        error: error.message || "Failed to get default config" 
      });
    }
  });

  const objectStorageService = new ObjectStorageService();

  browserSessionManager.addGlobalEventListener((event: SessionEvent) => {
    broadcastBrowserEvent(event.sessionId, event);
  });

  const wss = new WebSocketServer({ server: httpServer, path: "/ws/agent" });
  
  createAuthenticatedWebSocketHandler(wss, true, (ws: AuthenticatedWebSocket) => {
    let subscribedRunId: string | null = null;
    
    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === "subscribe" && data.runId) {
          subscribedRunId = data.runId;
          if (!agentClients.has(data.runId)) {
            agentClients.set(data.runId, new Set());
          }
          agentClients.get(data.runId)!.add(ws);
        }
      } catch (e) {
        console.error("WS message parse error:", e);
      }
    });
    
    ws.on("close", () => {
      if (subscribedRunId) {
        const clients = agentClients.get(subscribedRunId);
        if (clients) {
          clients.delete(ws);
          if (clients.size === 0) {
            agentClients.delete(subscribedRunId);
          }
        }
      }
    });
  });

  const browserWss = new WebSocketServer({ server: httpServer, path: "/ws/browser" });

  const fileStatusWss = new WebSocketServer({ server: httpServer, path: "/ws/file-status" });

  createAuthenticatedWebSocketHandler(fileStatusWss, true, (ws: AuthenticatedWebSocket) => {
    let subscribedFileIds: Set<string> = new Set();
    
    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === "subscribe" && data.fileId) {
          subscribedFileIds.add(data.fileId);
          if (!fileStatusClients.has(data.fileId)) {
            fileStatusClients.set(data.fileId, new Set());
          }
          fileStatusClients.get(data.fileId)!.add(ws);
          
          ws.send(JSON.stringify({ type: "subscribed", fileId: data.fileId }));
          
          const job = fileProcessingQueue.getJob(data.fileId);
          if (job && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'file_status',
              fileId: job.fileId,
              status: job.status,
              progress: job.progress,
              error: job.error,
            }));
          }
        } else if (data.type === "unsubscribe" && data.fileId) {
          subscribedFileIds.delete(data.fileId);
          const clients = fileStatusClients.get(data.fileId);
          if (clients) {
            clients.delete(ws);
            if (clients.size === 0) {
              fileStatusClients.delete(data.fileId);
            }
          }
        }
      } catch (e) {
        console.error("File status WS message parse error:", e);
      }
    });
    
    ws.on("close", () => {
      const fileIds = Array.from(subscribedFileIds);
      for (const fileId of fileIds) {
        const clients = fileStatusClients.get(fileId);
        if (clients) {
          clients.delete(ws);
          if (clients.size === 0) {
            fileStatusClients.delete(fileId);
          }
        }
      }
    });
  });

  fileProcessingQueue.setStatusChangeHandler((update: FileStatusUpdate) => {
    broadcastFileStatus(update);
  });

  fileProcessingQueue.setProcessCallback(async (job) => {
    try {
      await storage.updateFileJobStatus(job.fileId, "processing");
      await storage.updateFileProgress(job.fileId, 10);
      fileProcessingQueue.updateProgress(job.fileId, 10);

      const objectFile = await objectStorageService.getObjectEntityFile(job.storagePath);
      const content = await objectStorageService.getFileContent(objectFile);
      await storage.updateFileProgress(job.fileId, 30);
      fileProcessingQueue.updateProgress(job.fileId, 30);

      const result = await processDocument(content, job.mimeType, job.fileName);
      await storage.updateFileProgress(job.fileId, 50);
      fileProcessingQueue.updateProgress(job.fileId, 50);

      const chunks = chunkText(result.text, 1500, 150);
      await storage.updateFileProgress(job.fileId, 60);
      fileProcessingQueue.updateProgress(job.fileId, 60);

      const texts = chunks.map(c => c.content);
      const embeddings = await generateEmbeddingsBatch(texts);
      await storage.updateFileProgress(job.fileId, 80);
      fileProcessingQueue.updateProgress(job.fileId, 80);

      const chunksWithEmbeddings = chunks.map((chunk, i) => ({
        fileId: job.fileId,
        content: chunk.content,
        embedding: embeddings[i],
        chunkIndex: chunk.chunkIndex,
        pageNumber: chunk.pageNumber || null,
        metadata: null,
      }));

      await storage.createFileChunks(chunksWithEmbeddings);
      await storage.updateFileProgress(job.fileId, 95);
      fileProcessingQueue.updateProgress(job.fileId, 95);

      await storage.updateFileCompleted(job.fileId);
      await storage.updateFileJobStatus(job.fileId, "completed");
      
      console.log(`[FileQueue] File ${job.fileId} processed: ${chunks.length} chunks created`);
    } catch (error: any) {
      console.error(`[FileQueue] Error processing file ${job.fileId}:`, error);
      await storage.updateFileError(job.fileId, error.message || "Unknown error");
      await storage.updateFileJobStatus(job.fileId, "failed", error.message);
      throw error;
    }
  });
  
  createAuthenticatedWebSocketHandler(browserWss, true, (ws: AuthenticatedWebSocket) => {
    let subscribedSessionId: string | null = null;
    
    ws.on("message", async (message) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === "subscribe" && data.sessionId) {
          subscribedSessionId = data.sessionId;
          if (!browserClients.has(data.sessionId)) {
            browserClients.set(data.sessionId, new Set());
          }
          browserClients.get(data.sessionId)!.add(ws);
          
          ws.send(JSON.stringify({ type: "subscribed", sessionId: data.sessionId }));
          
          try {
            const screenshot = await browserSessionManager.getScreenshot(data.sessionId);
            if (screenshot && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                messageType: "browser_event",
                eventType: "observation",
                sessionId: data.sessionId,
                timestamp: new Date(),
                data: { type: "screenshot", screenshot }
              }));
            }
          } catch (e) {
          }
        }
      } catch (e) {
        console.error("Browser WS message parse error:", e);
      }
    });
    
    ws.on("close", () => {
      if (subscribedSessionId) {
        const clients = browserClients.get(subscribedSessionId);
        if (clients) {
          clients.delete(ws);
          if (clients.size === 0) {
            browserClients.delete(subscribedSessionId);
          }
        }
      }
    });
  });

  return httpServer;
}

function broadcastBrowserEvent(sessionId: string, event: SessionEvent) {
  const clients = browserClients.get(sessionId);
  if (!clients) return;
  
  const message = JSON.stringify({ 
    messageType: "browser_event", 
    eventType: event.type,
    sessionId: event.sessionId,
    timestamp: event.timestamp,
    data: event.data
  });
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function broadcastAgentUpdate(runId: string, update: StepUpdate) {
  const clients = agentClients.get(runId);
  if (!clients) return;
  
  const message = JSON.stringify({ type: "step_update", ...update });
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function broadcastFileStatus(update: FileStatusUpdate) {
  const clients = fileStatusClients.get(update.fileId);
  if (!clients) return;
  
  const message = JSON.stringify(update);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}
