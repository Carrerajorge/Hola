/**
 * OpenClaw × Super Agent Bridge
 *
 * Integrates OpenClaw's multi-channel gateway with the unified super agent system.
 * Any message from Telegram, Discord, WhatsApp, Slack, etc. can trigger
 * the full super agent pipeline (routing → multi-model → execution).
 *
 * Features:
 * - Channel-aware task routing
 * - Response formatting per channel (markdown, HTML, plain text)
 * - Media attachment handling across channels
 * - Background task notifications via channels
 * - Streaming progress updates where supported
 * - Session memory across channels
 */

import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { superAgentController, type SuperAgentRequest, type SuperAgentResponse } from "./superAgentController";
import { backgroundTaskManager } from "./backgroundTaskManager";

// ============================================
// Types
// ============================================

export type ChannelType =
  | "telegram"
  | "discord"
  | "whatsapp"
  | "slack"
  | "messenger"
  | "wechat"
  | "web"
  | "api"
  | "sms"
  | "email"
  | "matrix"
  | "signal";

export interface ChannelMessage {
  id: string;
  channelType: ChannelType;
  channelId: string;      // Chat/channel ID within the platform
  userId: string;          // User ID within the platform
  internalUserId: string;  // ILIAGPT internal user ID
  text: string;
  attachments?: ChannelAttachment[];
  replyTo?: string;        // ID of message being replied to
  metadata?: Record<string, any>;
  timestamp: Date;
}

export interface ChannelAttachment {
  type: "image" | "document" | "audio" | "video" | "file";
  url?: string;
  base64?: string;
  mimeType: string;
  fileName?: string;
  size?: number;
}

export interface ChannelResponse {
  text: string;
  format: "plain" | "markdown" | "html";
  attachments?: ChannelAttachment[];
  buttons?: Array<{ label: string; action: string; data?: string }>;
  inlineKeyboard?: Array<Array<{ text: string; callback_data: string }>>;
  metadata?: Record<string, any>;
}

export interface BridgeConfig {
  enableSuperAgent: boolean;
  maxResponseLength: Record<ChannelType, number>;
  supportedChannels: ChannelType[];
  autoRouteThreshold: number;
  streamingChannels: ChannelType[];
}

// ============================================
// Channel Format Limits
// ============================================

const CHANNEL_LIMITS: Record<ChannelType, { maxLength: number; format: "plain" | "markdown" | "html"; supportsMedia: boolean; supportsButtons: boolean }> = {
  telegram: { maxLength: 4096, format: "html", supportsMedia: true, supportsButtons: true },
  discord: { maxLength: 2000, format: "markdown", supportsMedia: true, supportsButtons: true },
  whatsapp: { maxLength: 4096, format: "plain", supportsMedia: true, supportsButtons: false },
  slack: { maxLength: 4000, format: "markdown", supportsMedia: true, supportsButtons: true },
  messenger: { maxLength: 2000, format: "plain", supportsMedia: true, supportsButtons: true },
  wechat: { maxLength: 2048, format: "plain", supportsMedia: true, supportsButtons: false },
  web: { maxLength: 50000, format: "markdown", supportsMedia: true, supportsButtons: true },
  api: { maxLength: 100000, format: "markdown", supportsMedia: true, supportsButtons: false },
  sms: { maxLength: 1600, format: "plain", supportsMedia: false, supportsButtons: false },
  email: { maxLength: 100000, format: "html", supportsMedia: true, supportsButtons: false },
  matrix: { maxLength: 65536, format: "html", supportsMedia: true, supportsButtons: false },
  signal: { maxLength: 4096, format: "plain", supportsMedia: true, supportsButtons: false },
};

// ============================================
// OpenClaw Super Agent Bridge
// ============================================

export class OpenClawSuperAgentBridge extends EventEmitter {
  private config: BridgeConfig;
  private sessionMemory: Map<string, Array<{ role: string; content: string }>> = new Map();
  private activeChannelRequests: Map<string, { requestId: string; channelMessage: ChannelMessage }> = new Map();

  constructor(config?: Partial<BridgeConfig>) {
    super();
    this.config = {
      enableSuperAgent: true,
      maxResponseLength: Object.fromEntries(
        Object.entries(CHANNEL_LIMITS).map(([k, v]) => [k, v.maxLength])
      ) as Record<ChannelType, number>,
      supportedChannels: Object.keys(CHANNEL_LIMITS) as ChannelType[],
      autoRouteThreshold: 0.6,
      streamingChannels: ["web", "api", "telegram"],
      ...config,
    };

    this.setupNotificationForwarding();
  }

  /**
   * Process an incoming channel message through the super agent.
   */
  async processChannelMessage(message: ChannelMessage): Promise<ChannelResponse> {
    if (!this.config.enableSuperAgent) {
      return { text: "Super agent is not enabled.", format: "plain" };
    }

    const channelLimits = CHANNEL_LIMITS[message.channelType] || CHANNEL_LIMITS.web;
    const sessionKey = `${message.channelType}:${message.channelId}:${message.internalUserId}`;

    // Get or create session memory
    const history = this.sessionMemory.get(sessionKey) || [];

    try {
      // Build super agent request
      const request: SuperAgentRequest = {
        id: randomUUID(),
        userId: message.internalUserId,
        chatId: `channel-${message.channelType}-${message.channelId}`,
        message: message.text,
        attachments: message.attachments?.map((a) => ({
          type: a.type,
          url: a.url,
          base64: a.base64,
          mimeType: a.mimeType,
          fileName: a.fileName,
        })),
        context: {
          chatHistory: history.slice(-20), // Last 20 messages for context
          userPlan: "pro",
          enableBackgroundTasks: true,
          enableParallelResearch: true,
          enableToolConnectors: true,
        },
      };

      this.activeChannelRequests.set(request.id!, { requestId: request.id!, channelMessage: message });

      // Execute through super agent
      const response = await superAgentController.process(request);

      // Update session memory
      history.push({ role: "user", content: message.text });
      history.push({ role: "assistant", content: this.extractTextContent(response) });
      if (history.length > 50) history.splice(0, history.length - 50);
      this.sessionMemory.set(sessionKey, history);

      // Format response for channel
      return this.formatForChannel(response, message.channelType, channelLimits);

    } catch (err: any) {
      console.error(`[Bridge] Error processing ${message.channelType} message:`, err);
      return {
        text: `Error processing your request: ${err.message}`,
        format: "plain",
      };
    } finally {
      this.activeChannelRequests.delete(message.id);
    }
  }

  /**
   * Format a super agent response for a specific channel.
   */
  private formatForChannel(
    response: SuperAgentResponse,
    channelType: ChannelType,
    limits: typeof CHANNEL_LIMITS[ChannelType]
  ): ChannelResponse {
    let text = this.extractTextContent(response);

    // Convert format
    switch (limits.format) {
      case "html":
        text = this.markdownToHtml(text);
        break;
      case "plain":
        text = this.markdownToPlain(text);
        break;
      // markdown stays as-is
    }

    // Truncate if needed
    if (text.length > limits.maxLength) {
      text = text.substring(0, limits.maxLength - 50) + "\n\n... (response truncated)";
    }

    const channelResponse: ChannelResponse = {
      text,
      format: limits.format,
    };

    // Add action buttons where supported
    if (limits.supportsButtons && response.engine !== "orchestrator") {
      channelResponse.buttons = [
        { label: "More detail", action: "expand", data: response.id },
        { label: "Save as document", action: "save_doc", data: response.id },
      ];

      if (channelType === "telegram") {
        channelResponse.inlineKeyboard = [
          [
            { text: "More detail", callback_data: `expand:${response.id}` },
            { text: "Save", callback_data: `save:${response.id}` },
          ],
        ];
      }
    }

    // Add attachments from response artifacts
    if (limits.supportsMedia && response.artifacts?.length) {
      channelResponse.attachments = response.artifacts
        .filter((a: any) => a.url || a.data)
        .map((a: any) => ({
          type: this.inferAttachmentType(a.type || a.mimeType),
          url: a.url,
          mimeType: a.mimeType || "application/octet-stream",
          fileName: a.name || a.fileName,
        }));
    }

    return channelResponse;
  }

  /**
   * Extract text content from a super agent response.
   */
  private extractTextContent(response: SuperAgentResponse): string {
    const result = response.result;
    if (!result) return "No response generated.";

    if (typeof result === "string") return result;

    // Try common result structures
    if (result.synthesis) return result.synthesis;
    if (result.content) return result.content;
    if (result.summary) return result.summary;
    if (result.message) return result.message;
    if (result.output) return typeof result.output === "string" ? result.output : JSON.stringify(result.output, null, 2);

    // For multi-engine results
    if (result.subResults) {
      return result.subResults
        .map((r: any, i: number) => `**Result ${i + 1}:**\n${this.extractTextContent({ ...response, result: r })}`)
        .join("\n\n---\n\n");
    }

    return JSON.stringify(result, null, 2).substring(0, 2000);
  }

  /**
   * Set up notification forwarding from background tasks to channels.
   */
  private setupNotificationForwarding(): void {
    backgroundTaskManager.on("notification", (data: any) => {
      this.emit("channel_notification", {
        userId: data.userId,
        message: data.message,
        type: "background_task",
        data,
      });
    });

    backgroundTaskManager.on("monitor_condition_met", (data: any) => {
      this.emit("channel_notification", {
        userId: data.taskId,
        message: `Alert: Condition met for task ${data.taskId}`,
        type: "monitor_alert",
        data,
      });
    });
  }

  /**
   * Send a notification to a specific channel.
   */
  async sendChannelNotification(
    channelType: ChannelType,
    channelId: string,
    message: string,
    attachments?: ChannelAttachment[]
  ): Promise<void> {
    const limits = CHANNEL_LIMITS[channelType];
    let text = message;

    if (limits.format === "html") text = this.markdownToHtml(text);
    if (limits.format === "plain") text = this.markdownToPlain(text);
    if (text.length > limits.maxLength) text = text.substring(0, limits.maxLength - 30) + "...";

    this.emit("send_to_channel", {
      channelType,
      channelId,
      response: { text, format: limits.format, attachments },
    });
  }

  // ============================================
  // Format Converters
  // ============================================

  private markdownToHtml(md: string): string {
    return md
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/\*(.+?)\*/g, "<i>$1</i>")
      .replace(/`(.+?)`/g, "<code>$1</code>")
      .replace(/```[\s\S]*?```/g, (match) => {
        const code = match.replace(/```\w*\n?/, "").replace(/```$/, "");
        return `<pre><code>${code}</code></pre>`;
      })
      .replace(/^### (.+)$/gm, "<b>$1</b>")
      .replace(/^## (.+)$/gm, "<b>$1</b>")
      .replace(/^# (.+)$/gm, "<b>$1</b>")
      .replace(/^[-*] (.+)$/gm, "• $1")
      .replace(/^\d+\. (.+)$/gm, (_, text) => `• ${text}`)
      .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
  }

  private markdownToPlain(md: string): string {
    return md
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/`(.+?)`/g, "$1")
      .replace(/```[\s\S]*?```/g, (match) => match.replace(/```\w*\n?/, "").replace(/```$/, ""))
      .replace(/^#{1,3} (.+)$/gm, "$1")
      .replace(/\[(.+?)\]\((.+?)\)/g, "$1 ($2)")
      .replace(/^[-*] /gm, "- ");
  }

  private inferAttachmentType(type: string): ChannelAttachment["type"] {
    if (/image|png|jpg|jpeg|gif|webp/i.test(type)) return "image";
    if (/video|mp4|webm|mov/i.test(type)) return "video";
    if (/audio|mp3|wav|ogg/i.test(type)) return "audio";
    if (/pdf|doc|xls|ppt|docx|xlsx|pptx/i.test(type)) return "document";
    return "file";
  }

  // ============================================
  // Session Management
  // ============================================

  /**
   * Clear session memory for a channel.
   */
  clearSession(channelType: ChannelType, channelId: string, userId: string): void {
    const key = `${channelType}:${channelId}:${userId}`;
    this.sessionMemory.delete(key);
  }

  /**
   * Get session history.
   */
  getSessionHistory(channelType: ChannelType, channelId: string, userId: string) {
    const key = `${channelType}:${channelId}:${userId}`;
    return this.sessionMemory.get(key) || [];
  }

  /**
   * Get bridge statistics.
   */
  getStats() {
    return {
      activeSessions: this.sessionMemory.size,
      activeRequests: this.activeChannelRequests.size,
      supportedChannels: this.config.supportedChannels,
    };
  }
}

// Singleton
export const openclawSuperAgentBridge = new OpenClawSuperAgentBridge();
