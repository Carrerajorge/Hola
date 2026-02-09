import { Router } from 'express';
import type { Response } from 'express';
import { whatsappWebManager } from '../integrations/whatsappWeb';
import { whatsappWebSseHub } from '../integrations/whatsappWebSse';
import { chunkText, isGroupJid, MemorySseResponse } from '../integrations/whatsappWebAutoReply';
import type { AuthenticatedRequest } from '../types/express';
import { getSecureUserId } from '../lib/anonUserHelper';
import { storage } from '../storage';
import { createUnifiedRun, executeUnifiedChat } from '../agent/unifiedChatHandler';

// Auto-reply timeout: 60 seconds max
const AUTO_REPLY_TIMEOUT_MS = 60_000;

function requireUserId(req: AuthenticatedRequest): string {
  return getSecureUserId(req as any) || '';
}

function safeChatId(userId: string, remoteJid: string): string {
  const raw = `wa_${userId}_${remoteJid}`;
  return raw.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 200);
}

/** Run a promise with a timeout. Rejects if the promise doesn't resolve in time. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timeout after ${ms}ms`));
    }, ms);
    timer.unref?.();
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export function createWhatsAppWebRouter(): Router {
  const router = Router();

  // Server-Sent Events for live WhatsApp status + mirrored messages.
  router.get('/events', async (req, res) => {
    const userId = requireUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    whatsappWebSseHub.subscribe(userId, res);

    // Send initial status snapshot.
    const status = whatsappWebManager.getStatus(userId);
    whatsappWebSseHub.broadcast(userId, 'wa_status', { status });
  });

  router.get('/status', async (req, res) => {
    const userId = requireUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const status = whatsappWebManager.getStatus(userId);
    const autoReply = whatsappWebManager.isAutoReplyEnabled(userId);
    res.json({ success: true, status, autoReply });
  });

  // Start connection — waits for QR to be ready before responding
  router.post('/connect/start', async (req, res) => {
    const userId = requireUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    try {
      const status = await whatsappWebManager.startWithOptions(userId);
      res.json({ success: true, status });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || 'Error al iniciar conexión' });
    }
  });

  // Force restart — kills existing connection and starts fresh
  router.post('/connect/restart', async (req, res) => {
    const userId = requireUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    try {
      const { phone } = (req.body || {}) as { phone?: string };
      const status = await whatsappWebManager.restart(userId, phone ? { phone: String(phone) } : undefined);
      res.json({ success: true, status });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || 'Error al reiniciar conexión' });
    }
  });

  // Generate pairing code (link by phone number)
  router.post('/connect/pairing-code', async (req, res) => {
    const userId = requireUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { phone } = (req.body || {}) as { phone?: string };
    if (!phone) return res.status(400).json({ success: false, error: 'Se requiere número de teléfono' });

    try {
      const status = await whatsappWebManager.restart(userId, { phone: String(phone) });
      res.json({ success: true, status });
    } catch (e: any) {
      res.status(400).json({ success: false, error: e?.message || 'No se pudo generar el código de vinculación' });
    }
  });

  router.post('/connect/disconnect', async (req, res) => {
    const userId = requireUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    try {
      await whatsappWebManager.disconnect(userId);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || 'Error al desconectar' });
    }
  });

  // Toggle auto-reply on/off
  router.post('/auto-reply', async (req, res) => {
    const userId = requireUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { enabled } = (req.body || {}) as { enabled?: boolean };
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, error: 'enabled (boolean) is required' });
    }

    whatsappWebManager.setAutoReply(userId, enabled);
    res.json({ success: true, autoReply: enabled });
  });

  // Basic send endpoint (used for testing from the web UI)
  router.post('/send', async (req, res) => {
    const userId = requireUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { to, text } = req.body || {};
    if (!to || !text) return res.status(400).json({ success: false, error: 'Se requiere destinatario y texto' });

    try {
      await whatsappWebManager.sendText(userId, String(to), String(text));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || 'Error al enviar mensaje' });
    }
  });

  return router;
}

async function autoReplyFromWhatsApp(opts: {
  userId: string;
  fromJid: string;
  chatId: string;
  inboundText: string;
  chatTitle?: string;
}): Promise<void> {
  const { userId, fromJid, chatId, chatTitle } = opts;

  // Safety: don't reply to groups automatically.
  if (isGroupJid(fromJid)) return;

  // Check if auto-reply is enabled for this user
  if (!whatsappWebManager.isAutoReplyEnabled(userId)) return;

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

  // Execute with timeout to prevent hanging
  await withTimeout(
    executeUnifiedChat(unifiedContext, {
      messages,
      chatId,
      userId,
      messageId: `wa_msg_${Date.now()}`,
    }, memRes as any as Response),
    AUTO_REPLY_TIMEOUT_MS,
    'Auto-reply AI'
  );

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
  const savedAssistantMessage = await storage.createChatMessage({
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
  await storage.updateChat(chatId, { lastMessageAt: new Date() } as any);

  whatsappWebSseHub.broadcast(userId, 'wa_message', {
    chat: {
      id: chatId,
      title: chatTitle || `WhatsApp: ${fromJid}`,
      channel: 'whatsapp_web',
      updatedAt: new Date().toISOString(),
    },
    message: {
      id: savedAssistantMessage.id,
      role: savedAssistantMessage.role,
      content: savedAssistantMessage.content,
      createdAt: savedAssistantMessage.createdAt instanceof Date ? savedAssistantMessage.createdAt.toISOString() : savedAssistantMessage.createdAt,
      requestId: savedAssistantMessage.requestId,
      userMessageId: savedAssistantMessage.userMessageId,
      metadata: savedAssistantMessage.metadata,
    },
  });

  // Send to WhatsApp (split if needed)
  for (const part of chunkText(finalText, 1400)) {
    await whatsappWebManager.sendText(userId, fromJid, part);
  }
}

// Wire inbound WhatsApp messages into IliaGPT chats (in-app inbox) and auto-reply.
whatsappWebManager.on('inbound_message', async (userId: string, msg: { from: string; text: string; messageId?: string; timestamp?: number }) => {
  try {
    // Deduplicate: skip if already processed
    if (msg.messageId && whatsappWebManager.markMessageProcessed(msg.messageId)) {
      return;
    }

    const chatId = safeChatId(userId, msg.from);

    let chat = await storage.getChat(chatId);
    if (!chat) {
      chat = await storage.createChat({
        id: chatId,
        userId,
        title: `WhatsApp: ${msg.from}`,
        archived: 'false',
        hidden: 'false',
        pinned: 'false',
      } as any);
    }

    const savedUserMessage = await storage.createChatMessage({
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

    whatsappWebSseHub.broadcast(userId, 'wa_message', {
      chat: {
        id: chatId,
        title: chat.title,
        channel: 'whatsapp_web',
        archived: chat.archived === 'true',
        hidden: chat.hidden === 'true',
        pinned: chat.pinned === 'true',
        pinnedAt: chat.pinnedAt instanceof Date ? chat.pinnedAt.toISOString() : chat.pinnedAt,
        updatedAt: new Date().toISOString(),
      },
      message: {
        id: savedUserMessage.id,
        role: savedUserMessage.role,
        content: savedUserMessage.content,
        createdAt: savedUserMessage.createdAt instanceof Date ? savedUserMessage.createdAt.toISOString() : savedUserMessage.createdAt,
        requestId: savedUserMessage.requestId,
        userMessageId: savedUserMessage.userMessageId,
        metadata: savedUserMessage.metadata,
      },
    });

    // Fire-and-forget auto-reply.
    void autoReplyFromWhatsApp({
      userId,
      fromJid: msg.from,
      chatId,
      inboundText: msg.text,
      chatTitle: chat.title,
    }).catch((e) => {
      console.error('[WhatsAppWebRouter] autoReply failed:', (e as any)?.message || e);
    });
  } catch (e) {
    console.error('[WhatsAppWebRouter] inbound_message persist failed:', (e as any)?.message || e);
  }
});

whatsappWebManager.on('status', (userId: string, status: any) => {
  whatsappWebSseHub.broadcast(userId, 'wa_status', { status });
});
