import { Router } from 'express';
import type { Response } from 'express';
import { whatsappWebManager } from '../integrations/whatsappWeb';
import { chunkText, isGroupJid, MemorySseResponse } from '../integrations/whatsappWebAutoReply';
import type { AuthenticatedRequest } from '../types/express';
import { storage } from '../storage';
import { createUnifiedRun, executeUnifiedChat } from '../agent/unifiedChatHandler';

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

    const status = await whatsappWebManager.startWithOptions(userId);
    res.json({ success: true, status });
  });

  // Generate pairing code (link by phone number)
  router.post('/connect/pairing-code', async (req, res) => {
    const userId = requireUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { phone } = (req.body || {}) as { phone?: string };
    if (!phone) return res.status(400).json({ success: false, error: 'phone is required' });

    try {
      const status = await whatsappWebManager.startWithOptions(userId, { phone: String(phone) });
      res.json({ success: true, status });
    } catch (e: any) {
      res.status(400).json({ success: false, error: e?.message || 'Failed to generate pairing code' });
    }
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

async function autoReplyFromWhatsApp(opts: {
  userId: string;
  fromJid: string;
  chatId: string;
  inboundText: string;
}): Promise<void> {
  const { userId, fromJid, chatId } = opts;

  // Safety: default to not replying to groups automatically.
  if (isGroupJid(fromJid)) {
    return;
  }

  // Build message history from mirrored chat.
  const history = await storage.getChatMessages(chatId).then((msgs) => msgs.slice(-20));
  const messages = history
    .filter((m: any) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m: any) => ({ role: m.role, content: m.content }));

  const unifiedContext = await createUnifiedRun({
    messages,
    chatId,
    userId,
    messageId: `wa_msg_${Date.now()}`,
  });

  const memRes = new MemorySseResponse();
  await executeUnifiedChat(unifiedContext, {
    messages,
    chatId,
    userId,
    messageId: `wa_msg_${Date.now()}`,
  }, memRes as any as Response);

  const assistantText = memRes.chunks
    .filter(c => c.event === 'chunk' && typeof c.data?.content === 'string')
    .map(c => c.data.content)
    .join('')
    .trim();

  const confirmationEvent = memRes.chunks.find(c => c.event === 'confirmation');

  const finalText = assistantText || (confirmationEvent
    ? 'Listo. Responda CONFIRM o CANCEL para continuar.'
    : 'Listo.');

  // Persist assistant message to mirrored chat.
  await storage.createChatMessage({
    chatId,
    role: 'assistant',
    content: finalText,
    status: 'done',
    requestId: `wa_out_${unifiedContext.runId}`,
    metadata: {
      channel: 'whatsapp_web',
      to: fromJid,
    },
  } as any);

  // Send to WhatsApp (split if needed)
  for (const part of chunkText(finalText, 1400)) {
    await whatsappWebManager.sendText(userId, fromJid, part);
  }
}

// Wire inbound WhatsApp messages into IliaGPT chats (in-app inbox) and auto-reply (AUTOMÁTICO).
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

    // Fire-and-forget auto-reply.
    void autoReplyFromWhatsApp({
      userId,
      fromJid: msg.from,
      chatId,
      inboundText: msg.text,
    }).catch((e) => {
      console.error('[WhatsAppWebRouter] autoReply failed:', (e as any)?.message || e);
    });
  } catch (e) {
    console.error('[WhatsAppWebRouter] inbound_message persist failed:', (e as any)?.message || e);
  }
});
