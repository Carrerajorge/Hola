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
  qrCount: number;        // how many QR rotations so far
  reconnectTimer?: ReturnType<typeof setTimeout>;
}

export class WhatsAppWebManager extends EventEmitter {
  private sockets = new Map<string, SocketRecord>();
  private reconnectAttempts = new Map<string, number>();

  private sessionDirForUser(userId: string): string {
    const base = path.join(process.cwd(), 'data', 'whatsapp-web');
    const dir = path.join(base, userId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
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

  /**
   * Start a WhatsApp session and wait for the first QR to be ready.
   * Returns once QR is available, connection is open, or timeout (15s).
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
      // If already connected or QR/pairing visible, return immediately
      if (existing.status.state === 'connected' ||
          existing.status.state === 'qr' ||
          existing.status.state === 'pairing_code') {
        return existing.status;
      }
      // If stuck in "connecting", kill and restart
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
      // Corrupted session — wipe and retry
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
      version = undefined; // Baileys will use built-in default
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
    };
    this.sockets.set(userId, record);
    this.reconnectAttempts.set(userId, 0);
    this.emit('status', userId, record.status);

    // Create a promise that resolves when QR is ready, connected, or on timeout
    const qrReady = new Promise<WhatsAppWebStatus>((resolve) => {
      let resolved = false;
      const done = (s: WhatsAppWebStatus) => {
        if (resolved) return;
        resolved = true;
        resolve(s);
      };

      // Timeout — resolve with current status after 15s
      const timeout = setTimeout(() => {
        done(record.status);
      }, 15_000);

      // Listen for QR or connection
      const onUpdate = (update: any) => {
        if (update.qr) {
          clearTimeout(timeout);
          done(record.status); // record.status is already updated by the handler below
        }
        if (update.connection === 'open') {
          clearTimeout(timeout);
          done(record.status);
        }
        if (update.connection === 'close') {
          clearTimeout(timeout);
          done(record.status);
        }
      };

      sock.ev.on('connection.update', onUpdate);

      // Also resolve for pairing codes
      if (opts?.phone) {
        // Pairing code flow will resolve via the async handler below
        const checkPairing = setInterval(() => {
          if (record.status.state === 'pairing_code' || record.status.state === 'disconnected') {
            clearInterval(checkPairing);
            clearTimeout(timeout);
            done(record.status);
          }
        }, 200);

        // Clear interval on timeout
        setTimeout(() => clearInterval(checkPairing), 15_000);
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

      // Wait a bit for socket to be ready, then request pairing code
      void (async () => {
        try {
          // Baileys needs the connection to initialize before requesting a code
          await new Promise(r => setTimeout(r, 3000));
          const anySock = sock as any;
          if (typeof anySock.requestPairingCode !== 'function') {
            throw new Error('Función de código de vinculación no disponible');
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
      } catch {
        // ignore
      }
    });

    // Main connection lifecycle handler
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        record.qrCount++;
        record.status = { state: 'qr', qr };
        this.emit('status', userId, record.status);

        // Baileys rotates QR ~5 times before giving up
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

          // Exponential backoff: 2s, 4s, 8s, 16s, max 30s
          const delay = Math.min(2000 * Math.pow(2, attempts - 1), 30_000);

          if (attempts <= 5) {
            console.info(`[WhatsApp] Reconnecting in ${delay}ms (attempt ${attempts})`, userId);
            const timer = setTimeout(() => {
              void this.startWithOptions(userId).catch((e) => {
                console.error('[WhatsApp] Reconnect failed:', e?.message);
              });
            }, delay);
            // Don't block process exit
            timer.unref?.();
          } else {
            console.warn('[WhatsApp] Max reconnect attempts reached', userId);
            this.reconnectAttempts.delete(userId);
          }
        } else {
          // Logged out — clean session
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

          const text =
            (msg.message as any)?.conversation ||
            (msg.message as any)?.extendedTextMessage?.text ||
            (msg.message as any)?.imageMessage?.caption ||
            (msg.message as any)?.videoMessage?.caption ||
            (msg.message as any)?.documentMessage?.caption ||
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

    // Wait for QR/connection before returning
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

  async sendText(userId: string, toJid: string, text: string): Promise<void> {
    const rec = this.sockets.get(userId);
    if (!rec || rec.status.state !== 'connected') {
      throw new Error('WhatsApp no está conectado');
    }
    await rec.sock.sendMessage(toJid, { text });
  }
}

export const whatsappWebManager = new WhatsAppWebManager();
