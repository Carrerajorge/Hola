import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';
import pino from 'pino';

// NOTE: This integration uses an *unofficial* WhatsApp Web protocol library (Baileys).
// It enables QR-based linking for a phone-controlled WhatsApp account.
// This is not a security bypass/intrusion: the user must scan the QR from their own WhatsApp.

import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WASocket,
  type WAMessage,
  type AuthenticationState,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';

// Silent logger for Baileys — suppresses noisy internal logs
const baileysLogger = pino({ level: 'silent' });

export type WhatsAppWebStatus =
  | { state: 'disconnected'; reason?: string }
  | { state: 'connecting' }
  | { state: 'qr'; qr: string }
  | { state: 'pairing_code'; phone: string; code: string }
  | { state: 'connected'; me?: { id?: string; name?: string; lid?: string } };

export interface WhatsAppMediaAttachment {
  type: 'image' | 'document' | 'audio' | 'video' | 'sticker';
  buffer: Buffer;
  mimetype: string;
  fileName?: string;
  caption?: string;
  /** Local path where the file was saved */
  localPath: string;
}

export interface WhatsAppInboundMessage {
  from: string;
  text: string;
  messageId?: string;
  timestamp?: number;
  media?: WhatsAppMediaAttachment;
}

export interface WhatsAppWebEvents {
  status: (userId: string, status: WhatsAppWebStatus) => void;
  inbound_message: (userId: string, msg: WhatsAppInboundMessage) => void;
}

interface SocketRecord {
  sock: WASocket;
  auth: AuthenticationState;
  status: WhatsAppWebStatus;
  qrCount: number;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  autoReplyEnabled: boolean;
}

export class WhatsAppWebManager extends EventEmitter {
  private sockets = new Map<string, SocketRecord>();
  // Persist lightweight per-user preferences even when the socket is not connected.
  private autoReplyPrefs = new Map<string, boolean>();
  private autoReplyToContactsPrefs = new Map<string, boolean>();
  private autoReplyPrompts = new Map<string, string>();
  private autoReplySettingsLoaded = new Set<string>();
  private reconnectAttempts = new Map<string, number>();
  // Track processed message IDs to prevent duplicate auto-replies
  private processedMessages = new Map<string, number>();
  // Track message IDs sent by the bot to avoid infinite self-chat loops
  private botSentMessageIds = new Set<string>();
  private processedMessagesCleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();
    // Cleanup old processed message IDs every 5 minutes
    this.processedMessagesCleanupTimer = setInterval(() => {
      const cutoff = Date.now() - 5 * 60_000;
      for (const [key, ts] of this.processedMessages) {
        if (ts < cutoff) this.processedMessages.delete(key);
      }
    }, 5 * 60_000);
    this.processedMessagesCleanupTimer?.unref?.();
  }

  private sessionDirForUser(userId: string): string {
    // Try primary path first (works in Docker with /app/data pre-created),
    // fall back to OS temp dir if the primary is not writable (local dev, etc.)
    const primary = path.join(process.cwd(), 'data', 'whatsapp-web');
    const fallback = path.join(os.tmpdir(), 'whatsapp-web-sessions');

    for (const base of [primary, fallback]) {
      const dir = path.join(base, userId);
      try {
        fs.mkdirSync(dir, { recursive: true });
        return dir;
      } catch (e: any) {
        if (e?.code === 'EACCES') {
          console.warn(`[WhatsApp] Permission denied creating ${dir}, trying fallback...`);
          continue;
        }
        throw e;
      }
    }

    // Should not reach here, but just in case
    throw new Error('No se pudo crear el directorio de sesión WhatsApp (permiso denegado)');
  }

  private autoReplySettingsPath(userId: string): string {
    return path.join(this.sessionDirForUser(userId), 'auto-reply-settings.json');
  }

  private loadAutoReplySettingsOnce(userId: string): void {
    if (this.autoReplySettingsLoaded.has(userId)) return;
    this.autoReplySettingsLoaded.add(userId);

    try {
      const settingsPath = this.autoReplySettingsPath(userId);
      if (!fs.existsSync(settingsPath)) return;

      const raw = fs.readFileSync(settingsPath, 'utf8');
      const parsed = JSON.parse(raw) as any;

      if (typeof parsed?.autoReplyEnabled === 'boolean') {
        this.autoReplyPrefs.set(userId, parsed.autoReplyEnabled);
      }
      if (typeof parsed?.autoReplyToContacts === 'boolean') {
        this.autoReplyToContactsPrefs.set(userId, parsed.autoReplyToContacts);
      }
      if (typeof parsed?.customPrompt === 'string') {
        this.autoReplyPrompts.set(userId, parsed.customPrompt);
      }
    } catch (e: any) {
      console.warn('[WhatsApp] Failed to load auto-reply settings:', e?.message || e);
    }
  }

  private persistAutoReplySettings(userId: string): void {
    try {
      const settingsPath = this.autoReplySettingsPath(userId);
      const tmp = `${settingsPath}.tmp`;
      const payload = {
        autoReplyEnabled: this.autoReplyPrefs.get(userId) ?? false,
        autoReplyToContacts: this.autoReplyToContactsPrefs.get(userId) ?? false,
        customPrompt: this.autoReplyPrompts.get(userId) ?? '',
        updatedAt: new Date().toISOString(),
      };

      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmp, settingsPath);
    } catch (e: any) {
      console.warn('[WhatsApp] Failed to persist auto-reply settings:', e?.message || e);
    }
  }

  private cleanSessionDir(userId: string): void {
    try {
      const dir = this.sessionDirForUser(userId);
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  }

  getStatus(userId: string): WhatsAppWebStatus {
    return this.sockets.get(userId)?.status || { state: 'disconnected' };
  }

  isAutoReplyEnabled(userId: string): boolean {
    this.loadAutoReplySettingsOnce(userId);
    const socketVal = this.sockets.get(userId)?.autoReplyEnabled;
    if (typeof socketVal === 'boolean') return socketVal;
    // Default to OFF for safety; auto-replies should be explicitly enabled by the user.
    return this.autoReplyPrefs.get(userId) ?? false;
  }

  setAutoReply(userId: string, enabled: boolean): void {
    this.loadAutoReplySettingsOnce(userId);
    this.autoReplyPrefs.set(userId, enabled);
    const rec = this.sockets.get(userId);
    if (rec) rec.autoReplyEnabled = enabled;
    this.persistAutoReplySettings(userId);
  }

  isAutoReplyToContactsEnabled(userId: string): boolean {
    this.loadAutoReplySettingsOnce(userId);
    return this.autoReplyToContactsPrefs.get(userId) ?? false;
  }

  setAutoReplyToContacts(userId: string, enabled: boolean): void {
    this.loadAutoReplySettingsOnce(userId);
    this.autoReplyToContactsPrefs.set(userId, enabled);
    this.persistAutoReplySettings(userId);
  }

  getAutoReplyPrompt(userId: string): string {
    this.loadAutoReplySettingsOnce(userId);
    return this.autoReplyPrompts.get(userId) ?? '';
  }

  setAutoReplyPrompt(userId: string, prompt: string): void {
    this.loadAutoReplySettingsOnce(userId);
    this.autoReplyPrompts.set(userId, prompt);
    this.persistAutoReplySettings(userId);
  }

  /**
   * Check if a message ID has already been processed (prevents duplicate replies).
   * Returns true if already processed.
   */
  markMessageProcessed(messageId: string): boolean {
    if (this.processedMessages.has(messageId)) return true;
    this.processedMessages.set(messageId, Date.now());
    return false;
  }

  /**
   * Start a WhatsApp session and wait for the first QR to be ready.
   */
  async start(userId: string): Promise<WhatsAppWebStatus> {
    return this.startWithOptions(userId);
  }

  /**
   * Force-restart: kills any existing socket, clears state, starts fresh.
   */
  async restart(userId: string, opts?: { phone?: string }): Promise<WhatsAppWebStatus> {
    await this.forceCleanup(userId);
    return this.startWithOptions(userId, opts);
  }

  /**
   * Start a WhatsApp Web session. If `phone` is provided, we will attempt to generate
   * a pairing code (link by phone number) instead of requiring QR scanning.
   *
   * Returns a Promise that resolves once QR/pairing_code is ready (or timeout).
   */
  async startWithOptions(userId: string, opts?: { phone?: string }): Promise<WhatsAppWebStatus> {
    this.loadAutoReplySettingsOnce(userId);
    const existing = this.sockets.get(userId);
    if (existing) {
      if (existing.status.state === 'connected' ||
        existing.status.state === 'qr' ||
        existing.status.state === 'pairing_code') {
        return existing.status;
      }
      await this.forceCleanup(userId);
    }

    const sessionDir = this.sessionDirForUser(userId);

    let state: AuthenticationState;
    let saveCreds: () => Promise<void>;
    try {
      const authResult = await useMultiFileAuthState(sessionDir);
      state = authResult.state;
      saveCreds = authResult.saveCreds;
    } catch (e) {
      console.warn('[WhatsApp] Corrupted session, clearing...', userId);
      this.cleanSessionDir(userId);
      const authResult = await useMultiFileAuthState(this.sessionDirForUser(userId));
      state = authResult.state;
      saveCreds = authResult.saveCreds;
    }

    // Fetch Baileys version with fallback
    let version: [number, number, number] | undefined;
    try {
      const vResult = await fetchLatestBaileysVersion();
      version = vResult.version;
    } catch {
      console.warn('[WhatsApp] Could not fetch latest version, using default');
      version = undefined;
    }

    const sockOpts: any = {
      auth: state,
      printQRInTerminal: false,
      browser: ['ILIAGPT', 'Chrome', '1.0.0'] as [string, string, string],
      logger: baileysLogger,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      connectTimeoutMs: 30_000,
      qrTimeout: 60_000,
    };
    if (version) {
      sockOpts.version = version;
    }

    const sock = makeWASocket(sockOpts);

    const record: SocketRecord = {
      sock,
      auth: state,
      status: { state: 'connecting' },
      qrCount: 0,
      autoReplyEnabled: this.autoReplyPrefs.get(userId) ?? false,
    };
    this.sockets.set(userId, record);
    this.reconnectAttempts.set(userId, 0);
    this.emit('status', userId, record.status);

    // Promise that resolves when QR is ready, connected, or on timeout
    const qrReady = new Promise<WhatsAppWebStatus>((resolve) => {
      let resolved = false;
      const done = (s: WhatsAppWebStatus) => {
        if (resolved) return;
        resolved = true;
        // Clean up the listener to prevent memory leak
        sock.ev.off('connection.update', onUpdate);
        if (pairingInterval) clearInterval(pairingInterval);
        clearTimeout(timeout);
        resolve(s);
      };

      const timeout = setTimeout(() => {
        done(record.status);
      }, 15_000);
      timeout.unref?.();

      const onUpdate = (update: any) => {
        if (update.qr || update.connection === 'open' || update.connection === 'close') {
          done(record.status);
        }
      };
      sock.ev.on('connection.update', onUpdate);

      // For pairing codes, poll until status changes
      let pairingInterval: ReturnType<typeof setInterval> | null = null;
      if (opts?.phone) {
        pairingInterval = setInterval(() => {
          if (record.status.state === 'pairing_code' || record.status.state === 'disconnected') {
            done(record.status);
          }
        }, 200);
      }
    });

    // Pairing code flow (link by phone number)
    if (opts?.phone) {
      const phone = String(opts.phone).trim();
      const digitsOnly = phone.replace(/[^0-9]/g, '');
      if (digitsOnly.length < 8) {
        record.status = { state: 'disconnected', reason: 'Número de teléfono inválido' };
        this.emit('status', userId, record.status);
        this.sockets.delete(userId);
        throw new Error('Número de teléfono inválido (mínimo 8 dígitos)');
      }

      void (async () => {
        try {
          // Baileys needs socket to initialize before requesting a code
          await new Promise(r => setTimeout(r, 3000));
          const anySock = sock as any;
          if (typeof anySock.requestPairingCode !== 'function') {
            throw new Error('Función de código de vinculación no disponible en esta versión');
          }
          const code = await anySock.requestPairingCode(digitsOnly);
          record.status = { state: 'pairing_code', phone: digitsOnly, code: String(code) };
          this.emit('status', userId, record.status);
        } catch (e: any) {
          console.error('[WhatsApp] Pairing code error:', e?.message);
          record.status = { state: 'disconnected', reason: e?.message || 'Error al generar código' };
          this.emit('status', userId, record.status);
          this.sockets.delete(userId);
        }
      })().catch(() => null);
    }

    // Save credentials on update
    sock.ev.on('creds.update', async () => {
      try {
        await saveCreds();
      } catch (e) {
        console.warn('[WhatsApp] Failed to save credentials:', (e as any)?.message);
      }
    });

    // Main connection lifecycle handler
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        record.qrCount++;
        record.status = { state: 'qr', qr };
        this.emit('status', userId, record.status);

        if (record.qrCount > 6) {
          console.warn('[WhatsApp] Too many QR rotations, stopping', userId);
          void this.forceCleanup(userId);
          record.status = { state: 'disconnected', reason: 'QR expirado. Intente de nuevo.' };
          this.emit('status', userId, record.status);
        }
      }

      if (connection === 'open') {
        record.status = {
          state: 'connected',
          me: { id: sock.user?.id, name: sock.user?.name, lid: sock.user?.lid },
        };
        this.reconnectAttempts.set(userId, 0);
        this.emit('status', userId, record.status);
        console.info('[WhatsApp] Connected:', userId, 'User Details:', JSON.stringify(sock.user));
      }

      if (connection === 'close') {
        const reason = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
        const shouldReconnect = reason !== DisconnectReason.loggedOut;
        const reasonText = this.disconnectReasonText(reason);

        record.status = { state: 'disconnected', reason: reasonText };
        this.emit('status', userId, record.status);
        this.sockets.delete(userId);

        console.info('[WhatsApp] Disconnected:', userId, 'reason:', reason, reasonText, 'reconnect:', shouldReconnect);

        if (shouldReconnect) {
          const attempts = (this.reconnectAttempts.get(userId) || 0) + 1;
          this.reconnectAttempts.set(userId, attempts);
          const delay = Math.min(2000 * Math.pow(2, Math.min(attempts - 1, 5)), 60_000);

          if (attempts <= 50) {
            console.info(`[WhatsApp] Reconnecting in ${delay}ms (attempt ${attempts})`, userId);
            const timer = setTimeout(() => {
              void this.startWithOptions(userId).catch((e) => {
                console.error('[WhatsApp] Reconnect failed:', (e as any)?.message);
              });
            }, delay);
            timer.unref?.();
          } else {
            console.warn('[WhatsApp] Max reconnect attempts reached', userId);
            record.status = { state: 'disconnected', reason: 'No se pudo reconectar tras demasiados intentos. Intente manualmente.' };
            this.emit('status', userId, record.status);
            this.reconnectAttempts.delete(userId);
          }
        } else {
          this.cleanSessionDir(userId);
          this.reconnectAttempts.delete(userId);
        }
      }
    });

    // Inbound messages (text + media)
    sock.ev.on('messages.upsert', (m) => {
      try {
        if (!m.messages || m.messages.length === 0) return;
        for (const msg of m.messages) {
          const from = msg.key.remoteJid || 'unknown';
          if (from === 'unknown' || from === 'status@broadcast') continue;

          // INYECCIÓN DE DIAGNÓSTICO PARA VER TODO LO QUE LLEGA 
          const rawText = (msg.message as any)?.conversation || (msg.message as any)?.extendedTextMessage?.text || '';
          console.log(`[WhatsApp Debug] message from=${from} fromMe=${msg.key.fromMe} id=${msg.key.id} text="${rawText.slice(0, 30)}..."`);

          // Allow messages from self-chat (same JID as connected user) even if fromMe
          const myJid = sock.user?.id;
          const myBaseJid = myJid?.includes(':') ? myJid.split(':')[0] + '@s.whatsapp.net' : myJid;

          const myLid = sock.user?.lid;
          const myBaseLid = myLid?.includes(':') ? myLid.split(':')[0] + '@lid' : myLid;

          const myPhoneNumbers = (myBaseJid || '').replace(/[^0-9]/g, '');
          const fromPhoneNumbers = (from || '').replace(/[^0-9]/g, '');

          // isSelfChat = El mensaje viene de un número que es el nuestro o de nuestro LID (Mirror Mode)
          const isSelfChat = Boolean(myPhoneNumbers && fromPhoneNumbers && myPhoneNumbers === fromPhoneNumbers) || Boolean(myBaseLid && from === myBaseLid);

          // Si el mensaje fue enviado por NOSOTROS MISMOS, lo ignoramos A MENOS que
          // el destinatario también seamos nosotros mismos (self user-chat)
          if (msg.key.fromMe && !isSelfChat) continue;

          // Skip bot-sent messages (evita que el bot se responda a sí mismo cuando emite respuestas de IA)
          if (msg.key.id && this.botSentMessageIds.has(msg.key.id)) continue;

          const text =
            (msg.message as any)?.conversation ||
            (msg.message as any)?.extendedTextMessage?.text ||
            (msg.message as any)?.imageMessage?.caption ||
            (msg.message as any)?.videoMessage?.caption ||
            (msg.message as any)?.documentMessage?.caption ||
            (msg.message as any)?.buttonsResponseMessage?.selectedDisplayText ||
            (msg.message as any)?.listResponseMessage?.title ||
            '';

          // Detect media type
          const msgContent = msg.message as any;
          const hasImage = !!msgContent?.imageMessage;
          const hasDocument = !!msgContent?.documentMessage;
          const hasAudio = !!msgContent?.audioMessage;
          const hasVideo = !!msgContent?.videoMessage;
          const hasSticker = !!msgContent?.stickerMessage;
          const hasMedia = hasImage || hasDocument || hasAudio || hasVideo || hasSticker;

          // Skip messages with no text AND no media
          if (!text && !hasMedia) continue;

          // Fire-and-forget media download + emit
          void this.processInboundMessage(userId, msg, from, text, hasMedia, {
            hasImage, hasDocument, hasAudio, hasVideo, hasSticker,
          }).catch(e => {
            console.error('[WhatsApp] processInboundMessage error:', e);
          });
        }
      } catch (e) {
        console.error('[WhatsApp] messages.upsert error:', e);
      }
    });

    return qrReady;
  }

  private disconnectReasonText(reason: number | undefined): string {
    if (!reason) return 'Desconectado';
    switch (reason) {
      case DisconnectReason.loggedOut: return 'Sesión cerrada (logout)';
      case DisconnectReason.badSession: return 'Sesión inválida';
      case DisconnectReason.connectionClosed: return 'Conexión cerrada';
      case DisconnectReason.connectionLost: return 'Conexión perdida';
      case DisconnectReason.connectionReplaced: return 'Conexión reemplazada por otro dispositivo';
      case DisconnectReason.multideviceMismatch: return 'Error de multi-dispositivo';
      case DisconnectReason.restartRequired: return 'Se requiere reinicio';
      case DisconnectReason.timedOut: return 'Tiempo de espera agotado';
      default: return `Desconectado (código: ${reason})`;
    }
  }

  private async forceCleanup(userId: string): Promise<void> {
    const rec = this.sockets.get(userId);
    if (rec) {
      if (rec.reconnectTimer) clearTimeout(rec.reconnectTimer);
      try { rec.sock.end(new Error('Force cleanup')); } catch { /* ignore */ }
      this.sockets.delete(userId);
    }
  }

  async disconnect(userId: string): Promise<void> {
    const rec = this.sockets.get(userId);
    if (!rec) return;

    try {
      await rec.sock.logout();
    } catch {
      // ignore
    }

    try {
      rec.sock.end(new Error('Disconnected by user'));
    } catch {
      // ignore
    }

    this.sockets.delete(userId);
    this.cleanSessionDir(userId);
    this.reconnectAttempts.delete(userId);
    this.emit('status', userId, { state: 'disconnected', reason: 'Desconectado por el usuario' } as WhatsAppWebStatus);
  }

  /**
   * Graceful shutdown: disconnect all active sessions.
   */
  async shutdownAll(): Promise<void> {
    console.info('[WhatsApp] Shutting down all sessions...');
    if (this.processedMessagesCleanupTimer) {
      clearInterval(this.processedMessagesCleanupTimer);
    }
    const userIds = [...this.sockets.keys()];
    for (const userId of userIds) {
      try {
        const rec = this.sockets.get(userId);
        if (rec) {
          try { rec.sock.end(new Error('Server shutdown')); } catch { /* ignore */ }
          this.sockets.delete(userId);
        }
      } catch {
        // ignore
      }
    }
    this.reconnectAttempts.clear();
    this.processedMessages.clear();
    console.info('[WhatsApp] All sessions closed');
  }

  /**
   * Download media from a WhatsApp message, save to disk, emit inbound_message with media info.
   */
  private async processInboundMessage(
    userId: string,
    msg: WAMessage,
    from: string,
    text: string,
    hasMedia: boolean,
    mediaFlags: { hasImage: boolean; hasDocument: boolean; hasAudio: boolean; hasVideo: boolean; hasSticker: boolean },
  ): Promise<void> {
    let media: WhatsAppMediaAttachment | undefined;

    if (hasMedia) {
      try {
        const msgContent = msg.message as any;
        let mediaType: WhatsAppMediaAttachment['type'];
        let mimetype = 'application/octet-stream';
        let fileName: string | undefined;

        if (mediaFlags.hasImage) {
          mediaType = 'image';
          mimetype = msgContent.imageMessage?.mimetype || 'image/jpeg';
        } else if (mediaFlags.hasDocument) {
          mediaType = 'document';
          mimetype = msgContent.documentMessage?.mimetype || 'application/octet-stream';
          fileName = msgContent.documentMessage?.fileName || msgContent.documentMessage?.title;
        } else if (mediaFlags.hasAudio) {
          mediaType = 'audio';
          mimetype = msgContent.audioMessage?.mimetype || 'audio/ogg';
        } else if (mediaFlags.hasVideo) {
          mediaType = 'video';
          mimetype = msgContent.videoMessage?.mimetype || 'video/mp4';
        } else {
          mediaType = 'sticker';
          mimetype = msgContent.stickerMessage?.mimetype || 'image/webp';
        }

        // Download media buffer
        const buffer = await downloadMediaMessage(msg, 'buffer', {}) as Buffer;

        // Determine file extension from mimetype
        const extMap: Record<string, string> = {
          'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
          'audio/ogg': '.ogg', 'audio/ogg; codecs=opus': '.ogg', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a',
          'video/mp4': '.mp4',
          'application/pdf': '.pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
          'application/msword': '.doc',
        };
        const ext = extMap[mimetype] || (fileName ? path.extname(fileName) : '.bin');
        const savedFileName = fileName || `wa_${mediaType}_${Date.now()}${ext}`;

        // Save to uploads/whatsapp/
        const waUploadsDir = path.join(process.cwd(), 'uploads', 'whatsapp');
        fs.mkdirSync(waUploadsDir, { recursive: true });
        const localPath = path.join(waUploadsDir, savedFileName);
        fs.writeFileSync(localPath, buffer);

        console.log(`[WhatsApp] Downloaded ${mediaType} (${buffer.length} bytes) → ${localPath}`);

        media = { type: mediaType, buffer, mimetype, fileName: savedFileName, localPath };
      } catch (dlErr: any) {
        console.error('[WhatsApp] Media download failed:', dlErr?.message || dlErr);
        // Still emit the message with whatever text we have
      }
    }

    // Build descriptive text if message is media-only (no caption)
    let finalText = text;
    if (!finalText && media) {
      switch (media.type) {
        case 'image': finalText = '[El usuario envió una imagen]'; break;
        case 'document': finalText = `[El usuario envió un documento: ${media.fileName || 'archivo'}]`; break;
        case 'audio': finalText = '[El usuario envió un mensaje de voz]'; break;
        case 'video': finalText = '[El usuario envió un video]'; break;
        case 'sticker': finalText = '[El usuario envió un sticker]'; break;
      }
    }

    if (!finalText) return; // Nothing to process

    this.emit('inbound_message', userId, {
      from,
      text: finalText,
      messageId: msg.key.id || undefined,
      timestamp: msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : undefined,
      media,
    } as WhatsAppInboundMessage);
  }

  async sendText(userId: string, toJid: string, text: string): Promise<void> {
    const rec = this.sockets.get(userId);
    if (!rec || rec.status.state !== 'connected') {
      throw new Error('WhatsApp no está conectado');
    }
    const sent = await rec.sock.sendMessage(toJid, { text });
    // Track bot-sent message IDs to prevent infinite self-chat loops
    if (sent?.key?.id) {
      this.botSentMessageIds.add(sent.key.id);
      // Auto-cleanup after 5 minutes
      setTimeout(() => this.botSentMessageIds.delete(sent.key.id!), 5 * 60_000).unref?.();
    }
  }

  async sendDocument(userId: string, toJid: string, buffer: Buffer, fileName: string, mimetype: string, caption?: string): Promise<void> {
    const rec = this.sockets.get(userId);
    if (!rec || rec.status.state !== 'connected') {
      throw new Error('WhatsApp no está conectado');
    }
    const sent = await rec.sock.sendMessage(toJid, {
      document: buffer,
      fileName,
      mimetype,
      ...(caption ? { caption } : {}),
    });
    if (sent?.key?.id) {
      this.botSentMessageIds.add(sent.key.id);
      setTimeout(() => this.botSentMessageIds.delete(sent.key.id!), 5 * 60_000).unref?.();
    }
  }

  async sendImage(userId: string, toJid: string, image: Buffer, mimetype: string, caption?: string): Promise<void> {
    const rec = this.sockets.get(userId);
    if (!rec || rec.status.state !== 'connected') {
      throw new Error('WhatsApp no está conectado');
    }
    const sent = await rec.sock.sendMessage(toJid, {
      image,
      mimetype,
      caption: caption || undefined,
    });
    if (sent?.key?.id) {
      this.botSentMessageIds.add(sent.key.id);
      setTimeout(() => this.botSentMessageIds.delete(sent.key.id!), 5 * 60_000).unref?.();
    }
  }

  async sendAudioNote(userId: string, toJid: string, audio: Buffer, mimetype: string = 'audio/ogg; codecs=opus'): Promise<void> {
    const rec = this.sockets.get(userId);
    if (!rec || rec.status.state !== 'connected') {
      throw new Error('WhatsApp no está conectado');
    }
    const sent = await rec.sock.sendMessage(toJid, {
      audio,
      mimetype,
      ptt: true,
    });
    if (sent?.key?.id) {
      this.botSentMessageIds.add(sent.key.id);
      setTimeout(() => this.botSentMessageIds.delete(sent.key.id!), 5 * 60_000).unref?.();
    }
  }

  async sendVideo(userId: string, toJid: string, video: Buffer, mimetype: string = 'video/mp4', caption?: string): Promise<void> {
    const rec = this.sockets.get(userId);
    if (!rec || rec.status.state !== 'connected') {
      throw new Error('WhatsApp no está conectado');
    }
    const sent = await rec.sock.sendMessage(toJid, {
      video,
      mimetype,
      caption: caption || undefined,
    });
    if (sent?.key?.id) {
      this.botSentMessageIds.add(sent.key.id);
      setTimeout(() => this.botSentMessageIds.delete(sent.key.id!), 5 * 60_000).unref?.();
    }
  }

  async sendSticker(userId: string, toJid: string, sticker: Buffer, mimetype: string = 'image/webp'): Promise<void> {
    const rec = this.sockets.get(userId);
    if (!rec || rec.status.state !== 'connected') {
      throw new Error('WhatsApp no está conectado');
    }
    const sent = await rec.sock.sendMessage(toJid, {
      sticker,
      mimetype,
    });
    if (sent?.key?.id) {
      this.botSentMessageIds.add(sent.key.id);
      setTimeout(() => this.botSentMessageIds.delete(sent.key.id!), 5 * 60_000).unref?.();
    }
  }

  async sendContact(userId: string, toJid: string, vcard: string, displayName: string): Promise<void> {
    const rec = this.sockets.get(userId);
    if (!rec || rec.status.state !== 'connected') {
      throw new Error('WhatsApp no está conectado');
    }
    const sent = await rec.sock.sendMessage(toJid, {
      contacts: {
        displayName,
        contacts: [{ vcard }],
      },
    });
    if (sent?.key?.id) {
      this.botSentMessageIds.add(sent.key.id);
      setTimeout(() => this.botSentMessageIds.delete(sent.key.id!), 5 * 60_000).unref?.();
    }
  }

  async sendLocation(userId: string, toJid: string, lat: number, lng: number, name?: string, address?: string): Promise<void> {
    const rec = this.sockets.get(userId);
    if (!rec || rec.status.state !== 'connected') {
      throw new Error('WhatsApp no está conectado');
    }
    const sent = await rec.sock.sendMessage(toJid, {
      location: {
        degreesLatitude: lat,
        degreesLongitude: lng,
        name,
        address,
      },
    });
    if (sent?.key?.id) {
      this.botSentMessageIds.add(sent.key.id);
      setTimeout(() => this.botSentMessageIds.delete(sent.key.id!), 5 * 60_000).unref?.();
    }
  }

  async sendReaction(userId: string, toJid: string, messageId: string, emoji: string): Promise<void> {
    const rec = this.sockets.get(userId);
    if (!rec || rec.status.state !== 'connected') {
      throw new Error('WhatsApp no está conectado');
    }
    await rec.sock.sendMessage(toJid, {
      react: {
        text: emoji,
        key: {
          remoteJid: toJid,
          id: messageId,
        },
      },
    });
  }
  /**
   * Auto-reconnect persisted sessions on server startup.
   * Scans the session directory for existing auth states and reconnects them.
   */
  async autoReconnect(): Promise<void> {
    const bases = [
      path.join(process.cwd(), 'data', 'whatsapp-web'),
      path.join(os.tmpdir(), 'whatsapp-web-sessions'),
    ];

    for (const base of bases) {
      try {
        if (!fs.existsSync(base)) continue;
        const userDirs = fs.readdirSync(base);
        for (const userId of userDirs) {
          const sessionDir = path.join(base, userId);
          const stat = fs.statSync(sessionDir);
          if (!stat.isDirectory()) continue;

          // Check if there are auth files (creds.json indicates a saved session)
          const credsFile = path.join(sessionDir, 'creds.json');
          if (!fs.existsSync(credsFile)) continue;

          console.log(`[WhatsApp] Auto-reconnecting session for user ${userId}...`);
          try {
            await this.startWithOptions(userId);
            console.log(`[WhatsApp] Auto-reconnect successful for user ${userId}`);
          } catch (e: any) {
            console.error(`[WhatsApp] Auto-reconnect failed for user ${userId}:`, e?.message || e);
          }
        }
      } catch {
        // Directory doesn't exist or isn't readable — skip
      }
    }
  }
}

export const whatsappWebManager = new WhatsAppWebManager();

// Auto-reconnect persisted sessions after a short delay (let the server finish starting)
setTimeout(() => {
  whatsappWebManager.autoReconnect().catch((e) => {
    console.error('[WhatsApp] Auto-reconnect error:', e);
  });
}, 3000);
