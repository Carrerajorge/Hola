import { Router, type Request, type Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { getUserId } from "../types/express";
import { integrationAccounts } from "@shared/schema";
import { ensureIntegrationCatalogSeeded } from "../services/integrationCatalog";

const configSchema = z
  .object({
    pageId: z.string().min(1),
    accessToken: z.string().min(1),
  })
  .strict();

export function createMessengerIntegrationRouter(): Router {
  const router = Router();

  router.post("/config", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const parsed = configSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.message });
    }

    await ensureIntegrationCatalogSeeded().catch(() => null);

    const { pageId, accessToken } = parsed.data;
    const now = new Date();

    const [existing] = await db
      .select({ id: integrationAccounts.id })
      .from(integrationAccounts)
      .where(
        and(
          eq(integrationAccounts.userId, userId),
          eq(integrationAccounts.providerId, "messenger"),
          sql`${integrationAccounts.metadata} ->> 'pageId' = ${pageId}`,
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(integrationAccounts)
        .set({
          accessToken,
          status: "active",
          metadata: { pageId },
          updatedAt: now,
        })
        .where(eq(integrationAccounts.id, existing.id));

      return res.json({ success: true, updated: true });
    }

    await db.insert(integrationAccounts).values({
      userId,
      providerId: "messenger",
      displayName: "Messenger",
      accessToken,
      status: "active",
      metadata: { pageId },
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
      .where(and(eq(integrationAccounts.userId, userId), eq(integrationAccounts.providerId, "messenger")));

    return res.json({ success: true, accounts });
  });

  router.post("/disconnect", async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const parsed = z.object({ pageId: z.string().min(1) }).strict().safeParse(req.body);
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
          eq(integrationAccounts.providerId, "messenger"),
          sql`${integrationAccounts.metadata} ->> 'pageId' = ${parsed.data.pageId}`,
        ),
      );

    return res.json({ success: true });
  });

  return router;
}
