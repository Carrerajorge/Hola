import { Router } from 'express';
import type { Response } from 'express';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { and, desc, eq } from 'drizzle-orm';
import { whatsappWebManager } from '../integrations/whatsappWeb';
import { whatsappWebSseHub } from '../integrations/whatsappWebSse';
import { chunkText, isGroupJid, MemorySseResponse } from '../integrations/whatsappWebAutoReply';
import { parseWhatsAppCommand, stripIliaMentionPrefix } from '../integrations/whatsappWebCommands';
import {
  generatePairingCode,
  isController as isWhatsAppController,
  loadWhatsAppWebSettings,
  removeController,
  settingsForClient,
  tryPairController,
  updateWhatsAppWebSettings,
  type WhatsAppWebSettings,
} from '../integrations/whatsappWebSettings';
import type { AuthenticatedRequest } from '../types/express';
import { getSecureUserId } from '../lib/anonUserHelper';
import { sanitizeMessageContent } from '../lib/markdownSanitizer';
import { db } from '../db';
import { storage } from '../storage';
import { llmGateway } from '../lib/llmGateway';
import { agentModeRuns } from '@shared/schema';
import { agentManager } from '../agent/agentOrchestrator';
import { createUnifiedRun, executeUnifiedChat } from '../agent/unifiedChatHandler';

function requireUserId(req: AuthenticatedRequest): string {
  return getSecureUserId(req as any) || '';
}

function safeChatId(userId: string, remoteJid: string): string {
  const raw = `wa_${userId}_${remoteJid}`;
  return raw.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 200);
}

const pairingLimiter = new RateLimiterMemory({ points: 5, duration: 10 * 60 }); // 5 attempts / 10 min
const commandLimiter = new RateLimiterMemory({ points: 12, duration: 60 }); // 12 commands / minute
const autoReplyLimiter = new RateLimiterMemory({ points: 6, duration: 60 }); // 6 replies / minute per controller contact

const autoReplyQueueByChat = new Map<string, Promise<void>>();
function enqueueAutoReply(chatId: string, fn: () => Promise<void>): void {
  const prev = autoReplyQueueByChat.get(chatId) || Promise.resolve();
  const next = prev
    .catch(() => null)
    .then(fn)
    .catch(() => null)
    .finally(() => {
      if (autoReplyQueueByChat.get(chatId) === next) {
        autoReplyQueueByChat.delete(chatId);
      }
    });
  autoReplyQueueByChat.set(chatId, next);
}

const CHAT_LIST_CACHE_TTL_MS = 30 * 60 * 1000;
const lastChatListByController = new Map<string, { ids: string[]; createdAt: number }>();
function controllerCacheKey(userId: string, controllerJid: string): string {
  return `${userId}:${controllerJid}`;
}

function asBoolText(v: unknown): boolean {
  return String(v || '').toLowerCase() === 'true';
}

function truncateOneLine(text: string, maxLen = 80): string {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen - 1) + '…';
}

async function refreshControllerChatList(userId: string, controllerJid: string): Promise<any[]> {
  const key = controllerCacheKey(userId, controllerJid);
  const now = Date.now();

  const all = await storage.getChats(userId);
  const visible = all.filter((c: any) => !asBoolText(c.hidden));
  const ids = visible.slice(0, 50).map((c: any) => c.id);
  lastChatListByController.set(key, { ids, createdAt: now });
  return visible.slice(0, 50) as any[];
}

async function getControllerChatIds(userId: string, controllerJid: string): Promise<string[]> {
  const key = controllerCacheKey(userId, controllerJid);
  const cached = lastChatListByController.get(key);
  if (cached && (Date.now() - cached.createdAt) < CHAT_LIST_CACHE_TTL_MS && cached.ids.length > 0) {
    return cached.ids;
  }

  const chats = await refreshControllerChatList(userId, controllerJid);
  return chats.map((c: any) => c.id);
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

  router.get('/security/settings', async (req, res) => {
    const userId = requireUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const settings = loadWhatsAppWebSettings(userId);
    res.json({ success: true, settings: settingsForClient(settings) });
  });

  router.post('/security/settings', async (req, res) => {
    const userId = requireUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { autoReplyEnabled, controllersOnly, allowAgenticTools, mentionOnly } = req.body || {};
    const autoReplyPatch: Record<string, boolean> = {};
    if (typeof autoReplyEnabled === 'boolean') autoReplyPatch.enabled = autoReplyEnabled;
    if (typeof controllersOnly === 'boolean') autoReplyPatch.controllersOnly = controllersOnly;
    if (typeof allowAgenticTools === 'boolean') autoReplyPatch.allowAgenticTools = allowAgenticTools;
    if (typeof mentionOnly === 'boolean') autoReplyPatch.mentionOnly = mentionOnly;

    const next = updateWhatsAppWebSettings(
      userId,
      Object.keys(autoReplyPatch).length > 0 ? ({ autoReply: autoReplyPatch as any } as any) : {},
    );
    res.json({ success: true, settings: settingsForClient(next) });
  });

  router.post('/security/pairing-code', async (req, res) => {
    const userId = requireUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { code, expiresAt } = generatePairingCode(userId);
    res.json({ success: true, code, expiresAt });
  });

  router.post('/security/controllers/remove', async (req, res) => {
    const userId = requireUserId(req as any);
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { jid } = req.body || {};
    if (!jid || typeof jid !== 'string') return res.status(400).json({ success: false, error: 'jid is required' });

    const next = removeController(userId, jid);
    res.json({ success: true, settings: settingsForClient(next) });
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

async function persistAndBroadcastAssistantMessage(opts: {
  userId: string;
  chatId: string;
  chatTitle: string;
  content: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { userId, chatId, chatTitle, requestId, metadata } = opts;
  const content = sanitizeMessageContent(String(opts.content || '')).trim() || 'Listo.';

  const saved = await storage.createChatMessage({
    chatId,
    role: 'assistant',
    content,
    status: 'done',
    requestId: requestId || undefined,
    metadata: metadata || null,
  } as any);

  await storage.updateChat(chatId, { lastMessageAt: new Date() } as any);

  whatsappWebSseHub.broadcast(userId, 'wa_message', {
    chat: {
      id: chatId,
      title: chatTitle,
      channel: 'whatsapp_web',
      updatedAt: new Date().toISOString(),
    },
    message: {
      id: saved.id,
      role: saved.role,
      content: saved.content,
      createdAt: saved.createdAt instanceof Date ? saved.createdAt.toISOString() : saved.createdAt,
      requestId: saved.requestId,
      userMessageId: saved.userMessageId,
      metadata: saved.metadata,
    },
  });
}

function broadcastChatUpdate(userId: string, chat: any): void {
  if (!chat?.id) return;
  whatsappWebSseHub.broadcast(userId, 'wa_chat_update', {
    chat: {
      id: chat.id,
      title: chat.title,
      archived: asBoolText(chat.archived),
      hidden: asBoolText(chat.hidden),
      pinned: asBoolText(chat.pinned),
      pinnedAt: chat.pinnedAt instanceof Date ? chat.pinnedAt.toISOString() : chat.pinnedAt,
      updatedAt: chat.updatedAt instanceof Date ? chat.updatedAt.toISOString() : new Date().toISOString(),
    },
  });
}

async function autoReplyFromWhatsApp(opts: {
  userId: string;
  fromJid: string;
  chatId: string;
  inboundText: string;
  chatTitle?: string;
  settings: WhatsAppWebSettings;
}): Promise<void> {
  const { userId, fromJid, chatId, chatTitle, settings } = opts;

  // Safety: default to not replying to groups automatically.
  if (isGroupJid(fromJid)) {
    return;
  }

  // Build message history from mirrored chat.
  const history = await storage.getChatMessages(chatId).then((msgs) => msgs.slice(-20));
  const messages: Array<{ role: string; content: string }> = history
    .filter((m: any) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m: any) => ({ role: m.role, content: m.content }));

  const allowAgenticTools = !!settings.autoReply.allowAgenticTools;
  const inboundTrimmed = String(opts.inboundText || '').trim();
  const decision = inboundTrimmed.toUpperCase();
  const isDecision = decision === 'CONFIRM' || decision === 'CANCEL';

  // Handle explicit confirmation/cancel commands without spinning up new runs.
  if (isDecision) {
    if (decision === 'CONFIRM' && !allowAgenticTools) {
      const msg = 'Confirmaciones por WhatsApp están desactivadas (Herramientas/Agent OFF). Confirme desde el panel web.';
      await persistAndBroadcastAssistantMessage({
        userId,
        chatId,
        chatTitle: chatTitle || `WhatsApp: ${fromJid}`,
        content: msg,
        requestId: `wa_confirm_disabled_${Date.now()}`,
        metadata: { channel: 'whatsapp_web', to: fromJid, command: 'confirm' },
      });
      for (const part of chunkText(msg, 1400)) await whatsappWebManager.sendText(userId, fromJid, part);
      return;
    }

    const [pendingRun] = await db.select()
      .from(agentModeRuns)
      .where(and(
        eq(agentModeRuns.chatId, chatId),
        eq(agentModeRuns.status, 'awaiting_confirmation'),
      ))
      .orderBy(desc(agentModeRuns.createdAt))
      .limit(1);

    if (!pendingRun) {
      const msg = 'No hay ninguna acción pendiente para confirmar/cancelar.';
      await persistAndBroadcastAssistantMessage({
        userId,
        chatId,
        chatTitle: chatTitle || `WhatsApp: ${fromJid}`,
        content: msg,
        requestId: `wa_no_pending_${Date.now()}`,
        metadata: { channel: 'whatsapp_web', to: fromJid, command: decision.toLowerCase() },
      });
      for (const part of chunkText(msg, 1400)) await whatsappWebManager.sendText(userId, fromJid, part);
      return;
    }

    if (decision === 'CANCEL') {
      const ok = await agentManager.cancelPendingConfirmation(pendingRun.id);
      const msg = ok ? 'Cancelado.' : 'No se pudo cancelar (run no activo).';
      await persistAndBroadcastAssistantMessage({
        userId,
        chatId,
        chatTitle: chatTitle || `WhatsApp: ${fromJid}`,
        content: msg,
        requestId: `wa_cancel_${pendingRun.id}_${Date.now()}`,
        metadata: { channel: 'whatsapp_web', to: fromJid, command: 'cancel', runId: pendingRun.id },
      });
      for (const part of chunkText(msg, 1400)) await whatsappWebManager.sendText(userId, fromJid, part);
      return;
    }

    const ok = await agentManager.confirmRun(pendingRun.id);
    const pendingInfo = (pendingRun as any).pendingConfirmation?.toolName
      ? ` (${String((pendingRun as any).pendingConfirmation.toolName)})`
      : '';
    const msg = ok ? `Confirmado${pendingInfo}. Ejecutando... (revise el panel web para el progreso)` : 'No se pudo reanudar (run no activo).';
    await persistAndBroadcastAssistantMessage({
      userId,
      chatId,
      chatTitle: chatTitle || `WhatsApp: ${fromJid}`,
      content: msg,
      requestId: `wa_confirm_${pendingRun.id}_${Date.now()}`,
      metadata: { channel: 'whatsapp_web', to: fromJid, command: 'confirm', runId: pendingRun.id },
    });
    for (const part of chunkText(msg, 1400)) await whatsappWebManager.sendText(userId, fromJid, part);
    return;
  }

  // If tools/agent are disabled, explicitly block "!agent".
  if (!allowAgenticTools && /^\s*!agent\b/i.test(opts.inboundText || '')) {
    const msg = 'Modo Agent/Herramientas está desactivado. Active "Herramientas / Agent (!agent)" en la web para usarlo.';
    await persistAndBroadcastAssistantMessage({
      userId,
      chatId,
      chatTitle: chatTitle || `WhatsApp: ${fromJid}`,
      content: msg,
      requestId: `wa_agent_disabled_${Date.now()}`,
      metadata: { channel: 'whatsapp_web', to: fromJid, mode: 'chat' },
    });
    for (const part of chunkText(msg, 1400)) await whatsappWebManager.sendText(userId, fromJid, part);
    return;
  }

  const wantsAgent = allowAgenticTools && /^\s*!agent\b/i.test(opts.inboundText || '');
  const normalizedUserText = wantsAgent
    ? inboundTrimmed.replace(/^\s*!agent\b[:\s]*/i, '').trim()
    : inboundTrimmed;

  // Replace the latest "user" message content so prefixes like "!agent" don't pollute the model context.
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      messages[i] = { ...messages[i], content: normalizedUserText || messages[i].content };
      break;
    }
  }

  let finalText = '';
  let requestId: string | undefined;

  if (wantsAgent) {
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
    }, memRes as any as Response, {
      // Extra guardrails for WhatsApp channel.
      systemPrompt: 'Estás respondiendo por WhatsApp. Mantén respuestas concisas. Evita pedir datos sensibles. ' +
        'Si una acción es riesgosa, explica y pide que lo hagan desde el panel web.',
      channel: 'whatsapp_web',
    });

    const assistantText = memRes.chunks
      .filter(c => c.event === 'chunk' && typeof c.data?.content === 'string')
      .map(c => c.data.content)
      .join('')
      .trim();

    finalText = assistantText || 'Listo.';
    requestId = `wa_out_${unifiedContext.runId}`;
  } else {
    const system = [
      'Eres ILIA, un asistente que responde por WhatsApp.',
      'Seguridad:',
      '- No ejecutes herramientas ni acciones externas.',
      '- Si el usuario pide acciones (enviar correos, mover dinero, etc.), indícale que lo haga desde el panel web.',
      '- No solicites contraseñas, códigos 2FA ni datos sensibles.',
      'Responde en el idioma del usuario y sé breve.',
    ].join('\n');

    const formatted = [
      { role: 'system', content: system },
      ...messages.map((m) => ({ role: m.role as any, content: m.content })),
    ];

    let full = '';
    for await (const chunk of llmGateway.streamChat(formatted as any, {
      userId,
      requestId: `wa_chat_${Date.now()}`,
      disableImageGeneration: true,
    })) {
      if (chunk.content) full += chunk.content;
      if (chunk.done) break;
    }
    finalText = String(full || '').trim() || 'Listo.';
    requestId = `wa_out_chat_${Date.now()}`;
  }

  const safeFinalText = sanitizeMessageContent(finalText);

  await persistAndBroadcastAssistantMessage({
    userId,
    chatId,
    chatTitle: chatTitle || `WhatsApp: ${fromJid}`,
    content: safeFinalText,
    requestId,
    metadata: {
      channel: 'whatsapp_web',
      to: fromJid,
      mode: wantsAgent ? 'agent' : 'chat',
    },
  });

  // Send to WhatsApp (split if needed)
  for (const part of chunkText(safeFinalText, 1400)) {
    await whatsappWebManager.sendText(userId, fromJid, part);
  }
}

// Wire inbound WhatsApp messages into IliaGPT chats (in-app inbox) and auto-reply (AUTOMÁTICO).
whatsappWebManager.on('inbound_message', async (userId: string, msg: { from: string; text: string; messageId?: string; timestamp?: number }) => {
  try {
    const chatId = safeChatId(userId, msg.from);
    const safeInboundText = sanitizeMessageContent(String(msg.text || '')).trim();

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
      content: safeInboundText,
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

    const settings = loadWhatsAppWebSettings(userId);
    const controller = isWhatsAppController(settings, msg.from);
    const cmd = parseWhatsAppCommand(safeInboundText);

    // Safety: do not accept pairing/commands/auto-replies from group chats.
    if (isGroupJid(msg.from)) return;

    // Commands are only honored from controllers, except pairing.
    if (cmd.type !== 'none') {
      try { await commandLimiter.consume(`${userId}:${msg.from}`); } catch { return; }
    }

    if (cmd.type === 'pair') {
      try { await pairingLimiter.consume(`${userId}:${msg.from}`); } catch { return; }

      const result = tryPairController(userId, msg.from, cmd.code);
      if (result.ok) {
        await persistAndBroadcastAssistantMessage({
          userId,
          chatId,
          chatTitle: chat.title,
          content: 'Emparejado OK. Auto-reply activado para este contacto. Envíe HELP para ver comandos.',
          requestId: `wa_pair_ok_${Date.now()}`,
          metadata: { channel: 'whatsapp_web', to: msg.from, command: 'pair' },
        });
        await whatsappWebManager.sendText(userId, msg.from, 'Emparejado OK. Auto-reply activado. Escriba HELP para comandos.');
      } else {
        // Keep this generic to avoid helping brute-force attempts.
        await whatsappWebManager.sendText(userId, msg.from, 'Código inválido o expirado.');
      }
      return;
    }

    if (cmd.type === 'help' && controller) {
      const s = loadWhatsAppWebSettings(userId);
      const mentionHint = s.autoReply.mentionOnly ? 'Tip: para que ILIA responda, escriba \"ILIA <mensaje>\".' : '';
      const help = [
        'Comandos ILIA (WhatsApp):',
        '- STATUS / ESTADO',
        '- STOP / PAUSA',
        '- START / CONTINUAR',
        '- UNPAIR / DESVINCULAR',
        '- CHATS (lista chats recientes)',
        '- OPEN <n> (ver chat n)',
        '- PIN <n> / UNPIN <n>',
        '- ARCHIVE <n> / UNARCHIVE <n>',
        '- !agent <texto> (solo si habilitó herramientas en la web)',
        mentionHint,
      ].filter(Boolean).join('\n');
      await whatsappWebManager.sendText(userId, msg.from, help);
      await persistAndBroadcastAssistantMessage({
        userId,
        chatId,
        chatTitle: chat.title,
        content: help,
        requestId: `wa_help_${Date.now()}`,
        metadata: { channel: 'whatsapp_web', to: msg.from, command: 'help' },
      });
      return;
    }

    if (cmd.type === 'status' && controller) {
      const status = whatsappWebManager.getStatus(userId);
      const s = loadWhatsAppWebSettings(userId);
      const text = [
        `WhatsApp: ${status.state}`,
        `Auto-reply: ${s.autoReply.enabled ? 'ON' : 'OFF'} (${s.autoReply.controllersOnly ? 'controllers' : 'all'})`,
        `Mention-only: ${s.autoReply.mentionOnly ? 'ON' : 'OFF'}`,
        `Tools/agent: ${s.autoReply.allowAgenticTools ? 'ON' : 'OFF'}`,
        `Controllers: ${s.controllers.length}`,
      ].join('\n');
      await whatsappWebManager.sendText(userId, msg.from, text);
      await persistAndBroadcastAssistantMessage({
        userId,
        chatId,
        chatTitle: chat.title,
        content: text,
        requestId: `wa_status_${Date.now()}`,
        metadata: { channel: 'whatsapp_web', to: msg.from, command: 'status' },
      });
      return;
    }

    if (cmd.type === 'stop' && controller) {
      updateWhatsAppWebSettings(userId, { autoReply: { enabled: false } as any });
      await whatsappWebManager.sendText(userId, msg.from, 'Auto-reply desactivado.');
      await persistAndBroadcastAssistantMessage({
        userId,
        chatId,
        chatTitle: chat.title,
        content: 'Auto-reply desactivado.',
        requestId: `wa_stop_${Date.now()}`,
        metadata: { channel: 'whatsapp_web', to: msg.from, command: 'stop' },
      });
      return;
    }

    if (cmd.type === 'start' && controller) {
      updateWhatsAppWebSettings(userId, { autoReply: { enabled: true, controllersOnly: true } as any });
      await whatsappWebManager.sendText(userId, msg.from, 'Auto-reply activado (solo controllers).');
      await persistAndBroadcastAssistantMessage({
        userId,
        chatId,
        chatTitle: chat.title,
        content: 'Auto-reply activado (solo controllers).',
        requestId: `wa_start_${Date.now()}`,
        metadata: { channel: 'whatsapp_web', to: msg.from, command: 'start' },
      });
      return;
    }

    if (cmd.type === 'unpair' && controller) {
      const next = removeController(userId, msg.from);
      await whatsappWebManager.sendText(userId, msg.from, 'Contacto desvinculado.');
      await persistAndBroadcastAssistantMessage({
        userId,
        chatId,
        chatTitle: chat.title,
        content: 'Contacto desvinculado.',
        requestId: `wa_unpair_${Date.now()}`,
        metadata: { channel: 'whatsapp_web', to: msg.from, command: 'unpair' },
      });
      // If no controllers remain, autoReply is disabled automatically by removeController().
      if (next.controllers.length === 0) {
        // no-op
      }
      return;
    }

    if (cmd.type === 'chats' && controller) {
      const chats = await refreshControllerChatList(userId, msg.from);
      const limit = Math.min(Math.max(cmd.limit || 10, 1), 20);
      const items = chats.slice(0, limit);

      const lines = items.map((c: any, idx: number) => {
        const flags: string[] = [];
        if (String(c.id || '').startsWith('wa_')) flags.push('WA');
        if (asBoolText(c.pinned)) flags.push('PIN');
        if (asBoolText(c.archived)) flags.push('ARCH');
        const prefix = flags.length ? `[${flags.join('][')}] ` : '';
        const title = truncateOneLine(c.title || '(sin titulo)', 60) || '(sin titulo)';
        return `${idx + 1}) ${prefix}${title}`;
      });

      const text = lines.length
        ? `Chats recientes:\n${lines.join('\n')}\n\nUse: OPEN 1, PIN 1, ARCHIVE 1, UNARCHIVE 1`
        : 'No hay chats.';

      for (const part of chunkText(text, 1400)) await whatsappWebManager.sendText(userId, msg.from, part);
      await persistAndBroadcastAssistantMessage({
        userId,
        chatId,
        chatTitle: chat.title,
        content: text,
        requestId: `wa_chats_${Date.now()}`,
        metadata: { channel: 'whatsapp_web', to: msg.from, command: 'chats' },
      });
      return;
    }

    if (cmd.type === 'open' && controller) {
      const ids = await getControllerChatIds(userId, msg.from);
      const idx = cmd.index;
      if (!idx || idx < 1 || idx > ids.length) {
        const msgText = 'Índice inválido. Envíe CHATS para ver la lista y luego use OPEN <n>, PIN <n>, ARCHIVE <n>, etc.';
        for (const part of chunkText(msgText, 1400)) await whatsappWebManager.sendText(userId, msg.from, part);
        await persistAndBroadcastAssistantMessage({
          userId,
          chatId,
          chatTitle: chat.title,
          content: msgText,
          requestId: `wa_bad_index_${Date.now()}`,
          metadata: { channel: 'whatsapp_web', to: msg.from, command: 'open' },
        });
        return;
      }

      const targetChatId = ids[idx - 1];
      const target = targetChatId ? await storage.getChat(targetChatId) : null;
      if (!target) {
        lastChatListByController.delete(controllerCacheKey(userId, msg.from));
        const msgText = 'Chat no encontrado. Envíe CHATS para regenerar la lista.';
        for (const part of chunkText(msgText, 1400)) await whatsappWebManager.sendText(userId, msg.from, part);
        await persistAndBroadcastAssistantMessage({
          userId,
          chatId,
          chatTitle: chat.title,
          content: msgText,
          requestId: `wa_open_missing_${Date.now()}`,
          metadata: { channel: 'whatsapp_web', to: msg.from, command: 'open' },
        });
        return;
      }

      const last = await storage.getChatMessages(targetChatId, { limit: 3, orderBy: 'desc' } as any);
      const lastChrono = [...last].reverse();
      const msgLines = lastChrono.map((m: any) => `- ${m.role}: ${truncateOneLine(m.content || '', 120)}`).join('\n');

      const text = [
        `Chat #${idx}: ${truncateOneLine(target.title || '(sin titulo)', 80) || '(sin titulo)'}`,
        `Pinned: ${asBoolText(target.pinned) ? 'yes' : 'no'}`,
        `Archived: ${asBoolText(target.archived) ? 'yes' : 'no'}`,
        msgLines ? `Ultimos mensajes:\n${msgLines}` : 'Sin mensajes.',
      ].join('\n');

      for (const part of chunkText(text, 1400)) await whatsappWebManager.sendText(userId, msg.from, part);
      await persistAndBroadcastAssistantMessage({
        userId,
        chatId,
        chatTitle: chat.title,
        content: text,
        requestId: `wa_open_${targetChatId}_${Date.now()}`,
        metadata: { channel: 'whatsapp_web', to: msg.from, command: 'open', targetChatId },
      });
      return;
    }

    if (cmd.type === 'pin' && controller) {
      const ids = await getControllerChatIds(userId, msg.from);
      const idx = cmd.index;
      if (!idx || idx < 1 || idx > ids.length) {
        await whatsappWebManager.sendText(userId, msg.from, 'Índice inválido. Envíe CHATS y luego PIN <n>.');
        return;
      }
      const targetChatId = ids[idx - 1];
      lastChatListByController.delete(controllerCacheKey(userId, msg.from));
      const updated = targetChatId ? await storage.updateChat(targetChatId, { pinned: 'true', pinnedAt: new Date() } as any) : null;
      if (updated) broadcastChatUpdate(userId, updated);
      const text = updated ? `OK. Fijado #${idx}: ${truncateOneLine(updated.title || '', 80) || targetChatId}` : 'No se pudo fijar el chat.';
      for (const part of chunkText(text, 1400)) await whatsappWebManager.sendText(userId, msg.from, part);
      await persistAndBroadcastAssistantMessage({
        userId,
        chatId,
        chatTitle: chat.title,
        content: text,
        requestId: `wa_pin_${targetChatId || 'missing'}_${Date.now()}`,
        metadata: { channel: 'whatsapp_web', to: msg.from, command: 'pin', targetChatId },
      });
      return;
    }

    if (cmd.type === 'unpin' && controller) {
      const ids = await getControllerChatIds(userId, msg.from);
      const idx = cmd.index;
      if (!idx || idx < 1 || idx > ids.length) {
        await whatsappWebManager.sendText(userId, msg.from, 'Índice inválido. Envíe CHATS y luego UNPIN <n>.');
        return;
      }
      const targetChatId = ids[idx - 1];
      lastChatListByController.delete(controllerCacheKey(userId, msg.from));
      const updated = targetChatId ? await storage.updateChat(targetChatId, { pinned: 'false', pinnedAt: null } as any) : null;
      if (updated) broadcastChatUpdate(userId, updated);
      const text = updated ? `OK. Desfijado #${idx}: ${truncateOneLine(updated.title || '', 80) || targetChatId}` : 'No se pudo desfijar el chat.';
      for (const part of chunkText(text, 1400)) await whatsappWebManager.sendText(userId, msg.from, part);
      await persistAndBroadcastAssistantMessage({
        userId,
        chatId,
        chatTitle: chat.title,
        content: text,
        requestId: `wa_unpin_${targetChatId || 'missing'}_${Date.now()}`,
        metadata: { channel: 'whatsapp_web', to: msg.from, command: 'unpin', targetChatId },
      });
      return;
    }

    if (cmd.type === 'archive' && controller) {
      const ids = await getControllerChatIds(userId, msg.from);
      const idx = cmd.index;
      if (!idx || idx < 1 || idx > ids.length) {
        await whatsappWebManager.sendText(userId, msg.from, 'Índice inválido. Envíe CHATS y luego ARCHIVE <n>.');
        return;
      }
      const targetChatId = ids[idx - 1];
      lastChatListByController.delete(controllerCacheKey(userId, msg.from));
      const updated = targetChatId ? await storage.updateChat(targetChatId, { archived: 'true' } as any) : null;
      if (updated) broadcastChatUpdate(userId, updated);
      const text = updated ? `OK. Archivado #${idx}: ${truncateOneLine(updated.title || '', 80) || targetChatId}` : 'No se pudo archivar el chat.';
      for (const part of chunkText(text, 1400)) await whatsappWebManager.sendText(userId, msg.from, part);
      await persistAndBroadcastAssistantMessage({
        userId,
        chatId,
        chatTitle: chat.title,
        content: text,
        requestId: `wa_archive_${targetChatId || 'missing'}_${Date.now()}`,
        metadata: { channel: 'whatsapp_web', to: msg.from, command: 'archive', targetChatId },
      });
      return;
    }

    if (cmd.type === 'unarchive' && controller) {
      const ids = await getControllerChatIds(userId, msg.from);
      const idx = cmd.index;
      if (!idx || idx < 1 || idx > ids.length) {
        await whatsappWebManager.sendText(userId, msg.from, 'Índice inválido. Envíe CHATS y luego UNARCHIVE <n>.');
        return;
      }
      const targetChatId = ids[idx - 1];
      lastChatListByController.delete(controllerCacheKey(userId, msg.from));
      const updated = targetChatId ? await storage.updateChat(targetChatId, { archived: 'false' } as any) : null;
      if (updated) broadcastChatUpdate(userId, updated);
      const text = updated ? `OK. Desarchivado #${idx}: ${truncateOneLine(updated.title || '', 80) || targetChatId}` : 'No se pudo desarchivar el chat.';
      for (const part of chunkText(text, 1400)) await whatsappWebManager.sendText(userId, msg.from, part);
      await persistAndBroadcastAssistantMessage({
        userId,
        chatId,
        chatTitle: chat.title,
        content: text,
        requestId: `wa_unarchive_${targetChatId || 'missing'}_${Date.now()}`,
        metadata: { channel: 'whatsapp_web', to: msg.from, command: 'unarchive', targetChatId },
      });
      return;
    }

    // Auto-reply security gate:
    // - Off by default, opt-in required (via UI or pairing).
    // - Default: only controllers can trigger replies.
    if (!settings.autoReply.enabled) return;
    if (settings.autoReply.controllersOnly && !controller) return;
    if (isGroupJid(msg.from)) return;

    const decision = safeInboundText.trim().toUpperCase();
    const isDecision = decision === 'CONFIRM' || decision === 'CANCEL';
    const { mentioned, cleanedText } = stripIliaMentionPrefix(safeInboundText);
    const textForAutoReply = mentioned ? cleanedText : safeInboundText;
    const wantsAgent = /^\s*!agent\b/i.test(textForAutoReply);

    // Mention-only safety: ignore non-mention, non-command messages.
    if (settings.autoReply.mentionOnly && !mentioned && !wantsAgent && !isDecision) return;

    // If controller pings "ILIA" with no content, provide a tiny hint instead of invoking the model.
    if (mentioned && !textForAutoReply) {
      const msgText = 'Listo. Envíe: "ILIA <mensaje>" (o HELP para comandos).';
      await whatsappWebManager.sendText(userId, msg.from, msgText);
      await persistAndBroadcastAssistantMessage({
        userId,
        chatId,
        chatTitle: chat.title,
        content: msgText,
        requestId: `wa_ilia_ping_${Date.now()}`,
        metadata: { channel: 'whatsapp_web', to: msg.from, mode: 'ping' },
      });
      return;
    }

    try { await autoReplyLimiter.consume(`${userId}:${msg.from}`); } catch { return; }

    enqueueAutoReply(chatId, async () => {
      await autoReplyFromWhatsApp({
        userId,
        fromJid: msg.from,
        chatId,
        inboundText: textForAutoReply,
        chatTitle: chat.title,
        settings: loadWhatsAppWebSettings(userId),
      });
    });
  } catch (e) {
    console.error('[WhatsAppWebRouter] inbound_message persist failed:', (e as any)?.message || e);
  }
});

whatsappWebManager.on('status', (userId: string, status: any) => {
  whatsappWebSseHub.broadcast(userId, 'wa_status', { status });
});
