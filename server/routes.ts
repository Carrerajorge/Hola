import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import OpenAI from "openai";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { extractText } from "./documentParser";
import { chunkText, generateEmbedding } from "./embeddingService";

const openai = new OpenAI({ 
  baseURL: "https://api.x.ai/v1", 
  apiKey: process.env.XAI_API_KEY 
});

const ALLOWED_MIME_TYPES = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "application/json",
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
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      res.json({ uploadURL });
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

      processFileAsync(file.id, storagePath, type);

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
      const { messages, useRag = true } = req.body;
      
      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: "Messages array is required" });
      }

      const formattedMessages = messages.map((msg: { role: string; content: string }) => ({
        role: msg.role as "user" | "assistant" | "system",
        content: msg.content
      }));

      let contextInfo = "";
      let sources: { fileName: string; content: string }[] = [];

      if (useRag && formattedMessages.length > 0) {
        const lastUserMessage = formattedMessages.filter((m: { role: string }) => m.role === "user").pop();
        if (lastUserMessage) {
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

  return httpServer;
}

async function processFileAsync(fileId: string, storagePath: string, mimeType: string) {
  try {
    const objectStorageService = new ObjectStorageService();
    const objectFile = await objectStorageService.getObjectEntityFile(storagePath);
    const content = await objectStorageService.getFileContent(objectFile);
    
    const text = await extractText(content, mimeType);
    const chunks = chunkText(text);
    
    const chunksWithEmbeddings = [];
    for (const chunk of chunks) {
      const embedding = await generateEmbedding(chunk.content);
      chunksWithEmbeddings.push({
        fileId,
        content: chunk.content,
        embedding,
        chunkIndex: chunk.chunkIndex,
        pageNumber: chunk.pageNumber || null,
        metadata: null,
      });
    }
    
    await storage.createFileChunks(chunksWithEmbeddings);
    await storage.updateFileStatus(fileId, "ready");
    
    console.log(`File ${fileId} processed: ${chunks.length} chunks created`);
  } catch (error) {
    console.error(`Error processing file ${fileId}:`, error);
    await storage.updateFileStatus(fileId, "error");
  }
}
