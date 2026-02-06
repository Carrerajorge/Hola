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
  | { state: 'pairing_code'; phone: string; code: string }
  | { state: 'connected'; me?: { id?: string; name?: string } };

export interface WhatsAppWebEvents {
  status: (userId: string, status: WhatsAppWebStatus) => void;
  inbound_message: (userId: string, msg: { from: string; text: string; messageId?: string; timestamp?: number }) => void;
}

export class WhatsAppWebManager extends EventEmitter {
  private sockets = new Map<string, { sock: WASocket; auth: AuthenticationState; status: WhatsAppWebStatus }>();

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
    return this.startWithOptions(userId);
  }

  /**
   * Start a WhatsApp Web session. If `phone` is provided, we will attempt to generate
   * a pairing code (link by phone number) instead of requiring QR scanning.
   */
  async startWithOptions(userId: string, opts?: { phone?: string }): Promise<WhatsAppWebStatus> {
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

    // Optional: pairing code flow (link by phone number)
    if (opts?.phone) {
      const phone = String(opts.phone).trim();
      const digitsOnly = phone.replace(/[^0-9]/g, '');
      if (digitsOnly.length < 8) {
        record.status = { state: 'disconnected' };
        this.emit('status', userId, record.status);
        this.sockets.delete(userId);
        throw new Error('Invalid phone number');
      }

      // Baileys supports requesting a pairing code for linking.
      // We keep the socket alive so the user can complete linking in WhatsApp.
      (async () => {
        try {
          const anySock = sock as any;
          if (typeof anySock.requestPairingCode !== 'function') {
            throw new Error('Pairing code not supported by WhatsApp Web provider');
          }
          const code = await anySock.requestPairingCode(digitsOnly);
          record.status = { state: 'pairing_code', phone: digitsOnly, code: String(code) };
          this.emit('status', userId, record.status);
        } catch (e: any) {
          record.status = { state: 'disconnected' };
          this.emit('status', userId, record.status);
          this.sockets.delete(userId);
        }
      })().catch(() => null);
    }

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
        record.status = { state: 'connected', me: { id: sock.user?.id, name: sock.user?.name } };
        this.emit('status', userId, record.status);
      }

      if (connection === 'close') {
        const reason = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
        const shouldReconnect = reason !== DisconnectReason.loggedOut;

        record.status = { state: 'disconnected' };
        this.emit('status', userId, record.status);

        this.sockets.delete(userId);

        if (shouldReconnect) {
          // Best-effort reconnect.
          void this.startWithOptions(userId).catch(() => null);
        }
      }
    });

    sock.ev.on('messages.upsert', (m) => {
      try {
        const msg = m.messages?.[0];
        if (!msg) return;
        if (msg.key.fromMe) return;
        const from = msg.key.remoteJid || 'unknown';

        // Extract a simple text message.
        const text =
          (msg.message as any)?.conversation ||
          (msg.message as any)?.extendedTextMessage?.text ||
          (msg.message as any)?.imageMessage?.caption ||
          '';

        if (!text) return;

        this.emit('inbound_message', userId, {
          from,
          text,
          messageId: msg.key.id || undefined,
          timestamp: (msg.messageTimestamp as any) ? Number(msg.messageTimestamp) * 1000 : undefined,
        });
      } catch {
        // ignore
      }
    });

    return record.status;
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
    this.emit('status', userId, { state: 'disconnected' } satisfies WhatsAppWebStatus);
  }

  async sendText(userId: string, toJid: string, text: string): Promise<void> {
    const rec = this.sockets.get(userId);
    if (!rec) throw new Error('WhatsApp not connected');
    await rec.sock.sendMessage(toJid, { text });
  }
}

export const whatsappWebManager = new WhatsAppWebManager();
