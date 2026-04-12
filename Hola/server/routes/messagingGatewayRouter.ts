/**
 * Messaging Gateway Router (OpenClaw-style multi-channel)
 *
 * REST API for managing messaging channels and sending/receiving messages
 * across Telegram, Discord, Slack, Signal, Matrix, and generic webhooks.
 */

import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import {
  messagingGateway,
  type ChannelConfig,
  type ChannelType,
  type InboundMessage,
} from "../integrations/messagingGateway";
import { getSecureUserId } from "../lib/anonUserHelper";
import { createLogger } from "../lib/structuredLogger";

const logger = createLogger("messaging-gateway-router");

const VALID_CHANNEL_TYPES: ChannelType[] = [
  "telegram",
  "discord",
  "slack",
  "signal",
  "matrix",
  "whatsapp",
  "google_chat",
  "webhook",
];

export function createMessagingGatewayRouter(): Router {
  const router = Router();

  function requireUserId(req: Request): string {
    return getSecureUserId(req as any) || "";
  }

  /**
   * GET /channels
   * List all configured messaging channels.
   */
  router.get("/channels", (req: Request, res: Response) => {
    const userId = requireUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

    const channels = messagingGateway.listChannels().map((ch) => ({
      id: ch.config.id,
      type: ch.config.type,
      label: ch.config.label,
      enabled: ch.config.enabled,
      status: ch.status,
      lastActivity: ch.lastActivity,
      messageCount: ch.messageCount,
      error: ch.error,
    }));

    res.json({ success: true, channels });
  });

  /**
   * POST /channels
   * Add a new messaging channel.
   * Body: { type, label, credentials, enabled }
   */
  router.post("/channels", async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

    const { type, label, credentials, enabled = true } = req.body || {};

    if (!type || !VALID_CHANNEL_TYPES.includes(type)) {
      return res.status(400).json({
        success: false,
        error: `Invalid channel type. Valid types: ${VALID_CHANNEL_TYPES.join(", ")}`,
      });
    }

    if (!label || typeof label !== "string") {
      return res.status(400).json({ success: false, error: "Channel label is required" });
    }

    if (!credentials || typeof credentials !== "object") {
      return res.status(400).json({ success: false, error: "Channel credentials are required" });
    }

    const config: ChannelConfig = {
      id: randomUUID(),
      type,
      label,
      credentials,
      enabled: Boolean(enabled),
      createdAt: Date.now(),
    };

    try {
      const state = await messagingGateway.addChannel(config);
      logger.info(`[Gateway] Channel added: ${label} (${type})`, { userId, channelId: config.id });

      res.status(201).json({
        success: true,
        channel: {
          id: state.config.id,
          type: state.config.type,
          label: state.config.label,
          enabled: state.config.enabled,
          status: state.status,
          error: state.error,
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /channels/:id/connect
   * Connect (or reconnect) a channel.
   */
  router.post("/channels/:id/connect", async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

    const { id } = req.params;
    const channel = messagingGateway.getChannel(id);
    if (!channel) return res.status(404).json({ success: false, error: "Channel not found" });

    try {
      await messagingGateway.connectChannel(id);
      const updated = messagingGateway.getChannel(id)!;
      res.json({ success: true, status: updated.status });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /channels/:id/disconnect
   * Disconnect a channel.
   */
  router.post("/channels/:id/disconnect", async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

    const { id } = req.params;
    try {
      await messagingGateway.disconnectChannel(id);
      res.json({ success: true, status: "disconnected" });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * DELETE /channels/:id
   * Remove a channel entirely.
   */
  router.delete("/channels/:id", async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

    const { id } = req.params;
    try {
      await messagingGateway.removeChannel(id);
      logger.info(`[Gateway] Channel removed`, { userId, channelId: id });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /channels/:id/send
   * Send a message through a specific channel.
   * Body: { recipientId, text, replyToMessageId? }
   */
  router.post("/channels/:id/send", async (req: Request, res: Response) => {
    const userId = requireUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

    const { id } = req.params;
    const { recipientId, text, replyToMessageId } = req.body || {};

    if (!recipientId || !text) {
      return res.status(400).json({ success: false, error: "recipientId and text are required" });
    }

    try {
      const result = await messagingGateway.sendMessage(id, {
        recipientId,
        text,
        replyToMessageId,
      });
      res.json({ success: result.success, externalId: result.externalId });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * GET /stats
   * Gateway-wide statistics.
   */
  router.get("/stats", (req: Request, res: Response) => {
    const userId = requireUserId(req);
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

    const stats = messagingGateway.getStats();
    res.json({ success: true, ...stats });
  });

  /**
   * GET /supported-types
   * Lists all supported channel types with their required credentials.
   */
  router.get("/supported-types", (_req: Request, res: Response) => {
    res.json({
      success: true,
      types: [
        {
          type: "telegram",
          label: "Telegram",
          icon: "telegram",
          requiredCredentials: ["bot_token"],
          description: "Connect a Telegram bot to receive and send messages.",
        },
        {
          type: "discord",
          label: "Discord",
          icon: "discord",
          requiredCredentials: ["bot_token"],
          description: "Connect a Discord bot to interact in channels.",
        },
        {
          type: "slack",
          label: "Slack",
          icon: "slack",
          requiredCredentials: ["webhook_url"],
          description: "Send messages via Slack incoming webhook.",
        },
        {
          type: "signal",
          label: "Signal",
          icon: "signal",
          requiredCredentials: ["webhook_url"],
          description: "Bridge Signal messages through a webhook relay.",
        },
        {
          type: "matrix",
          label: "Matrix",
          icon: "matrix",
          requiredCredentials: ["webhook_url"],
          description: "Connect to Matrix rooms via webhook bridge.",
        },
        {
          type: "google_chat",
          label: "Google Chat",
          icon: "google_chat",
          requiredCredentials: ["webhook_url"],
          description: "Send messages to Google Chat spaces.",
        },
        {
          type: "webhook",
          label: "Generic Webhook",
          icon: "webhook",
          requiredCredentials: ["webhook_url"],
          description: "Forward messages to any HTTP endpoint.",
        },
      ],
    });
  });

  /**
   * POST /inbound/:channelId
   * Webhook endpoint for receiving inbound messages from external platforms.
   * Each platform adapter formats the message differently, so we normalize here.
   */
  router.post("/inbound/:channelId", (req: Request, res: Response) => {
    const { channelId } = req.params;
    const channel = messagingGateway.getChannel(channelId);

    if (!channel) {
      return res.status(404).json({ success: false, error: "Channel not found" });
    }

    try {
      const body = req.body || {};

      // Normalize inbound message from various platform formats
      const msg: InboundMessage = {
        id: body.message_id || body.id || randomUUID(),
        channelType: channel.config.type,
        channelId,
        senderId: body.sender_id || body.from?.id || body.user?.id || "unknown",
        senderName: body.sender_name || body.from?.name || body.user?.name || "Unknown",
        text: body.text || body.message?.text || body.content || "",
        threadId: body.thread_id || body.thread_ts || undefined,
        timestamp: body.timestamp || Date.now(),
        raw: body,
      };

      messagingGateway.handleInboundMessage(msg);
      logger.info(`[Gateway] Inbound message from ${channel.config.type}`, {
        channelId,
        senderId: msg.senderId,
      });

      res.json({ success: true, messageId: msg.id });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}
