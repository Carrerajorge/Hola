import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, jsonb, index, uniqueIndex, boolean as pgBoolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── Auto-Reply Scope Enum ──
// OWNER_ONLY  – Only respond to the owner (default, safest)
// ALLOWLIST   – Respond to owner + contacts on the allowlist
// ALL_CONTACTS – Respond to any contact (except groups unless overridden)
export const AUTO_REPLY_SCOPES = ['OWNER_ONLY', 'ALLOWLIST', 'ALL_CONTACTS'] as const;
export type AutoReplyScope = typeof AUTO_REPLY_SCOPES[number];

// ── Workspace-level auto-reply configuration ──
export const autoReplyConfigs = pgTable("auto_reply_configs", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull(),
    channel: text("channel").notNull(), // 'whatsapp_web', 'telegram', 'messenger', 'wechat'
    channelAccountId: text("channel_account_id"), // e.g. the WhatsApp JID of the owner account

    // (A) Owner Assist – always ON, cannot be disabled
    // This field exists for explicitness/auditing; code always treats owner as enabled
    ownerAssistEnabled: pgBoolean("owner_assist_enabled").notNull().default(true),

    // (B) Auto-Reply scope for non-owner messages
    autoReplyScope: text("auto_reply_scope").notNull().default('OWNER_ONLY'),

    // Allowlist (array of contact identifiers – JIDs, user IDs, etc.)
    allowlist: jsonb("allowlist").default(sql`'[]'::jsonb`), // string[]

    // Whether to auto-reply in group chats (default false for safety)
    allowGroups: pgBoolean("allow_groups").notNull().default(false),

    // Schema version for safe migrations
    version: text("version").notNull().default('1'),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
    uniqueIndex("auto_reply_configs_user_channel_unique").on(table.userId, table.channel),
    index("auto_reply_configs_user_idx").on(table.userId),
]);

export const insertAutoReplyConfigSchema = createInsertSchema(autoReplyConfigs);
export type InsertAutoReplyConfig = z.infer<typeof insertAutoReplyConfigSchema>;
export type AutoReplyConfig = typeof autoReplyConfigs.$inferSelect;

// ── Per-thread/conversation auto-reply overrides ──
export const threadAutoReplyOverrides = pgTable("thread_auto_reply_overrides", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull(),
    channel: text("channel").notNull(),
    threadId: text("thread_id").notNull(), // chatId / conversationKey threadId component

    // true = force auto-reply ON for this thread (even if scope would block it)
    // false = force auto-reply OFF for this thread (even if scope would allow it)
    autoReplyEnabled: pgBoolean("auto_reply_enabled").notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
    uniqueIndex("thread_overrides_user_channel_thread_unique").on(table.userId, table.channel, table.threadId),
    index("thread_overrides_user_idx").on(table.userId),
]);

export const insertThreadAutoReplyOverrideSchema = createInsertSchema(threadAutoReplyOverrides);
export type InsertThreadAutoReplyOverride = z.infer<typeof insertThreadAutoReplyOverrideSchema>;
export type ThreadAutoReplyOverride = typeof threadAutoReplyOverrides.$inferSelect;
