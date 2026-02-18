/**
 * replyModeEngine.ts
 *
 * Core engine for the split reply-mode system:
 *   (A) Owner Assist – always ON, owner messages always get a response
 *   (B) Auto-Reply   – toggleable scope for non-owner messages
 *
 * All decisions are based on a normalized MessageEnvelope so channel-specific
 * identity logic stays contained here.
 */

import type { AutoReplyScope } from '../../shared/schema/autoReplyConfig';

// ── MessageEnvelope ──
// Normalized representation of every inbound message, regardless of channel.
export interface MessageEnvelope {
  /** Unique workspace/user that owns the integration account */
  workspaceId: string;

  /** Channel identifier: 'whatsapp_web' | 'telegram' | 'messenger' | 'wechat' */
  channel: string;

  /** The integration account identifier (e.g. owner's WhatsApp JID) */
  channelAccountId: string;

  /** Thread/contact identifier within the channel */
  threadId: string;

  /** Fully-qualified conversation key for routing isolation */
  conversationKey: string;

  /** Whether the sender is the verified owner of the integration account */
  isOwner: boolean;

  /** Whether this is a group chat */
  isGroup: boolean;

  /** Raw sender identifier (JID, userId, openid, etc.) */
  senderId: string;

  /** Message text content */
  text: string;

  /** Original message ID from the channel */
  messageId?: string;

  /** Timestamp (ms epoch) */
  timestamp?: number;

  /** Optional media attachment */
  media?: any;
}

// ── ConversationKey ──
// Composite key that guarantees 100% routing isolation between conversations.
export interface ConversationKey {
  workspaceId: string;
  channel: string;
  channelAccountId: string;
  threadId: string;
}

export function buildConversationKey(parts: ConversationKey): string {
  const { workspaceId, channel, channelAccountId, threadId } = parts;
  return `${workspaceId}:${channel}:${channelAccountId}:${threadId}`
    .replace(/[^a-zA-Z0-9:_\-@.+]/g, '_')
    .slice(0, 300);
}

// ── Owner Detection per Channel ──

export function detectIsOwnerWhatsApp(
  senderJid: string,
  ownerJid: string | undefined,
  fromMe: boolean,
): boolean {
  if (!ownerJid) return false;

  // Normalize JIDs: strip the device suffix (e.g. "51918714054:42@s.whatsapp.net" → "51918714054@s.whatsapp.net")
  const normalize = (jid: string) => {
    if (jid.includes(':')) {
      return jid.split(':')[0] + '@' + jid.split('@')[1];
    }
    return jid;
  };

  const normalSender = normalize(senderJid);
  const normalOwner = normalize(ownerJid);

  // Self-chat: sender JID matches owner JID (owner messaging themselves)
  if (normalSender === normalOwner) return true;

  // fromMe flag from Baileys indicates message was sent by the authenticated device
  if (fromMe) return true;

  return false;
}

export function detectIsOwnerTelegram(
  senderChatId: string | number,
  ownerChatId: string | number | undefined,
): boolean {
  if (!ownerChatId) return false;
  return String(senderChatId) === String(ownerChatId);
}

export function detectIsOwnerMessenger(
  senderUserId: string,
  ownerUserId: string | undefined,
): boolean {
  if (!ownerUserId) return false;
  return senderUserId === ownerUserId;
}

export function detectIsOwnerWeChat(
  senderOpenId: string,
  ownerOpenId: string | undefined,
): boolean {
  if (!ownerOpenId) return false;
  return senderOpenId === ownerOpenId;
}

// ── Reply Decision Engine ──
// Returns { shouldReply, reason } — deterministic, no side effects.

export interface ReplyDecision {
  shouldReply: boolean;
  reason: string;
}

export interface ReplyDecisionInput {
  envelope: MessageEnvelope;
  autoReplyScope: AutoReplyScope;
  allowlist: string[];
  allowGroups: boolean;
  threadOverride?: boolean | null; // true=force ON, false=force OFF, null=no override
}

export function decideReply(input: ReplyDecisionInput): ReplyDecision {
  const { envelope, autoReplyScope, allowlist, allowGroups, threadOverride } = input;

  // ━━━ (A) OWNER ASSIST — always ON, never blocked ━━━
  if (envelope.isOwner) {
    return { shouldReply: true, reason: 'owner_assist' };
  }

  // ━━━ Group check (before scope check) ━━━
  if (envelope.isGroup && !allowGroups) {
    return { shouldReply: false, reason: 'groups_disabled' };
  }

  // ━━━ Per-thread override takes precedence over scope ━━━
  if (threadOverride === true) {
    return { shouldReply: true, reason: 'thread_override_on' };
  }
  if (threadOverride === false) {
    return { shouldReply: false, reason: 'thread_override_off' };
  }

  // ━━━ (B) AUTO-REPLY — scope-based decision ━━━
  switch (autoReplyScope) {
    case 'OWNER_ONLY':
      // Only owner gets replies; we already returned for owner above
      return { shouldReply: false, reason: 'scope_owner_only' };

    case 'ALLOWLIST':
      if (allowlist.includes(envelope.senderId)) {
        return { shouldReply: true, reason: 'scope_allowlist_match' };
      }
      return { shouldReply: false, reason: 'scope_allowlist_no_match' };

    case 'ALL_CONTACTS':
      return { shouldReply: true, reason: 'scope_all_contacts' };

    default:
      return { shouldReply: false, reason: 'unknown_scope' };
  }
}

// ── Normalize WhatsApp Inbound into MessageEnvelope ──

export function normalizeWhatsAppMessage(opts: {
  userId: string;
  fromJid: string;
  ownerJid: string | undefined;
  fromMe: boolean;
  text: string;
  messageId?: string;
  timestamp?: number;
  media?: any;
  isGroup?: boolean;
}): MessageEnvelope {
  const { userId, fromJid, ownerJid, fromMe, text, messageId, timestamp, media } = opts;
  const isGroup = opts.isGroup ?? fromJid.endsWith('@g.us');

  const isOwner = detectIsOwnerWhatsApp(fromJid, ownerJid, fromMe);

  const conversationKey = buildConversationKey({
    workspaceId: userId,
    channel: 'whatsapp_web',
    channelAccountId: ownerJid || 'unknown',
    threadId: fromJid,
  });

  return {
    workspaceId: userId,
    channel: 'whatsapp_web',
    channelAccountId: ownerJid || 'unknown',
    threadId: fromJid,
    conversationKey,
    isOwner,
    isGroup,
    senderId: fromJid,
    text,
    messageId,
    timestamp,
    media,
  };
}
