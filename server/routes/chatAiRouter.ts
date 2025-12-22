import { Router } from "express";
import { storage } from "../storage";
import { handleChatRequest, AVAILABLE_MODELS, DEFAULT_PROVIDER, DEFAULT_MODEL } from "../services/chatService";
import { llmGateway } from "../lib/llmGateway";
import { generateImage, detectImageRequest, extractImagePrompt } from "../services/imageGeneration";
import { runETLAgent, getAvailableCountries, getAvailableIndicators } from "../etl";

export function createChatAiRouter(broadcastAgentUpdate: (runId: string, update: any) => void) {
  const router = Router();

  router.get("/models", (req, res) => {
    res.json(AVAILABLE_MODELS);
  });

  router.post("/chat", async (req, res) => {
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
        onAgentProgress: (update) => broadcastAgentUpdate(update.runId, update)
      });
      
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

  router.post("/voice-chat", async (req, res) => {
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

  router.post("/image/generate", async (req, res) => {
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

  router.post("/image/detect", (req, res) => {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }
    
    const isImageRequest = detectImageRequest(message);
    const extractedPrompt = isImageRequest ? extractImagePrompt(message) : null;
    
    res.json({ isImageRequest, extractedPrompt });
  });

  router.get("/etl/config", async (req, res) => {
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

  router.post("/etl/run", async (req, res) => {
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

  router.post("/chat/stream", async (req, res) => {
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

  return router;
}
