import { Router, type Request, type Response } from "express";
import { env } from "../config/env";
import { Logger } from "../lib/logger";
import { submitChannelIngest } from "../channels/channelIngestQueue";
import { verifyTelegramSecretToken, verifyWhatsAppSignature256 } from "../channels/webhookSecurity";

function getRawBodyBuffer(req: Request): Buffer {
  const raw = (req as any).rawBody;
  if (Buffer.isBuffer(raw)) return raw;
  if (typeof raw === "string") return Buffer.from(raw);
  // Fallback: re-stringify parsed body (won't match signature, but avoids crashes).
  return Buffer.from(JSON.stringify(req.body ?? {}));
}

export function createChannelWebhooksRouter(): Router {
  const router = Router();

  // Telegram webhook: setWebhook(url, secret_token) makes Telegram include:
  // X-Telegram-Bot-Api-Secret-Token header on each request.
  router.post("/telegram", async (req: Request, res: Response) => {
    try {
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

  return router;
}

