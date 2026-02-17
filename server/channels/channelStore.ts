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
const MAX_OWNER_IDENTITY_VALUE_LENGTH = 120;
const MAX_POLICY_ARRAY_LENGTH = 64;
const SAFE_OWNER_ID_RE = /^[A-Za-z0-9._:@+\-]+$/;

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

export async function getChannelConversationForUser(input: {
  userId: string;
  channel: string;
  channelKey: string;
  externalConversationId: string;
}): Promise<ChannelConversation | null> {
  const [row] = await db
    .select()
    .from(channelConversations)
    .where(
      and(
        eq(channelConversations.userId, input.userId),
        eq(channelConversations.channel, input.channel),
        eq(channelConversations.channelKey, input.channelKey),
        eq(channelConversations.externalConversationId, input.externalConversationId),
        eq(channelConversations.isActive, true),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function getChannelConversationById(id: string): Promise<ChannelConversation | null> {
  const [row] = await db.select().from(channelConversations).where(eq(channelConversations.id, id)).limit(1);
  return row ?? null;
}

export async function getChannelConversationByMetadata(input: {
  userId: string;
  channel: string;
  channelKey: string;
  externalConversationId: string;
}): Promise<ChannelConversation | null> {
  return getChannelConversation({ channel: input.channel, channelKey: input.channelKey, externalConversationId: input.externalConversationId });
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

    try {
      await db.delete(chats).where(eq(chats.id, chat.id));
    } catch {
      // ignore cleanup failure
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

export async function updateChannelConversationMetadata(
  conversationId: string,
  patch: Record<string, unknown>,
): Promise<ChannelConversation | null> {
  const now = new Date();
  const [row] = await db
    .update(channelConversations)
    .set({
      metadata: sql`COALESCE(${channelConversations.metadata}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
      updatedAt: now,
    })
    .where(eq(channelConversations.id, conversationId))
    .returning();

  return row ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeMetadata(input: unknown): Record<string, unknown> {
  return isRecord(input) ? (input as Record<string, unknown>) : {};
}

function normalizeOwnerIdentityCollection(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(
    values
      .slice(0, MAX_POLICY_ARRAY_LENGTH)
      .map((value) => normalizeOwnerIdentityValue(value))
      .filter(Boolean),
  ));
}

function toStringSet(values: unknown): Set<string> {
  if (!Array.isArray(values)) return new Set<string>();
  return new Set(
    values
      .slice(0, MAX_POLICY_ARRAY_LENGTH)
      .map((value) => normalizeOwnerIdentityValue(value))
      .filter(Boolean),
  );
}

function normalizeOwnerIdentityValue(value: unknown): string {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .replace(/\u0000/g, "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .slice(0, MAX_OWNER_IDENTITY_VALUE_LENGTH);

  if (!normalized || !SAFE_OWNER_ID_RE.test(normalized)) {
    return "";
  }

  return normalized;
}

function mergeMetadataObjects(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(patch)) {
    const current = merged[key];
    if (isRecord(current) && isRecord(value)) {
      merged[key] = mergeMetadataObjects(current, value);
      continue;
    }
    merged[key] = value;
  }

  return merged;
}

export async function patchConversationMetadata(
  conversationId: string,
  patch: Record<string, unknown>,
): Promise<ChannelConversation | null> {
  const [row] = await db
    .select()
    .from(channelConversations)
    .where(eq(channelConversations.id, conversationId))
    .limit(1);

  if (!row) return null;

  const merged = mergeMetadataObjects(normalizeMetadata(row.metadata), patch);

  const [updated] = await db
    .update(channelConversations)
    .set({
      metadata: merged,
      updatedAt: new Date(),
    })
    .where(eq(channelConversations.id, conversationId))
    .returning();

  return updated ?? null;
}

function mergeHistoryMetadata(existing: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const existingObj =
    existing && typeof existing === "object" ? (existing as Record<string, unknown>) : {};
  const history =
    existingObj.history && typeof existingObj.history === "object"
      ? (existingObj.history as Record<string, unknown>)
      : {};

  return {
    ...existingObj,
    ...patch,
    history: {
      ...history,
      ...(patch.history as Record<string, unknown> | undefined),
    },
  };
}

export async function touchChannelConversationHeartbeat(
  conversationId: string,
  touch: { lastInboundAt?: string; lastOutboundAt?: string },
): Promise<ChannelConversation | null> {
  const [row] = await db
    .select()
    .from(channelConversations)
    .where(eq(channelConversations.id, conversationId))
    .limit(1);

  if (!row) return null;

  const merged = mergeHistoryMetadata(row.metadata, {
    lastInboundAt: touch.lastInboundAt ?? row.metadata?.lastInboundAt,
    lastOutboundAt: touch.lastOutboundAt ?? row.metadata?.lastOutboundAt,
  } as Record<string, unknown>);

  const [updated] = await db
    .update(channelConversations)
    .set({ metadata: merged, updatedAt: new Date() })
    .where(eq(channelConversations.id, conversationId))
    .returning();

  return updated ?? null;
}

export async function setConversationPolicy(
  conversationId: string,
  policy: Record<string, unknown>,
): Promise<ChannelConversation | null> {
  return patchConversationMetadata(conversationId, {
    policy: {
      ...(await getConversationMetadata(conversationId)).policy,
      ...policy,
      updatedAt: new Date().toISOString(),
    },
  });
}

export async function setConversationOwnerIdentity(
  conversationId: string,
  ownerIdentity: Record<string, unknown>,
): Promise<ChannelConversation | null> {
  const current = await getConversationMetadata(conversationId);
  const ownerIdentityPatch = {
    ...normalizeMetadata(current.ownerIdentity),
    ...ownerIdentity,
    updatedAt: new Date().toISOString(),
  };

  const ownerIdCandidates = [
    ownerIdentityPatch.owner_external_ids,
    ownerIdentityPatch.owners,
    ownerIdentityPatch.ownerIds,
    ownerIdentityPatch.owner_ids,
  ];
  const normalizedOwnerIdentityPatch = {
    ...ownerIdentityPatch,
    ownerExternalId: normalizeOwnerIdentityValue(ownerIdentityPatch.ownerExternalId),
    ownerId: normalizeOwnerIdentityValue(ownerIdentityPatch.ownerId),
    consumedByExternalId: normalizeOwnerIdentityValue(ownerIdentityPatch.consumedByExternalId),
    owner_external_ids: normalizeOwnerIdentityCollection(ownerIdentityPatch.owner_external_ids),
    owners: normalizeOwnerIdentityCollection(ownerIdentityPatch.owners),
    ownerIds: normalizeOwnerIdentityCollection(ownerIdentityPatch.ownerIds),
    owner_ids: normalizeOwnerIdentityCollection(ownerIdentityPatch.owner_ids),
  };

  const ownerIds = new Set<string>();
  const ownerCandidates = [
    normalizedOwnerIdentityPatch.ownerExternalId,
    normalizedOwnerIdentityPatch.ownerId,
    normalizedOwnerIdentityPatch.owner_external_ids,
    normalizedOwnerIdentityPatch.owners,
    normalizedOwnerIdentityPatch.ownerIds,
    normalizedOwnerIdentityPatch.owner_ids,
    ownerIdentityPatch.ownerExternalId,
    ownerIdentityPatch.ownerId,
  ];
  for (const candidate of ownerCandidates) {
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        const normalized = normalizeOwnerIdentityValue(item);
        if (normalized) ownerIds.add(normalized);
      }
      continue;
    }
    const normalized = normalizeOwnerIdentityValue(candidate);
    if (normalized) ownerIds.add(normalized);
  }

  const runtimePatch = normalizeMetadata(current.runtime);
  const policyPatch = normalizeMetadata(current.policy);

  const mergedRuntimeOwnerIds = new Set([
    ...toStringSet(runtimePatch.owner_external_ids),
    ...ownerIds,
  ]);
  const mergedPolicyOwnerIds = new Set([
    ...toStringSet(policyPatch.owner_external_ids),
    ...ownerIds,
  ]);

  return patchConversationMetadata(conversationId, {
    ownerIdentity: normalizedOwnerIdentityPatch,
    policy: {
      ...policyPatch,
      ...(ownerIds.size ? { owner_external_ids: Array.from(mergedPolicyOwnerIds) } : {}),
      updatedAt: new Date().toISOString(),
    },
    runtime: {
      ...runtimePatch,
      ...(ownerIds.size ? { owner_external_ids: Array.from(mergedRuntimeOwnerIds) } : {}),
    },
  });
}

async function getConversationMetadata(conversationId: string): Promise<Record<string, any>> {
  const [row] = await db
    .select()
    .from(channelConversations)
    .where(eq(channelConversations.id, conversationId))
    .limit(1);

  return normalizeMetadata(row?.metadata);
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

export async function findAnyActiveTelegramAccount(): Promise<IntegrationAccount | null> {
  const [row] = await db
    .select()
    .from(integrationAccounts)
    .where(
      and(
        eq(integrationAccounts.providerId, "telegram"),
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
