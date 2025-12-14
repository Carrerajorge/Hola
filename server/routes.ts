import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import OpenAI from "openai";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { processDocument } from "./services/documentProcessing";
import { chunkText, generateEmbedding, generateEmbeddingsBatch } from "./embeddingService";
import { routeMessage, extractUrls, agentOrchestrator, checkDomainPolicy, checkRateLimit, sanitizeUrl, isValidObjective, StepUpdate, runPipeline, initializePipeline, ProgressUpdate } from "./agent";

const openai = new OpenAI({ 
  baseURL: "https://api.x.ai/v1", 
  apiKey: process.env.XAI_API_KEY 
});

const agentClients: Map<string, Set<WebSocket>> = new Map();

const ALLOWED_MIME_TYPES = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "application/json",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/bmp",
  "image/webp",
  "image/tiff",
];

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const objectStorageService = new ObjectStorageService();

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
      const { messages, useRag = true, conversationId } = req.body;
      
      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: "Messages array is required" });
      }

      const formattedMessages = messages.map((msg: { role: string; content: string }) => ({
        role: msg.role as "user" | "assistant" | "system",
        content: msg.content
      }));

      const lastUserMessage = formattedMessages.filter((m: { role: string }) => m.role === "user").pop();
      
      if (lastUserMessage) {
        const routeResult = await routeMessage(lastUserMessage.content);
        
        if (routeResult.decision === "agent" || routeResult.decision === "hybrid") {
          const urls = routeResult.urls.length > 0 ? routeResult.urls : [];
          
          for (const url of urls) {
            try {
              const sanitizedUrl = sanitizeUrl(url);
              const securityCheck = await checkDomainPolicy(sanitizedUrl);
              
              if (!securityCheck.allowed) {
                return res.json({
                  content: `No puedo acceder a ${url}: ${securityCheck.reason}`,
                  role: "assistant"
                });
              }
              
              const domain = new URL(sanitizedUrl).hostname;
              if (!checkRateLimit(domain, securityCheck.rateLimit)) {
                return res.json({
                  content: `Límite de solicitudes alcanzado para ${domain}. Intenta de nuevo en un minuto.`,
                  role: "assistant"
                });
              }
            } catch (e) {
              console.error("URL validation error:", e);
            }
          }
          
          if (!isValidObjective(routeResult.objective || lastUserMessage.content)) {
            return res.json({
              content: "No puedo procesar solicitudes que involucren información sensible o actividades no permitidas.",
              role: "assistant"
            });
          }
          
          const objective = routeResult.objective || lastUserMessage.content;
          
          const onProgress = (update: ProgressUpdate) => {
            broadcastAgentUpdate(update.runId, update as any);
          };
          
          const pipelineResult = await runPipeline({
            objective,
            conversationId,
            onProgress
          });
          
          return res.json({
            content: pipelineResult.summary || "Tarea completada.",
            role: "assistant",
            sources: pipelineResult.artifacts
              .filter(a => a.type === "text" && a.name)
              .slice(0, 5)
              .map(a => ({ fileName: a.name, content: a.content?.slice(0, 200) || "" })),
            agentRunId: pipelineResult.runId,
            wasAgentTask: true,
            pipelineSteps: pipelineResult.steps.length,
            pipelineSuccess: pipelineResult.success
          });
        }
      }

      let contextInfo = "";
      let sources: { fileName: string; content: string }[] = [];

      if (useRag && lastUserMessage) {
        try {
          const queryEmbedding = await generateEmbedding(lastUserMessage.content);
          const similarChunks = await storage.searchSimilarChunks(queryEmbedding, 5);
          
          if (similarChunks.length > 0) {
            sources = similarChunks.map((chunk: any) => ({
              fileName: chunk.file_name || "Documento",
              content: chunk.content.slice(0, 200) + "..."
            }));
            
            contextInfo = "\n\nContexto de documentos relevantes:\n" + 
              similarChunks.map((chunk: any, i: number) => 
                `[${i + 1}] ${chunk.file_name || "Documento"}: ${chunk.content}`
              ).join("\n\n");
          }
        } catch (error) {
          console.error("RAG search error:", error);
        }
      }

      const systemMessage = {
        role: "system" as const,
        content: `Eres Sira GPT, un asistente de IA avanzado capaz de navegar la web, recopilar información, crear documentos y ejecutar objetivos complejos. Responde de manera útil y profesional en el idioma del usuario.${contextInfo}`
      };

      const response = await openai.chat.completions.create({
        model: "grok-3-fast",
        messages: [systemMessage, ...formattedMessages],
      });

      const content = response.choices[0]?.message?.content || "No response generated";
      
      res.json({ 
        content,
        role: "assistant",
        sources: sources.length > 0 ? sources : undefined
      });
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
  
  wss.on("connection", (ws) => {
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

  return httpServer;
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
