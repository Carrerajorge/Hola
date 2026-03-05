import { Router, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { getUserId } from "../types/express";
import { channelConversations, integrationAccounts } from "@shared/schema";
import { createChannelPairingCode } from "../channels/channelStore";
import { env } from "../config/env";
import { telegramSetWebhook } from "../channels/telegram/telegramApi";
import { ensureIntegrationCatalogSeeded } from "../services/integrationCatalog";
import { Logger } from "../lib/logger";
import { extractRuntimeSettings, runtimeSettingsUpdateSchema, withRuntimeSettingsMetadata } from "../channels/runtimeConfigHttp";
import { getOrCreateSecureUserId } from "../lib/anonUserHelper";
import { ensureUserRowExists } from "../lib/ensureUserRowExists";
import { telegramSendMessage } from "../channels/telegram/telegramApi";

const pairingRequestSchema = z
  .object({
    ttlMinutes: z.number().int().min(1).max(60).optional(),
  })
  .strict();

const configSchema = z
  .object({
    botToken: z.string().min(1),
    webhookUrl: z.string().optional(),
  })
  .strict();

const telegramTestMessageSchema = z
  .object({})
  .strict();

type TelegramAccountRow = {
  id: string;
  userId: string;
  displayName: string | null;
  accessToken: string | null;
  metadata: unknown;
  updatedAt: Date;
};

const TELEGRAM_TOKEN_RE = /^\d+:[A-Za-z0-9_-]{35,}$/;
const TELEGRAM_BOT_USERNAME_RE = /^[A-Za-z0-9_]{5,64}$/;

function normalizeTelegramToken(raw: unknown): string {
  const token = String(raw ?? "").trim();
  if (!token) return "";
  return TELEGRAM_TOKEN_RE.test(token) ? token : "";
}

function normalizeTelegramBotUsername(raw: unknown): string {
  const username = String(raw ?? "")
    .trim()
    .replace(/^@+/, "");
  if (!username) return "";
  return TELEGRAM_BOT_USERNAME_RE.test(username) ? username : "";
}

function extractTelegramBotUsername(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object") return "";
  return normalizeTelegramBotUsername((metadata as any).botUsername);
}

async function fetchTelegramBotProfile(botToken: string): Promise<{ username: string; displayName: string } | null> {
  const safeToken = normalizeTelegramToken(botToken);
  if (!safeToken) return null;

  try {
    const response = await fetch(`https://api.telegram.org/bot${safeToken}/getMe`, { method: "GET" });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null) as any;
    const user = payload?.result;
    const username = normalizeTelegramBotUsername(user?.username);
    if (!username) return null;
    const displayName = String(user?.first_name || "Telegram Bot").trim() || "Telegram Bot";
    return { username, displayName };
  } catch {
    return null;
  }
}

export function createTelegramIntegrationRouter(): Router {
  const router = Router();

  async function resolveUserId(req: Request): Promise<string> {
    const userId = getUserId(req) || getOrCreateSecureUserId(req);
    await ensureUserRowExists(userId);
    return userId;
  }

  async function findActiveTelegramAccount(userId: string): Promise<TelegramAccountRow | null> {
    const [account] = await db
      .select({
        id: integrationAccounts.id,
        userId: integrationAccounts.userId,
        displayName: integrationAccounts.displayName,
        accessToken: integrationAccounts.accessToken,
        metadata: integrationAccounts.metadata,
        updatedAt: integrationAccounts.updatedAt,
      })
      .from(integrationAccounts)
      .where(
        and(
          eq(integrationAccounts.userId, userId),
          eq(integrationAccounts.providerId, "telegram"),
          eq(integrationAccounts.status, "active"),
        ),
      )
      .orderBy(desc(integrationAccounts.updatedAt))
      .limit(1);
    return account ?? null;
  }

  async function findAnyActiveTelegramAccountGlobal(): Promise<TelegramAccountRow | null> {
    const [account] = await db
      .select({
        id: integrationAccounts.id,
        userId: integrationAccounts.userId,
        displayName: integrationAccounts.displayName,
        accessToken: integrationAccounts.accessToken,
        metadata: integrationAccounts.metadata,
        updatedAt: integrationAccounts.updatedAt,
      })
      .from(integrationAccounts)
      .where(
        and(
          eq(integrationAccounts.providerId, "telegram"),
          eq(integrationAccounts.status, "active"),
        ),
      )
      .orderBy(desc(integrationAccounts.updatedAt))
      .limit(1);
    return account ?? null;
  }

  async function ensureTelegramAccountForUser(userId: string): Promise<TelegramAccountRow | null> {
    const existing = await findActiveTelegramAccount(userId);
    if (existing) return existing;

    const globalAccount = await findAnyActiveTelegramAccountGlobal();
    if (globalAccount?.accessToken) {
      if (globalAccount.userId === userId) return globalAccount;
      const [createdFromGlobal] = await db
        .insert(integrationAccounts)
        .values({
          userId,
          providerId: "telegram",
          displayName: globalAccount.displayName || "Telegram Bot",
          accessToken: globalAccount.accessToken,
          status: "active",
          metadata: globalAccount.metadata && typeof globalAccount.metadata === "object"
            ? { ...(globalAccount.metadata as Record<string, unknown>) }
            : null,
          updatedAt: new Date(),
        })
        .returning({
          id: integrationAccounts.id,
          userId: integrationAccounts.userId,
          displayName: integrationAccounts.displayName,
          accessToken: integrationAccounts.accessToken,
          metadata: integrationAccounts.metadata,
          updatedAt: integrationAccounts.updatedAt,
        });
      if (createdFromGlobal) return createdFromGlobal;
    }

    const fallbackToken = normalizeTelegramToken(env.TELEGRAM_BOT_TOKEN);
    if (!fallbackToken) return null;

    await ensureIntegrationCatalogSeeded().catch(() => null);

    const profile = await fetchTelegramBotProfile(fallbackToken);
    const metadata: Record<string, unknown> = {
      botUsername: profile?.username || null,
      configuredFrom: "env",
    };

    const [created] = await db
      .insert(integrationAccounts)
      .values({
        userId,
        providerId: "telegram",
        displayName: profile?.displayName || "Telegram Bot",
        accessToken: fallbackToken,
        status: "active",
        metadata,
        updatedAt: new Date(),
      })
      .returning({
        id: integrationAccounts.id,
        userId: integrationAccounts.userId,
        displayName: integrationAccounts.displayName,
        accessToken: integrationAccounts.accessToken,
        metadata: integrationAccounts.metadata,
        updatedAt: integrationAccounts.updatedAt,
      });

    return created ?? null;
  }

  router.get("/status", async (req: Request, res: Response) => {
    const userId = await resolveUserId(req);
    await ensureTelegramAccountForUser(userId).catch(() => null);

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
      .where(and(eq(integrationAccounts.userId, userId), eq(integrationAccounts.providerId, "telegram")));

    return res.json({ success: true, accounts });
  });

  router.post("/pairing-code", async (req: Request, res: Response) => {
    const userId = await resolveUserId(req);

    const parsed = pairingRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.message });
    }

    const account = await ensureTelegramAccountForUser(userId);
    if (!account) {
      return res.status(400).json({
        error:
          "Telegram aún no está habilitado en este servidor. Solicita al administrador activar el bot para conexión por QR.",
      });
    }

    const { code, expiresAt } = await createChannelPairingCode({
      userId,
      channel: "telegram",
      ttlMinutes: parsed.data.ttlMinutes,
    });

    let botUsername = extractTelegramBotUsername(account.metadata);
    if (!botUsername) {
      const profile = await fetchTelegramBotProfile(account.accessToken || "");
      if (profile?.username) {
        botUsername = profile.username;
        await db
          .update(integrationAccounts)
          .set({
            displayName: profile.displayName || "Telegram Bot",
            metadata: {
              ...(account.metadata && typeof account.metadata === "object" ? account.metadata : {}),
              botUsername: profile.username,
            },
            updatedAt: new Date(),
          })
          .where(eq(integrationAccounts.id, account.id))
          .catch(() => null);
      }
    }
    const deeplink = botUsername
      ? `https://t.me/${encodeURIComponent(botUsername)}?start=${encodeURIComponent(code)}`
      : "https://web.telegram.org/";
    const qrPayload = deeplink;
    return res.json({
      success: true,
      code,
      expiresAt: expiresAt.toISOString(),
      channel: "telegram",
      deeplink,
      qrPayload,
      qrHint: botUsername
        ? "Escanea o abre Telegram, inicia el bot y envía el código si no se manda automáticamente."
        : "Abre Telegram y envía el código al bot para iniciar la verificación.",
      botUsername: botUsername ? `@${botUsername}` : null,
    });
  });

  router.post("/config", async (req: Request, res: Response) => {
    const userId = await resolveUserId(req);

    const parsed = configSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.message });
    }

    await ensureIntegrationCatalogSeeded().catch(() => null);

    const { botToken, webhookUrl } = parsed.data;
    const safeToken = normalizeTelegramToken(botToken);
    if (!safeToken) {
      return res.status(400).json({ error: "Bot token inválido" });
    }
    const profile = await fetchTelegramBotProfile(safeToken);
    const now = new Date();

    const [existing] = await db
      .select({ id: integrationAccounts.id, metadata: integrationAccounts.metadata })
      .from(integrationAccounts)
      .where(
        and(
          eq(integrationAccounts.userId, userId),
          eq(integrationAccounts.providerId, "telegram"),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(integrationAccounts)
        .set({
          accessToken: safeToken,
          status: "active",
          metadata: {
            ...(existing.metadata && typeof existing.metadata === "object" ? existing.metadata : {}),
            webhookUrl: webhookUrl || null,
            botUsername: profile?.username || null,
          },
          displayName: profile?.displayName || "Telegram Bot",
          updatedAt: now,
        })
        .where(eq(integrationAccounts.id, existing.id));
    } else {
      await db.insert(integrationAccounts).values({
        userId,
        providerId: "telegram",
        displayName: profile?.displayName || "Telegram Bot",
        accessToken: safeToken,
        status: "active",
        metadata: {
          webhookUrl: webhookUrl || null,
          botUsername: profile?.username || null,
        },
        updatedAt: now,
      });
    }

    if (webhookUrl) {
      try {
        await telegramSetWebhook({ webhookUrl, botToken: safeToken });
      } catch (err) {
        Logger.error("[Telegram] Failed to set webhook", err);
        return res.json({ success: true, webhookSet: false, webhookError: String(err) });
      }
    }

    return res.json({ success: true, webhookSet: !!webhookUrl });
  });

  router.get("/settings", async (req: Request, res: Response) => {
    const userId = await resolveUserId(req);
    await ensureTelegramAccountForUser(userId).catch(() => null);

    const [account] = await db
      .select({ metadata: integrationAccounts.metadata })
      .from(integrationAccounts)
      .where(and(eq(integrationAccounts.userId, userId), eq(integrationAccounts.providerId, "telegram")))
      .limit(1);

    return res.json({ success: true, settings: extractRuntimeSettings(account?.metadata) });
  });

  router.put("/settings", async (req: Request, res: Response) => {
    const userId = await resolveUserId(req);

    const parsed = runtimeSettingsUpdateSchema.safeParse(req.body?.settings ?? req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Invalid settings", details: parsed.error.message });

    const [account] = await db
      .select({ id: integrationAccounts.id, metadata: integrationAccounts.metadata })
      .from(integrationAccounts)
      .where(and(eq(integrationAccounts.userId, userId), eq(integrationAccounts.providerId, "telegram")))
      .limit(1);

    if (!account) return res.status(404).json({ error: "Integration account not found" });

    const mergedMetadata = withRuntimeSettingsMetadata(account.metadata, parsed.data);
    await db.update(integrationAccounts)
      .set({ metadata: mergedMetadata, updatedAt: new Date() })
      .where(eq(integrationAccounts.id, account.id));

    return res.json({ success: true, settings: extractRuntimeSettings(mergedMetadata) });
  });

  router.post("/test-message", async (req: Request, res: Response) => {
    const userId = await resolveUserId(req);
    const parsed = telegramTestMessageSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.message });
    }

    const account = await ensureTelegramAccountForUser(userId);
    if (!account) {
      return res.status(404).json({
        error:
          "Telegram aún no está habilitado en este servidor. Solicita al administrador activar el bot para usar chat espejo.",
      });
    }

    const [conversation] = await db
      .select({
        id: channelConversations.id,
        chatId: channelConversations.chatId,
        externalConversationId: channelConversations.externalConversationId,
      })
      .from(channelConversations)
      .where(
        and(
          eq(channelConversations.userId, userId),
          eq(channelConversations.channel, "telegram"),
          eq(channelConversations.isActive, true),
        ),
      )
      .orderBy(desc(channelConversations.updatedAt))
      .limit(1);

    if (!conversation || !conversation.externalConversationId) {
      return res.status(404).json({
        error:
          "Aún no hay chat vinculado. Abre Telegram, escribe el código de vinculación al bot y luego pulsa Comprobar.",
      });
    }

    const recipientId = String(conversation.externalConversationId).trim();
    if (!recipientId) {
      return res.status(400).json({ error: "No se pudo identificar el destinatario del chat vinculado." });
    }

    const testMessage =
      "✅ ILIA conectado. Este es tu chat espejo en Telegram. Escríbeme aquí para continuar.";
    await telegramSendMessage(recipientId, testMessage, {
      botToken: account.accessToken || undefined,
    });

    return res.json({
      success: true,
      chatId: conversation.chatId,
      recipientId,
      message: "Mensaje de prueba enviado a tu chat de Telegram.",
    });
  });

  return router;
}
