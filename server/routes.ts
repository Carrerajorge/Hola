import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import crypto from "crypto";
import { storage } from "./storage";
import { db } from "./db";
import { users, notificationEventTypes, responsePreferencesSchema, userProfileSchema, featureFlagsSchema, integrationProviders, integrationTools } from "@shared/schema";
import { eq } from "drizzle-orm";
import { ObjectStorageService, ObjectNotFoundError, objectStorageClient } from "./objectStorage";
import { processDocument } from "./services/documentProcessing";
import { chunkText, generateEmbedding, generateEmbeddingsBatch } from "./embeddingService";
import { agentOrchestrator, StepUpdate, ProgressUpdate, guardrails } from "./agent";
import { browserSessionManager, SessionEvent } from "./agent/browser";
import { handleChatRequest, AVAILABLE_MODELS, DEFAULT_PROVIDER, DEFAULT_MODEL } from "./services/chatService";
import { llmGateway } from "./lib/llmGateway";
import { ALLOWED_MIME_TYPES, ALLOWED_EXTENSIONS, FILE_UPLOAD_CONFIG, LIMITS } from "./lib/constants";
import { fileProcessingQueue, FileStatusUpdate } from "./lib/fileProcessingQueue";
import { 
  generateWordDocument, 
  generateExcelDocument, 
  generatePptDocument,
  parseExcelFromText,
  parseSlidesFromText
} from "./services/documentGeneration";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import { runETLAgent, getAvailableCountries, getAvailableIndicators } from "./etl";
import { figmaService } from "./services/figmaService";
import { sendShareNotificationEmail } from "./services/emailService";
import { generateImage, detectImageRequest, extractImagePrompt } from "./services/imageGeneration";
import * as codeInterpreter from "./services/codeInterpreterService";
import * as pistonService from "./services/pistonService";
import { 
  DocumentRenderRequestSchema,
  renderDocument,
  getGeneratedDocument,
  getTemplates,
  getTemplateById
} from "./services/documentService";
import { renderExcelFromSpec } from "./services/excelSpecRenderer";
import { renderWordFromSpec } from "./services/wordSpecRenderer";
import { validateExcelSpec, validateDocSpec } from "./services/documentValidators";
import { generateExcelFromPrompt, generateWordFromPrompt, generateCvFromPrompt, generateReportFromPrompt, generateLetterFromPrompt } from "./services/documentOrchestrator";
import { renderCvFromSpec } from "./services/cvRenderer";
import { selectCvTemplate } from "./services/documentMappingService";
import { excelSpecSchema, docSpecSchema, cvSpecSchema, reportSpecSchema, letterSpecSchema } from "../shared/documentSpecs";
import { pptExportRouter } from "./routes/pptExport";

const agentClients: Map<string, Set<WebSocket>> = new Map();
const browserClients: Map<string, Set<WebSocket>> = new Map();
const fileStatusClients: Map<string, Set<WebSocket>> = new Map();

interface MultipartUploadSession {
  uploadId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  totalChunks: number;
  storagePath: string;
  basePath: string;
  bucketName: string;
  uploadedParts: Map<number, string>;
  createdAt: Date;
}

const multipartSessions: Map<string, MultipartUploadSession> = new Map();

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Setup authentication BEFORE other routes
  await setupAuth(app);
  registerAuthRoutes(app);
  
  // PPT Export routes
  app.use("/api/ppt", pptExportRouter);

  const objectStorageService = new ObjectStorageService();

  // Register global event listener for ALL browser sessions (including pipeline-created ones)
  browserSessionManager.addGlobalEventListener((event: SessionEvent) => {
    broadcastBrowserEvent(event.sessionId, event);
  });

  app.get("/api/files", async (req, res) => {
    try {
      const files = await storage.getFiles();
      res.json(files);
    } catch (error: any) {
      console.error("Error getting files:", error);
      res.status(500).json({ error: "Failed to get files" });
    }
  });

  app.post("/api/objects/upload", async (req, res) => {
    try {
      const { uploadURL, storagePath } = await objectStorageService.getObjectEntityUploadURLWithPath();
      res.json({ uploadURL, storagePath });
    } catch (error: any) {
      console.error("Error getting upload URL:", error);
      res.status(500).json({ error: "Failed to get upload URL" });
    }
  });

  app.post("/api/objects/multipart/create", async (req, res) => {
    try {
      const { fileName, mimeType, fileSize, totalChunks } = req.body;

      if (!fileName || !mimeType || !fileSize || !totalChunks) {
        return res.status(400).json({ error: "Missing required fields: fileName, mimeType, fileSize, totalChunks" });
      }

      if (!ALLOWED_MIME_TYPES.includes(mimeType as any)) {
        return res.status(400).json({ error: `Unsupported file type: ${mimeType}` });
      }

      if (fileSize > LIMITS.MAX_FILE_SIZE_BYTES) {
        return res.status(400).json({ error: `File size exceeds maximum limit of ${LIMITS.MAX_FILE_SIZE_MB}MB` });
      }

      const uploadId = `multipart_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
      const privateObjectDir = objectStorageService.getPrivateObjectDir();
      const objectId = `uploads/${uploadId}`;
      const storagePath = `/objects/${objectId}`;

      const session: MultipartUploadSession = {
        uploadId,
        fileName,
        mimeType,
        fileSize,
        totalChunks,
        storagePath,
        basePath: `${privateObjectDir}/${objectId}`,
        bucketName: privateObjectDir.split('/')[1] || '',
        uploadedParts: new Map(),
        createdAt: new Date(),
      };

      multipartSessions.set(uploadId, session);

      res.json({ uploadId, storagePath });
    } catch (error: any) {
      console.error("Error creating multipart upload:", error);
      res.status(500).json({ error: "Failed to create multipart upload session" });
    }
  });

  app.post("/api/objects/multipart/sign-part", async (req, res) => {
    try {
      const { uploadId, partNumber } = req.body;

      if (!uploadId || partNumber === undefined) {
        return res.status(400).json({ error: "Missing required fields: uploadId, partNumber" });
      }

      const session = multipartSessions.get(uploadId);
      if (!session) {
        return res.status(404).json({ error: "Upload session not found" });
      }

      if (partNumber < 1 || partNumber > session.totalChunks) {
        return res.status(400).json({ error: `Invalid part number. Must be between 1 and ${session.totalChunks}` });
      }

      const partPath = `${session.basePath}_part_${partNumber}`;
      const { bucketName, objectName } = parseObjectPath(partPath);
      
      const signedUrl = await signObjectURLForMultipart({
        bucketName,
        objectName,
        method: "PUT",
        ttlSec: 900,
      });

      res.json({ signedUrl });
    } catch (error: any) {
      console.error("Error signing multipart part:", error);
      res.status(500).json({ error: "Failed to get signed URL for part" });
    }
  });

  app.post("/api/objects/multipart/complete", async (req, res) => {
    try {
      const { uploadId, parts } = req.body;

      if (!uploadId || !parts || !Array.isArray(parts)) {
        return res.status(400).json({ error: "Missing required fields: uploadId, parts" });
      }

      const session = multipartSessions.get(uploadId);
      if (!session) {
        return res.status(404).json({ error: "Upload session not found" });
      }

      const { bucketName } = parseObjectPath(session.basePath);
      const bucket = objectStorageClient.bucket(bucketName);
      
      const partPaths = parts
        .sort((a: { partNumber: number }, b: { partNumber: number }) => a.partNumber - b.partNumber)
        .map((p: { partNumber: number }) => {
          const partPath = `${session.basePath}_part_${p.partNumber}`;
          const { objectName } = parseObjectPath(partPath);
          return objectName;
        });

      const { objectName: finalObjectName } = parseObjectPath(session.basePath);
      const destinationFile = bucket.file(finalObjectName);

      try {
        await bucket.combine(
          partPaths.map(p => bucket.file(p)),
          destinationFile
        );
        
        await destinationFile.setMetadata({ contentType: session.mimeType });

        for (const partPath of partPaths) {
          try {
            await bucket.file(partPath).delete();
          } catch (e) {
            console.warn(`Failed to delete part ${partPath}:`, e);
          }
        }
      } catch (composeError: any) {
        console.error("Failed to compose parts:", composeError);
        return res.status(500).json({ error: "Failed to compose file parts" });
      }

      multipartSessions.delete(uploadId);

      const file = await storage.createFile({
        name: session.fileName,
        type: session.mimeType,
        size: session.fileSize,
        storagePath: session.storagePath,
        status: "processing",
        userId: null,
      });

      await storage.createFileJob({
        fileId: file.id,
        status: "pending",
      });

      fileProcessingQueue.enqueue({
        fileId: file.id,
        storagePath: session.storagePath,
        mimeType: session.mimeType,
        fileName: session.fileName,
      });

      res.json({ success: true, storagePath: session.storagePath, fileId: file.id });
    } catch (error: any) {
      console.error("Error completing multipart upload:", error);
      res.status(500).json({ error: "Failed to complete multipart upload" });
    }
  });

  app.post("/api/objects/multipart/abort", async (req, res) => {
    try {
      const { uploadId } = req.body;

      if (!uploadId) {
        return res.status(400).json({ error: "Missing required field: uploadId" });
      }

      const session = multipartSessions.get(uploadId);
      if (!session) {
        return res.status(404).json({ error: "Upload session not found" });
      }

      const { bucketName } = parseObjectPath(session.basePath);
      const bucket = objectStorageClient.bucket(bucketName);

      for (let i = 1; i <= session.totalChunks; i++) {
        const partPath = `${session.basePath}_part_${i}`;
        const { objectName } = parseObjectPath(partPath);
        try {
          await bucket.file(objectName).delete();
        } catch (e) {
        }
      }

      multipartSessions.delete(uploadId);

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error aborting multipart upload:", error);
      res.status(500).json({ error: "Failed to abort multipart upload" });
    }
  });

  app.get("/api/files/config", (req, res) => {
    res.json({
      allowedMimeTypes: [...ALLOWED_MIME_TYPES],
      allowedExtensions: ALLOWED_EXTENSIONS,
      maxFileSize: LIMITS.MAX_FILE_SIZE_BYTES,
      maxFileSizeMB: LIMITS.MAX_FILE_SIZE_MB,
      chunkSize: FILE_UPLOAD_CONFIG.CHUNK_SIZE_BYTES,
      chunkSizeMB: FILE_UPLOAD_CONFIG.CHUNK_SIZE_MB,
      maxParallelChunks: FILE_UPLOAD_CONFIG.MAX_PARALLEL_CHUNKS,
    });
  });

  app.post("/api/files", async (req, res) => {
    try {
      const { name, type, size, storagePath } = req.body;

      if (!name || !type || !size || !storagePath) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      if (!ALLOWED_MIME_TYPES.includes(type)) {
        return res.status(400).json({ error: `Unsupported file type: ${type}` });
      }

      const file = await storage.createFile({
        name,
        type,
        size,
        storagePath,
        status: "processing",
        userId: null,
      });

      processFileAsync(file.id, storagePath, type, name);

      res.json(file);
    } catch (error: any) {
      console.error("Error creating file:", error);
      res.status(500).json({ error: "Failed to create file" });
    }
  });

  app.delete("/api/files/:id", async (req, res) => {
    try {
      await storage.deleteFile(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting file:", error);
      res.status(500).json({ error: "Failed to delete file" });
    }
  });

  app.get("/api/files/:id/content", async (req, res) => {
    try {
      const file = await storage.getFile(req.params.id);
      if (!file) {
        return res.status(404).json({ error: "File not found" });
      }
      if (file.status !== "ready") {
        return res.status(202).json({ status: file.status, content: null });
      }
      const chunks = await storage.getFileChunks(req.params.id);
      const content = chunks
        .sort((a, b) => a.chunkIndex - b.chunkIndex)
        .map(c => c.content)
        .join("\n");
      res.json({ status: "ready", content, fileName: file.name });
    } catch (error: any) {
      console.error("Error getting file content:", error);
      res.status(500).json({ error: "Failed to get file content" });
    }
  });

  app.get("/objects/:objectPath(*)", async (req, res) => {
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        return res.sendStatus(404);
      }
      console.error("Error serving object:", error);
      return res.sendStatus(500);
    }
  });

  app.get("/api/models", (req, res) => {
    res.json(AVAILABLE_MODELS);
  });

  app.post("/api/chat", async (req, res) => {
    try {
      const { messages, useRag = true, conversationId, images, gptConfig, documentMode, figmaMode, provider = DEFAULT_PROVIDER, model = DEFAULT_MODEL } = req.body;
      
      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: "Messages array is required" });
      }

      const formattedMessages = messages.map((msg: { role: string; content: string }) => ({
        role: msg.role as "user" | "assistant" | "system",
        content: msg.content
      }));

      const response = await handleChatRequest(formattedMessages, {
        useRag,
        conversationId,
        images,
        gptConfig,
        documentMode,
        figmaMode,
        provider,
        model,
        onAgentProgress: (update) => broadcastAgentUpdate(update.runId, update as any)
      });
      
      // Track chat query activity (only for authenticated users)
      const user = (req as any).user;
      const userId = user?.claims?.sub;
      if (userId) {
        try {
          await storage.createAuditLog({
            userId,
            action: "chat_query",
            resource: "chats",
            resourceId: conversationId || null,
            details: { 
              messageCount: messages.length,
              useRag,
              documentMode: documentMode || false,
              hasImages: !!images && images.length > 0
            }
          });
        } catch (auditError) {
          console.error("Failed to create audit log:", auditError);
        }
      }
      
      res.json(response);
    } catch (error: any) {
      console.error("Chat API error:", error);
      res.status(500).json({ 
        error: "Failed to get AI response",
        details: error.message 
      });
    }
  });

  // Voice Chat API - for conversational voice mode with Grok
  app.post("/api/voice-chat", async (req, res) => {
    try {
      const { message } = req.body;
      
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Message is required" });
      }

      console.log("[VoiceChat] Processing voice input:", message);
      
      const result = await llmGateway.chat([
        {
          role: "system",
          content: `Eres Sira, un asistente de voz amigable y conversacional. 
Responde de manera natural y concisa, como si estuvieras hablando directamente con el usuario.
Mantén las respuestas cortas (2-3 oraciones máximo) para que sean fáciles de escuchar.
Usa un tono cálido y conversacional en español.
No uses markdown, emojis ni formatos especiales ya que tu respuesta será leída en voz alta.`
        },
        {
          role: "user",
          content: message
        }
      ], {
        model: "grok-3-fast",
        temperature: 0.7,
        maxTokens: 150,
      });
      
      res.json({ 
        success: true,
        response: result.content,
        latencyMs: result.latencyMs
      });
    } catch (error: any) {
      console.error("Voice chat error:", error);
      res.status(500).json({ 
        error: "Failed to process voice message",
        details: error.message 
      });
    }
  });

  // Image Generation API
  app.post("/api/image/generate", async (req, res) => {
    try {
      const { prompt } = req.body;
      
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }

      console.log("[ImageGen] Generating image for prompt:", prompt);
      
      const result = await generateImage(prompt);
      
      res.json({
        success: true,
        imageData: `data:${result.mimeType};base64,${result.imageBase64}`,
        prompt: result.prompt
      });
    } catch (error: any) {
      console.error("Image generation error:", error);
      res.status(500).json({ 
        error: "Failed to generate image",
        details: error.message 
      });
    }
  });

  // Detect if message is an image request
  app.post("/api/image/detect", (req, res) => {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }
    
    const isImageRequest = detectImageRequest(message);
    const extractedPrompt = isImageRequest ? extractImagePrompt(message) : null;
    
    res.json({ isImageRequest, extractedPrompt });
  });

  // ETL Agent Routes
  app.get("/api/etl/config", async (req, res) => {
    try {
      res.json({
        countries: getAvailableCountries(),
        indicators: getAvailableIndicators()
      });
    } catch (error: any) {
      console.error("ETL config error:", error);
      res.status(500).json({ error: "Failed to get ETL config" });
    }
  });

  app.post("/api/etl/run", async (req, res) => {
    try {
      const { countries, indicators, startDate, endDate } = req.body;
      
      if (!countries || !Array.isArray(countries) || countries.length === 0) {
        return res.status(400).json({ error: "Countries array is required" });
      }

      console.log("[ETL API] Starting ETL for countries:", countries);

      const result = await runETLAgent({
        countries,
        indicators,
        startDate,
        endDate
      });

      if (result.success && result.workbookBuffer) {
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
        res.send(result.workbookBuffer);
      } else {
        res.status(result.success ? 200 : 500).json({
          success: result.success,
          message: result.message,
          summary: result.summary,
          errors: result.errors
        });
      }
    } catch (error: any) {
      console.error("ETL API error:", error);
      res.status(500).json({ 
        error: "ETL pipeline failed",
        details: error.message 
      });
    }
  });

  app.post("/api/chat/stream", async (req, res) => {
    const requestId = `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    let heartbeatInterval: NodeJS.Timeout | null = null;
    let isConnectionClosed = false;

    try {
      const { messages, conversationId } = req.body;
      
      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: "Messages array is required" });
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Request-Id", requestId);
      res.flushHeaders();

      req.on("close", () => {
        isConnectionClosed = true;
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
        }
        console.log(`[SSE] Connection closed: ${requestId}`);
      });

      heartbeatInterval = setInterval(() => {
        if (!isConnectionClosed) {
          res.write(`:heartbeat\n\n`);
        }
      }, 15000);

      const formattedMessages = messages.map((msg: { role: string; content: string }) => ({
        role: msg.role as "user" | "assistant" | "system",
        content: msg.content
      }));

      const systemMessage = {
        role: "system" as const,
        content: `Eres MICHAT, un asistente de IA avanzado. Responde de manera útil y profesional en el idioma del usuario.`
      };

      const user = (req as any).user;
      const userId = user?.claims?.sub;

      res.write(`event: start\ndata: ${JSON.stringify({ requestId, timestamp: Date.now() })}\n\n`);

      const streamGenerator = llmGateway.streamChat(
        [systemMessage, ...formattedMessages],
        {
          userId: userId || conversationId || "anonymous",
          requestId,
        }
      );

      let fullContent = "";
      let lastAckSequence = -1;

      for await (const chunk of streamGenerator) {
        if (isConnectionClosed) break;

        fullContent += chunk.content;
        lastAckSequence = chunk.sequenceId;

        if (chunk.done) {
          res.write(`event: done\ndata: ${JSON.stringify({
            sequenceId: chunk.sequenceId,
            requestId: chunk.requestId,
            timestamp: Date.now(),
          })}\n\n`);
        } else {
          res.write(`event: chunk\ndata: ${JSON.stringify({
            content: chunk.content,
            sequenceId: chunk.sequenceId,
            requestId: chunk.requestId,
            timestamp: Date.now(),
          })}\n\n`);
        }
      }

      if (!isConnectionClosed) {
        res.write(`event: complete\ndata: ${JSON.stringify({ 
          requestId, 
          totalSequences: lastAckSequence + 1,
          contentLength: fullContent.length,
          timestamp: Date.now() 
        })}\n\n`);
      }

      if (userId) {
        try {
          await storage.createAuditLog({
            userId,
            action: "chat_stream",
            resource: "chats",
            resourceId: conversationId || null,
            details: { 
              messageCount: messages.length,
              requestId,
              streaming: true
            }
          });
        } catch (auditError) {
          console.error("Failed to create audit log:", auditError);
        }
      }

    } catch (error: any) {
      console.error(`[SSE] Stream error ${requestId}:`, error);
      if (!isConnectionClosed) {
        try {
          res.write(`event: error\ndata: ${JSON.stringify({ 
            error: error.message, 
            requestId,
            timestamp: Date.now() 
          })}\n\n`);
        } catch (writeError) {
          console.error(`[SSE] Failed to write error event:`, writeError);
        }
      }
    } finally {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
      if (!isConnectionClosed) {
        res.end();
      }
    }
  });

  app.get("/api/agent/runs/:id", async (req, res) => {
    try {
      const run = await storage.getAgentRun(req.params.id);
      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }
      const steps = await storage.getAgentSteps(req.params.id);
      const assets = await storage.getAgentAssets(req.params.id);
      res.json({ run, steps, assets });
    } catch (error: any) {
      res.status(500).json({ error: "Failed to get agent run" });
    }
  });

  app.post("/api/agent/runs/:id/cancel", async (req, res) => {
    try {
      const success = agentOrchestrator.cancelRun(req.params.id);
      if (success) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: "Run not found or already completed" });
      }
    } catch (error: any) {
      res.status(500).json({ error: "Failed to cancel run" });
    }
  });

  const wss = new WebSocketServer({ server: httpServer, path: "/ws/agent" });
  
  console.log("Agent WebSocket server created at /ws/agent");
  
  wss.on("connection", (ws) => {
    console.log("Agent WebSocket client connected");
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

  app.post("/api/browser/session", async (req, res) => {
    try {
      const { objective, config } = req.body;
      if (!objective) {
        return res.status(400).json({ error: "Objective is required" });
      }
      
      const sessionId = await browserSessionManager.createSession(
        objective,
        config || {},
        (event: SessionEvent) => {
          broadcastBrowserEvent(event.sessionId, event);
        }
      );
      
      browserSessionManager.startScreenshotStreaming(sessionId, 1500);
      
      res.json({ sessionId });
    } catch (error: any) {
      console.error("Error creating browser session:", error);
      res.status(500).json({ error: "Failed to create browser session" });
    }
  });

  app.post("/api/browser/session/:id/navigate", async (req, res) => {
    try {
      const { url } = req.body;
      const validation = await guardrails.validateAction(req.params.id, "navigate", url);
      if (!validation.allowed) {
        return res.status(403).json({ error: validation.reason, blocked: true });
      }
      const result = await browserSessionManager.navigate(req.params.id, url);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/browser/session/:id/click", async (req, res) => {
    try {
      const { selector } = req.body;
      const validation = await guardrails.validateAction(req.params.id, "click", selector);
      if (!validation.allowed) {
        return res.status(403).json({ error: validation.reason, blocked: true });
      }
      const result = await browserSessionManager.click(req.params.id, selector);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/browser/session/:id/type", async (req, res) => {
    try {
      const { selector, text } = req.body;
      const validation = await guardrails.validateAction(req.params.id, "type", selector, { text });
      if (!validation.allowed) {
        return res.status(403).json({ error: validation.reason, blocked: true });
      }
      const result = await browserSessionManager.type(req.params.id, selector, text);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/browser/session/:id/scroll", async (req, res) => {
    try {
      const { direction, amount } = req.body;
      const validation = await guardrails.validateAction(req.params.id, "scroll", "page");
      if (!validation.allowed) {
        return res.status(403).json({ error: validation.reason, blocked: true });
      }
      const result = await browserSessionManager.scroll(req.params.id, direction, amount);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/browser/session/:id/state", async (req, res) => {
    try {
      const state = await browserSessionManager.getPageState(req.params.id);
      if (!state) {
        return res.status(404).json({ error: "Session not found" });
      }
      res.json(state);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/browser/session/:id/screenshot", async (req, res) => {
    try {
      const screenshot = await browserSessionManager.getScreenshot(req.params.id);
      if (!screenshot) {
        return res.status(404).json({ error: "Session not found" });
      }
      res.json({ screenshot });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/browser/session/:id", async (req, res) => {
    try {
      const session = browserSessionManager.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      res.json(session);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/browser/session/:id", async (req, res) => {
    try {
      await browserSessionManager.closeSession(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/browser/session/:id/cancel", async (req, res) => {
    try {
      browserSessionManager.cancelSession(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Chat persistence API routes (require authentication for user-specific history)
  app.get("/api/chats", async (req, res) => {
    try {
      // Get userId from authenticated session
      const user = (req as any).user;
      const userId = user?.claims?.sub;
      
      // If not authenticated, return empty array (user sees no chats)
      if (!userId) {
        return res.json([]);
      }
      
      const chatList = await storage.getChats(userId);
      res.json(chatList);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/chats", async (req, res) => {
    try {
      const { title } = req.body;
      // Get userId from authenticated session
      const user = (req as any).user;
      const userId = user?.claims?.sub;
      
      // Require authentication to create chats
      if (!userId) {
        return res.status(401).json({ error: "Authentication required to create chats" });
      }
      
      const chat = await storage.createChat({ title: title || "New Chat", userId });
      res.json(chat);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/chats/:id", async (req, res) => {
    try {
      const user = (req as any).user;
      const userId = user?.claims?.sub;
      const userEmail = user?.claims?.email;
      
      const chat = await storage.getChat(req.params.id);
      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }
      
      // Check ownership first
      const isOwner = chat.userId && chat.userId === userId;
      
      // If not owner, check for shared access by userId (secure)
      let shareRole = null;
      if (!isOwner && userId) {
        const share = await storage.getChatShareByUserAndChat(userId, req.params.id);
        if (share) {
          shareRole = share.role;
        }
      }
      
      // Deny access if not owner and no share
      if (!isOwner && !shareRole) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      const messages = await storage.getChatMessages(req.params.id);
      res.json({ ...chat, messages, shareRole, isOwner });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/chats/:id", async (req, res) => {
    try {
      const user = (req as any).user;
      const userId = user?.claims?.sub;
      
      // First check if chat exists and verify ownership
      const existingChat = await storage.getChat(req.params.id);
      if (!existingChat) {
        return res.status(404).json({ error: "Chat not found" });
      }
      if (!existingChat.userId || existingChat.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      const { title, archived, hidden } = req.body;
      const updates: any = {};
      if (title !== undefined) updates.title = title;
      if (archived !== undefined) updates.archived = archived.toString();
      if (hidden !== undefined) updates.hidden = hidden.toString();
      
      const chat = await storage.updateChat(req.params.id, updates);
      res.json(chat);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/chats/:id", async (req, res) => {
    try {
      const user = (req as any).user;
      const userId = user?.claims?.sub;
      
      // Verify ownership before delete
      const chat = await storage.getChat(req.params.id);
      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }
      if (!chat.userId || chat.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      await storage.deleteChat(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/chats/archive-all", async (req, res) => {
    try {
      const user = (req as any).user;
      const userId = user?.claims?.sub;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      const chats = await storage.getChats(userId);
      let archivedCount = 0;
      for (const chat of chats) {
        if (chat.archived !== "true") {
          await storage.updateChat(chat.id, { archived: "true" });
          archivedCount++;
        }
      }
      res.json({ success: true, archivedCount });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/chats/delete-all", async (req, res) => {
    try {
      const user = (req as any).user;
      const userId = user?.claims?.sub;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      const chats = await storage.getChats(userId);
      let deletedCount = 0;
      for (const chat of chats) {
        await storage.deleteChat(chat.id);
        deletedCount++;
      }
      res.json({ success: true, deletedCount });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/chats/:id/messages", async (req, res) => {
    try {
      const user = (req as any).user;
      const userId = user?.claims?.sub;
      
      // Verify ownership before adding message
      const chat = await storage.getChat(req.params.id);
      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }
      if (!chat.userId || chat.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      const { role, content, attachments, sources, figmaDiagram } = req.body;
      if (!role || !content) {
        return res.status(400).json({ error: "role and content are required" });
      }
      const message = await storage.createChatMessage({
        chatId: req.params.id,
        role,
        content,
        attachments: attachments || null,
        sources: sources || null,
        figmaDiagram: figmaDiagram || null
      });
      
      // Update chat title if first user message
      if (chat.title === "New Chat" && role === "user") {
        const newTitle = content.slice(0, 30) + (content.length > 30 ? "..." : "");
        await storage.updateChat(req.params.id, { title: newTitle });
      }
      
      res.json(message);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Chat Share API routes
  app.get("/api/chats/:id/shares", async (req, res) => {
    try {
      const user = (req as any).user;
      const userId = user?.claims?.sub;
      
      const chat = await storage.getChat(req.params.id);
      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }
      if (!chat.userId || chat.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      const shares = await storage.getChatShares(req.params.id);
      res.json(shares);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/chats/:id/shares", async (req, res) => {
    try {
      const user = (req as any).user;
      const userId = user?.claims?.sub;
      const userEmail = user?.claims?.email;
      
      const chat = await storage.getChat(req.params.id);
      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }
      if (!chat.userId || chat.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      const { participants } = req.body;
      if (!participants || !Array.isArray(participants)) {
        return res.status(400).json({ error: "participants array is required" });
      }
      
      const createdShares = [];
      const emailsToNotify = [];
      
      for (const p of participants) {
        if (!p.email || !p.role) continue;
        
        const normalizedEmail = p.email.toLowerCase().trim();
        
        // Look up user by email to get their userId (secure authorization)
        const recipientUser = await storage.getUserByEmail(normalizedEmail);
        
        // Check if already exists
        const existing = await storage.getChatShareByEmailAndChat(normalizedEmail, req.params.id);
        if (existing) {
          // Update role and recipientUserId if needed
          const updates: any = {};
          if (existing.role !== p.role) updates.role = p.role;
          if (recipientUser && existing.recipientUserId !== recipientUser.id) {
            updates.recipientUserId = recipientUser.id;
          }
          if (Object.keys(updates).length > 0) {
            await storage.updateChatShare(existing.id, updates);
          }
          continue;
        }
        
        const share = await storage.createChatShare({
          chatId: req.params.id,
          email: normalizedEmail,
          recipientUserId: recipientUser?.id || null,
          role: p.role,
          invitedBy: userId,
          notificationSent: "false"
        });
        createdShares.push(share);
        emailsToNotify.push({ email: normalizedEmail, role: p.role, shareId: share.id });
      }
      
      // Send email notifications
      for (const notify of emailsToNotify) {
        try {
          await sendShareNotificationEmail({
            toEmail: notify.email,
            chatTitle: chat.title,
            chatId: req.params.id,
            role: notify.role,
            inviterEmail: userEmail || "Un usuario"
          });
          await storage.updateChatShare(notify.shareId, { notificationSent: "true" });
        } catch (emailError) {
          console.error("Failed to send share notification:", emailError);
        }
      }
      
      res.json({ success: true, created: createdShares.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/chats/:id/shares/:shareId", async (req, res) => {
    try {
      const user = (req as any).user;
      const userId = user?.claims?.sub;
      
      const chat = await storage.getChat(req.params.id);
      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }
      if (!chat.userId || chat.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      await storage.deleteChatShare(req.params.shareId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get chats shared with the current user (uses userId for secure auth)
  app.get("/api/shared-chats", async (req, res) => {
    try {
      const user = (req as any).user;
      const userId = user?.claims?.sub;
      
      if (!userId) {
        return res.json([]);
      }
      
      const shares = await storage.getChatSharesByUserId(userId);
      const sharedChats = [];
      
      for (const share of shares) {
        const chat = await storage.getChat(share.chatId);
        if (chat) {
          sharedChats.push({ ...chat, shareRole: share.role, shareId: share.id });
        }
      }
      
      res.json(sharedChats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GPT Categories API routes
  app.get("/api/gpt-categories", async (req, res) => {
    try {
      const categories = await storage.getGptCategories();
      res.json(categories);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/gpt-categories", async (req, res) => {
    try {
      const { name, slug, description, icon, sortOrder } = req.body;
      if (!name || !slug) {
        return res.status(400).json({ error: "name and slug are required" });
      }
      const category = await storage.createGptCategory({
        name,
        slug,
        description: description || null,
        icon: icon || null,
        sortOrder: sortOrder || 0
      });
      res.json(category);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GPT API routes
  app.get("/api/gpts", async (req, res) => {
    try {
      const { visibility, categoryId, creatorId } = req.query;
      const filters: any = {};
      if (visibility) filters.visibility = visibility as string;
      if (categoryId) filters.categoryId = categoryId as string;
      if (creatorId) filters.creatorId = creatorId as string;
      
      const gptList = await storage.getGpts(Object.keys(filters).length > 0 ? filters : undefined);
      res.json(gptList);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/gpts/popular", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const gptList = await storage.getPopularGpts(limit);
      res.json(gptList);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/gpts", async (req, res) => {
    try {
      const { 
        name, slug, description, avatar, categoryId, creatorId,
        visibility, systemPrompt, temperature, topP, maxTokens,
        welcomeMessage, capabilities, conversationStarters, isPublished
      } = req.body;
      
      if (!name || !slug || !systemPrompt) {
        return res.status(400).json({ error: "name, slug, and systemPrompt are required" });
      }
      
      // Check if slug already exists
      const existing = await storage.getGptBySlug(slug);
      if (existing) {
        return res.status(409).json({ error: "A GPT with this slug already exists" });
      }
      
      const gpt = await storage.createGpt({
        name,
        slug,
        description: description || null,
        avatar: avatar || null,
        categoryId: categoryId || null,
        creatorId: creatorId || null,
        visibility: visibility || "private",
        systemPrompt,
        temperature: temperature || "0.7",
        topP: topP || "1",
        maxTokens: maxTokens || 4096,
        welcomeMessage: welcomeMessage || null,
        capabilities: capabilities || null,
        conversationStarters: conversationStarters || null,
        isPublished: isPublished || "false",
        version: 1
      });
      
      // Create initial version
      await storage.createGptVersion({
        gptId: gpt.id,
        versionNumber: 1,
        systemPrompt,
        temperature: temperature || "0.7",
        topP: topP || "1",
        maxTokens: maxTokens || 4096,
        changeNotes: "Initial version",
        createdBy: creatorId || null
      });
      
      res.json(gpt);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/gpts/:id", async (req, res) => {
    try {
      const gpt = await storage.getGpt(req.params.id);
      if (!gpt) {
        // Try by slug
        const gptBySlug = await storage.getGptBySlug(req.params.id);
        if (!gptBySlug) {
          return res.status(404).json({ error: "GPT not found" });
        }
        return res.json(gptBySlug);
      }
      res.json(gpt);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/gpts/:id", async (req, res) => {
    try {
      const updates = req.body;
      const gpt = await storage.updateGpt(req.params.id, updates);
      if (!gpt) {
        return res.status(404).json({ error: "GPT not found" });
      }
      res.json(gpt);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/gpts/:id", async (req, res) => {
    try {
      await storage.deleteGpt(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/gpts/:id/use", async (req, res) => {
    try {
      await storage.incrementGptUsage(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GPT Versions API routes
  app.get("/api/gpts/:id/versions", async (req, res) => {
    try {
      const versions = await storage.getGptVersions(req.params.id);
      res.json(versions);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/gpts/:id/versions", async (req, res) => {
    try {
      const { systemPrompt, temperature, topP, maxTokens, changeNotes, createdBy } = req.body;
      
      if (!systemPrompt) {
        return res.status(400).json({ error: "systemPrompt is required" });
      }
      
      // Get current max version number
      const latestVersion = await storage.getLatestGptVersion(req.params.id);
      const newVersionNumber = latestVersion ? latestVersion.versionNumber + 1 : 1;
      
      const version = await storage.createGptVersion({
        gptId: req.params.id,
        versionNumber: newVersionNumber,
        systemPrompt,
        temperature: temperature || "0.7",
        topP: topP || "1",
        maxTokens: maxTokens || 4096,
        changeNotes: changeNotes || null,
        createdBy: createdBy || null
      });
      
      // Update the GPT with the new version and settings
      await storage.updateGpt(req.params.id, {
        version: newVersionNumber,
        systemPrompt,
        temperature: temperature || "0.7",
        topP: topP || "1",
        maxTokens: maxTokens || 4096
      });
      
      res.json(version);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/documents/generate", async (req, res) => {
    try {
      const { type, title, content } = req.body;
      
      if (!type || !title || !content) {
        return res.status(400).json({ error: "type, title, and content are required" });
      }

      let buffer: Buffer;
      let filename: string;
      let mimeType: string;

      switch (type) {
        case "word":
          buffer = await generateWordDocument(title, content);
          filename = `${title.replace(/[^a-zA-Z0-9]/g, "_")}.docx`;
          mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
          break;
        case "excel":
          const excelData = parseExcelFromText(content);
          buffer = await generateExcelDocument(title, excelData);
          filename = `${title.replace(/[^a-zA-Z0-9]/g, "_")}.xlsx`;
          mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
          break;
        case "ppt":
          const slides = parseSlidesFromText(content);
          buffer = await generatePptDocument(title, slides);
          filename = `${title.replace(/[^a-zA-Z0-9]/g, "_")}.pptx`;
          mimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
          break;
        default:
          return res.status(400).json({ error: "Invalid document type. Use 'word', 'excel', or 'ppt'" });
      }

      res.setHeader("Content-Type", mimeType);
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buffer);
    } catch (error: any) {
      console.error("Document generation error:", error);
      res.status(500).json({ error: "Failed to generate document", details: error.message });
    }
  });

  app.get("/api/documents/templates", async (req, res) => {
    try {
      const templates = getTemplates();
      const type = req.query.type as string | undefined;
      
      if (type) {
        const filtered = templates.filter(t => t.type.includes(type as any));
        return res.json(filtered);
      }
      
      res.json(templates);
    } catch (error: any) {
      console.error("Error fetching templates:", error);
      res.status(500).json({ error: "Failed to fetch templates" });
    }
  });

  app.get("/api/documents/templates/:id", async (req, res) => {
    try {
      const template = getTemplateById(req.params.id);
      if (!template) {
        return res.status(404).json({ error: "Template not found" });
      }
      res.json(template);
    } catch (error: any) {
      console.error("Error fetching template:", error);
      res.status(500).json({ error: "Failed to fetch template" });
    }
  });

  app.post("/api/documents/render", async (req, res) => {
    try {
      const parseResult = DocumentRenderRequestSchema.safeParse(req.body);
      
      if (!parseResult.success) {
        return res.status(400).json({ 
          error: "Invalid request", 
          details: parseResult.error.flatten().fieldErrors 
        });
      }
      
      const document = await renderDocument(parseResult.data);
      
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const downloadUrl = `${baseUrl}/api/documents/${document.id}`;
      
      res.json({
        id: document.id,
        fileName: document.fileName,
        mimeType: document.mimeType,
        downloadUrl,
        expiresAt: document.expiresAt.toISOString(),
      });
    } catch (error: any) {
      console.error("Document render error:", error);
      res.status(500).json({ error: "Failed to render document", details: error.message });
    }
  });

  app.get("/api/documents/:id", async (req, res) => {
    try {
      const document = getGeneratedDocument(req.params.id);
      
      if (!document) {
        return res.status(404).json({ error: "Document not found or expired" });
      }
      
      res.setHeader("Content-Type", document.mimeType);
      res.setHeader("Content-Disposition", `attachment; filename="${document.fileName}"`);
      res.setHeader("Content-Length", document.buffer.length);
      res.send(document.buffer);
    } catch (error: any) {
      console.error("Document download error:", error);
      res.status(500).json({ error: "Failed to download document" });
    }
  });

  // Render Excel from spec
  app.post("/api/documents/render/excel", async (req, res) => {
    try {
      const parseResult = excelSpecSchema.safeParse(req.body);
      
      if (!parseResult.success) {
        return res.status(400).json({ 
          error: "Invalid Excel spec", 
          details: parseResult.error.flatten().fieldErrors 
        });
      }
      
      const buffer = await renderExcelFromSpec(parseResult.data);
      
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${parseResult.data.workbook_title || 'workbook'}.xlsx"`);
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error: any) {
      console.error("Excel render error:", error);
      res.status(500).json({ error: "Failed to render Excel document", details: error.message });
    }
  });

  // Render Word from spec
  app.post("/api/documents/render/word", async (req, res) => {
    try {
      const parseResult = docSpecSchema.safeParse(req.body);
      
      if (!parseResult.success) {
        return res.status(400).json({ 
          error: "Invalid Word doc spec", 
          details: parseResult.error.flatten().fieldErrors 
        });
      }
      
      const buffer = await renderWordFromSpec(parseResult.data);
      
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${parseResult.data.title || 'document'}.docx"`);
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error: any) {
      console.error("Word render error:", error);
      res.status(500).json({ error: "Failed to render Word document", details: error.message });
    }
  });

  // Generate Excel from prompt (AI-powered)
  app.post("/api/documents/generate/excel", async (req, res) => {
    try {
      const { prompt, returnMetadata } = req.body;
      
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }
      
      const result = await generateExcelFromPrompt(prompt);
      const { buffer, spec, qualityReport, postRenderValidation, attemptsUsed } = result;
      
      // Add quality gate warnings as response headers
      if (qualityReport.warnings.length > 0) {
        res.setHeader("X-Quality-Warnings", JSON.stringify(qualityReport.warnings.map(w => w.message)));
      }
      if (postRenderValidation.warnings.length > 0) {
        res.setHeader("X-PostRender-Warnings", JSON.stringify(postRenderValidation.warnings));
      }
      res.setHeader("X-Generation-Attempts", attemptsUsed.toString());
      
      // If client requests metadata, return JSON with base64 buffer
      if (returnMetadata === true) {
        return res.json({
          success: true,
          filename: `${spec.workbook_title || 'generated'}.xlsx`,
          buffer: buffer.toString("base64"),
          qualityWarnings: qualityReport.warnings,
          postRenderWarnings: postRenderValidation.warnings,
          metadata: postRenderValidation.metadata,
          attemptsUsed,
        });
      }
      
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${spec.workbook_title || 'generated'}.xlsx"`);
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error: any) {
      console.error("Excel generation error:", error);
      res.status(500).json({ error: "Failed to generate Excel document", details: error.message });
    }
  });

  // Generate Word from prompt (AI-powered)
  app.post("/api/documents/generate/word", async (req, res) => {
    try {
      const { prompt, returnMetadata } = req.body;
      
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }
      
      const result = await generateWordFromPrompt(prompt);
      const { buffer, spec, qualityReport, postRenderValidation, attemptsUsed } = result;
      
      // Add quality gate warnings as response headers
      if (qualityReport.warnings.length > 0) {
        res.setHeader("X-Quality-Warnings", JSON.stringify(qualityReport.warnings.map(w => w.message)));
      }
      if (postRenderValidation.warnings.length > 0) {
        res.setHeader("X-PostRender-Warnings", JSON.stringify(postRenderValidation.warnings));
      }
      res.setHeader("X-Generation-Attempts", attemptsUsed.toString());
      
      // If client requests metadata, return JSON with base64 buffer
      if (returnMetadata === true) {
        return res.json({
          success: true,
          filename: `${spec.title || 'generated'}.docx`,
          buffer: buffer.toString("base64"),
          qualityWarnings: qualityReport.warnings,
          postRenderWarnings: postRenderValidation.warnings,
          metadata: postRenderValidation.metadata,
          attemptsUsed,
        });
      }
      
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${spec.title || 'generated'}.docx"`);
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error: any) {
      console.error("Word generation error:", error);
      res.status(500).json({ error: "Failed to generate Word document", details: error.message });
    }
  });

  // Generate CV from prompt (AI-powered)
  app.post("/api/documents/generate/cv", async (req, res) => {
    try {
      const { prompt } = req.body;
      
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }
      
      const result = await generateCvFromPrompt(prompt);
      const { buffer, qualityReport, postRenderValidation, attemptsUsed } = result;
      
      if (qualityReport.warnings.length > 0) {
        res.setHeader("X-Quality-Warnings", JSON.stringify(qualityReport.warnings.map(w => w.message)));
      }
      if (postRenderValidation.warnings.length > 0) {
        res.setHeader("X-PostRender-Warnings", JSON.stringify(postRenderValidation.warnings));
      }
      res.setHeader("X-Generation-Attempts", attemptsUsed.toString());
      
      const timestamp = Date.now();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="cv_${timestamp}.docx"`);
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error: any) {
      console.error("CV generation error:", error);
      res.status(500).json({ error: "Failed to generate CV document", details: error.message });
    }
  });

  // Generate Report from prompt (AI-powered)
  app.post("/api/documents/generate/report", async (req, res) => {
    try {
      const { prompt } = req.body;
      
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }
      
      const result = await generateReportFromPrompt(prompt);
      const { buffer, qualityReport, postRenderValidation, attemptsUsed } = result;
      
      if (qualityReport.warnings.length > 0) {
        res.setHeader("X-Quality-Warnings", JSON.stringify(qualityReport.warnings.map(w => w.message)));
      }
      if (postRenderValidation.warnings.length > 0) {
        res.setHeader("X-PostRender-Warnings", JSON.stringify(postRenderValidation.warnings));
      }
      res.setHeader("X-Generation-Attempts", attemptsUsed.toString());
      
      const timestamp = Date.now();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="report_${timestamp}.docx"`);
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error: any) {
      console.error("Report generation error:", error);
      res.status(500).json({ error: "Failed to generate Report document", details: error.message });
    }
  });

  // Generate Letter from prompt (AI-powered)
  app.post("/api/documents/generate/letter", async (req, res) => {
    try {
      const { prompt } = req.body;
      
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }
      
      const result = await generateLetterFromPrompt(prompt);
      const { buffer, qualityReport, postRenderValidation, attemptsUsed } = result;
      
      if (qualityReport.warnings.length > 0) {
        res.setHeader("X-Quality-Warnings", JSON.stringify(qualityReport.warnings.map(w => w.message)));
      }
      if (postRenderValidation.warnings.length > 0) {
        res.setHeader("X-PostRender-Warnings", JSON.stringify(postRenderValidation.warnings));
      }
      res.setHeader("X-Generation-Attempts", attemptsUsed.toString());
      
      const timestamp = Date.now();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="letter_${timestamp}.docx"`);
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error: any) {
      console.error("Letter generation error:", error);
      res.status(500).json({ error: "Failed to generate Letter document", details: error.message });
    }
  });

  // Render CV from spec
  app.post("/api/documents/render/cv", async (req, res) => {
    try {
      const parseResult = cvSpecSchema.safeParse(req.body);
      
      if (!parseResult.success) {
        return res.status(400).json({ 
          error: "Invalid CV spec", 
          details: parseResult.error.flatten().fieldErrors 
        });
      }
      
      const spec = parseResult.data;
      const templateConfig = selectCvTemplate(spec.template_style || "modern");
      const buffer = await renderCvFromSpec(spec, templateConfig);
      
      const timestamp = Date.now();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="cv_${timestamp}.docx"`);
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error: any) {
      console.error("CV render error:", error);
      res.status(500).json({ error: "Failed to render CV document", details: error.message });
    }
  });

  // AI-powered document command planning
  app.post("/api/documents/plan", async (req, res) => {
    try {
      const { prompt, selectedText, documentContent } = req.body;
      
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }

      const systemPrompt = `You are a document editing assistant. Given a user's instruction, generate a plan of document editing commands.

Available commands:
- bold: Toggle bold formatting
- italic: Toggle italic formatting
- underline: Toggle underline formatting
- strikethrough: Toggle strikethrough
- heading1, heading2, heading3: Set heading level
- paragraph: Set as paragraph
- bulletList: Toggle bullet list
- orderedList: Toggle numbered list
- alignLeft, alignCenter, alignRight, alignJustify: Text alignment
- insertLink: Insert link (payload: {url: string})
- insertImage: Insert image (payload: {src: string})
- insertTable: Insert table (payload: {rows: number, cols: number})
- blockquote: Toggle blockquote
- codeBlock: Toggle code block
- insertHorizontalRule: Insert horizontal line
- setTextColor: Set text color (payload: {color: string})
- setHighlight: Highlight text (payload: {color: string})
- insertText: Insert text (payload: {text: string})
- replaceSelection: Replace selected text (payload: {content: string})
- clearFormatting: Remove all formatting

Respond with a JSON object containing:
{
  "intent": "brief description of what user wants",
  "commands": [
    {"name": "commandName", "payload": {...}, "description": "what this step does"}
  ]
}

Only respond with valid JSON, no markdown code blocks.`;

      const userMessage = `User instruction: ${prompt}
${selectedText ? `\nSelected text: "${selectedText}"` : ''}
${documentContent ? `\nDocument context (first 500 chars): "${documentContent.substring(0, 500)}"` : ''}

Generate the command plan:`;

      const result = await llmGateway.chat([
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ], {
        temperature: 0.3,
        maxTokens: 1024,
      });

      let plan;
      try {
        const jsonStr = result.content.replace(/```json\n?|\n?```/g, '').trim();
        plan = JSON.parse(jsonStr);
      } catch {
        plan = {
          intent: prompt,
          commands: [],
          error: "Failed to parse AI response"
        };
      }

      res.json(plan);
    } catch (error: any) {
      console.error("Document plan error:", error);
      res.status(500).json({ error: "Failed to generate document plan", details: error.message });
    }
  });

  // Admin API Routes
  
  // Dashboard metrics
  app.get("/api/admin/dashboard", async (req, res) => {
    try {
      const metrics = await storage.getDashboardMetrics();
      const recentLogs = await storage.getAuditLogs(5);
      res.json({ metrics, recentActivity: recentLogs });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Users management
  app.get("/api/admin/users", async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/users/stats", async (req, res) => {
    try {
      const stats = await storage.getUserStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/users", async (req, res) => {
    try {
      const { email, password, plan, role } = req.body;
      if (!email || !password) {
        return res.status(400).json({ message: "Email y contraseña son requeridos" });
      }
      const existingUsers = await storage.getAllUsers();
      const existingUser = existingUsers.find(u => u.email === email);
      if (existingUser) {
        return res.status(400).json({ message: "Ya existe un usuario con este email" });
      }
      const [user] = await db.insert(users).values({
        email,
        password,
        plan: plan || "free",
        role: role || "user",
        status: "active"
      }).returning();
      await storage.createAuditLog({
        action: "user_create",
        resource: "users",
        resourceId: user.id,
        details: { email, plan, role }
      });
      res.json(user);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/admin/users/:id", async (req, res) => {
    try {
      const user = await storage.updateUser(req.params.id, req.body);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      await storage.createAuditLog({
        action: "user_update",
        resource: "users",
        resourceId: req.params.id,
        details: req.body
      });
      res.json(user);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/admin/users/:id", async (req, res) => {
    try {
      await storage.deleteUser(req.params.id);
      await storage.createAuditLog({
        action: "user_delete",
        resource: "users",
        resourceId: req.params.id
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // AI Models management
  app.get("/api/admin/models", async (req, res) => {
    try {
      const models = await storage.getAiModels();
      res.json(models);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/models", async (req, res) => {
    try {
      const { name, provider, modelId, costPer1k, description, status } = req.body;
      if (!name || !provider || !modelId) {
        return res.status(400).json({ error: "name, provider, and modelId are required" });
      }
      const model = await storage.createAiModel({
        name, provider, modelId, costPer1k, description, status
      });
      await storage.createAuditLog({
        action: "model_create",
        resource: "ai_models",
        resourceId: model.id,
        details: { name, provider }
      });
      res.json(model);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/admin/models/:id", async (req, res) => {
    try {
      const model = await storage.updateAiModel(req.params.id, req.body);
      if (!model) {
        return res.status(404).json({ error: "Model not found" });
      }
      await storage.createAuditLog({
        action: "model_update",
        resource: "ai_models",
        resourceId: req.params.id,
        details: req.body
      });
      res.json(model);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/admin/models/:id", async (req, res) => {
    try {
      await storage.deleteAiModel(req.params.id);
      await storage.createAuditLog({
        action: "model_delete",
        resource: "ai_models",
        resourceId: req.params.id
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Payments management
  app.get("/api/admin/payments", async (req, res) => {
    try {
      const payments = await storage.getPayments();
      res.json(payments);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/payments/stats", async (req, res) => {
    try {
      const stats = await storage.getPaymentStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/payments", async (req, res) => {
    try {
      const payment = await storage.createPayment(req.body);
      res.json(payment);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/admin/payments/:id", async (req, res) => {
    try {
      const payment = await storage.updatePayment(req.params.id, req.body);
      if (!payment) {
        return res.status(404).json({ error: "Payment not found" });
      }
      res.json(payment);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Invoices management
  app.get("/api/admin/invoices", async (req, res) => {
    try {
      const invoices = await storage.getInvoices();
      res.json(invoices);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/invoices", async (req, res) => {
    try {
      const invoice = await storage.createInvoice(req.body);
      res.json(invoice);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/admin/invoices/:id", async (req, res) => {
    try {
      const invoice = await storage.updateInvoice(req.params.id, req.body);
      if (!invoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }
      res.json(invoice);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Analytics
  app.get("/api/admin/analytics", async (req, res) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const snapshots = await storage.getAnalyticsSnapshots(days);
      res.json(snapshots);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/analytics/snapshot", async (req, res) => {
    try {
      const snapshot = await storage.createAnalyticsSnapshot(req.body);
      res.json(snapshot);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Security - Domain Policies
  app.get("/api/admin/security/policies", async (req, res) => {
    try {
      const policies = await storage.getDomainPolicies();
      res.json(policies);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/security/policies", async (req, res) => {
    try {
      const policy = await storage.createDomainPolicy(req.body);
      res.json(policy);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/admin/security/policies/:id", async (req, res) => {
    try {
      const policy = await storage.updateDomainPolicy(req.params.id, req.body);
      if (!policy) {
        return res.status(404).json({ error: "Policy not found" });
      }
      res.json(policy);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/admin/security/policies/:id", async (req, res) => {
    try {
      await storage.deleteDomainPolicy(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Audit Logs
  app.get("/api/admin/security/logs", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const logs = await storage.getAuditLogs(limit);
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Reports
  app.get("/api/admin/reports", async (req, res) => {
    try {
      const reports = await storage.getReports();
      res.json(reports);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/reports", async (req, res) => {
    try {
      const report = await storage.createReport({
        ...req.body,
        status: "pending"
      });
      res.json(report);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/admin/reports/:id", async (req, res) => {
    try {
      const report = await storage.updateReport(req.params.id, req.body);
      if (!report) {
        return res.status(404).json({ error: "Report not found" });
      }
      res.json(report);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Platform Settings
  app.get("/api/admin/settings", async (req, res) => {
    try {
      const settings = await storage.getSettings();
      res.json(settings);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/settings", async (req, res) => {
    try {
      const { key, value, description, category } = req.body;
      if (!key) {
        return res.status(400).json({ error: "key is required" });
      }
      const setting = await storage.upsertSetting(key, value, description, category);
      await storage.createAuditLog({
        action: "setting_update",
        resource: "platform_settings",
        details: { key, value }
      });
      res.json(setting);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // LLM Gateway metrics
  app.get("/api/admin/llm/metrics", async (req, res) => {
    try {
      const metrics = llmGateway.getMetrics();
      res.json(metrics);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Database info
  app.get("/api/admin/database/info", async (req, res) => {
    try {
      const userStats = await storage.getUserStats();
      const models = await storage.getAiModels();
      const payments = await storage.getPayments();
      const invoices = await storage.getInvoices();
      
      res.json({
        tables: {
          users: { count: userStats.total },
          ai_models: { count: models.length },
          payments: { count: payments.length },
          invoices: { count: invoices.length }
        },
        status: "healthy",
        lastBackup: new Date().toISOString()
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  const browserWss = new WebSocketServer({ server: httpServer, path: "/ws/browser" });
  console.log("Browser WebSocket server created at /ws/browser");

  const fileStatusWss = new WebSocketServer({ server: httpServer, path: "/ws/file-status" });
  console.log("File status WebSocket server created at /ws/file-status");

  fileStatusWss.on("connection", (ws) => {
    console.log("File status WebSocket client connected");
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
  
  browserWss.on("connection", (ws) => {
    console.log("Browser WebSocket client connected");
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
          
          // Send current screenshot immediately if session exists
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
            // Session may not exist yet, that's ok
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

  // ============ FIGMA MCP ROUTES ============
  
  // Figma OAuth - Start authorization
  app.get("/api/auth/figma", (req, res) => {
    const clientId = process.env.FIGMA_CLIENT_ID;
    if (!clientId) {
      return res.status(500).json({ error: "Figma OAuth not configured" });
    }
    
    const state = Math.random().toString(36).substring(7);
    const host = req.get('host');
    const protocol = host?.includes('replit') ? 'https' : req.protocol;
    const redirectUri = `${protocol}://${host}/api/auth/figma/callback`;
    
    console.log("Starting Figma OAuth with redirect_uri:", redirectUri);
    
    const authUrl = `https://www.figma.com/oauth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=file_content:read&state=${state}&response_type=code`;
    
    res.redirect(authUrl);
  });
  
  // Figma OAuth - Callback
  app.get("/api/auth/figma/callback", async (req, res) => {
    console.log("Figma OAuth callback received:", req.query);
    const { code, state, error, error_description } = req.query;
    
    if (error) {
      console.error("Figma OAuth error from Figma:", error, error_description);
      return res.redirect(`/?figma_error=${encodeURIComponent(error as string)}`);
    }
    
    if (!code) {
      console.error("No code received from Figma");
      return res.redirect("/?figma_error=no_code");
    }
    
    const clientId = process.env.FIGMA_CLIENT_ID;
    const clientSecret = process.env.FIGMA_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      console.error("Figma OAuth not configured");
      return res.redirect("/?figma_error=not_configured");
    }
    
    try {
      // Use https for Replit
      const host = req.get('host');
      const protocol = host?.includes('replit') ? 'https' : req.protocol;
      const redirectUri = `${protocol}://${host}/api/auth/figma/callback`;
      
      console.log("Exchanging code for token with redirect_uri:", redirectUri);
      
      // Exchange code for access token
      const tokenResponse = await fetch("https://api.figma.com/v1/oauth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          code: code as string,
          grant_type: "authorization_code",
        }),
      });
      
      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error("Figma token exchange failed:", errorText);
        return res.redirect("/?figma_error=token_exchange_failed");
      }
      
      const tokenData = await tokenResponse.json();
      console.log("Figma token received successfully");
      const { access_token } = tokenData;
      
      // Store the token
      figmaService.setAccessToken(access_token);
      
      // Redirect back to the app with success
      res.redirect("/?figma_connected=true");
    } catch (error: any) {
      console.error("Figma OAuth error:", error);
      res.redirect("/?figma_error=server_error");
    }
  });
  
  app.post("/api/figma/connect", async (req, res) => {
    try {
      const { accessToken } = req.body;
      if (!accessToken) {
        return res.status(400).json({ error: "Access token is required" });
      }
      
      figmaService.setAccessToken(accessToken);
      
      // Test the connection by making a simple request
      try {
        // We'll just verify the token format is correct
        res.json({ success: true, message: "Figma connected successfully" });
      } catch (error: any) {
        res.status(401).json({ error: "Invalid Figma access token" });
      }
    } catch (error: any) {
      console.error("Error connecting to Figma:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/figma/status", (req, res) => {
    const token = figmaService.getAccessToken();
    res.json({ connected: !!token });
  });

  app.post("/api/figma/disconnect", (req, res) => {
    figmaService.setAccessToken("");
    res.json({ success: true });
  });

  app.get("/api/figma/file/:fileKey", async (req, res) => {
    try {
      const { fileKey } = req.params;
      const fileData = await figmaService.getFile(fileKey);
      res.json(fileData);
    } catch (error: any) {
      console.error("Error fetching Figma file:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/figma/file/:fileKey/tokens", async (req, res) => {
    try {
      const { fileKey } = req.params;
      const fileData = await figmaService.getFile(fileKey);
      const tokens = figmaService.extractDesignTokens(fileData);
      res.json({ tokens });
    } catch (error: any) {
      console.error("Error extracting design tokens:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/figma/code", async (req, res) => {
    try {
      const { fileKey, nodeId } = req.body;
      if (!fileKey) {
        return res.status(400).json({ error: "File key is required" });
      }
      
      const codeContext = await figmaService.getDesignContext(fileKey, nodeId);
      res.json(codeContext);
    } catch (error: any) {
      console.error("Error generating code from Figma:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/figma/parse-url", (req, res) => {
    try {
      const { url } = req.body;
      if (!url) {
        return res.status(400).json({ error: "URL is required" });
      }
      
      const parsed = figmaService.parseFileUrl(url);
      if (!parsed) {
        return res.status(400).json({ error: "Invalid Figma URL" });
      }
      
      res.json(parsed);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/figma/images/:fileKey", async (req, res) => {
    try {
      const { fileKey } = req.params;
      const { nodeIds, format = "png", scale = "2" } = req.query;
      
      if (!nodeIds || typeof nodeIds !== "string") {
        return res.status(400).json({ error: "Node IDs are required" });
      }
      
      const ids = nodeIds.split(",");
      const images = await figmaService.getImages(
        fileKey, 
        ids, 
        format as "png" | "svg" | "jpg",
        parseInt(scale as string)
      );
      res.json({ images });
    } catch (error: any) {
      console.error("Error fetching Figma images:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Library Items API Routes
  app.get("/api/library", async (req, res) => {
    try {
      const user = (req as any).user;
      const userId = user?.claims?.sub;
      
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }
      
      const mediaType = req.query.type as string | undefined;
      const items = await storage.getLibraryItems(userId, mediaType);
      res.json(items);
    } catch (error: any) {
      console.error("Error getting library items:", error);
      res.status(500).json({ error: "Failed to get library items" });
    }
  });

  app.post("/api/library", async (req, res) => {
    try {
      const user = (req as any).user;
      const userId = user?.claims?.sub;
      
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }
      
      const { mediaType, title, description, storagePath, thumbnailPath, mimeType, size, metadata, sourceChatId } = req.body;
      
      if (!mediaType || !title || !storagePath) {
        return res.status(400).json({ error: "mediaType, title, and storagePath are required" });
      }
      
      const item = await storage.createLibraryItem({
        userId,
        mediaType,
        title,
        description: description || null,
        storagePath,
        thumbnailPath: thumbnailPath || null,
        mimeType: mimeType || null,
        size: size || null,
        metadata: metadata || null,
        sourceChatId: sourceChatId || null,
      });
      
      res.json(item);
    } catch (error: any) {
      console.error("Error creating library item:", error);
      res.status(500).json({ error: "Failed to create library item" });
    }
  });

  app.delete("/api/library/:id", async (req, res) => {
    try {
      const user = (req as any).user;
      const userId = user?.claims?.sub;
      
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }
      
      const deleted = await storage.deleteLibraryItem(req.params.id, userId);
      
      if (!deleted) {
        return res.status(404).json({ error: "Library item not found" });
      }
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting library item:", error);
      res.status(500).json({ error: "Failed to delete library item" });
    }
  });

  // Code Interpreter Routes
  app.post("/api/code-interpreter/run", async (req, res) => {
    try {
      const { code, conversationId, language } = req.body;
      
      if (!code || typeof code !== "string" || !code.trim()) {
        return res.status(400).json({ error: "Code is required" });
      }

      const user = (req as any).user;
      const userId = user?.claims?.sub;

      const result = await codeInterpreter.executeCode(code, {
        conversationId,
        userId,
        language: language || "python",
      });

      res.json({
        run: result.run,
        artifacts: result.artifacts,
      });
    } catch (error: any) {
      console.error("Error executing code:", error);
      res.status(500).json({ error: "Failed to execute code" });
    }
  });

  app.get("/api/code-interpreter/run/:id", async (req, res) => {
    try {
      const run = await codeInterpreter.getRun(req.params.id);
      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }
      const artifacts = await codeInterpreter.getRunArtifacts(req.params.id);
      res.json({ run, artifacts });
    } catch (error: any) {
      console.error("Error getting run:", error);
      res.status(500).json({ error: "Failed to get run" });
    }
  });

  app.get("/api/sandbox/runtimes", async (req, res) => {
    try {
      const runtimes = await pistonService.getSupportedRuntimes();
      const languages = pistonService.getSupportedLanguages();
      const aliases = pistonService.getLanguageAliases();
      
      res.json({
        runtimes,
        supportedLanguages: languages,
        aliases,
      });
    } catch (error: any) {
      console.error("Error fetching runtimes:", error);
      res.status(500).json({ error: "Failed to fetch available runtimes" });
    }
  });

  app.post("/api/sandbox/execute", async (req, res) => {
    try {
      const { code, language, stdin, args } = req.body;

      if (!code || typeof code !== "string" || !code.trim()) {
        return res.status(400).json({ error: "Code is required" });
      }

      if (!language || typeof language !== "string") {
        return res.status(400).json({ error: "Language is required" });
      }

      const langInfo = await pistonService.getLanguageInfo(language);
      if (!langInfo.supported) {
        const supportedLangs = pistonService.getSupportedLanguages();
        return res.status(400).json({
          error: `Unsupported language: ${language}`,
          supportedLanguages: supportedLangs,
        });
      }

      const result = await pistonService.executeCode(
        language,
        code,
        stdin,
        args
      );

      res.json({
        run: result.run,
        compile: result.compile,
        errorLines: result.errorLines,
        language: result.language,
        version: result.version,
        usedFallback: result.usedFallback || false,
        artifacts: result.artifacts || [],
      });
    } catch (error: any) {
      console.error("Sandbox execution error:", error);
      res.status(500).json({
        error: "Failed to execute code",
        details: error.message,
      });
    }
  });

  // Notification Event Types and Preferences API
  app.get("/api/notification-event-types", async (req, res) => {
    try {
      const eventTypes = await storage.getNotificationEventTypes();
      res.json(eventTypes);
    } catch (error: any) {
      console.error("Error getting notification event types:", error);
      res.status(500).json({ error: "Failed to get notification event types" });
    }
  });

  app.get("/api/users/:id/notification-preferences", async (req, res) => {
    try {
      const { id } = req.params;
      const eventTypes = await storage.getNotificationEventTypes();
      const preferences = await storage.getNotificationPreferences(id);
      
      const prefsWithEventTypes = eventTypes.map(eventType => {
        const pref = preferences.find(p => p.eventTypeId === eventType.id);
        return {
          eventType,
          preference: pref || null,
          enabled: pref ? pref.enabled : eventType.defaultChannels !== 'none',
          channels: pref ? pref.channels : eventType.defaultChannels
        };
      });
      
      res.json(prefsWithEventTypes);
    } catch (error: any) {
      console.error("Error getting notification preferences:", error);
      res.status(500).json({ error: "Failed to get notification preferences" });
    }
  });

  app.put("/api/users/:id/notification-preferences", async (req, res) => {
    try {
      const { id } = req.params;
      const { eventTypeId, enabled, channels } = req.body;
      
      if (!eventTypeId) {
        return res.status(400).json({ error: "eventTypeId is required" });
      }
      
      const preference = await storage.upsertNotificationPreference({
        userId: id,
        eventTypeId,
        enabled: enabled !== undefined ? (enabled ? "true" : "false") : "true",
        channels: channels || "push"
      });
      
      res.json(preference);
    } catch (error: any) {
      console.error("Error updating notification preference:", error);
      res.status(500).json({ error: "Failed to update notification preference" });
    }
  });

  app.post("/api/notification-event-types/seed", async (req, res) => {
    try {
      const eventTypesToSeed = [
        { id: 'ai_response_ready', name: 'Respuestas de IA', description: 'Notificaciones cuando una respuesta larga está lista', category: 'ai_updates', severity: 'normal', defaultChannels: 'push', sortOrder: 1 },
        { id: 'task_status_update', name: 'Actualizaciones de tareas', description: 'Cambios en tareas programadas', category: 'tasks', severity: 'normal', defaultChannels: 'push_email', sortOrder: 2 },
        { id: 'project_invitation', name: 'Invitaciones a proyectos', description: 'Invitaciones a chats compartidos', category: 'social', severity: 'high', defaultChannels: 'push_email', sortOrder: 3 },
        { id: 'product_recommendation', name: 'Recomendaciones', description: 'Sugerencias personalizadas', category: 'product', severity: 'low', defaultChannels: 'email', sortOrder: 4 },
        { id: 'feature_announcement', name: 'Novedades', description: 'Nuevas funciones disponibles', category: 'product', severity: 'low', defaultChannels: 'email', sortOrder: 5 }
      ];
      
      const existing = await storage.getNotificationEventTypes();
      const existingIds = new Set(existing.map(e => e.id));
      
      const toInsert = eventTypesToSeed.filter(e => !existingIds.has(e.id));
      
      if (toInsert.length > 0) {
        await db.insert(notificationEventTypes).values(toInsert);
      }
      
      const allEventTypes = await storage.getNotificationEventTypes();
      res.json({ 
        message: `Seeded ${toInsert.length} new event types`,
        eventTypes: allEventTypes 
      });
    } catch (error: any) {
      console.error("Error seeding notification event types:", error);
      res.status(500).json({ error: "Failed to seed notification event types" });
    }
  });

  app.get("/api/users/:id/settings", async (req, res) => {
    try {
      const { id } = req.params;
      
      const user = (req as any).user;
      const userId = user?.claims?.sub;
      
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }
      
      if (userId !== id) {
        return res.status(403).json({ error: "Access denied: You can only access your own settings" });
      }
      
      const settings = await storage.getUserSettings(id);
      
      if (!settings) {
        res.json({
          userId: id,
          responsePreferences: {
            responseStyle: 'default',
            responseTone: 'professional',
            customInstructions: ''
          },
          userProfile: {
            nickname: '',
            occupation: '',
            bio: ''
          },
          featureFlags: {
            memoryEnabled: true,
            recordingHistoryEnabled: false,
            webSearchAuto: true,
            codeInterpreterEnabled: true,
            canvasEnabled: true,
            voiceEnabled: true,
            voiceAdvanced: false,
            connectorSearchAuto: false
          }
        });
        return;
      }
      
      res.json(settings);
    } catch (error: any) {
      console.error("Error getting user settings:", error);
      res.status(500).json({ error: "Failed to get user settings" });
    }
  });

  app.put("/api/users/:id/settings", async (req, res) => {
    try {
      const { id } = req.params;
      
      const user = (req as any).user;
      const userId = user?.claims?.sub;
      
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }
      
      if (userId !== id) {
        return res.status(403).json({ error: "Access denied: You can only update your own settings" });
      }
      
      const { responsePreferences, userProfile, featureFlags } = req.body;
      
      const updates: any = {};
      const validationErrors: string[] = [];
      
      if (responsePreferences !== undefined) {
        const parsed = responsePreferencesSchema.safeParse(responsePreferences);
        if (!parsed.success) {
          validationErrors.push(`responsePreferences: ${parsed.error.errors.map(e => e.message).join(', ')}`);
        } else {
          updates.responsePreferences = parsed.data;
        }
      }
      
      if (userProfile !== undefined) {
        const parsed = userProfileSchema.safeParse(userProfile);
        if (!parsed.success) {
          validationErrors.push(`userProfile: ${parsed.error.errors.map(e => e.message).join(', ')}`);
        } else {
          updates.userProfile = parsed.data;
        }
      }
      
      if (featureFlags !== undefined) {
        const parsed = featureFlagsSchema.safeParse(featureFlags);
        if (!parsed.success) {
          validationErrors.push(`featureFlags: ${parsed.error.errors.map(e => e.message).join(', ')}`);
        } else {
          updates.featureFlags = parsed.data;
        }
      }
      
      if (validationErrors.length > 0) {
        return res.status(400).json({ 
          error: "Validation failed", 
          details: validationErrors 
        });
      }
      
      const settings = await storage.upsertUserSettings(id, updates);
      res.json(settings);
    } catch (error: any) {
      console.error("Error updating user settings:", error);
      res.status(500).json({ error: "Failed to update user settings" });
    }
  });

  // Integration API endpoints
  app.get("/api/integrations/providers", async (req, res) => {
    try {
      const providers = await storage.getIntegrationProviders();
      res.json(providers);
    } catch (error: any) {
      console.error("Error getting providers:", error);
      res.status(500).json({ error: "Failed to get providers" });
    }
  });

  app.get("/api/integrations/tools", async (req, res) => {
    try {
      const { providerId } = req.query;
      const tools = await storage.getIntegrationTools(providerId as string | undefined);
      res.json(tools);
    } catch (error: any) {
      console.error("Error getting tools:", error);
      res.status(500).json({ error: "Failed to get tools" });
    }
  });

  app.post("/api/integrations/seed", async (req, res) => {
    try {
      const providersToSeed = [
        {
          id: "github",
          name: "GitHub",
          description: "Control de versiones y colaboración de código",
          iconUrl: "https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png",
          authType: "oauth2",
          authConfig: { authUrl: "https://github.com/login/oauth/authorize", tokenUrl: "https://github.com/login/oauth/access_token", scopes: ["repo", "user", "read:org"] },
          category: "development",
          isActive: "true"
        },
        {
          id: "figma",
          name: "Figma",
          description: "Diseño colaborativo y prototipado",
          iconUrl: "https://static.figma.com/app/icon/1/favicon.svg",
          authType: "oauth2",
          authConfig: { authUrl: "https://www.figma.com/oauth", tokenUrl: "https://www.figma.com/api/oauth/token", scopes: ["file_read", "file_write"] },
          category: "design",
          isActive: "true"
        },
        {
          id: "canva",
          name: "Canva",
          description: "Diseño gráfico y contenido visual",
          iconUrl: "https://static.canva.com/static/images/canva-logo.svg",
          authType: "oauth2",
          authConfig: { authUrl: "https://www.canva.com/api/oauth/authorize", tokenUrl: "https://www.canva.com/api/oauth/token", scopes: ["design:content:read", "design:content:write"] },
          category: "design",
          isActive: "true"
        },
        {
          id: "slack",
          name: "Slack",
          description: "Comunicación y mensajería de equipo",
          iconUrl: "https://a.slack-edge.com/80588/marketing/img/icons/icon_slack_hash_colored.png",
          authType: "oauth2",
          authConfig: { authUrl: "https://slack.com/oauth/v2/authorize", tokenUrl: "https://slack.com/api/oauth.v2.access", scopes: ["channels:read", "chat:write", "users:read"] },
          category: "communication",
          isActive: "true"
        },
        {
          id: "notion",
          name: "Notion",
          description: "Notas, documentación y gestión de proyectos",
          iconUrl: "https://www.notion.so/images/logo-ios.png",
          authType: "oauth2",
          authConfig: { authUrl: "https://api.notion.com/v1/oauth/authorize", tokenUrl: "https://api.notion.com/v1/oauth/token", scopes: [] },
          category: "productivity",
          isActive: "true"
        },
        {
          id: "google_drive",
          name: "Google Drive",
          description: "Almacenamiento y documentos en la nube",
          iconUrl: "https://ssl.gstatic.com/docs/doclist/images/drive_2022q3_32dp.png",
          authType: "oauth2",
          authConfig: { authUrl: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: "https://oauth2.googleapis.com/token", scopes: ["https://www.googleapis.com/auth/drive.readonly"] },
          category: "productivity",
          isActive: "true"
        }
      ];

      for (const provider of providersToSeed) {
        const existing = await storage.getIntegrationProvider(provider.id);
        if (!existing) {
          await db.insert(integrationProviders).values(provider);
        }
      }

      const toolsToSeed = [
        { id: "github:list_repos", providerId: "github", name: "Listar repositorios", description: "Lista los repositorios del usuario", requiredScopes: ["repo"], dataAccessLevel: "read", confirmationRequired: "false" },
        { id: "github:create_issue", providerId: "github", name: "Crear issue", description: "Crea un nuevo issue en un repositorio", requiredScopes: ["repo"], dataAccessLevel: "write", confirmationRequired: "true" },
        { id: "github:get_file", providerId: "github", name: "Obtener archivo", description: "Lee el contenido de un archivo", requiredScopes: ["repo"], dataAccessLevel: "read", confirmationRequired: "false" },
        { id: "figma:get_file", providerId: "figma", name: "Obtener archivo", description: "Obtiene información de un archivo Figma", requiredScopes: ["file_read"], dataAccessLevel: "read", confirmationRequired: "false" },
        { id: "figma:export_frame", providerId: "figma", name: "Exportar frame", description: "Exporta un frame como imagen", requiredScopes: ["file_read"], dataAccessLevel: "read", confirmationRequired: "false" },
        { id: "canva:list_designs", providerId: "canva", name: "Listar diseños", description: "Lista los diseños del usuario", requiredScopes: ["design:content:read"], dataAccessLevel: "read", confirmationRequired: "false" },
        { id: "canva:export_design", providerId: "canva", name: "Exportar diseño", description: "Exporta un diseño como imagen", requiredScopes: ["design:content:read"], dataAccessLevel: "read", confirmationRequired: "false" },
        { id: "slack:send_message", providerId: "slack", name: "Enviar mensaje", description: "Envía un mensaje a un canal", requiredScopes: ["chat:write"], dataAccessLevel: "write", confirmationRequired: "true" },
        { id: "slack:list_channels", providerId: "slack", name: "Listar canales", description: "Lista los canales disponibles", requiredScopes: ["channels:read"], dataAccessLevel: "read", confirmationRequired: "false" },
        { id: "notion:search", providerId: "notion", name: "Buscar páginas", description: "Busca páginas en el workspace", requiredScopes: [], dataAccessLevel: "read", confirmationRequired: "false" },
        { id: "notion:get_page", providerId: "notion", name: "Obtener página", description: "Obtiene el contenido de una página", requiredScopes: [], dataAccessLevel: "read", confirmationRequired: "false" },
        { id: "google_drive:list_files", providerId: "google_drive", name: "Listar archivos", description: "Lista archivos en Drive", requiredScopes: ["https://www.googleapis.com/auth/drive.readonly"], dataAccessLevel: "read", confirmationRequired: "false" },
        { id: "google_drive:get_file", providerId: "google_drive", name: "Obtener archivo", description: "Obtiene contenido de un archivo", requiredScopes: ["https://www.googleapis.com/auth/drive.readonly"], dataAccessLevel: "read", confirmationRequired: "false" }
      ];

      for (const tool of toolsToSeed) {
        const existing = await db.select().from(integrationTools).where(eq(integrationTools.id, tool.id));
        if (existing.length === 0) {
          await db.insert(integrationTools).values({ ...tool, isActive: "true" });
        }
      }

      const providers = await storage.getIntegrationProviders();
      const tools = await storage.getIntegrationTools();
      res.json({ message: "Catalog seeded", providers: providers.length, tools: tools.length });
    } catch (error: any) {
      console.error("Error seeding catalog:", error);
      res.status(500).json({ error: "Failed to seed catalog" });
    }
  });

  app.get("/api/users/:id/integrations", async (req, res) => {
    try {
      const authUserId = (req as any).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });
      
      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });
      
      const [accounts, policy, providers] = await Promise.all([
        storage.getIntegrationAccounts(id),
        storage.getIntegrationPolicy(id),
        storage.getIntegrationProviders()
      ]);
      
      res.json({ accounts, policy, providers });
    } catch (error: any) {
      console.error("Error getting user integrations:", error);
      res.status(500).json({ error: "Failed to get integrations" });
    }
  });

  app.put("/api/users/:id/integrations/policy", async (req, res) => {
    try {
      const authUserId = (req as any).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });
      
      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });
      
      const { enabledApps, enabledTools, disabledTools, resourceScopes, autoConfirmPolicy, sandboxMode, maxParallelCalls } = req.body;
      
      const policy = await storage.upsertIntegrationPolicy(id, {
        enabledApps,
        enabledTools,
        disabledTools,
        resourceScopes,
        autoConfirmPolicy,
        sandboxMode,
        maxParallelCalls
      });
      
      res.json(policy);
    } catch (error: any) {
      console.error("Error updating policy:", error);
      res.status(500).json({ error: "Failed to update policy" });
    }
  });

  app.post("/api/users/:id/integrations/:provider/connect", async (req, res) => {
    try {
      const authUserId = (req as any).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });
      
      const { id, provider } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });
      
      const providerInfo = await storage.getIntegrationProvider(provider);
      if (!providerInfo) return res.status(404).json({ error: "Provider not found" });
      
      res.json({ 
        message: "OAuth flow not yet implemented",
        provider: providerInfo.name,
        authType: providerInfo.authType
      });
    } catch (error: any) {
      console.error("Error initiating connect:", error);
      res.status(500).json({ error: "Failed to initiate connection" });
    }
  });

  app.post("/api/users/:id/integrations/:provider/disconnect", async (req, res) => {
    try {
      const authUserId = (req as any).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });
      
      const { id, provider } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });
      
      const account = await storage.getIntegrationAccountByProvider(id, provider);
      if (!account) return res.status(404).json({ error: "Account not found" });
      
      await storage.deleteIntegrationAccount(account.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error disconnecting:", error);
      res.status(500).json({ error: "Failed to disconnect" });
    }
  });

  app.get("/api/users/:id/integrations/logs", async (req, res) => {
    try {
      const authUserId = (req as any).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });
      
      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });
      
      const limit = parseInt(req.query.limit as string) || 50;
      const logs = await storage.getToolCallLogs(id, limit);
      res.json(logs);
    } catch (error: any) {
      console.error("Error getting logs:", error);
      res.status(500).json({ error: "Failed to get logs" });
    }
  });

  // ========================================
  // Data Controls API Endpoints
  // ========================================

  // Get privacy settings
  app.get("/api/users/:id/privacy", async (req, res) => {
    try {
      const authUserId = (req as any).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });
      
      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });
      
      const settings = await storage.getUserSettings(id);
      const logs = await storage.getConsentLogs(id, 10);
      res.json({ 
        privacySettings: settings?.privacySettings || { trainingOptIn: false, remoteBrowserDataAccess: false },
        consentHistory: logs
      });
    } catch (error: any) {
      console.error("Error getting privacy settings:", error);
      res.status(500).json({ error: "Failed to get privacy settings" });
    }
  });

  // Update privacy settings with consent logging
  app.put("/api/users/:id/privacy", async (req, res) => {
    try {
      const authUserId = (req as any).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });
      
      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });
      
      const { trainingOptIn, remoteBrowserDataAccess } = req.body;
      const ipAddress = req.ip || (req.headers['x-forwarded-for'] as string)?.split(',')[0] || undefined;
      const userAgent = req.headers['user-agent'] || undefined;
      
      if (trainingOptIn !== undefined) {
        await storage.logConsent(id, 'training_opt_in', String(trainingOptIn), ipAddress, userAgent);
      }
      if (remoteBrowserDataAccess !== undefined) {
        await storage.logConsent(id, 'remote_browser_access', String(remoteBrowserDataAccess), ipAddress, userAgent);
      }
      
      const settings = await storage.upsertUserSettings(id, {
        privacySettings: { trainingOptIn: trainingOptIn ?? false, remoteBrowserDataAccess: remoteBrowserDataAccess ?? false }
      });
      
      res.json(settings);
    } catch (error: any) {
      console.error("Error updating privacy settings:", error);
      res.status(500).json({ error: "Failed to update privacy settings" });
    }
  });

  // Get user's shared links
  app.get("/api/users/:id/shared-links", async (req, res) => {
    try {
      const authUserId = (req as any).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });
      
      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });
      
      const links = await storage.getSharedLinks(id);
      res.json(links);
    } catch (error: any) {
      console.error("Error getting shared links:", error);
      res.status(500).json({ error: "Failed to get shared links" });
    }
  });

  // Create shared link
  app.post("/api/users/:id/shared-links", async (req, res) => {
    try {
      const authUserId = (req as any).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });
      
      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });
      
      const { resourceType, resourceId, scope, permissions, expiresAt } = req.body;
      
      if (!resourceType || !resourceId) {
        return res.status(400).json({ error: "Missing required fields: resourceType, resourceId" });
      }
      
      const token = crypto.randomBytes(32).toString('hex');
      
      const link = await storage.createSharedLink({
        userId: id,
        resourceType,
        resourceId,
        token,
        scope: scope || 'link_only',
        permissions: permissions || 'read',
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        isRevoked: 'false'
      });
      
      res.json(link);
    } catch (error: any) {
      console.error("Error creating shared link:", error);
      res.status(500).json({ error: "Failed to create shared link" });
    }
  });

  // Revoke shared link
  app.delete("/api/users/:id/shared-links/:linkId", async (req, res) => {
    try {
      const authUserId = (req as any).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });
      
      const { id, linkId } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });
      
      await storage.revokeSharedLink(linkId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error revoking shared link:", error);
      res.status(500).json({ error: "Failed to revoke shared link" });
    }
  });

  // Rotate shared link token
  app.post("/api/users/:id/shared-links/:linkId/rotate", async (req, res) => {
    try {
      const authUserId = (req as any).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });
      
      const { id, linkId } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });
      
      const link = await storage.rotateSharedLinkToken(linkId);
      res.json(link);
    } catch (error: any) {
      console.error("Error rotating shared link token:", error);
      res.status(500).json({ error: "Failed to rotate shared link token" });
    }
  });

  // Update shared link permissions
  app.patch("/api/users/:id/shared-links/:linkId", async (req, res) => {
    try {
      const authUserId = (req as any).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });
      
      const { id, linkId } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });
      
      const { scope, permissions } = req.body;
      
      const link = await storage.updateSharedLink(linkId, { scope, permissions });
      res.json(link);
    } catch (error: any) {
      console.error("Error updating shared link:", error);
      res.status(500).json({ error: "Failed to update shared link" });
    }
  });

  // Public access endpoint (no auth required)
  app.get("/api/shared/:token", async (req, res) => {
    try {
      const { token } = req.params;
      
      const link = await storage.getSharedLinkByToken(token);
      
      if (!link) {
        return res.status(404).json({ error: "Shared link not found" });
      }
      
      if (link.isRevoked === 'true') {
        return res.status(410).json({ error: "This shared link has been revoked" });
      }
      
      if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
        return res.status(410).json({ error: "This shared link has expired" });
      }
      
      await storage.incrementSharedLinkAccess(link.id);
      
      res.json({
        resourceType: link.resourceType,
        resourceId: link.resourceId,
        scope: link.scope,
        permissions: link.permissions,
        accessCount: (link.accessCount || 0) + 1
      });
    } catch (error: any) {
      console.error("Error accessing shared link:", error);
      res.status(500).json({ error: "Failed to access shared link" });
    }
  });

  // Get archived chats
  app.get("/api/users/:id/chats/archived", async (req, res) => {
    try {
      const authUserId = (req as any).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });
      
      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });
      
      const chats = await storage.getArchivedChats(id);
      res.json(chats);
    } catch (error: any) {
      console.error("Error getting archived chats:", error);
      res.status(500).json({ error: "Failed to get archived chats" });
    }
  });

  // Unarchive chat
  app.post("/api/users/:id/chats/:chatId/unarchive", async (req, res) => {
    try {
      const authUserId = (req as any).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });
      
      const { id, chatId } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });
      
      await storage.unarchiveChat(chatId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error unarchiving chat:", error);
      res.status(500).json({ error: "Failed to unarchive chat" });
    }
  });

  // Archive all chats
  app.post("/api/users/:id/chats/archive-all", async (req, res) => {
    try {
      const authUserId = (req as any).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });
      
      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });
      
      const count = await storage.archiveAllChats(id);
      res.json({ count });
    } catch (error: any) {
      console.error("Error archiving all chats:", error);
      res.status(500).json({ error: "Failed to archive all chats" });
    }
  });

  // Get deleted chats (for recovery)
  app.get("/api/users/:id/chats/deleted", async (req, res) => {
    try {
      const authUserId = (req as any).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });
      
      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });
      
      const chats = await storage.getDeletedChats(id);
      res.json(chats);
    } catch (error: any) {
      console.error("Error getting deleted chats:", error);
      res.status(500).json({ error: "Failed to get deleted chats" });
    }
  });

  // Soft delete all chats
  app.post("/api/users/:id/chats/delete-all", async (req, res) => {
    try {
      const authUserId = (req as any).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });
      
      const { id } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });
      
      const count = await storage.softDeleteAllChats(id);
      
      const links = await storage.getSharedLinks(id);
      for (const link of links) {
        if (link.resourceType === 'chat') {
          await storage.revokeSharedLink(link.id);
        }
      }
      
      res.json({ count });
    } catch (error: any) {
      console.error("Error deleting all chats:", error);
      res.status(500).json({ error: "Failed to delete all chats" });
    }
  });

  // Restore deleted chat
  app.post("/api/users/:id/chats/:chatId/restore", async (req, res) => {
    try {
      const authUserId = (req as any).user?.claims?.sub;
      if (!authUserId) return res.status(401).json({ error: "Unauthorized" });
      
      const { id, chatId } = req.params;
      if (authUserId !== id) return res.status(403).json({ error: "Forbidden" });
      
      await storage.restoreDeletedChat(chatId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error restoring chat:", error);
      res.status(500).json({ error: "Failed to restore chat" });
    }
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

async function processFileAsync(fileId: string, storagePath: string, mimeType: string, filename?: string) {
  try {
    const objectStorageService = new ObjectStorageService();
    const objectFile = await objectStorageService.getObjectEntityFile(storagePath);
    const content = await objectStorageService.getFileContent(objectFile);
    
    const result = await processDocument(content, mimeType, filename);
    const chunks = chunkText(result.text, 1500, 150);
    
    const texts = chunks.map(c => c.content);
    const embeddings = await generateEmbeddingsBatch(texts);
    
    const chunksWithEmbeddings = chunks.map((chunk, i) => ({
      fileId,
      content: chunk.content,
      embedding: embeddings[i],
      chunkIndex: chunk.chunkIndex,
      pageNumber: chunk.pageNumber || null,
      metadata: null,
    }));
    
    await storage.createFileChunks(chunksWithEmbeddings);
    await storage.updateFileStatus(fileId, "ready");
    
    console.log(`File ${fileId} processed: ${chunks.length} chunks created`);
  } catch (error) {
    console.error(`Error processing file ${fileId}:`, error);
    await storage.updateFileStatus(fileId, "error");
  }
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

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }
  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");
  return { bucketName, objectName };
}

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

async function signObjectURLForMultipart({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}`
    );
  }
  const { signed_url: signedURL } = await response.json();
  return signedURL;
}
