import { Router } from 'express';
import type { Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { whatsappWebManager, type WhatsAppMediaAttachment } from '../integrations/whatsappWeb';
import { whatsappWebSseHub } from '../integrations/whatsappWebSse';
import { chunkText, isGroupJid, MemorySseResponse } from '../integrations/whatsappWebAutoReply';
import {
  normalizeWhatsAppMessage,
  decideReply,
  type MessageEnvelope,
  type ReplyDecision,
} from '../integrations/replyModeEngine';
import type { AutoReplyScope } from '../../shared/schema/autoReplyConfig';
import type { AuthenticatedRequest } from '../types/express';
import { getSecureUserId } from '../lib/anonUserHelper';
import { storage } from '../storage';
import { createUnifiedRun, executeUnifiedChat } from '../agent/unifiedChatHandler';

// Auto-reply timeout: 120 seconds max (document generation needs extra time)
const AUTO_REPLY_TIMEOUT_MS = 120_000;

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

    // Load persistent config
    let autoReplyScope: AutoReplyScope = 'OWNER_ONLY';
    let allowlist: string[] = [];
    let allowGroups = false;
    try {
      const config = await storage.getAutoReplyConfig(userId, 'whatsapp_web');
      if (config) {
        autoReplyScope = config.autoReplyScope as AutoReplyScope;
        allowlist = (config.allowlist as string[]) || [];
        allowGroups = config.allowGroups ?? false;
      }
    } catch { /* ignore - table may not exist yet */ }

    res.json({
      success: true,
      status,
      autoReply,
      ownerAssistEnabled: true, // Always ON — cannot be disabled
      autoReplyScope,
      allowlist,
      allowGroups,
    });
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

  // ── Legacy toggle (kept for backward compatibility) ──
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

  // ── NEW: Set auto-reply scope (persistent) ──
  router.post('/auto-reply-scope', async (req, res) => {
    const userId = requireUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { scope, allowlist, allowGroups } = (req.body || {}) as {
      scope?: string;
      allowlist?: string[];
      allowGroups?: boolean;
    };

    const validScopes = ['OWNER_ONLY', 'ALLOWLIST', 'ALL_CONTACTS'];
    if (!scope || !validScopes.includes(scope)) {
      return res.status(400).json({
        success: false,
        error: `scope must be one of: ${validScopes.join(', ')}`,
      });
    }

    try {
      const ownerJid = whatsappWebManager.getOwnerJid(userId);
      const config = await storage.upsertAutoReplyConfig({
        userId,
        channel: 'whatsapp_web',
        channelAccountId: ownerJid || undefined,
        autoReplyScope: scope,
        allowlist: allowlist || [],
        allowGroups: allowGroups ?? false,
      } as any);

      // Also update the in-memory toggle to match:
      // If scope != OWNER_ONLY, enable in-memory auto-reply
      whatsappWebManager.setAutoReply(userId, scope !== 'OWNER_ONLY');

      // Broadcast the updated config so UI reflects immediately
      whatsappWebSseHub.broadcast(userId, 'wa_status', {
        status: whatsappWebManager.getStatus(userId),
        autoReplyScope: config.autoReplyScope,
        ownerAssistEnabled: true,
      });

      res.json({
        success: true,
        autoReplyScope: config.autoReplyScope,
        allowlist: config.allowlist,
        allowGroups: config.allowGroups,
        ownerAssistEnabled: true,
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || 'Error al actualizar configuración' });
    }
  });

  // ── NEW: Per-thread auto-reply override ──
  router.post('/thread-auto-reply', async (req, res) => {
    const userId = requireUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { threadId, enabled } = (req.body || {}) as { threadId?: string; enabled?: boolean | null };
    if (!threadId) {
      return res.status(400).json({ success: false, error: 'threadId is required' });
    }

    try {
      if (enabled === null || enabled === undefined) {
        // Remove override — fall back to global scope
        await storage.deleteThreadAutoReplyOverride(userId, 'whatsapp_web', threadId);
        res.json({ success: true, threadId, override: null });
      } else {
        const override = await storage.upsertThreadAutoReplyOverride({
          userId,
          channel: 'whatsapp_web',
          threadId,
          autoReplyEnabled: enabled,
        } as any);
        res.json({ success: true, threadId, override: override.autoReplyEnabled });
      }
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || 'Error al actualizar override' });
    }
  });

  // Send a test message to the user's own WhatsApp number
  router.post('/test', async (req, res) => {
    const userId = requireUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const status = whatsappWebManager.getStatus(userId);
    if (status.state !== 'connected' || !status.me?.id) {
      return res.status(400).json({ success: false, error: 'WhatsApp no está conectado' });
    }

    // The me.id from Baileys is like "51918714054:42@s.whatsapp.net" — extract the base JID
    const myJid = status.me.id.includes(':')
      ? status.me.id.split(':')[0] + '@s.whatsapp.net'
      : status.me.id;

    const testMessage = `Hola desde ILIAGPT! Tu WhatsApp está conectado correctamente.\n\nPuedes enviarme mensajes aquí y te responderé con IA. Prueba escribiéndome algo!`;

    try {
      await whatsappWebManager.sendText(userId, myJid, testMessage);
      res.json({ success: true, sentTo: myJid });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || 'Error al enviar mensaje de prueba' });
    }
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AUTO-REPLY HANDLER — uses the split-mode reply engine
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function autoReplyFromWhatsApp(opts: {
  userId: string;
  fromJid: string;
  chatId: string;
  inboundText: string;
  chatTitle?: string;
  media?: WhatsAppMediaAttachment;
  envelope: MessageEnvelope;
  decision: ReplyDecision;
}): Promise<void> {
  const { userId, fromJid, chatId, chatTitle, media, envelope, decision } = opts;
  const runId = `wa_run_${randomUUID()}`;
  const requestId = `wa_req_${randomUUID()}`;

  console.log(
    `[WhatsApp AutoReply] Processing message from ${fromJid} for user ${userId}` +
    ` | isOwner=${envelope.isOwner} | reason=${decision.reason} | runId=${runId}` +
    `${media ? ` [media: ${media.type}]` : ''}`,
  );

  // Build message history from mirrored chat (isolated by conversationKey via chatId).
  const history = await storage.getChatMessages(chatId).then((msgs) => msgs.slice(-20));
  const messages: Array<{ role: string; content: string }> = history
    .filter((m: any) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m: any) => ({ role: m.role, content: m.content }));

  // If the message has an image, inject a system hint about the image being available
  if (media && media.type === 'image') {
    const lastUserMsg = messages[messages.length - 1];
    if (lastUserMsg && lastUserMsg.role === 'user') {
      const b64 = media.buffer.toString('base64');
      const dataUrl = `data:${media.mimetype};base64,${b64}`;
      lastUserMsg.content = `${lastUserMsg.content}\n\n[Imagen adjunta - data URL: ${dataUrl}]`;
    }
  }

  // If the message has a document, add context about the document
  if (media && media.type === 'document') {
    const lastUserMsg = messages[messages.length - 1];
    if (lastUserMsg && lastUserMsg.role === 'user') {
      lastUserMsg.content = `${lastUserMsg.content}\n\n[Documento adjunto: ${media.fileName} (${media.mimetype}), guardado en: ${media.localPath}]`;
    }
  }

  // Audio: add a note that a voice message was received
  if (media && media.type === 'audio') {
    const lastUserMsg = messages[messages.length - 1];
    if (lastUserMsg && lastUserMsg.role === 'user') {
      lastUserMsg.content = `${lastUserMsg.content}\n\n[Mensaje de voz recibido (${media.mimetype}), guardado en: ${media.localPath}. No se puede transcribir automáticamente por ahora.]`;
    }
  }

  const messageId = `wa_msg_${Date.now()}`;
  const unifiedContext = await createUnifiedRun({
    messages,
    chatId,
    userId,
    messageId,
  });

  const memRes = new MemorySseResponse();

  console.log(`[WhatsApp AutoReply] runId=${runId} Calling executeUnifiedChat with ${messages.length} messages...`);

  // Execute with timeout to prevent hanging — never infinite spinner
  try {
    await withTimeout(
      executeUnifiedChat(unifiedContext, {
        messages,
        chatId,
        userId,
        messageId,
      }, memRes as any as Response),
      AUTO_REPLY_TIMEOUT_MS,
      'Auto-reply AI',
    );
  } catch (timeoutErr: any) {
    console.error(`[WhatsApp AutoReply] runId=${runId} TIMEOUT/ERROR: ${timeoutErr?.message}`);
    // On timeout: send a fallback message instead of silence
    const fallbackText = envelope.isOwner
      ? 'Lo siento, la respuesta tardó demasiado. Por favor intenta de nuevo.'
      : 'Estamos procesando tu mensaje. Por favor espera un momento.';

    await persistAndSend({
      userId, fromJid, chatId, chatTitle, finalText: fallbackText,
      runId, requestId, envelope,
    });
    return;
  }

  console.log(`[WhatsApp AutoReply] runId=${runId} AI finished. Chunks: ${memRes.chunks.length}`);

  const assistantText = memRes.chunks
    .filter(c => c.event === 'chunk' && typeof c.data?.content === 'string')
    .map(c => c.data.content)
    .join('')
    .trim();

  const confirmationEvent = memRes.chunks.find(c => c.event === 'confirmation');

  const finalText = assistantText || (confirmationEvent
    ? 'Listo. Responda CONFIRM o CANCEL para continuar.'
    : 'Listo.');

  await persistAndSend({
    userId, fromJid, chatId, chatTitle, finalText,
    runId, requestId, envelope,
  });

  // Check for generated artifacts (documents, spreadsheets, presentations) and send them
  const artifactEvents = memRes.chunks.filter(c => c.event === 'artifacts' && c.data?.artifacts);
  for (const evt of artifactEvents) {
    const artifacts: Array<{ type?: string; url?: string; name?: string }> = evt.data.artifacts || [];
    for (const artifact of artifacts) {
      if (!artifact.name) continue;

      const filePath = path.join(process.cwd(), 'generated_artifacts', artifact.name);
      try {
        const fileBuffer = await fs.readFile(filePath);
        const ext = path.extname(artifact.name).toLowerCase();
        const mimeMap: Record<string, string> = {
          '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          '.pdf': 'application/pdf',
        };
        const mimetype = mimeMap[ext] || 'application/octet-stream';

        console.log(`[WhatsApp AutoReply] runId=${runId} Sending document "${artifact.name}" (${fileBuffer.length} bytes) to ${fromJid}`);
        await whatsappWebManager.sendDocument(userId, fromJid, fileBuffer, artifact.name, mimetype, `Documento generado: ${artifact.name}`);
        console.log(`[WhatsApp AutoReply] runId=${runId} Document "${artifact.name}" sent successfully`);
      } catch (fileErr: any) {
        console.error(`[WhatsApp AutoReply] runId=${runId} Failed to send document "${artifact.name}":`, fileErr?.message || fileErr);
      }
    }
  }

  console.log(`[WhatsApp AutoReply] runId=${runId} Reply sent successfully`);
}

/** Persist assistant message to DB, broadcast to UI, send to WhatsApp */
async function persistAndSend(opts: {
  userId: string;
  fromJid: string;
  chatId: string;
  chatTitle?: string;
  finalText: string;
  runId: string;
  requestId: string;
  envelope: MessageEnvelope;
}): Promise<void> {
  const { userId, fromJid, chatId, chatTitle, finalText, runId, requestId, envelope } = opts;

  const savedAssistantMessage = await storage.createChatMessage({
    chatId,
    role: 'assistant',
    content: finalText,
    status: 'done',
    requestId: `wa_out_${runId}`,
    metadata: {
      channel: 'whatsapp_web',
      to: fromJid,
      runId,
      requestId,
      isOwnerReply: envelope.isOwner,
      conversationKey: envelope.conversationKey,
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

  console.log(`[WhatsApp AutoReply] runId=${runId} Sending reply (${finalText.length} chars) to ${fromJid}`);

  // Send to WhatsApp (split if needed)
  for (const part of chunkText(finalText, 1400)) {
    await whatsappWebManager.sendText(userId, fromJid, part);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INBOUND MESSAGE HANDLER — the main entry point
// Normalizes to MessageEnvelope → runs reply decision engine → dispatches
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

whatsappWebManager.on('inbound_message', async (userId: string, msg: {
  from: string;
  text: string;
  messageId?: string;
  timestamp?: number;
  media?: WhatsAppMediaAttachment;
  fromMe?: boolean;
  ownerJid?: string;
}) => {
  try {
    const mediaTag = msg.media ? ` [${msg.media.type}: ${msg.media.fileName || msg.media.mimetype}]` : '';
    console.log(`[WhatsAppWebRouter] inbound_message from=${msg.from} text="${msg.text.slice(0, 80)}..."${mediaTag} msgId=${msg.messageId}`);

    // ── Deduplicate: skip if already processed ──
    if (msg.messageId && whatsappWebManager.markMessageProcessed(msg.messageId)) {
      console.log(`[WhatsAppWebRouter] Skipping duplicate message ${msg.messageId}`);
      return;
    }

    // ── Normalize to MessageEnvelope ──
    const ownerJid = msg.ownerJid || whatsappWebManager.getOwnerJid(userId);
    const envelope = normalizeWhatsAppMessage({
      userId,
      fromJid: msg.from,
      ownerJid,
      fromMe: msg.fromMe ?? false,
      text: msg.text,
      messageId: msg.messageId,
      timestamp: msg.timestamp,
      media: msg.media,
    });

    // ── ChatId is isolated by conversationKey: {userId, channel, channelAccountId, threadId} ──
    const chatId = safeChatId(userId, msg.from);

    // Format a clean title
    const phoneNumber = msg.from.replace(/@s\.whatsapp\.net$/, '').replace(/@lid$/, '');
    const chatTitle = /^\d+$/.test(phoneNumber) ? `WhatsApp: +${phoneNumber}` : `WhatsApp: ${phoneNumber}`;

    let chat = await storage.getChat(chatId);
    if (!chat) {
      chat = await storage.createChat({
        id: chatId,
        userId,
        title: chatTitle,
        archived: 'false',
        hidden: 'false',
        pinned: 'false',
      } as any);
    }

    // ── Persist inbound user message (always, regardless of reply decision) ──
    const messageMetadata: Record<string, any> = {
      channel: 'whatsapp_web',
      from: msg.from,
      timestamp: msg.timestamp,
      isOwner: envelope.isOwner,
      conversationKey: envelope.conversationKey,
    };
    if (msg.media) {
      messageMetadata.media = {
        type: msg.media.type,
        mimetype: msg.media.mimetype,
        fileName: msg.media.fileName,
        localPath: msg.media.localPath,
      };
    }

    const savedUserMessage = await storage.createChatMessage({
      chatId,
      role: 'user',
      content: msg.text,
      status: 'done',
      requestId: msg.messageId ? `wa_${msg.messageId}` : undefined,
      metadata: messageMetadata,
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

    // ━━━ REPLY DECISION ENGINE ━━━
    // Load persistent auto-reply config
    let autoReplyScope: AutoReplyScope = 'OWNER_ONLY';
    let allowlist: string[] = [];
    let allowGroups = false;
    try {
      const config = await storage.getAutoReplyConfig(userId, 'whatsapp_web');
      if (config) {
        autoReplyScope = config.autoReplyScope as AutoReplyScope;
        allowlist = (config.allowlist as string[]) || [];
        allowGroups = config.allowGroups ?? false;
      }
    } catch {
      // Table may not exist yet — use defaults (OWNER_ONLY)
    }

    // Check for per-thread override
    let threadOverride: boolean | null = null;
    try {
      const override = await storage.getThreadAutoReplyOverride(userId, 'whatsapp_web', msg.from);
      if (override) {
        threadOverride = override.autoReplyEnabled;
      }
    } catch {
      // ignore — table may not exist
    }

    // Also check in-memory legacy toggle (backward compat)
    // If legacy toggle is OFF and scope is OWNER_ONLY, that means old behavior: only owner gets replies
    // The new system supersedes this, but we respect the legacy toggle as a safety net
    const legacyAutoReply = whatsappWebManager.isAutoReplyEnabled(userId);

    const decision = decideReply({
      envelope,
      autoReplyScope: legacyAutoReply ? autoReplyScope : 'OWNER_ONLY',
      allowlist,
      allowGroups,
      threadOverride,
    });

    console.log(
      `[WhatsAppWebRouter] Reply decision: shouldReply=${decision.shouldReply}` +
      ` reason=${decision.reason} isOwner=${envelope.isOwner}` +
      ` scope=${autoReplyScope} legacyToggle=${legacyAutoReply}`,
    );

    // ── GATE: if (!isOwner && !shouldReply) return ──
    // CRITICAL: Owner is NEVER blocked. The decision engine guarantees this,
    // but we add an explicit safety check here.
    if (!decision.shouldReply && !envelope.isOwner) {
      console.log(`[WhatsAppWebRouter] Skipping auto-reply: ${decision.reason}`);
      return;
    }

    // If decision says reply, or if it's the owner, proceed with auto-reply
    void autoReplyFromWhatsApp({
      userId,
      fromJid: msg.from,
      chatId,
      inboundText: msg.text,
      chatTitle: chat.title,
      media: msg.media,
      envelope,
      decision,
    }).catch((e) => {
      console.error(`[WhatsAppWebRouter] autoReply failed:`, (e as any)?.message || e);
    });
  } catch (e) {
    console.error('[WhatsAppWebRouter] inbound_message persist failed:', (e as any)?.message || e);
  }
});

whatsappWebManager.on('status', (userId: string, status: any) => {
  whatsappWebSseHub.broadcast(userId, 'wa_status', { status });
});
