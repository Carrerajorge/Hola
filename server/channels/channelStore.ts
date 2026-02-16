import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { db } from "../db";
import { storage } from "../storage";
import {
  channelConversations,
  channelPairingCodes,
  chats,
  integrationAccounts,
  type ChannelConversation,
  type IntegrationAccount,
} from "@shared/schema";

const pairingAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const makePairingCode = customAlphabet(pairingAlphabet, 8);

function isUniqueViolation(err: unknown): boolean {
  const code = (err as any)?.code;
  return code === "23505";
}

export async function createChannelPairingCode(input: {
  userId: string;
  channel: string;
  ttlMinutes?: number;
}): Promise<{ code: string; expiresAt: Date }> {
  const ttlMinutes = input.ttlMinutes ?? 15;
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makePairingCode();
    try {
      await db.insert(channelPairingCodes).values({
        userId: input.userId,
        channel: input.channel,
        code,
        expiresAt,
      });
      return { code, expiresAt };
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }

  throw new Error("Failed to generate a unique pairing code");
}

export async function consumeChannelPairingCode(input: {
  channel: string;
  code: string;
  consumedByExternalId: string;
}): Promise<{ userId: string } | null> {
  const now = new Date();
  const [row] = await db
    .update(channelPairingCodes)
    .set({
      consumedAt: now,
      consumedByExternalId: input.consumedByExternalId,
    })
    .where(
      and(
        eq(channelPairingCodes.channel, input.channel),
        eq(channelPairingCodes.code, input.code),
        isNull(channelPairingCodes.consumedAt),
        gt(channelPairingCodes.expiresAt, now),
      ),
    )
    .returning({ userId: channelPairingCodes.userId });

  return row ? { userId: row.userId } : null;
}

export async function getChannelConversation(input: {
  channel: string;
  channelKey: string;
  externalConversationId: string;
}): Promise<ChannelConversation | null> {
  const [row] = await db
    .select()
    .from(channelConversations)
    .where(
      and(
        eq(channelConversations.channel, input.channel),
        eq(channelConversations.channelKey, input.channelKey),
        eq(channelConversations.externalConversationId, input.externalConversationId),
        eq(channelConversations.isActive, true),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function getOrCreateChannelConversation(input: {
  userId: string;
  channel: string;
  channelKey: string;
  externalConversationId: string;
  title: string;
  metadata?: Record<string, unknown>;
}): Promise<ChannelConversation> {
  const existing = await getChannelConversation({
    channel: input.channel,
    channelKey: input.channelKey,
    externalConversationId: input.externalConversationId,
  });
  if (existing) return existing;

  // Create chat first, then bind it. If a race creates the conversation first,
  // delete the orphaned chat (best-effort) and return the existing conversation.
  const chat = await storage.createChat({
    userId: input.userId,
    title: input.title,
  });

  try {
    const [created] = await db
      .insert(channelConversations)
      .values({
        userId: input.userId,
        channel: input.channel,
        channelKey: input.channelKey,
        externalConversationId: input.externalConversationId,
        chatId: chat.id,
        metadata: input.metadata ?? null,
      })
      .returning();

    if (!created) throw new Error("Failed to create channel conversation");
    return created;
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;

    // Best-effort cleanup.
    try {
      await db.delete(chats).where(eq(chats.id, chat.id));
    } catch {
      // ignore
    }

    const after = await getChannelConversation({
      channel: input.channel,
      channelKey: input.channelKey,
      externalConversationId: input.externalConversationId,
    });
    if (!after) throw e;
    return after;
  }
}

export async function findWhatsAppCloudAccountByPhoneNumberId(
  phoneNumberId: string,
): Promise<IntegrationAccount | null> {
  const [row] = await db
    .select()
    .from(integrationAccounts)
    .where(
      and(
        eq(integrationAccounts.providerId, "whatsapp_cloud"),
        sql`${integrationAccounts.metadata} ->> 'phoneNumberId' = ${phoneNumberId}`,
        eq(integrationAccounts.status, "active"),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function findTelegramAccountByUserId(
  userId: string,
): Promise<IntegrationAccount | null> {
  const [row] = await db
    .select()
    .from(integrationAccounts)
    .where(
      and(
        eq(integrationAccounts.providerId, "telegram"),
        eq(integrationAccounts.userId, userId),
        eq(integrationAccounts.status, "active"),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function findMessengerAccountByPageId(
  pageId: string,
): Promise<IntegrationAccount | null> {
  const [row] = await db
    .select()
    .from(integrationAccounts)
    .where(
      and(
        eq(integrationAccounts.providerId, "messenger"),
        sql`${integrationAccounts.metadata} ->> 'pageId' = ${pageId}`,
        eq(integrationAccounts.status, "active"),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function findWeChatAccountByAppId(
  appId: string,
): Promise<IntegrationAccount | null> {
  const [row] = await db
    .select()
    .from(integrationAccounts)
    .where(
      and(
        eq(integrationAccounts.providerId, "wechat"),
        sql`${integrationAccounts.metadata} ->> 'appId' = ${appId}`,
        eq(integrationAccounts.status, "active"),
      ),
    )
    .limit(1);
  return row ?? null;
}

