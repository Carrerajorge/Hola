import { Router, type Request, type Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { getUserId } from "../types/express";
import { integrationAccounts } from "@shared/schema";
import { ensureIntegrationCatalogSeeded } from "../services/integrationCatalog";

const configSchema = z
  .object({
    appId: z.string().min(1),
    appSecret: z.string().min(1),
  })
  .strict();

export function createWeChatIntegrationRouter(): Router {
  const router = Router();

  router.post("/config", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const parsed = configSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.message });
    }

    await ensureIntegrationCatalogSeeded().catch(() => null);

    const { appId, appSecret } = parsed.data;
    const now = new Date();

    const [existing] = await db
      .select({ id: integrationAccounts.id })
      .from(integrationAccounts)
      .where(
        and(
          eq(integrationAccounts.userId, userId),
          eq(integrationAccounts.providerId, "wechat"),
          sql`${integrationAccounts.metadata} ->> 'appId' = ${appId}`,
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(integrationAccounts)
        .set({
          accessToken: appSecret,
          status: "active",
          metadata: { appId },
          updatedAt: now,
        })
        .where(eq(integrationAccounts.id, existing.id));

      return res.json({ success: true, updated: true });
    }

    await db.insert(integrationAccounts).values({
      userId,
      providerId: "wechat",
      displayName: "WeChat Official Account",
      accessToken: appSecret,
      status: "active",
      metadata: { appId },
      updatedAt: now,
    });

    return res.json({ success: true, created: true });
  });

  router.get("/status", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const accounts = await db
      .select({
        id: integrationAccounts.id,
        providerId: integrationAccounts.providerId,
        displayName: integrationAccounts.displayName,
        status: integrationAccounts.status,
        metadata: integrationAccounts.metadata,
        createdAt: integrationAccounts.createdAt,
        updatedAt: integrationAccounts.updatedAt,
      })
      .from(integrationAccounts)
      .where(and(eq(integrationAccounts.userId, userId), eq(integrationAccounts.providerId, "wechat")));

    return res.json({ success: true, accounts });
  });

  router.post("/disconnect", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const parsed = z.object({ appId: z.string().min(1) }).strict().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.message });
    }

    const now = new Date();
    await db
      .update(integrationAccounts)
      .set({ status: "inactive", updatedAt: now })
      .where(
        and(
          eq(integrationAccounts.userId, userId),
          eq(integrationAccounts.providerId, "wechat"),
          sql`${integrationAccounts.metadata} ->> 'appId' = ${parsed.data.appId}`,
        ),
      );

    return res.json({ success: true });
  });

  return router;
}
