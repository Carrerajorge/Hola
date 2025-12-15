import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { processDocument } from "./services/documentProcessing";
import { chunkText, generateEmbedding, generateEmbeddingsBatch } from "./embeddingService";
import { agentOrchestrator, StepUpdate, ProgressUpdate, guardrails } from "./agent";
import { browserSessionManager, SessionEvent } from "./agent/browser";
import { handleChatRequest } from "./services/chatService";
import { ALLOWED_MIME_TYPES } from "./lib/constants";
import { 
  generateWordDocument, 
  generateExcelDocument, 
  generatePptDocument,
  parseExcelFromText,
  parseSlidesFromText
} from "./services/documentGeneration";

const agentClients: Map<string, Set<WebSocket>> = new Map();
const browserClients: Map<string, Set<WebSocket>> = new Map();

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
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

  app.post("/api/chat", async (req, res) => {
    try {
      const { messages, useRag = true, conversationId, images } = req.body;
      
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
        onAgentProgress: (update) => broadcastAgentUpdate(update.runId, update as any)
      });
      
      res.json(response);
    } catch (error: any) {
      console.error("Chat API error:", error);
      res.status(500).json({ 
        error: "Failed to get AI response",
        details: error.message 
      });
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

  // Chat persistence API routes
  app.get("/api/chats", async (req, res) => {
    try {
      const chatList = await storage.getChats();
      res.json(chatList);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/chats", async (req, res) => {
    try {
      const { title } = req.body;
      const chat = await storage.createChat({ title: title || "New Chat" });
      res.json(chat);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/chats/:id", async (req, res) => {
    try {
      const chat = await storage.getChat(req.params.id);
      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }
      const messages = await storage.getChatMessages(req.params.id);
      res.json({ ...chat, messages });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/chats/:id", async (req, res) => {
    try {
      const { title, archived, hidden } = req.body;
      const updates: any = {};
      if (title !== undefined) updates.title = title;
      if (archived !== undefined) updates.archived = archived.toString();
      if (hidden !== undefined) updates.hidden = hidden.toString();
      
      const chat = await storage.updateChat(req.params.id, updates);
      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }
      res.json(chat);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/chats/:id", async (req, res) => {
    try {
      await storage.deleteChat(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/chats/:id/messages", async (req, res) => {
    try {
      const { role, content, attachments, sources } = req.body;
      if (!role || !content) {
        return res.status(400).json({ error: "role and content are required" });
      }
      const message = await storage.createChatMessage({
        chatId: req.params.id,
        role,
        content,
        attachments: attachments || null,
        sources: sources || null
      });
      
      // Update chat title if first user message
      const chat = await storage.getChat(req.params.id);
      if (chat && chat.title === "New Chat" && role === "user") {
        const newTitle = content.slice(0, 30) + (content.length > 30 ? "..." : "");
        await storage.updateChat(req.params.id, { title: newTitle });
      }
      
      res.json(message);
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
