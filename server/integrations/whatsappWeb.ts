import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

// NOTE: This integration uses an *unofficial* WhatsApp Web protocol library (Baileys).
// It enables QR-based linking for a phone-controlled WhatsApp account.
// This is not a security bypass/intrusion: the user must scan the QR from their own WhatsApp.

import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WASocket,
  type AuthenticationState,
  type BaileysEventMap,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';

export type WhatsAppWebStatus =
  | { state: 'disconnected' }
  | { state: 'connecting' }
  | { state: 'qr'; qr: string }
  | { state: 'connected'; me?: { id?: string; name?: string } };

export interface WhatsAppWebEvents {
  status: (userId: string, status: WhatsAppWebStatus) => void;
  inbound_message: (userId: string, msg: { from: string; text: string; messageId?: string; timestamp?: number }) => void;
}

function unwrapMessageContent(message: any): any {
  let m = message;
  // Common wrapper layers used by WhatsApp/Baileys.
  // Keep this conservative and non-recursive to avoid unexpected shapes.
  for (let i = 0; i < 5; i++) {
    if (!m) return m;
    if (m.ephemeralMessage?.message) { m = m.ephemeralMessage.message; continue; }
    if (m.viewOnceMessage?.message) { m = m.viewOnceMessage.message; continue; }
    if (m.viewOnceMessageV2?.message) { m = m.viewOnceMessageV2.message; continue; }
    if (m.viewOnceMessageV2Extension?.message) { m = m.viewOnceMessageV2Extension.message; continue; }
    if (m.documentWithCaptionMessage?.message) { m = m.documentWithCaptionMessage.message; continue; }
    break;
  }
  return m;
}

function extractText(message: any): string {
  const m = unwrapMessageContent(message) || {};
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    m.templateButtonReplyMessage?.selectedDisplayText ||
    ''
  );
}

export class WhatsAppWebManager extends EventEmitter {
  private sockets = new Map<string, { sock: WASocket; auth: AuthenticationState; status: WhatsAppWebStatus }>();
  private manualDisconnect = new Set<string>();
  private reconnectAttempts = new Map<string, number>();
  private reconnectTimers = new Map<string, NodeJS.Timeout>();

  private clearReconnect(userId: string): void {
    const t = this.reconnectTimers.get(userId);
    if (t) clearTimeout(t);
    this.reconnectTimers.delete(userId);
    this.reconnectAttempts.delete(userId);
  }

  private scheduleReconnect(userId: string): void {
    if (this.reconnectTimers.has(userId)) return;
    const attempts = (this.reconnectAttempts.get(userId) ?? 0) + 1;
    this.reconnectAttempts.set(userId, attempts);
    const delayMs = Math.min(60_000, 1000 * Math.pow(2, attempts - 1));
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(userId);
      void this.start(userId).catch(() => null);
    }, delayMs);
    this.reconnectTimers.set(userId, timer);
  }

  private sessionDirForUser(userId: string): string {
    const base = path.join(process.cwd(), 'data', 'whatsapp-web');
    const dir = path.join(base, userId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  getStatus(userId: string): WhatsAppWebStatus {
    return this.sockets.get(userId)?.status || { state: 'disconnected' };
  }

  async start(userId: string): Promise<WhatsAppWebStatus> {
    this.manualDisconnect.delete(userId);
    // If a reconnect is scheduled and the user explicitly starts, prefer the explicit start.
    const scheduled = this.reconnectTimers.get(userId);
    if (scheduled) {
      clearTimeout(scheduled);
      this.reconnectTimers.delete(userId);
    }

    const existing = this.sockets.get(userId);
    if (existing) return existing.status;

    const sessionDir = this.sessionDirForUser(userId);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: ['ILIAGPT', 'Chrome', '1.0.0'],
      // Keep it conservative to reduce risk of rate limits.
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
    });

    const record = { sock, auth: state, status: { state: 'connecting' } as WhatsAppWebStatus };
    this.sockets.set(userId, record);
    this.emit('status', userId, record.status);

    sock.ev.on('creds.update', async () => {
      try {
        await saveCreds();
      } catch (e) {
        // ignore
      }
    });

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        record.status = { state: 'qr', qr };
        this.emit('status', userId, record.status);
      }

      if (connection === 'open') {
        this.clearReconnect(userId);
        record.status = { state: 'connected', me: { id: sock.user?.id, name: sock.user?.name } };
        this.emit('status', userId, record.status);
      }

      if (connection === 'close') {
        const reason = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
        const shouldReconnect = !this.manualDisconnect.has(userId) && reason !== DisconnectReason.loggedOut;

        record.status = { state: 'disconnected' };
        this.emit('status', userId, record.status);

        this.sockets.delete(userId);
        this.manualDisconnect.delete(userId);

        if (shouldReconnect) {
          // Best-effort reconnect with backoff to reduce flapping.
          this.scheduleReconnect(userId);
        }
      }
    });

    sock.ev.on('messages.upsert', (m) => {
      try {
        const msgs = m.messages || [];
        for (const msg of msgs) {
          if (!msg) continue;
          if (msg.key?.fromMe) continue;

          const from = msg.key?.remoteJid || 'unknown';
          const text = extractText((msg as any).message);
          if (!text) continue;

          this.emit('inbound_message', userId, {
            from,
            text,
            messageId: msg.key?.id || undefined,
            timestamp: (msg as any).messageTimestamp ? Number((msg as any).messageTimestamp) * 1000 : undefined,
          });
        }
      } catch {
        // ignore
      }
    });

    return record.status;
  }

  async disconnect(userId: string): Promise<void> {
    const rec = this.sockets.get(userId);
    if (!rec) return;

    this.manualDisconnect.add(userId);
    this.clearReconnect(userId);
    // Detach listeners first to avoid triggering reconnect on our own shutdown.
    try { rec.sock.ev.removeAllListeners('connection.update'); } catch { /* ignore */ }
    try { rec.sock.ev.removeAllListeners('messages.upsert'); } catch { /* ignore */ }
    try { rec.sock.ev.removeAllListeners('creds.update'); } catch { /* ignore */ }

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
    this.emit('status', userId, { state: 'disconnected' } satisfies WhatsAppWebStatus);
  }

  async sendText(userId: string, toJid: string, text: string): Promise<void> {
    const rec = this.sockets.get(userId);
    if (!rec) throw new Error('WhatsApp not connected');
    await rec.sock.sendMessage(toJid, { text });
  }
}

export const whatsappWebManager = new WhatsAppWebManager();
