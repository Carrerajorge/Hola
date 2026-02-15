import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { getUserId } from "../types/express";
import { createChannelPairingCode } from "../channels/channelStore";

const pairingRequestSchema = z
  .object({
    ttlMinutes: z.number().int().min(1).max(60).optional(),
  })
  .strict();

export function createTelegramIntegrationRouter(): Router {
  const router = Router();

  router.post("/pairing-code", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const parsed = pairingRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.message });
    }

    const { code, expiresAt } = await createChannelPairingCode({
      userId,
      channel: "telegram",
      ttlMinutes: parsed.data.ttlMinutes,
    });

    return res.json({ success: true, code, expiresAt: expiresAt.toISOString() });
  });

  return router;
}

