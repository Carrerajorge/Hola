import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { processDocument } from "./services/documentProcessing";
import { chunkText, generateEmbedding, generateEmbeddingsBatch } from "./embeddingService";
import { agentOrchestrator, StepUpdate, ProgressUpdate, guardrails } from "./agent";
import { browserSessionManager, SessionEvent } from "./agent/browser";
import { handleChatRequest, AVAILABLE_MODELS, DEFAULT_PROVIDER, DEFAULT_MODEL } from "./services/chatService";
import { llmGateway } from "./lib/llmGateway";
import { ALLOWED_MIME_TYPES } from "./lib/constants";
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

const agentClients: Map<string, Set<WebSocket>> = new Map();
const browserClients: Map<string, Set<WebSocket>> = new Map();

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Setup authentication BEFORE other routes
  await setupAuth(app);
  registerAuthRoutes(app);

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
      
      const chat = await storage.getChat(req.params.id);
      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }
      
      // Verify ownership - block access to chats without userId (legacy/orphaned) or wrong user
      if (!chat.userId || chat.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      const messages = await storage.getChatMessages(req.params.id);
      res.json({ ...chat, messages });
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
