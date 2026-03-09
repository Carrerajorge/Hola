/**
 * ILIAGPT × OpenClaw Fusion — Channel Bridge
 * 
 * Unified multi-channel adapter that connects ILIAGPT to external messaging
 * platforms through OpenClaw's channel protocol. Supports WhatsApp, Telegram,
 * Discord, Slack, Email, and the native Web/API channels.
 * 
 * @version 2.2.0-fusion
 */

import { Logger } from '../lib/logger';
import type { ChannelConfig } from '../openclaw.config';

const log = new Logger('ChannelBridge');

/* ──────────────────────────────────────────────
   Channel Message Types
   ────────────────────────────────────────────── */

export interface IncomingMessage {
  id: string;
  channel: string;
  channelType: ChannelConfig['type'];
  senderId: string;
  senderName?: string;
  text: string;
  attachments?: MessageAttachment[];
  replyTo?: string;
  threadId?: string;
  timestamp: Date;
  raw: unknown;
}

export interface OutgoingMessage {
  channel: string;
  recipientId: string;
  text: string;
  attachments?: MessageAttachment[];
  replyTo?: string;
  threadId?: string;
  markdown?: boolean;
}

export interface MessageAttachment {
  type: 'image' | 'video' | 'audio' | 'file' | 'location';
  url?: string;
  data?: Buffer;
  mimeType?: string;
  filename?: string;
  caption?: string;
}

export type MessageHandler = (message: IncomingMessage) => Promise<OutgoingMessage | null>;

/* ──────────────────────────────────────────────
   Channel Adapter Interface
   ────────────────────────────────────────────── */

interface ChannelAdapter {
  name: string;
  type: ChannelConfig['type'];
  connected: boolean;
  initialize(config: Record<string, unknown>): Promise<void>;
  sendMessage(message: OutgoingMessage): Promise<boolean>;
  onMessage(handler: MessageHandler): void;
  shutdown(): Promise<void>;
  getStatus(): ChannelStatus;
}

interface ChannelStatus {
  name: string;
  type: string;
  connected: boolean;
  messagesReceived: number;
  messagesSent: number;
  lastActivity: Date | null;
  errors: number;
}

/* ──────────────────────────────────────────────
   Base Channel Adapter
   ────────────────────────────────────────────── */

abstract class BaseChannelAdapter implements ChannelAdapter {
  name: string;
  type: ChannelConfig['type'];
  connected = false;
  protected handler: MessageHandler | null = null;
  protected stats = { received: 0, sent: 0, errors: 0, lastActivity: null as Date | null };

  constructor(name: string, type: ChannelConfig['type']) {
    this.name = name;
    this.type = type;
  }

  abstract initialize(config: Record<string, unknown>): Promise<void>;
  abstract sendMessage(message: OutgoingMessage): Promise<boolean>;
  abstract shutdown(): Promise<void>;

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  protected async handleIncoming(message: IncomingMessage): Promise<void> {
    this.stats.received++;
    this.stats.lastActivity = new Date();

    if (this.handler) {
      try {
        const response = await this.handler(message);
        if (response) {
          await this.sendMessage(response);
        }
      } catch (error) {
        this.stats.errors++;
        log.error(`Error handling message on ${this.name}`, { error });
      }
    }
  }

  getStatus(): ChannelStatus {
    return {
      name: this.name,
      type: this.type,
      connected: this.connected,
      messagesReceived: this.stats.received,
      messagesSent: this.stats.sent,
      lastActivity: this.stats.lastActivity,
      errors: this.stats.errors,
    };
  }
}

/* ──────────────────────────────────────────────
   Web Channel Adapter (WebSocket/SSE)
   ────────────────────────────────────────────── */

class WebChannelAdapter extends BaseChannelAdapter {
  constructor() {
    super('web', 'web');
  }

  async initialize(_config: Record<string, unknown>): Promise<void> {
    // Web channel is handled by the existing Express + WebSocket setup
    this.connected = true;
    log.info('Web channel adapter initialized (delegates to existing WS/SSE)');
  }

  async sendMessage(message: OutgoingMessage): Promise<boolean> {
    // Delegated to existing ILIAGPT WebSocket/SSE infrastructure
    this.stats.sent++;
    this.stats.lastActivity = new Date();
    return true;
  }

  async shutdown(): Promise<void> {
    this.connected = false;
  }
}

/* ──────────────────────────────────────────────
   API Channel Adapter (REST)
   ────────────────────────────────────────────── */

class APIChannelAdapter extends BaseChannelAdapter {
  constructor() {
    super('api', 'api');
  }

  async initialize(_config: Record<string, unknown>): Promise<void> {
    this.connected = true;
    log.info('API channel adapter initialized (delegates to existing REST routes)');
  }

  async sendMessage(_message: OutgoingMessage): Promise<boolean> {
    this.stats.sent++;
    return true;
  }

  async shutdown(): Promise<void> {
    this.connected = false;
  }
}

/* ──────────────────────────────────────────────
   WhatsApp Channel Adapter
   ────────────────────────────────────────────── */

class WhatsAppChannelAdapter extends BaseChannelAdapter {
  private token: string = '';
  private verifyToken: string = '';

  constructor() {
    super('whatsapp', 'whatsapp');
  }

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.token = (config.token as string) || '';
    this.verifyToken = (config.verifyToken as string) || '';

    if (!this.token) {
      log.warn('WhatsApp token not configured, adapter disabled');
      return;
    }

    this.connected = true;
    log.info('WhatsApp channel adapter initialized');
  }

  async sendMessage(message: OutgoingMessage): Promise<boolean> {
    if (!this.connected) return false;

    try {
      const response = await fetch('https://graph.facebook.com/v19.0/me/messages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: message.recipientId,
          type: 'text',
          text: { body: message.text },
        }),
      });

      this.stats.sent++;
      this.stats.lastActivity = new Date();
      return response.ok;
    } catch (error) {
      this.stats.errors++;
      log.error('WhatsApp send failed', { error });
      return false;
    }
  }

  async shutdown(): Promise<void> {
    this.connected = false;
  }
}

/* ──────────────────────────────────────────────
   Telegram Channel Adapter
   ────────────────────────────────────────────── */

class TelegramChannelAdapter extends BaseChannelAdapter {
  private token: string = '';

  constructor() {
    super('telegram', 'telegram');
  }

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.token = (config.token as string) || '';

    if (!this.token) {
      log.warn('Telegram bot token not configured, adapter disabled');
      return;
    }

    this.connected = true;
    log.info('Telegram channel adapter initialized');
  }

  async sendMessage(message: OutgoingMessage): Promise<boolean> {
    if (!this.connected) return false;

    try {
      const response = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: message.recipientId,
          text: message.text,
          parse_mode: message.markdown ? 'MarkdownV2' : undefined,
        }),
      });

      this.stats.sent++;
      this.stats.lastActivity = new Date();
      return response.ok;
    } catch (error) {
      this.stats.errors++;
      log.error('Telegram send failed', { error });
      return false;
    }
  }

  async shutdown(): Promise<void> {
    this.connected = false;
  }
}

/* ──────────────────────────────────────────────
   Discord Channel Adapter
   ────────────────────────────────────────────── */

class DiscordChannelAdapter extends BaseChannelAdapter {
  private token: string = '';

  constructor() {
    super('discord', 'discord');
  }

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.token = (config.token as string) || '';

    if (!this.token) {
      log.warn('Discord bot token not configured, adapter disabled');
      return;
    }

    this.connected = true;
    log.info('Discord channel adapter initialized');
  }

  async sendMessage(message: OutgoingMessage): Promise<boolean> {
    if (!this.connected) return false;

    try {
      const response = await fetch(`https://discord.com/api/v10/channels/${message.recipientId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bot ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: message.text }),
      });

      this.stats.sent++;
      this.stats.lastActivity = new Date();
      return response.ok;
    } catch (error) {
      this.stats.errors++;
      log.error('Discord send failed', { error });
      return false;
    }
  }

  async shutdown(): Promise<void> {
    this.connected = false;
  }
}

/* ──────────────────────────────────────────────
   Slack Channel Adapter
   ────────────────────────────────────────────── */

class SlackChannelAdapter extends BaseChannelAdapter {
  private token: string = '';

  constructor() {
    super('slack', 'slack');
  }

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.token = (config.token as string) || '';

    if (!this.token) {
      log.warn('Slack bot token not configured, adapter disabled');
      return;
    }

    this.connected = true;
    log.info('Slack channel adapter initialized');
  }

  async sendMessage(message: OutgoingMessage): Promise<boolean> {
    if (!this.connected) return false;

    try {
      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel: message.recipientId,
          text: message.text,
          thread_ts: message.threadId,
        }),
      });

      this.stats.sent++;
      this.stats.lastActivity = new Date();
      return response.ok;
    } catch (error) {
      this.stats.errors++;
      log.error('Slack send failed', { error });
      return false;
    }
  }

  async shutdown(): Promise<void> {
    this.connected = false;
  }
}

/* ──────────────────────────────────────────────
   Email Channel Adapter
   ────────────────────────────────────────────── */

class EmailChannelAdapter extends BaseChannelAdapter {
  constructor() {
    super('email', 'email');
  }

  async initialize(config: Record<string, unknown>): Promise<void> {
    const imapHost = config.imapHost as string;
    if (!imapHost) {
      log.warn('Email IMAP host not configured, adapter disabled');
      return;
    }

    this.connected = true;
    log.info('Email channel adapter initialized');
  }

  async sendMessage(_message: OutgoingMessage): Promise<boolean> {
    // Email sending is handled by the existing ILIAGPT email service
    this.stats.sent++;
    return true;
  }

  async shutdown(): Promise<void> {
    this.connected = false;
  }
}

/* ──────────────────────────────────────────────
   Adapter Factory
   ────────────────────────────────────────────── */

const ADAPTER_MAP: Record<string, new () => ChannelAdapter> = {
  WebChannelAdapter,
  APIChannelAdapter,
  WhatsAppChannelAdapter,
  TelegramChannelAdapter,
  DiscordChannelAdapter,
  SlackChannelAdapter,
  EmailChannelAdapter,
};

/* ──────────────────────────────────────────────
   Channel Bridge (Orchestrates all channels)
   ────────────────────────────────────────────── */

export class ChannelBridge {
  private adapters: Map<string, ChannelAdapter> = new Map();
  private channelConfigs: ChannelConfig[];
  private app: import('express').Application;
  private messageHandler: MessageHandler | null = null;

  constructor(configs: ChannelConfig[], app: import('express').Application) {
    this.channelConfigs = configs;
    this.app = app;
  }

  /**
   * Register and initialize all enabled channels
   */
  async registerChannels(): Promise<void> {
    for (const config of this.channelConfigs) {
      if (!config.enabled) continue;

      const AdapterClass = ADAPTER_MAP[config.adapter];
      if (!AdapterClass) {
        log.warn(`Unknown adapter: ${config.adapter} for channel ${config.name}`);
        continue;
      }

      try {
        const adapter = new AdapterClass();
        await adapter.initialize(config.config);

        if (this.messageHandler) {
          adapter.onMessage(this.messageHandler);
        }

        this.adapters.set(config.name, adapter);
        log.info(`Channel registered: ${config.name} (${config.type})`);
      } catch (error) {
        log.error(`Failed to register channel ${config.name}`, { error });
      }
    }

    // Register webhook routes for channels that need them
    this.registerWebhookRoutes();
  }

  /**
   * Register Express routes for channel webhooks
   */
  private registerWebhookRoutes(): void {
    // WhatsApp webhook
    this.app.post('/webhooks/whatsapp', async (req, res) => {
      const adapter = this.adapters.get('whatsapp');
      if (adapter) {
        // Process WhatsApp webhook payload
        const message = this.parseWhatsAppWebhook(req.body);
        if (message) {
          await (adapter as any).handleIncoming(message);
        }
      }
      res.sendStatus(200);
    });

    // Telegram webhook
    this.app.post('/webhooks/telegram', async (req, res) => {
      const adapter = this.adapters.get('telegram');
      if (adapter) {
        const message = this.parseTelegramWebhook(req.body);
        if (message) {
          await (adapter as any).handleIncoming(message);
        }
      }
      res.sendStatus(200);
    });

    // Slack events
    this.app.post('/webhooks/slack', async (req, res) => {
      // Handle Slack URL verification challenge
      if (req.body.type === 'url_verification') {
        res.json({ challenge: req.body.challenge });
        return;
      }

      const adapter = this.adapters.get('slack');
      if (adapter && req.body.event?.type === 'message') {
        const message = this.parseSlackEvent(req.body.event);
        if (message) {
          await (adapter as any).handleIncoming(message);
        }
      }
      res.sendStatus(200);
    });

    log.info('Channel webhook routes registered');
  }

  /**
   * Send a message through a specific channel
   */
  async sendMessage(channelName: string, message: OutgoingMessage): Promise<boolean> {
    const adapter = this.adapters.get(channelName);
    if (!adapter) {
      log.warn(`Channel not found: ${channelName}`);
      return false;
    }
    return adapter.sendMessage(message);
  }

  /**
   * Broadcast a message to all active channels
   */
  async broadcast(message: OutgoingMessage): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};
    for (const [name, adapter] of this.adapters) {
      if (adapter.connected) {
        results[name] = await adapter.sendMessage(message);
      }
    }
    return results;
  }

  /**
   * Set the global message handler for all channels
   */
  setMessageHandler(handler: MessageHandler): void {
    this.messageHandler = handler;
    for (const adapter of this.adapters.values()) {
      adapter.onMessage(handler);
    }
  }

  getActiveCount(): number {
    return Array.from(this.adapters.values()).filter((a) => a.connected).length;
  }

  getChannelStatuses(): ChannelStatus[] {
    return Array.from(this.adapters.values()).map((a) => a.getStatus());
  }

  async shutdown(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.shutdown();
    }
    this.adapters.clear();
  }

  // ── Webhook Parsers ──

  private parseWhatsAppWebhook(body: any): IncomingMessage | null {
    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const msg = change?.value?.messages?.[0];
    if (!msg) return null;

    return {
      id: msg.id,
      channel: 'whatsapp',
      channelType: 'whatsapp',
      senderId: msg.from,
      text: msg.text?.body || '',
      timestamp: new Date(parseInt(msg.timestamp) * 1000),
      raw: body,
    };
  }

  private parseTelegramWebhook(body: any): IncomingMessage | null {
    const msg = body?.message;
    if (!msg) return null;

    return {
      id: String(msg.message_id),
      channel: 'telegram',
      channelType: 'telegram',
      senderId: String(msg.from?.id),
      senderName: msg.from?.first_name,
      text: msg.text || '',
      timestamp: new Date(msg.date * 1000),
      raw: body,
    };
  }

  private parseSlackEvent(event: any): IncomingMessage | null {
    if (event.bot_id) return null; // Skip bot messages

    return {
      id: event.ts,
      channel: 'slack',
      channelType: 'slack',
      senderId: event.user,
      text: event.text || '',
      threadId: event.thread_ts,
      timestamp: new Date(parseFloat(event.ts) * 1000),
      raw: event,
    };
  }
}
