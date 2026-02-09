import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import pino from 'pino';

// NOTE: This integration uses an *unofficial* WhatsApp Web protocol library (Baileys).
// It enables QR-based linking for a phone-controlled WhatsApp account.
// This is not a security bypass/intrusion: the user must scan the QR from their own WhatsApp.

import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WASocket,
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
  | { state: 'connected'; me?: { id?: string; name?: string } };

export interface WhatsAppWebEvents {
  status: (userId: string, status: WhatsAppWebStatus) => void;
  inbound_message: (userId: string, msg: { from: string; text: string; messageId?: string; timestamp?: number }) => void;
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
  private reconnectAttempts = new Map<string, number>();
  // Track processed message IDs to prevent duplicate auto-replies
  private processedMessages = new Map<string, number>();
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
    const fallback = path.join(require('os').tmpdir(), 'whatsapp-web-sessions');

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
    return this.sockets.get(userId)?.autoReplyEnabled ?? true;
  }

  setAutoReply(userId: string, enabled: boolean): void {
    const rec = this.sockets.get(userId);
    if (rec) rec.autoReplyEnabled = enabled;
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
      autoReplyEnabled: true,
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
          me: { id: sock.user?.id, name: sock.user?.name },
        };
        this.reconnectAttempts.set(userId, 0);
        this.emit('status', userId, record.status);
        console.info('[WhatsApp] Connected:', userId, sock.user?.id);
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
          const delay = Math.min(2000 * Math.pow(2, attempts - 1), 30_000);

          if (attempts <= 5) {
            console.info(`[WhatsApp] Reconnecting in ${delay}ms (attempt ${attempts})`, userId);
            const timer = setTimeout(() => {
              void this.startWithOptions(userId).catch((e) => {
                console.error('[WhatsApp] Reconnect failed:', (e as any)?.message);
              });
            }, delay);
            timer.unref?.();
          } else {
            console.warn('[WhatsApp] Max reconnect attempts reached', userId);
            record.status = { state: 'disconnected', reason: 'No se pudo reconectar tras varios intentos' };
            this.emit('status', userId, record.status);
            this.reconnectAttempts.delete(userId);
          }
        } else {
          this.cleanSessionDir(userId);
          this.reconnectAttempts.delete(userId);
        }
      }
    });

    // Inbound messages
    sock.ev.on('messages.upsert', (m) => {
      try {
        if (!m.messages || m.messages.length === 0) return;
        for (const msg of m.messages) {
          if (msg.key.fromMe) continue;
          const from = msg.key.remoteJid || 'unknown';
          if (from === 'unknown' || from === 'status@broadcast') continue;

          const text =
            (msg.message as any)?.conversation ||
            (msg.message as any)?.extendedTextMessage?.text ||
            (msg.message as any)?.imageMessage?.caption ||
            (msg.message as any)?.videoMessage?.caption ||
            (msg.message as any)?.documentMessage?.caption ||
            (msg.message as any)?.buttonsResponseMessage?.selectedDisplayText ||
            (msg.message as any)?.listResponseMessage?.title ||
            '';

          if (!text) continue;

          this.emit('inbound_message', userId, {
            from,
            text,
            messageId: msg.key.id || undefined,
            timestamp: msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : undefined,
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

  async sendText(userId: string, toJid: string, text: string): Promise<void> {
    const rec = this.sockets.get(userId);
    if (!rec || rec.status.state !== 'connected') {
      throw new Error('WhatsApp no está conectado');
    }
    await rec.sock.sendMessage(toJid, { text });
  }
}

export const whatsappWebManager = new WhatsAppWebManager();
