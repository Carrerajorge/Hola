import { Router } from "express";
import { storage } from "../storage";
import { sendShareNotificationEmail } from "../services/emailService";
import { getSecureUserId, getOrCreateSecureUserId } from "../lib/anonUserHelper";
import { sanitizeMessageContent } from "../lib/markdownSanitizer";

export function createChatsRouter() {
  const router = Router();

  router.get("/chats", async (req, res) => {
    try {
      const userId = getSecureUserId(req);
      if (!userId) {
        return res.json([]);
      }

      const chatList = await storage.getChats(userId);
      res.json(chatList);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * @swagger
   * /chats/search:
   *   get:
   *     summary: Search chat messages
   *     description: Full-text search across all user messages using Postgres tsvector.
   *     tags: [Chats]
   *     parameters:
   *       - in: query
   *         name: q
   *         schema:
   *           type: string
   *         required: true
   *         description: Search query
   *     responses:
   *       200:
   *         description: List of matching messages
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   *                 properties:
   *                   id:
   *                     type: string
   *                   content:
   *                     type: string
   *                   role:
   *                     type: string
   *       401:
   *         description: Unauthorized
   */
  router.get("/chats/search", async (req, res) => {
    try {
      const userId = getSecureUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { q } = req.query;
      if (!q || typeof q !== 'string') {
        return res.status(400).json({ error: "Query parameter 'q' is required" });
      }

      const messages = await storage.searchMessages(userId, q);
      res.json(messages);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * @swagger
   * /chats:
   *   post:
   *     summary: Create a new chat
   *     tags: [Chats]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               title:
   *                 type: string
   *               messages:
   *                 type: array
   *                 items:
   *                   type: object
   *                   properties:
   *                     role:
   *                       type: string
   *                     content:
   *                       type: string
   *     responses:
   *       200:
   *         description: Chat created
   */
  router.post("/chats", async (req, res) => {
    try {
      const { title, messages } = req.body;
      const userId = getOrCreateSecureUserId(req);

      // If messages provided with requestIds, check if any already exist (reconciliation scenario)
      if (messages && Array.isArray(messages) && messages.length > 0) {
        // Check first message's requestId to detect duplicate reconciliation attempts
        const firstMsgWithRequestId = messages.find((m: any) => m.requestId);
        if (firstMsgWithRequestId?.requestId) {
          const existingMsg = await storage.findMessageByRequestId(firstMsgWithRequestId.requestId);
          if (existingMsg) {
            // Chat already exists with this message, return existing chat
            const existingChat = await storage.getChat(existingMsg.chatId);
            if (existingChat) {
              const existingMessages = await storage.getChatMessages(existingChat.id);
              return res.json({ ...existingChat, messages: existingMessages, alreadyExists: true });
            }
          }
        }

        // Create chat with messages atomically using transaction
        const result = await storage.createChatWithMessages(
          { title: title || "New Chat", userId },
          messages.map((msg: any) => ({
            role: msg.role,
            content: msg.content,
            requestId: msg.requestId,
            userMessageId: msg.userMessageId,
            attachments: msg.attachments
          }))
        );
        return res.json({ ...result.chat, messages: result.messages });
      }

      // Simple chat creation without messages
      const chat = await storage.createChat({ title: title || "New Chat", userId });
      res.json(chat);
    } catch (error: any) {
      // Handle duplicate key constraint gracefully
      if (error.code === '23505' && error.constraint?.includes('request')) {
        // Duplicate requestId - try to find and return existing chat
        const requestId = req.body.messages?.find((m: any) => m.requestId)?.requestId;
        if (requestId) {
          const existingMsg = await storage.findMessageByRequestId(requestId);
          if (existingMsg) {
            const existingChat = await storage.getChat(existingMsg.chatId);
            if (existingChat) {
              const existingMessages = await storage.getChatMessages(existingChat.id);
              return res.json({ ...existingChat, messages: existingMessages, alreadyExists: true });
            }
          }
        }
      }
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/chats/:id", async (req, res) => {
    try {
      const userId = getSecureUserId(req);
      const userEmail = (req as any).user?.claims?.email;

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

  // ============================================================================
  // CONTEXT VALIDATION API - Verify client-server sync
  // ============================================================================
  router.get("/chats/:id/validate", async (req, res) => {
    try {
      const userId = getSecureUserId(req);
      const { clientMessageCount, clientMessageIds } = req.query;

      const chat = await storage.getChat(req.params.id);
      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }
      if (!chat.userId || chat.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const serverMessages = await storage.getChatMessages(req.params.id);
      const serverMessageIds = serverMessages.map(m => m.id);
      const serverMessageCount = serverMessages.length;

      // Parse client message IDs if provided
      let clientIds: string[] = [];
      if (clientMessageIds && typeof clientMessageIds === 'string') {
        try {
          clientIds = JSON.parse(clientMessageIds);
        } catch {
          clientIds = clientMessageIds.split(',');
        }
      }

      // Calculate sync status
      const missingOnClient = serverMessageIds.filter(id => !clientIds.includes(id));
      const extraOnClient = clientIds.filter(id => !serverMessageIds.includes(id));
      const clientCount = clientMessageCount ? parseInt(clientMessageCount as string) : clientIds.length;

      const valid = missingOnClient.length === 0 &&
        extraOnClient.length === 0 &&
        serverMessageCount === clientCount;

      res.json({
        valid,
        serverMessageCount,
        clientMessageCount: clientCount,
        difference: serverMessageCount - clientCount,
        missingOnClient: missingOnClient.slice(0, 10), // Limit to 10
        extraOnClient: extraOnClient.slice(0, 10),
        lastServerMessageId: serverMessageIds[serverMessageIds.length - 1] || null,
        syncRecommendation: !valid ? 'FULL_REFRESH' : 'NONE'
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================================================
  // CONFLICT RESOLUTION - Last-Write-Wins with version tracking
  // ============================================================================
  router.post("/chats/:id/resolve-conflict", async (req, res) => {
    try {
      const userId = getSecureUserId(req);
      const { clientMessage, expectedVersion } = req.body;

      const chat = await storage.getChat(req.params.id);
      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }
      if (!chat.userId || chat.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Get server version of the message if it exists
      if (clientMessage?.id) {
        const serverMessages = await storage.getChatMessages(req.params.id);
        const serverMessage = serverMessages.find(m => m.id === clientMessage.id);

        if (serverMessage) {
          // Compare timestamps for LWW
          const serverTime = new Date(serverMessage.createdAt).getTime();
          const clientTime = clientMessage.timestamp || Date.now();

          if (clientTime > serverTime) {
            // Client wins - update server
            const updated = await storage.updateMessageContent(
              clientMessage.id,
              clientMessage.content,
              { status: 'done' }
            );
            return res.json({
              resolved: true,
              strategy: 'client_wins',
              message: updated
            });
          } else {
            // Server wins - return server version
            return res.json({
              resolved: true,
              strategy: 'server_wins',
              message: serverMessage
            });
          }
        }
      }

      // No conflict - message doesn't exist on server
      res.json({
        resolved: false,
        strategy: 'no_conflict',
        message: null
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch("/chats/:id", async (req, res) => {
    try {
      const userId = getSecureUserId(req);

      const existingChat = await storage.getChat(req.params.id);
      if (!existingChat) {
        return res.status(404).json({ error: "Chat not found" });
      }
      if (!existingChat.userId || existingChat.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const { title, archived, hidden, pinned, pinnedAt } = req.body;
      const updates: any = {};
      if (title !== undefined) updates.title = title;
      if (archived !== undefined) updates.archived = archived.toString();
      if (hidden !== undefined) updates.hidden = hidden.toString();
      if (pinned !== undefined) updates.pinned = pinned.toString();
      if (pinnedAt !== undefined) updates.pinnedAt = pinnedAt;

      const chat = await storage.updateChat(req.params.id, updates);
      res.json(chat);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete("/chats/:id", async (req, res) => {
    try {
      const userId = getSecureUserId(req);

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
      const userId = getSecureUserId(req);

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
      const userId = getSecureUserId(req);
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
      const userId = getSecureUserId(req);
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
      const userId = getSecureUserId(req);

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

      // SAINITIZATION: Prevent XSS
      const sanitizedContent = sanitizeMessageContent(content);

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
            content: sanitizedContent,
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
          const newTitle = sanitizedContent.slice(0, 30) + (sanitizedContent.length > 30 ? "..." : "");
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
        content: sanitizedContent,
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
        const newTitle = sanitizedContent.slice(0, 30) + (sanitizedContent.length > 30 ? "..." : "");
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
