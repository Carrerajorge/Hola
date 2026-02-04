import { Router } from 'express';
import { whatsappWebManager } from '../integrations/whatsappWeb';
import type { AuthenticatedRequest } from '../types/express';
import { storage } from '../storage';

function requireUserId(req: AuthenticatedRequest): string {
  const user = req.user;
  const session = req.session as any;
  return (
    user?.claims?.sub ||
    user?.id ||
    session?.authUserId ||
    session?.anonUserId ||
    ''
  );
}

function safeChatId(userId: string, remoteJid: string): string {
  const raw = `wa_${userId}_${remoteJid}`;
  return raw.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 200);
}

export function createWhatsAppWebRouter(): Router {
  const router = Router();

  router.get('/status', async (req, res) => {
    const userId = requireUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const status = whatsappWebManager.getStatus(userId);
    res.json({ success: true, status });
  });

  router.post('/connect/start', async (req, res) => {
    const userId = requireUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const status = await whatsappWebManager.start(userId);
    res.json({ success: true, status });
  });

  router.post('/connect/disconnect', async (req, res) => {
    const userId = requireUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    await whatsappWebManager.disconnect(userId);
    res.json({ success: true });
  });

  // Basic send endpoint (used for testing from the web UI)
  router.post('/send', async (req, res) => {
    const userId = requireUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { to, text } = req.body || {};
    if (!to || !text) return res.status(400).json({ success: false, error: 'to and text are required' });

    await whatsappWebManager.sendText(userId, String(to), String(text));
    res.json({ success: true });
  });

  return router;
}

// Wire inbound WhatsApp messages into IliaGPT chats (in-app inbox).
// NOTE: Auto-reply from WhatsApp is a separate step; for now we persist inbound messages to the user account.
whatsappWebManager.on('inbound_message', async (userId: string, msg: { from: string; text: string; messageId?: string; timestamp?: number }) => {
  try {
    const chatId = safeChatId(userId, msg.from);

    const existing = await storage.getChat(chatId);
    if (!existing) {
      await storage.createChat({
        id: chatId,
        userId,
        title: `WhatsApp: ${msg.from}`,
        archived: 'false',
        hidden: 'false',
        pinned: 'false',
      } as any);
    }

    await storage.createChatMessage({
      chatId,
      role: 'user',
      content: msg.text,
      status: 'done',
      requestId: msg.messageId ? `wa_${msg.messageId}` : undefined,
      metadata: {
        channel: 'whatsapp_web',
        from: msg.from,
        timestamp: msg.timestamp,
      },
      createdAt: msg.timestamp ? new Date(msg.timestamp) : new Date(),
    } as any);

    await storage.updateChat(chatId, { lastMessageAt: new Date() } as any);
  } catch (e) {
    console.error('[WhatsAppWebRouter] inbound_message persist failed:', (e as any)?.message || e);
  }
});
