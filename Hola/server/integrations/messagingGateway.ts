/**
 * Unified Messaging Gateway (OpenClaw-style multi-channel)
 *
 * Provides a single interface for sending/receiving messages across
 * multiple platforms: Telegram, Discord, Slack, Signal, Matrix.
 *
 * Each channel is represented as a ChannelAdapter. The gateway
 * routes inbound messages to the AI agent and outbound responses
 * back through the originating channel.
 */

import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { createLogger } from "../lib/structuredLogger";

const logger = createLogger("messaging-gateway");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChannelType =
  | "telegram"
  | "discord"
  | "slack"
  | "signal"
  | "matrix"
  | "whatsapp"
  | "google_chat"
  | "webhook";

export type ChannelStatus = "disconnected" | "connecting" | "connected" | "error";

export interface ChannelConfig {
  id: string;
  type: ChannelType;
  label: string;
  /** Token / API key for the channel (bot token, webhook URL, etc.) */
  credentials: Record<string, string>;
  enabled: boolean;
  createdAt: number;
}

export interface ChannelState {
  config: ChannelConfig;
  status: ChannelStatus;
  lastActivity: number | null;
  error: string | null;
  messageCount: number;
}

export interface InboundMessage {
  id: string;
  channelType: ChannelType;
  channelId: string;
  senderId: string;
  senderName: string;
  text: string;
  media?: { url: string; mimeType: string; filename?: string }[];
  threadId?: string;
  timestamp: number;
  raw?: unknown;
}

export interface OutboundMessage {
  channelType: ChannelType;
  channelId: string;
  recipientId: string;
  text: string;
  replyToMessageId?: string;
  media?: { url: string; mimeType: string; filename?: string }[];
}

export interface GatewayStats {
  totalChannels: number;
  connectedChannels: number;
  totalMessagesIn: number;
  totalMessagesOut: number;
  channelBreakdown: Record<ChannelType, { count: number; connected: number }>;
}

// ---------------------------------------------------------------------------
// Channel Adapter interface
// ---------------------------------------------------------------------------

export interface ChannelAdapter {
  readonly type: ChannelType;
  connect(config: ChannelConfig): Promise<void>;
  disconnect(): Promise<void>;
  send(msg: OutboundMessage): Promise<{ success: boolean; externalId?: string }>;
  getStatus(): ChannelStatus;
}

// ---------------------------------------------------------------------------
// Built-in adapters (webhook-based, no external SDK needed)
// ---------------------------------------------------------------------------

class WebhookAdapter implements ChannelAdapter {
  readonly type: ChannelType = "webhook";
  private status: ChannelStatus = "disconnected";
  private webhookUrl = "";

  async connect(config: ChannelConfig): Promise<void> {
    this.webhookUrl = config.credentials.webhook_url || "";
    if (!this.webhookUrl) {
      this.status = "error";
      throw new Error("webhook_url is required");
    }
    this.status = "connected";
  }

  async disconnect(): Promise<void> {
    this.status = "disconnected";
  }

  async send(msg: OutboundMessage) {
    try {
      const res = await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: msg.channelType,
          recipient: msg.recipientId,
          text: msg.text,
          replyTo: msg.replyToMessageId,
          timestamp: Date.now(),
        }),
      });
      return { success: res.ok, externalId: undefined };
    } catch {
      return { success: false };
    }
  }

  getStatus(): ChannelStatus {
    return this.status;
  }
}

class TelegramAdapter implements ChannelAdapter {
  readonly type: ChannelType = "telegram";
  private status: ChannelStatus = "disconnected";
  private botToken = "";
  private apiBase = "https://api.telegram.org";

  async connect(config: ChannelConfig): Promise<void> {
    this.botToken = config.credentials.bot_token || "";
    if (!this.botToken) {
      this.status = "error";
      throw new Error("Telegram bot_token is required");
    }
    // Verify the token works
    try {
      const res = await fetch(`${this.apiBase}/bot${this.botToken}/getMe`);
      if (!res.ok) throw new Error("Invalid bot token");
      this.status = "connected";
      logger.info("[Telegram] Bot connected successfully");
    } catch (err: any) {
      this.status = "error";
      throw new Error(`Telegram connection failed: ${err.message}`);
    }
  }

  async disconnect(): Promise<void> {
    this.status = "disconnected";
  }

  async send(msg: OutboundMessage) {
    try {
      const res = await fetch(`${this.apiBase}/bot${this.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: msg.recipientId,
          text: msg.text,
          reply_to_message_id: msg.replyToMessageId ? parseInt(msg.replyToMessageId) : undefined,
          parse_mode: "Markdown",
        }),
      });
      const data = (await res.json()) as any;
      return { success: data.ok, externalId: data.result?.message_id?.toString() };
    } catch {
      return { success: false };
    }
  }

  getStatus(): ChannelStatus {
    return this.status;
  }
}

class DiscordAdapter implements ChannelAdapter {
  readonly type: ChannelType = "discord";
  private status: ChannelStatus = "disconnected";
  private botToken = "";
  private apiBase = "https://discord.com/api/v10";

  async connect(config: ChannelConfig): Promise<void> {
    this.botToken = config.credentials.bot_token || "";
    if (!this.botToken) {
      this.status = "error";
      throw new Error("Discord bot_token is required");
    }
    try {
      const res = await fetch(`${this.apiBase}/users/@me`, {
        headers: { Authorization: `Bot ${this.botToken}` },
      });
      if (!res.ok) throw new Error("Invalid bot token");
      this.status = "connected";
      logger.info("[Discord] Bot connected successfully");
    } catch (err: any) {
      this.status = "error";
      throw new Error(`Discord connection failed: ${err.message}`);
    }
  }

  async disconnect(): Promise<void> {
    this.status = "disconnected";
  }

  async send(msg: OutboundMessage) {
    try {
      const res = await fetch(`${this.apiBase}/channels/${msg.recipientId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bot ${this.botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: msg.text }),
      });
      const data = (await res.json()) as any;
      return { success: res.ok, externalId: data.id };
    } catch {
      return { success: false };
    }
  }

  getStatus(): ChannelStatus {
    return this.status;
  }
}

class SlackWebhookAdapter implements ChannelAdapter {
  readonly type: ChannelType = "slack";
  private status: ChannelStatus = "disconnected";
  private webhookUrl = "";

  async connect(config: ChannelConfig): Promise<void> {
    this.webhookUrl = config.credentials.webhook_url || "";
    if (!this.webhookUrl) {
      this.status = "error";
      throw new Error("Slack webhook_url is required");
    }
    this.status = "connected";
  }

  async disconnect(): Promise<void> {
    this.status = "disconnected";
  }

  async send(msg: OutboundMessage) {
    try {
      const res = await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: msg.text,
          channel: msg.recipientId || undefined,
          thread_ts: msg.replyToMessageId || undefined,
        }),
      });
      return { success: res.ok };
    } catch {
      return { success: false };
    }
  }

  getStatus(): ChannelStatus {
    return this.status;
  }
}

// ---------------------------------------------------------------------------
// Messaging Gateway
// ---------------------------------------------------------------------------

export class MessagingGateway extends EventEmitter {
  private channels = new Map<string, ChannelState>();
  private adapters = new Map<string, ChannelAdapter>();
  private totalIn = 0;
  private totalOut = 0;

  createAdapter(type: ChannelType): ChannelAdapter {
    switch (type) {
      case "telegram":
        return new TelegramAdapter();
      case "discord":
        return new DiscordAdapter();
      case "slack":
        return new SlackWebhookAdapter();
      case "webhook":
      case "signal":
      case "matrix":
      case "google_chat":
        return new WebhookAdapter();
      case "whatsapp":
        // WhatsApp is handled by the existing whatsappWeb integration
        return new WebhookAdapter();
      default:
        return new WebhookAdapter();
    }
  }

  async addChannel(config: ChannelConfig): Promise<ChannelState> {
    const state: ChannelState = {
      config,
      status: "disconnected",
      lastActivity: null,
      error: null,
      messageCount: 0,
    };
    this.channels.set(config.id, state);

    if (config.enabled) {
      await this.connectChannel(config.id);
    }

    return state;
  }

  async connectChannel(channelId: string): Promise<void> {
    const state = this.channels.get(channelId);
    if (!state) throw new Error(`Channel ${channelId} not found`);

    state.status = "connecting";
    state.error = null;

    try {
      const adapter = this.createAdapter(state.config.type);
      await adapter.connect(state.config);
      this.adapters.set(channelId, adapter);
      state.status = "connected";
      logger.info(`[Gateway] Channel connected: ${state.config.label} (${state.config.type})`);
    } catch (err: any) {
      state.status = "error";
      state.error = err.message;
      logger.error(`[Gateway] Channel connection failed: ${state.config.label}`, { error: err.message });
    }
  }

  async disconnectChannel(channelId: string): Promise<void> {
    const adapter = this.adapters.get(channelId);
    if (adapter) {
      await adapter.disconnect();
      this.adapters.delete(channelId);
    }
    const state = this.channels.get(channelId);
    if (state) {
      state.status = "disconnected";
    }
  }

  async removeChannel(channelId: string): Promise<void> {
    await this.disconnectChannel(channelId);
    this.channels.delete(channelId);
  }

  async sendMessage(channelId: string, msg: Omit<OutboundMessage, "channelType" | "channelId">): Promise<{ success: boolean; externalId?: string }> {
    const state = this.channels.get(channelId);
    if (!state) return { success: false };

    const adapter = this.adapters.get(channelId);
    if (!adapter || state.status !== "connected") {
      return { success: false };
    }

    const result = await adapter.send({
      ...msg,
      channelType: state.config.type,
      channelId,
    });

    if (result.success) {
      state.messageCount++;
      state.lastActivity = Date.now();
      this.totalOut++;
    }

    return result;
  }

  handleInboundMessage(msg: InboundMessage): void {
    this.totalIn++;
    const state = this.channels.get(msg.channelId);
    if (state) {
      state.messageCount++;
      state.lastActivity = Date.now();
    }
    this.emit("message", msg);
  }

  getChannel(channelId: string): ChannelState | undefined {
    return this.channels.get(channelId);
  }

  listChannels(): ChannelState[] {
    return Array.from(this.channels.values());
  }

  getStats(): GatewayStats {
    const breakdown: Record<string, { count: number; connected: number }> = {};
    for (const state of this.channels.values()) {
      if (!breakdown[state.config.type]) {
        breakdown[state.config.type] = { count: 0, connected: 0 };
      }
      breakdown[state.config.type].count++;
      if (state.status === "connected") {
        breakdown[state.config.type].connected++;
      }
    }

    return {
      totalChannels: this.channels.size,
      connectedChannels: Array.from(this.channels.values()).filter((c) => c.status === "connected").length,
      totalMessagesIn: this.totalIn,
      totalMessagesOut: this.totalOut,
      channelBreakdown: breakdown as any,
    };
  }
}

// Singleton instance
export const messagingGateway = new MessagingGateway();
