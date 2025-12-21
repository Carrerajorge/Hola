import { Router } from "express";
import { storage } from "../storage";
import { handleChatRequest, AVAILABLE_MODELS, DEFAULT_PROVIDER, DEFAULT_MODEL } from "../services/chatService";
import { llmGateway } from "../lib/llmGateway";
import { sendShareNotificationEmail } from "../services/emailService";

export function createChatRouter(broadcastAgentUpdate: (runId: string, update: any) => void): Router {
  const router = Router();

  router.get("/api/models", (req, res) => {
    res.json(AVAILABLE_MODELS);
  });

  router.post("/api/chat", async (req, res) => {
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

  router.post("/api/voice-chat", async (req, res) => {
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

  router.post("/api/chat/stream", async (req, res) => {
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

  router.get("/api/chats", async (req, res) => {
    try {
      const user = (req as any).user;
      const userId = user?.claims?.sub;
      
      if (!userId) {
        return res.json([]);
      }
      
      const chatList = await storage.getChats(userId);
      res.json(chatList);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/api/chats/bulk", async (req, res) => {
    try {
      const user = (req as any).user;
      const userId = user?.claims?.sub;
      
      if (!userId) {
        return res.json([]);
      }
      
      const chatsWithMessages = await storage.getChatsWithMessages(userId);
      res.json(chatsWithMessages);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/api/chats", async (req, res) => {
    try {
      const { title } = req.body;
      const user = (req as any).user;
      const userId = user?.claims?.sub;
      
      if (!userId) {
        return res.status(401).json({ error: "Authentication required to create chats" });
      }
      
      const chat = await storage.createChat({ title: title || "New Chat", userId });
      res.json(chat);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/api/chats/:id", async (req, res) => {
    try {
      const user = (req as any).user;
      const userId = user?.claims?.sub;
      
      const chat = await storage.getChat(req.params.id);
      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }
      
      const isOwner = chat.userId && chat.userId === userId;
      
      let shareRole = null;
      if (!isOwner && userId) {
        const share = await storage.getChatShareByUserAndChat(userId, req.params.id);
        if (share) {
          shareRole = share.role;
        }
      }
      
      if (!isOwner && !shareRole) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      const messages = await storage.getChatMessages(req.params.id);
      res.json({ ...chat, messages, shareRole, isOwner });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch("/api/chats/:id", async (req, res) => {
    try {
      const user = (req as any).user;
      const userId = user?.claims?.sub;
      
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

  router.delete("/api/chats/:id", async (req, res) => {
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
      
      await storage.deleteChat(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/api/chats/archive-all", async (req, res) => {
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

  router.delete("/api/chats/delete-all", async (req, res) => {
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

  router.post("/api/chats/:id/messages", async (req, res) => {
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
      
      if (chat.title === "New Chat" && role === "user") {
        const newTitle = content.slice(0, 30) + (content.length > 30 ? "..." : "");
        await storage.updateChat(req.params.id, { title: newTitle });
      }
      
      res.json(message);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/api/chats/:id/shares", async (req, res) => {
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

  router.post("/api/chats/:id/shares", async (req, res) => {
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
        
        const recipientUser = await storage.getUserByEmail(normalizedEmail);
        
        const existing = await storage.getChatShareByEmailAndChat(normalizedEmail, req.params.id);
        if (existing) {
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

  router.delete("/api/chats/:id/shares/:shareId", async (req, res) => {
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

  router.get("/api/shared-chats", async (req, res) => {
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

  return router;
}
