import { Router, type Request, type Response } from "express";
import { env } from "../config/env";
import { Logger } from "../lib/logger";
import { submitChannelIngest } from "../channels/channelIngestQueue";
import {
  verifyTelegramSecretToken,
  verifyWhatsAppSignature256,
  verifyMessengerSignature256,
  verifyWeChatSignature,
  extractWebhookPayloadTimestamp,
  isWebhookTimestampFresh,
} from "../channels/webhookSecurity";
import express from "express";

const MAX_WEBHOOK_PAYLOAD_BYTES = 128 * 1024;
const WEBHOOK_MAX_AGE_MS = 6 * 60 * 1000;

function normalizeWebhookTimestamp(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return value > 0 && value < 1_000_000_000_000 ? value * 1000 : value;
}

function getRawBodyBuffer(req: Request): Buffer {
  const raw = (req as any).rawBody;
  if (Buffer.isBuffer(raw)) return raw;
  if (typeof raw === "string") return Buffer.from(raw);
  // Fallback: re-stringify parsed body (won't match signature, but avoids crashes).
  return Buffer.from(JSON.stringify(req.body ?? {}));
}

function hasTooLargePayload(req: Request): boolean {
  if (getRawBodyBuffer(req).length > MAX_WEBHOOK_PAYLOAD_BYTES) return true;
  return false;
}

function getWebhookTimestampFromRequest(channel: "telegram" | "whatsapp_cloud" | "messenger" | "wechat", req: Request): number | null {
  if (channel === "wechat") {
    return normalizeWebhookTimestamp(Number.parseInt(String(req.query.timestamp || ""), 10));
  }

  const queryTimestamp = Number.parseInt(String(req.query.timestamp || req.query["hub.timestamp"] || ""), 10);
  if (Number.isFinite(queryTimestamp)) {
    return normalizeWebhookTimestamp(queryTimestamp);
  }
  return extractWebhookPayloadTimestamp((req as any).body);
}

export function createChannelWebhooksRouter(): Router {
  const router = Router();

  // Telegram webhook: setWebhook(url, secret_token) makes Telegram include:
  // X-Telegram-Bot-Api-Secret-Token header on each request.
  router.post("/telegram", async (req: Request, res: Response) => {
    try {
      if (hasTooLargePayload(req)) {
        return res.status(413).send("payload_too_large");
      }

      const eventTimestamp = getWebhookTimestampFromRequest("telegram", req);
      if (!isWebhookTimestampFresh(eventTimestamp, { maxSkewMs: WEBHOOK_MAX_AGE_MS })) {
        return res.status(200).send("stale");
      }

      const ok = verifyTelegramSecretToken({
        providedToken: req.header("x-telegram-bot-api-secret-token") || undefined,
        expectedToken: env.TELEGRAM_WEBHOOK_SECRET_TOKEN,
      });
      if (!ok) return res.status(403).send("forbidden");

      await submitChannelIngest({
        channel: "telegram",
        update: req.body,
        receivedAt: new Date().toISOString(),
      });

      return res.status(200).send("ok");
    } catch (err) {
      Logger.error("[Webhooks] Telegram ingest failed", err);
      return res.status(200).send("ok"); // avoid Telegram retry storms on transient server errors
    }
  });

  // WhatsApp Cloud webhook verification (Meta)
  router.get("/whatsapp", (req: Request, res: Response) => {
    const eventTimestamp = getWebhookTimestampFromRequest("whatsapp_cloud", req);
    if (eventTimestamp && !isWebhookTimestampFresh(eventTimestamp, { maxSkewMs: WEBHOOK_MAX_AGE_MS })) {
      return res.status(403).send("stale");
    }

    const mode = String(req.query["hub.mode"] || "");
    const token = String(req.query["hub.verify_token"] || "");
    const challenge = String(req.query["hub.challenge"] || "");

    if (mode === "subscribe" && env.WHATSAPP_VERIFY_TOKEN && token === env.WHATSAPP_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("forbidden");
  });

  router.post("/whatsapp", async (req: Request, res: Response) => {
    try {
      if (hasTooLargePayload(req)) {
        return res.status(413).send("payload_too_large");
      }

      const eventTimestamp = getWebhookTimestampFromRequest("whatsapp_cloud", req);
      if (!isWebhookTimestampFresh(eventTimestamp, { maxSkewMs: WEBHOOK_MAX_AGE_MS })) {
        return res.status(200).send("stale");
      }

      const sig = req.header("x-hub-signature-256") || undefined;
      const ok = verifyWhatsAppSignature256({
        rawBody: getRawBodyBuffer(req),
        headerSignature: sig,
        appSecret: env.WHATSAPP_APP_SECRET,
      });
      if (!ok) return res.status(403).send("forbidden");

      await submitChannelIngest({
        channel: "whatsapp_cloud",
        payload: req.body,
        receivedAt: new Date().toISOString(),
      });

      return res.status(200).send("ok");
    } catch (err) {
      Logger.error("[Webhooks] WhatsApp ingest failed", err);
      return res.status(200).send("ok");
    }
  });

  // Messenger webhook verification (Meta — same pattern as WhatsApp)
  router.get("/messenger", (req: Request, res: Response) => {
    const eventTimestamp = getWebhookTimestampFromRequest("messenger", req);
    if (eventTimestamp && !isWebhookTimestampFresh(eventTimestamp, { maxSkewMs: WEBHOOK_MAX_AGE_MS })) {
      return res.status(403).send("stale");
    }

    const mode = String(req.query["hub.mode"] || "");
    const token = String(req.query["hub.verify_token"] || "");
    const challenge = String(req.query["hub.challenge"] || "");

    if (mode === "subscribe" && env.MESSENGER_VERIFY_TOKEN && token === env.MESSENGER_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("forbidden");
  });

  router.post("/messenger", async (req: Request, res: Response) => {
    try {
      if (hasTooLargePayload(req)) {
        return res.status(413).send("payload_too_large");
      }

      const eventTimestamp = getWebhookTimestampFromRequest("messenger", req);
      if (!isWebhookTimestampFresh(eventTimestamp, { maxSkewMs: WEBHOOK_MAX_AGE_MS })) {
        return res.status(200).send("stale");
      }

      const sig = req.header("x-hub-signature-256") || undefined;
      const ok = verifyMessengerSignature256({
        rawBody: getRawBodyBuffer(req),
        headerSignature: sig,
        appSecret: env.MESSENGER_APP_SECRET,
      });
      if (!ok) return res.status(403).send("forbidden");

      await submitChannelIngest({
        channel: "messenger",
        payload: req.body,
        receivedAt: new Date().toISOString(),
      });

      return res.status(200).send("EVENT_RECEIVED");
    } catch (err) {
      Logger.error("[Webhooks] Messenger ingest failed", err);
      return res.status(200).send("EVENT_RECEIVED");
    }
  });

  // WeChat webhook verification (SHA1 signature, echo echostr)
  router.get("/wechat", (req: Request, res: Response) => {
    const eventTimestamp = getWebhookTimestampFromRequest("wechat", req);
    if (!isWebhookTimestampFresh(eventTimestamp, { maxSkewMs: WEBHOOK_MAX_AGE_MS })) {
      return res.status(403).send("stale");
    }

    const ok = verifyWeChatSignature({
      signature: String(req.query.signature || ""),
      timestamp: String(req.query.timestamp || ""),
      nonce: String(req.query.nonce || ""),
      token: env.WECHAT_TOKEN,
    });
    if (!ok) return res.status(403).send("forbidden");
    return res.status(200).send(String(req.query.echostr || ""));
  });

  // WeChat inbound messages (XML body)
  router.post("/wechat", express.text({ type: ["text/xml", "application/xml"] }), async (req: Request, res: Response) => {
    try {
      if (req.headers["content-length"] && Number(req.headers["content-length"]) > MAX_WEBHOOK_PAYLOAD_BYTES) {
        return res.status(413).send("payload_too_large");
      }

      const eventTimestamp = getWebhookTimestampFromRequest("wechat", req);
      if (!isWebhookTimestampFresh(eventTimestamp, { maxSkewMs: WEBHOOK_MAX_AGE_MS })) {
        return res.status(200).send("stale");
      }

      const ok = verifyWeChatSignature({
        signature: String(req.query.signature || ""),
        timestamp: String(req.query.timestamp || ""),
        nonce: String(req.query.nonce || ""),
        token: env.WECHAT_TOKEN,
      });
      if (!ok) return res.status(403).send("forbidden");

      // WeChat sends XML; body is a string after express.text() middleware
      const rawXml = typeof req.body === "string" ? req.body : "";

      await submitChannelIngest({
        channel: "wechat",
        payload: rawXml,
        receivedAt: new Date().toISOString(),
      });

      // WeChat expects "success" response to acknowledge receipt
      return res.status(200).send("success");
    } catch (err) {
      Logger.error("[Webhooks] WeChat ingest failed", err);
      return res.status(200).send("success");
    }
  });

  return router;
}
