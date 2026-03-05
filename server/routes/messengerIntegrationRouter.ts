import { Router, type Request, type Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { getUserId } from "../types/express";
import { channelConversations, integrationAccounts } from "@shared/schema";
import { createChannelPairingCode } from "../channels/channelStore";
import { ensureIntegrationCatalogSeeded } from "../services/integrationCatalog";
import { extractRuntimeSettings, runtimeSettingsUpdateSchema, withRuntimeSettingsMetadata } from "../channels/runtimeConfigHttp";
import { getOrCreateSecureUserId } from "../lib/anonUserHelper";
import { ensureUserRowExists } from "../lib/ensureUserRowExists";
import { messengerSendText } from "../channels/messenger/messengerApi";
import { env } from "../config/env";

const configSchema = z
  .object({
    pageId: z.string().min(1),
    accessToken: z.string().min(1),
  })
  .strict();

const pairingRequestSchema = z
  .object({
    ttlMinutes: z.number().int().min(1).max(60).optional(),
    pageId: z.string().min(1).optional(),
  })
  .strict();

const messengerTestMessageSchema = z
  .object({
    pageId: z.string().min(1).optional(),
  })
  .strict();

function messengerPairingPayload(code: string, pageId?: string) {
  const payload = `Mi canal de Messenger está listo para vincularte. Código: ${code}`;
  const deeplink = pageId
    ? `https://m.me/${encodeURIComponent(pageId)}?ref=${encodeURIComponent(code)}`
    : null;

  return {
    code,
    deeplink,
    qrPayload: payload,
    qrHint: "Comparte este texto en Messenger y escribe el código de vinculación",
  };
}

type MessengerAccountRow = {
  id: string;
  accessToken: string;
  metadata: unknown;
  updatedAt: Date;
};

function extractMessengerPageId(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object") return "";
  const value = (metadata as any).pageId;
  return typeof value === "string" ? value.trim() : "";
}

async function fetchMessengerPageProfile(accessToken: string): Promise<{ pageId: string; name: string } | null> {
  try {
    const url = new URL("https://graph.facebook.com/v21.0/me");
    url.searchParams.set("fields", "id,name");
    url.searchParams.set("access_token", accessToken);
    const response = await fetch(url.toString(), { method: "GET" });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null) as any;
    const pageId = typeof payload?.id === "string" ? payload.id.trim() : "";
    const name = typeof payload?.name === "string" ? payload.name.trim() : "Messenger";
    if (!pageId) return null;
    return { pageId, name: name || "Messenger" };
  } catch {
    return null;
  }
}

export function createMessengerIntegrationRouter(): Router {
  const router = Router();

  async function resolveUserId(req: Request): Promise<string> {
    const userId = getUserId(req) || getOrCreateSecureUserId(req);
    await ensureUserRowExists(userId);
    return userId;
  }

  async function findActiveMessengerAccount(userId: string, requestedPageId?: string): Promise<MessengerAccountRow | null> {
    const predicates = [
      eq(integrationAccounts.userId, userId),
      eq(integrationAccounts.providerId, "messenger"),
      eq(integrationAccounts.status, "active"),
    ];
    const safePageId = requestedPageId?.trim();
    if (safePageId) {
      predicates.push(sql`${integrationAccounts.metadata} ->> 'pageId' = ${safePageId}`);
    }

    const [account] = await db
      .select({
        id: integrationAccounts.id,
        accessToken: integrationAccounts.accessToken,
        metadata: integrationAccounts.metadata,
        updatedAt: integrationAccounts.updatedAt,
      })
      .from(integrationAccounts)
      .where(and(...predicates))
      .orderBy(desc(integrationAccounts.updatedAt))
      .limit(1);
    return account ?? null;
  }

  async function ensureMessengerAccountForUser(userId: string, requestedPageId?: string): Promise<MessengerAccountRow | null> {
    const existing = await findActiveMessengerAccount(userId, requestedPageId);
    if (existing) return existing;

    const fallbackToken = String(env.MESSENGER_PAGE_ACCESS_TOKEN || "").trim();
    if (!fallbackToken) return null;

    let pageId = (requestedPageId || "").trim();
    let displayName = "Messenger";

    if (!pageId) {
      const envPageId = String(process.env.MESSENGER_PAGE_ID || "").trim();
      if (envPageId) {
        pageId = envPageId;
      } else {
        const profile = await fetchMessengerPageProfile(fallbackToken);
        if (profile) {
          pageId = profile.pageId;
          displayName = profile.name || "Messenger";
        }
      }
    }

    if (!pageId) return null;

    await ensureIntegrationCatalogSeeded().catch(() => null);

    const [samePageAccount] = await db
      .select({ id: integrationAccounts.id, metadata: integrationAccounts.metadata })
      .from(integrationAccounts)
      .where(
        and(
          eq(integrationAccounts.userId, userId),
          eq(integrationAccounts.providerId, "messenger"),
          sql`${integrationAccounts.metadata} ->> 'pageId' = ${pageId}`,
        ),
      )
      .limit(1);

    if (samePageAccount) {
      await db
        .update(integrationAccounts)
        .set({
          accessToken: fallbackToken,
          status: "active",
          displayName: displayName || "Messenger",
          metadata: {
            ...(samePageAccount.metadata && typeof samePageAccount.metadata === "object" ? samePageAccount.metadata : {}),
            pageId,
          },
          updatedAt: new Date(),
        })
        .where(eq(integrationAccounts.id, samePageAccount.id));
    } else {
      await db.insert(integrationAccounts).values({
        userId,
        providerId: "messenger",
        displayName: displayName || "Messenger",
        accessToken: fallbackToken,
        status: "active",
        metadata: { pageId },
        updatedAt: new Date(),
      });
    }

    return findActiveMessengerAccount(userId, pageId);
  }

  router.post("/config", async (req: Request, res: Response) => {
    const userId = await resolveUserId(req);

    const parsed = configSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.message });
    }

    await ensureIntegrationCatalogSeeded().catch(() => null);

    const { pageId, accessToken } = parsed.data;
    const now = new Date();

    const [existing] = await db
      .select({ id: integrationAccounts.id, metadata: integrationAccounts.metadata })
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
          metadata: {
            ...(existing.metadata && typeof existing.metadata === "object" ? existing.metadata : {}),
            pageId,
          },
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

  router.post("/pairing-code", async (req: Request, res: Response) => {
    const userId = await resolveUserId(req);

    const parsed = pairingRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.message });
    }

    const account = await ensureMessengerAccountForUser(userId, parsed.data.pageId);
    const pageId = extractMessengerPageId(account?.metadata);
    if (!account || !pageId) {
      return res.status(400).json({
        error:
          "No hay una cuenta de Messenger conectada. Configura MESSENGER_PAGE_ACCESS_TOKEN (y opcionalmente MESSENGER_PAGE_ID) o conecta una página primero.",
      });
    }

    const { code, expiresAt } = await createChannelPairingCode({
      userId,
      channel: "messenger",
      ttlMinutes: parsed.data.ttlMinutes,
    });
    const payload = messengerPairingPayload(code, pageId);

    return res.json({
      success: true,
      channel: "messenger",
      code: payload.code,
      expiresAt: expiresAt.toISOString(),
      deeplink: payload.deeplink,
      qrPayload: payload.qrPayload,
      qrHint: payload.qrHint,
    });
  });

  router.post("/test-message", async (req: Request, res: Response) => {
    const userId = await resolveUserId(req);
    const parsed = messengerTestMessageSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.message });
    }

    const requestedPageId = parsed.data.pageId?.trim();
    const account = await ensureMessengerAccountForUser(userId, requestedPageId);

    if (!account) {
      return res.status(404).json({
        error:
          "No hay una cuenta de Messenger conectada. Configura MESSENGER_PAGE_ACCESS_TOKEN en el servidor para habilitar envío.",
      });
    }

    const accountPageId = extractMessengerPageId(account.metadata) || null;

    const conversationPredicates = [
      eq(channelConversations.userId, userId),
      eq(channelConversations.channel, "messenger"),
      eq(channelConversations.isActive, true),
    ];
    if (accountPageId) {
      conversationPredicates.push(eq(channelConversations.channelKey, accountPageId));
    }

    const [conversation] = await db
      .select({
        id: channelConversations.id,
        chatId: channelConversations.chatId,
        channelKey: channelConversations.channelKey,
        externalConversationId: channelConversations.externalConversationId,
      })
      .from(channelConversations)
      .where(and(...conversationPredicates))
      .orderBy(desc(channelConversations.updatedAt))
      .limit(1);

    if (!conversation || !conversation.externalConversationId) {
      return res.status(404).json({
        error:
          "Aún no hay chat vinculado. Abre Messenger, envía el código de vinculación en el chat de tu página y luego pulsa Comprobar.",
      });
    }

    const recipientId = String(conversation.externalConversationId).trim();
    if (!recipientId) {
      return res.status(400).json({ error: "No se pudo identificar el destinatario del chat vinculado." });
    }

    const testMessage =
      "✅ ILIA conectado. Este es tu chat espejo en Messenger. Escríbeme aquí para continuar.";
    await messengerSendText({
      recipientId,
      text: testMessage,
      accessToken: account.accessToken,
    });

    return res.json({
      success: true,
      pageId: accountPageId || conversation.channelKey,
      recipientId,
      chatId: conversation.chatId,
      message: "Mensaje de prueba enviado a tu chat de Messenger.",
    });
  });

  router.get("/status", async (req: Request, res: Response) => {
    const userId = await resolveUserId(req);
    await ensureMessengerAccountForUser(userId).catch(() => null);

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

  router.get("/settings", async (req: Request, res: Response) => {
    const userId = await resolveUserId(req);

    const pageId = typeof req.query.pageId === "string" ? req.query.pageId : "";
    if (!pageId) return res.status(400).json({ error: "pageId is required" });

    const [account] = await db
      .select({ metadata: integrationAccounts.metadata })
      .from(integrationAccounts)
      .where(and(
        eq(integrationAccounts.userId, userId),
        eq(integrationAccounts.providerId, "messenger"),
        sql`${integrationAccounts.metadata} ->> 'pageId' = ${pageId}`,
      ))
      .limit(1);

    return res.json({ success: true, settings: extractRuntimeSettings(account?.metadata) });
  });

  router.put("/settings", async (req: Request, res: Response) => {
    const userId = await resolveUserId(req);

    const pageId = typeof req.body?.pageId === "string" ? req.body.pageId : "";
    if (!pageId) return res.status(400).json({ error: "pageId is required" });

    const rawSettings = req.body?.settings ?? (({ pageId: _omit, ...rest }: any) => rest)(req.body ?? {});
    const parsed = runtimeSettingsUpdateSchema.safeParse(rawSettings);
    if (!parsed.success) return res.status(400).json({ error: "Invalid settings", details: parsed.error.message });

    const [account] = await db
      .select({ id: integrationAccounts.id, metadata: integrationAccounts.metadata })
      .from(integrationAccounts)
      .where(and(
        eq(integrationAccounts.userId, userId),
        eq(integrationAccounts.providerId, "messenger"),
        sql`${integrationAccounts.metadata} ->> 'pageId' = ${pageId}`,
      ))
      .limit(1);

    if (!account) return res.status(404).json({ error: "Integration account not found" });

    const mergedMetadata = withRuntimeSettingsMetadata(account.metadata, parsed.data);
    await db.update(integrationAccounts)
      .set({ metadata: mergedMetadata, updatedAt: new Date() })
      .where(eq(integrationAccounts.id, account.id));

    return res.json({ success: true, settings: extractRuntimeSettings(mergedMetadata) });
  });

  router.post("/disconnect", async (req: Request, res: Response) => {
    const userId = await resolveUserId(req);

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
