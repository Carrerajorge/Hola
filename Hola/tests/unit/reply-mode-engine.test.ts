import { describe, expect, it } from 'vitest';
import {
  decideReply,
  normalizeWhatsAppMessage,
  detectIsOwnerWhatsApp,
  buildConversationKey,
  type MessageEnvelope,
  type ReplyDecisionInput,
} from '../../server/integrations/replyModeEngine';

// ── Helper factories ──

function makeOwnerEnvelope(overrides?: Partial<MessageEnvelope>): MessageEnvelope {
  return {
    workspaceId: 'user123',
    channel: 'whatsapp_web',
    channelAccountId: '51918714054@s.whatsapp.net',
    threadId: '51918714054@s.whatsapp.net',
    conversationKey: 'user123:whatsapp_web:51918714054@s.whatsapp.net:51918714054@s.whatsapp.net',
    isOwner: true,
    isGroup: false,
    senderId: '51918714054@s.whatsapp.net',
    text: 'Hola',
    ...overrides,
  };
}

function makeContactEnvelope(overrides?: Partial<MessageEnvelope>): MessageEnvelope {
  return {
    workspaceId: 'user123',
    channel: 'whatsapp_web',
    channelAccountId: '51918714054@s.whatsapp.net',
    threadId: '5491155551234@s.whatsapp.net',
    conversationKey: 'user123:whatsapp_web:51918714054@s.whatsapp.net:5491155551234@s.whatsapp.net',
    isOwner: false,
    isGroup: false,
    senderId: '5491155551234@s.whatsapp.net',
    text: 'Hola desde contacto',
    ...overrides,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TEST SUITE: Reply Mode Engine
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Reply Mode Engine', () => {

  // ── Owner Detection ──

  describe('detectIsOwnerWhatsApp', () => {
    it('detects owner by matching JID (self-chat)', () => {
      expect(detectIsOwnerWhatsApp(
        '51918714054@s.whatsapp.net',
        '51918714054@s.whatsapp.net',
        false,
      )).toBe(true);
    });

    it('detects owner with device suffix normalization', () => {
      expect(detectIsOwnerWhatsApp(
        '51918714054@s.whatsapp.net',
        '51918714054:42@s.whatsapp.net',
        false,
      )).toBe(true);
    });

    it('detects owner via fromMe flag', () => {
      expect(detectIsOwnerWhatsApp(
        '51918714054@s.whatsapp.net',
        '51918714054@s.whatsapp.net',
        true,
      )).toBe(true);
    });

    it('rejects non-owner contacts', () => {
      expect(detectIsOwnerWhatsApp(
        '5491155551234@s.whatsapp.net',
        '51918714054@s.whatsapp.net',
        false,
      )).toBe(false);
    });

    it('rejects when ownerJid is undefined', () => {
      expect(detectIsOwnerWhatsApp(
        '51918714054@s.whatsapp.net',
        undefined,
        false,
      )).toBe(false);
    });
  });

  // ── Conversation Key Isolation ──

  describe('buildConversationKey', () => {
    it('produces unique keys per contact', () => {
      const key1 = buildConversationKey({
        workspaceId: 'user1',
        channel: 'whatsapp_web',
        channelAccountId: 'owner@s.whatsapp.net',
        threadId: 'contact1@s.whatsapp.net',
      });
      const key2 = buildConversationKey({
        workspaceId: 'user1',
        channel: 'whatsapp_web',
        channelAccountId: 'owner@s.whatsapp.net',
        threadId: 'contact2@s.whatsapp.net',
      });
      expect(key1).not.toBe(key2);
    });

    it('produces unique keys per workspace', () => {
      const key1 = buildConversationKey({
        workspaceId: 'user1',
        channel: 'whatsapp_web',
        channelAccountId: 'owner@s.whatsapp.net',
        threadId: 'contact@s.whatsapp.net',
      });
      const key2 = buildConversationKey({
        workspaceId: 'user2',
        channel: 'whatsapp_web',
        channelAccountId: 'owner@s.whatsapp.net',
        threadId: 'contact@s.whatsapp.net',
      });
      expect(key1).not.toBe(key2);
    });

    it('truncates very long keys', () => {
      const key = buildConversationKey({
        workspaceId: 'a'.repeat(200),
        channel: 'whatsapp_web',
        channelAccountId: 'b'.repeat(200),
        threadId: 'c'.repeat(200),
      });
      expect(key.length).toBeLessThanOrEqual(300);
    });
  });

  // ── normalizeWhatsAppMessage ──

  describe('normalizeWhatsAppMessage', () => {
    it('normalizes a self-chat message as isOwner=true', () => {
      const env = normalizeWhatsAppMessage({
        userId: 'user123',
        fromJid: '51918714054@s.whatsapp.net',
        ownerJid: '51918714054:42@s.whatsapp.net',
        fromMe: true,
        text: 'Test from self',
      });
      expect(env.isOwner).toBe(true);
      expect(env.isGroup).toBe(false);
      expect(env.channel).toBe('whatsapp_web');
    });

    it('normalizes a contact message as isOwner=false', () => {
      const env = normalizeWhatsAppMessage({
        userId: 'user123',
        fromJid: '5491155551234@s.whatsapp.net',
        ownerJid: '51918714054@s.whatsapp.net',
        fromMe: false,
        text: 'Hello from contact',
      });
      expect(env.isOwner).toBe(false);
    });

    it('detects group JIDs', () => {
      const env = normalizeWhatsAppMessage({
        userId: 'user123',
        fromJid: '123456789@g.us',
        ownerJid: '51918714054@s.whatsapp.net',
        fromMe: false,
        text: 'Group message',
      });
      expect(env.isGroup).toBe(true);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TEST (1): Owner writes in self-chat → responds even if auto-reply is OFF
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe('Scenario 1: Owner self-chat always responds', () => {
    it('replies to owner even when scope is OWNER_ONLY (auto-reply effectively OFF for others)', () => {
      const decision = decideReply({
        envelope: makeOwnerEnvelope(),
        autoReplyScope: 'OWNER_ONLY',
        allowlist: [],
        allowGroups: false,
        threadOverride: null,
      });
      expect(decision.shouldReply).toBe(true);
      expect(decision.reason).toBe('owner_assist');
    });

    it('replies to owner even when thread override is OFF', () => {
      const decision = decideReply({
        envelope: makeOwnerEnvelope(),
        autoReplyScope: 'OWNER_ONLY',
        allowlist: [],
        allowGroups: false,
        threadOverride: false,
      });
      // Owner ALWAYS gets a reply — thread override cannot block the owner
      expect(decision.shouldReply).toBe(true);
      expect(decision.reason).toBe('owner_assist');
    });

    it('replies to owner even when scope is ALL_CONTACTS', () => {
      const decision = decideReply({
        envelope: makeOwnerEnvelope(),
        autoReplyScope: 'ALL_CONTACTS',
        allowlist: [],
        allowGroups: false,
        threadOverride: null,
      });
      expect(decision.shouldReply).toBe(true);
      expect(decision.reason).toBe('owner_assist');
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TEST (2): External contact writes → does NOT respond in OWNER_ONLY
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe('Scenario 2: External contact blocked in OWNER_ONLY', () => {
    it('does NOT reply to external contact in OWNER_ONLY scope', () => {
      const decision = decideReply({
        envelope: makeContactEnvelope(),
        autoReplyScope: 'OWNER_ONLY',
        allowlist: [],
        allowGroups: false,
        threadOverride: null,
      });
      expect(decision.shouldReply).toBe(false);
      expect(decision.reason).toBe('scope_owner_only');
    });

    it('does NOT reply to external contact in ALLOWLIST when not on list', () => {
      const decision = decideReply({
        envelope: makeContactEnvelope(),
        autoReplyScope: 'ALLOWLIST',
        allowlist: ['other_contact@s.whatsapp.net'],
        allowGroups: false,
        threadOverride: null,
      });
      expect(decision.shouldReply).toBe(false);
      expect(decision.reason).toBe('scope_allowlist_no_match');
    });

    it('replies to external contact in ALLOWLIST when on list', () => {
      const decision = decideReply({
        envelope: makeContactEnvelope(),
        autoReplyScope: 'ALLOWLIST',
        allowlist: ['5491155551234@s.whatsapp.net'],
        allowGroups: false,
        threadOverride: null,
      });
      expect(decision.shouldReply).toBe(true);
      expect(decision.reason).toBe('scope_allowlist_match');
    });

    it('blocks group messages even in ALL_CONTACTS when groups disabled', () => {
      const decision = decideReply({
        envelope: makeContactEnvelope({ isGroup: true, senderId: '123@g.us', threadId: '123@g.us' }),
        autoReplyScope: 'ALL_CONTACTS',
        allowlist: [],
        allowGroups: false,
        threadOverride: null,
      });
      expect(decision.shouldReply).toBe(false);
      expect(decision.reason).toBe('groups_disabled');
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TEST (3): ALL_CONTACTS ON → responds coherently per thread
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe('Scenario 3: ALL_CONTACTS responds per thread without mixing', () => {
    it('replies to any contact in ALL_CONTACTS scope', () => {
      const decision = decideReply({
        envelope: makeContactEnvelope(),
        autoReplyScope: 'ALL_CONTACTS',
        allowlist: [],
        allowGroups: false,
        threadOverride: null,
      });
      expect(decision.shouldReply).toBe(true);
      expect(decision.reason).toBe('scope_all_contacts');
    });

    it('different contacts produce different conversation keys (routing isolation)', () => {
      const env1 = normalizeWhatsAppMessage({
        userId: 'user123',
        fromJid: '5491155551234@s.whatsapp.net',
        ownerJid: '51918714054@s.whatsapp.net',
        fromMe: false,
        text: 'Hello from contact A',
      });
      const env2 = normalizeWhatsAppMessage({
        userId: 'user123',
        fromJid: '5491199998888@s.whatsapp.net',
        ownerJid: '51918714054@s.whatsapp.net',
        fromMe: false,
        text: 'Hello from contact B',
      });

      // Each contact gets a unique conversation key
      expect(env1.conversationKey).not.toBe(env2.conversationKey);

      // Both should reply in ALL_CONTACTS
      const d1 = decideReply({ envelope: env1, autoReplyScope: 'ALL_CONTACTS', allowlist: [], allowGroups: false, threadOverride: null });
      const d2 = decideReply({ envelope: env2, autoReplyScope: 'ALL_CONTACTS', allowlist: [], allowGroups: false, threadOverride: null });
      expect(d1.shouldReply).toBe(true);
      expect(d2.shouldReply).toBe(true);
    });

    it('per-thread override can disable reply for a specific contact', () => {
      const decision = decideReply({
        envelope: makeContactEnvelope(),
        autoReplyScope: 'ALL_CONTACTS',
        allowlist: [],
        allowGroups: false,
        threadOverride: false, // specific contact disabled
      });
      expect(decision.shouldReply).toBe(false);
      expect(decision.reason).toBe('thread_override_off');
    });

    it('per-thread override can enable reply even in OWNER_ONLY for a specific contact', () => {
      const decision = decideReply({
        envelope: makeContactEnvelope(),
        autoReplyScope: 'OWNER_ONLY',
        allowlist: [],
        allowGroups: false,
        threadOverride: true, // specific contact enabled
      });
      expect(decision.shouldReply).toBe(true);
      expect(decision.reason).toBe('thread_override_on');
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TEST (4): Toggle changes reflect in /status and UI immediately
  // (This test verifies the contract — the actual UI/SSE test is E2E)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe('Scenario 4: Scope changes reflect immediately', () => {
    it('changing from OWNER_ONLY to ALL_CONTACTS changes decision for same contact', () => {
      const contact = makeContactEnvelope();

      const d1 = decideReply({
        envelope: contact,
        autoReplyScope: 'OWNER_ONLY',
        allowlist: [],
        allowGroups: false,
        threadOverride: null,
      });
      expect(d1.shouldReply).toBe(false);

      // Simulate scope change
      const d2 = decideReply({
        envelope: contact,
        autoReplyScope: 'ALL_CONTACTS',
        allowlist: [],
        allowGroups: false,
        threadOverride: null,
      });
      expect(d2.shouldReply).toBe(true);
    });

    it('owner decision is ALWAYS true regardless of scope changes', () => {
      const owner = makeOwnerEnvelope();

      for (const scope of ['OWNER_ONLY', 'ALLOWLIST', 'ALL_CONTACTS'] as const) {
        const d = decideReply({
          envelope: owner,
          autoReplyScope: scope,
          allowlist: [],
          allowGroups: false,
          threadOverride: null,
        });
        expect(d.shouldReply).toBe(true);
        expect(d.reason).toBe('owner_assist');
      }
    });

    it('adding a contact to allowlist immediately allows replies', () => {
      const contact = makeContactEnvelope();

      const d1 = decideReply({
        envelope: contact,
        autoReplyScope: 'ALLOWLIST',
        allowlist: [],
        allowGroups: false,
        threadOverride: null,
      });
      expect(d1.shouldReply).toBe(false);

      // Add to allowlist
      const d2 = decideReply({
        envelope: contact,
        autoReplyScope: 'ALLOWLIST',
        allowlist: [contact.senderId],
        allowGroups: false,
        threadOverride: null,
      });
      expect(d2.shouldReply).toBe(true);
    });
  });

  // ── Edge cases ──

  describe('Edge cases', () => {
    it('handles unknown scope gracefully', () => {
      const decision = decideReply({
        envelope: makeContactEnvelope(),
        autoReplyScope: 'INVALID_SCOPE' as any,
        allowlist: [],
        allowGroups: false,
        threadOverride: null,
      });
      expect(decision.shouldReply).toBe(false);
      expect(decision.reason).toBe('unknown_scope');
    });

    it('owner in a group still gets a reply', () => {
      const decision = decideReply({
        envelope: makeOwnerEnvelope({ isGroup: true }),
        autoReplyScope: 'OWNER_ONLY',
        allowlist: [],
        allowGroups: false,
        threadOverride: null,
      });
      // Owner is checked BEFORE group check
      expect(decision.shouldReply).toBe(true);
      expect(decision.reason).toBe('owner_assist');
    });

    it('group message from non-owner blocked when groups disabled', () => {
      const decision = decideReply({
        envelope: makeContactEnvelope({ isGroup: true }),
        autoReplyScope: 'ALL_CONTACTS',
        allowlist: [],
        allowGroups: false,
        threadOverride: null,
      });
      expect(decision.shouldReply).toBe(false);
      expect(decision.reason).toBe('groups_disabled');
    });

    it('group message from non-owner allowed when groups enabled', () => {
      const decision = decideReply({
        envelope: makeContactEnvelope({ isGroup: true }),
        autoReplyScope: 'ALL_CONTACTS',
        allowlist: [],
        allowGroups: true,
        threadOverride: null,
      });
      expect(decision.shouldReply).toBe(true);
      expect(decision.reason).toBe('scope_all_contacts');
    });
  });
});
