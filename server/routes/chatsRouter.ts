import { Router } from "express";
import { storage } from "../storage";
import { sendShareNotificationEmail } from "../services/emailService";

export function createChatsRouter() {
  const router = Router();

  router.get("/chats", async (req, res) => {
    try {
      const user = (req as any).user;
      let userId = user?.claims?.sub;
      
      // For anonymous users, use session-based ID
      if (!userId) {
        const sessionId = (req as any).sessionID;
        if (sessionId) {
          userId = `anon_${sessionId}`;
        } else {
          return res.json([]);
        }
      }
      
      const chatList = await storage.getChats(userId);
      res.json(chatList);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/chats", async (req, res) => {
    try {
      const { title } = req.body;
      const user = (req as any).user;
      let userId = user?.claims?.sub;
      
      // Allow anonymous users to create chats with session-based ID
      if (!userId) {
        const sessionId = (req as any).sessionID || `anon_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        userId = `anon_${sessionId}`;
      }
      
      const chat = await storage.createChat({ title: title || "New Chat", userId });
      res.json(chat);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/chats/:id", async (req, res) => {
    try {
      const user = (req as any).user;
      let userId = user?.claims?.sub;
      const userEmail = user?.claims?.email;
      
      // For anonymous users, use session-based ID
      if (!userId) {
        const sessionId = (req as any).sessionID;
        if (sessionId) {
          userId = `anon_${sessionId}`;
        }
      }
      
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

  router.patch("/chats/:id", async (req, res) => {
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

  router.delete("/chats/:id", async (req, res) => {
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

  router.post("/chats/:id/documents", async (req, res) => {
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
      
      const { type, title, content } = req.body;
      if (!type || !title || !content) {
        return res.status(400).json({ error: "type, title and content are required" });
      }
      
      const message = await storage.saveDocumentToChat(req.params.id, { type, title, content });
      res.json(message);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/chats/archive-all", async (req, res) => {
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

  router.delete("/chats/delete-all", async (req, res) => {
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

  router.post("/chats/:id/messages", async (req, res) => {
    try {
      const user = (req as any).user;
      let userId = user?.claims?.sub;
      
      // For anonymous users, use session-based ID
      if (!userId) {
        const sessionId = (req as any).sessionID;
        if (sessionId) {
          userId = `anon_${sessionId}`;
        }
      }
      
      const chat = await storage.getChat(req.params.id);
      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }
      if (!chat.userId || chat.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      const { role, content, requestId, clientRequestId, userMessageId, attachments, sources, figmaDiagram, googleFormPreview, gmailPreview, generatedImage } = req.body;
      if (!role || !content) {
        return res.status(400).json({ error: "role and content are required" });
      }
      
      // Run-based idempotency for user messages
      if (role === 'user' && clientRequestId) {
        // Check if a run with this clientRequestId already exists
        const existingRun = await storage.getChatRunByClientRequestId(req.params.id, clientRequestId);
        if (existingRun) {
          console.log(`[Dedup] Run with clientRequestId ${clientRequestId} already exists, returning existing`);
          // Fetch the user message that was created with this run
          const messages = await storage.getChatMessages(req.params.id);
          const existingMessage = messages.find(m => m.id === existingRun.userMessageId);
          return res.json({ 
            message: existingMessage, 
            run: existingRun,
            deduplicated: true 
          });
        }
        
        // Create user message and run atomically
        const { message, run } = await storage.createUserMessageAndRun(
          req.params.id,
          {
            chatId: req.params.id,
            role: 'user',
            content,
            status: 'done',
            requestId: requestId || null,
            userMessageId: null,
            attachments: attachments || null,
            sources: sources || null,
            figmaDiagram: figmaDiagram || null,
            googleFormPreview: googleFormPreview || null,
            gmailPreview: gmailPreview || null,
            generatedImage: generatedImage || null
          },
          clientRequestId
        );
        
        if (chat.title === "New Chat") {
          const newTitle = content.slice(0, 30) + (content.length > 30 ? "..." : "");
          await storage.updateChat(req.params.id, { title: newTitle });
        }
        
        return res.json({ message, run, deduplicated: false });
      }
      
      // Legacy flow for assistant messages or messages without clientRequestId
      if (requestId) {
        const existingMessage = await storage.findMessageByRequestId(requestId);
        if (existingMessage) {
          console.log(`[Dedup] Message with requestId ${requestId} already exists, returning existing`);
          return res.json(existingMessage);
        }
      }
      
      const message = await storage.createChatMessage({
        chatId: req.params.id,
        role,
        content,
        status: 'done',
        requestId: requestId || null,
        userMessageId: userMessageId || null,
        attachments: attachments || null,
        sources: sources || null,
        figmaDiagram: figmaDiagram || null,
        googleFormPreview: googleFormPreview || null,
        gmailPreview: gmailPreview || null,
        generatedImage: generatedImage || null
      });
      
      if (chat.title === "New Chat" && role === "user") {
        const newTitle = content.slice(0, 30) + (content.length > 30 ? "..." : "");
        await storage.updateChat(req.params.id, { title: newTitle });
      }
      
      res.json(message);
    } catch (error: any) {
      // Handle unique constraint violation gracefully (duplicate clientRequestId or requestId)
      if (error.code === '23505') {
        console.log(`[Dedup] Duplicate constraint hit, fetching existing`);
        const { clientRequestId, requestId } = req.body;
        if (clientRequestId) {
          const existingRun = await storage.getChatRunByClientRequestId(req.params.id, clientRequestId);
          if (existingRun) {
            const messages = await storage.getChatMessages(req.params.id);
            const existingMessage = messages.find(m => m.id === existingRun.userMessageId);
            return res.json({ message: existingMessage, run: existingRun, deduplicated: true });
          }
        }
        if (requestId) {
          const existingMessage = await storage.findMessageByRequestId(requestId);
          if (existingMessage) {
            return res.json(existingMessage);
          }
        }
      }
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/chats/:id/shares", async (req, res) => {
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

  router.post("/chats/:id/shares", async (req, res) => {
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

  router.delete("/chats/:id/shares/:shareId", async (req, res) => {
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

  router.get("/shared-chats", async (req, res) => {
    try {
      const user = (req as any).user;
      const userId = user?.claims?.sub;
      
      if (!userId) {
        return res.json([]);
      }
      
      const sharedChats = await storage.getSharedChatsWithDetails(userId);
      res.json(sharedChats);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
