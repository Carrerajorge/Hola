import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, index, uniqueIndex, serial, boolean, customType, check } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./auth";

export const chats = pgTable("chats", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id"),
    title: text("title").notNull().default("New Chat"),
    gptId: varchar("gpt_id"),
    archived: text("archived").default("false"),
    hidden: text("hidden").default("false"),
    pinned: text("pinned").default("false"),
    pinnedAt: timestamp("pinned_at"),
    deletedAt: timestamp("deleted_at"),
    lastMessageAt: timestamp("last_message_at"),
    messageCount: integer("message_count").default(0),
    tokensUsed: integer("tokens_used").default(0),
    aiModelUsed: text("ai_model_used"),
    conversationStatus: text("conversation_status").default("active"), // active, completed, flagged
    flagStatus: text("flag_status"), // reviewed, needs_attention, spam, vip_support
    endedAt: timestamp("ended_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
    index("chats_user_idx").on(table.userId),
    index("chats_status_idx").on(table.conversationStatus),
    index("chats_flag_idx").on(table.flagStatus),
    index("chats_user_updated_idx").on(table.userId, table.updatedAt),
    index("chats_user_archived_deleted_idx").on(table.userId, table.archived, table.deletedAt),
    index("chats_updated_at_idx").on(table.updatedAt),
    index("chats_gpt_id_idx").on(table.gptId),
    index("chats_pinned_idx").on(table.pinned),
    index("chats_active_inbox_idx").on(table.conversationStatus, table.archived),
    check("chats_message_count_check", sql`${table.messageCount} >= 0`),
    check("chats_tokens_used_check", sql`${table.tokensUsed} >= 0`),
]);

export const insertChatSchema = createInsertSchema(chats);

export type InsertChat = z.infer<typeof insertChatSchema>;
export type Chat = typeof chats.$inferSelect;

export const chatMessages = pgTable("chat_messages", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    chatId: varchar("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
    runId: varchar("run_id"), // FK to the run this message belongs to (for run-based idempotency)
    role: text("role").notNull(), // "user" or "assistant"
    content: text("content").notNull(),
    status: text("status").default("done"), // pending, processing, done, failed - for idempotency
    requestId: varchar("request_id"), // UUID for idempotency - prevents duplicate processing (legacy)
    userMessageId: varchar("user_message_id"), // For assistant messages: links to the user message it responds to
    sequence: integer("sequence"), // Sequence number within the run (for streaming dedup)
    attachments: jsonb("attachments"), // array of attachments
    sources: jsonb("sources"), // array of sources
    figmaDiagram: jsonb("figma_diagram"), // Figma diagram data
    googleFormPreview: jsonb("google_form_preview"), // Google Forms preview data
    gmailPreview: jsonb("gmail_preview"), // Gmail preview data
    generatedImage: text("generated_image"), // Base64 or URL of generated image
    metadata: jsonb("metadata"), // Additional metadata for extensibility
    searchVector: customType<{ data: string }>({ dataType() { return "tsvector"; } })("search_vector"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
    index("chat_messages_chat_idx").on(table.chatId),
    index("chat_messages_request_idx").on(table.requestId),
    index("chat_messages_status_idx").on(table.status),
    uniqueIndex("chat_messages_request_unique").on(table.requestId),
    index("chat_messages_chat_created_idx").on(table.chatId, table.createdAt),
    index("chat_messages_created_at_idx").on(table.createdAt),
    index("chat_messages_search_idx").using("gin", table.searchVector),
    index("chat_messages_role_idx").on(table.role),
    index("chat_messages_sequence_idx").on(table.sequence),
    index("chat_messages_metadata_idx").using("gin", table.metadata),
    check("chat_messages_content_check", sql`length(${table.content}) > 0`),
]);

export const insertChatMessageSchema = createInsertSchema(chatMessages);

export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;

// Chat Runs - Each user submission creates an idempotent "run"
// A run tracks: user_message creation -> AI processing -> assistant_message response
export const chatRuns = pgTable("chat_runs", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    chatId: varchar("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
    clientRequestId: varchar("client_request_id").notNull(), // UUID from frontend - idempotency key
    userMessageId: varchar("user_message_id"), // FK to the user message that triggered this run
    assistantMessageId: varchar("assistant_message_id"), // FK to the assistant response message
    status: text("status").notNull().default("pending"), // pending, processing, done, failed, cancelled
    lastSeq: integer("last_seq").default(0), // Last sequence number processed (for streaming dedup)
    error: text("error"), // Error message if failed
    metadata: jsonb("metadata"), // Additional run metadata
    createdAt: timestamp("created_at").defaultNow().notNull(),
    startedAt: timestamp("started_at"), // When processing started
    completedAt: timestamp("completed_at"), // When processing completed
}, (table) => [
    index("chat_runs_chat_idx").on(table.chatId),
    index("chat_runs_status_idx").on(table.status),
    uniqueIndex("chat_runs_client_request_unique").on(table.chatId, table.clientRequestId),
    index("chat_runs_chat_created_idx").on(table.chatId, table.createdAt),
]);

export const insertChatRunSchema = createInsertSchema(chatRuns);

export type InsertChatRun = z.infer<typeof insertChatRunSchema>;
export type ChatRun = typeof chatRuns.$inferSelect;

// Tool Invocations - Track tool calls within a run for idempotency
export const toolInvocations = pgTable("tool_invocations", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    runId: varchar("run_id").notNull().references(() => chatRuns.id, { onDelete: "cascade" }),
    toolCallId: varchar("tool_call_id").notNull(), // Tool call ID from the model
    toolName: text("tool_name").notNull(),
    input: jsonb("input"), // Tool input parameters
    output: jsonb("output"), // Tool output/result
    status: text("status").notNull().default("pending"), // pending, running, done, failed
    error: text("error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
}, (table) => [
    index("tool_invocations_run_idx").on(table.runId),
    uniqueIndex("tool_invocations_unique").on(table.runId, table.toolCallId),
    index("tool_invocations_run_created_idx").on(table.runId, table.createdAt),
    index("tool_invocations_tool_name_idx").on(table.toolName),
]);

export const insertToolInvocationSchema = createInsertSchema(toolInvocations);

export type InsertToolInvocation = z.infer<typeof insertToolInvocationSchema>;
export type ToolInvocation = typeof toolInvocations.$inferSelect;

// Chat sharing - participantes con acceso a chats específicos
export const chatShares = pgTable("chat_shares", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    chatId: varchar("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
    recipientUserId: varchar("recipient_user_id"),
    email: text("email").notNull(),
    role: text("role").notNull().default("viewer"), // owner, editor, viewer
    invitedBy: varchar("invited_by"),
    notificationSent: text("notification_sent").default("false"),
    acceptedAt: timestamp("accepted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
    index("chat_shares_chat_idx").on(table.chatId),
    index("chat_shares_email_idx").on(table.email),
    index("chat_shares_recipient_idx").on(table.recipientUserId),
]);

export const insertChatShareSchema = createInsertSchema(chatShares);

export type InsertChatShare = z.infer<typeof insertChatShareSchema>;
export type ChatShare = typeof chatShares.$inferSelect;

// Chat Participants for sharing chats
export const chatParticipants = pgTable("chat_participants", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    chatId: varchar("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull().default("viewer"), // owner, editor, viewer
    invitedBy: varchar("invited_by"),
    invitedAt: timestamp("invited_at").defaultNow().notNull(),
    acceptedAt: timestamp("accepted_at"),
}, (table) => [
    index("chat_participants_chat_idx").on(table.chatId),
    index("chat_participants_email_idx").on(table.email),
    uniqueIndex("chat_participants_unique_idx").on(table.chatId, table.email),
]);

export const insertChatParticipantSchema = createInsertSchema(chatParticipants);

export type InsertChatParticipant = z.infer<typeof insertChatParticipantSchema>;
export type ChatParticipant = typeof chatParticipants.$inferSelect;

// Response Quality Metrics
export const responseQualityMetrics = pgTable("response_quality_metrics", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    runId: varchar("run_id"),
    userId: varchar("user_id"),
    score: integer("score"), // 1-5 or similar
    feedback: text("feedback"),
    category: text("category"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
    index("response_quality_metrics_run_idx").on(table.runId),
    index("response_quality_metrics_category_idx").on(table.category),
]);

export const insertResponseQualityMetricSchema = createInsertSchema(responseQualityMetrics);

export type InsertResponseQualityMetric = z.infer<typeof insertResponseQualityMetricSchema>;
export type ResponseQualityMetric = typeof responseQualityMetrics.$inferSelect;

// Offline Message Queue
export const offlineMessageQueue = pgTable("offline_message_queue", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull(),
    content: jsonb("content").notNull(),
    status: text("status").default("pending"),
    retryCount: integer("retry_count").default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    processedAt: timestamp("processed_at"),
}, (table) => [
    index("offline_message_queue_user_idx").on(table.userId),
    index("offline_message_queue_status_idx").on(table.status),
    index("offline_message_queue_processed_at_idx").on(table.processedAt),
]);

export const insertOfflineMessageQueueSchema = createInsertSchema(offlineMessageQueue);

export type InsertOfflineMessageQueue = z.infer<typeof insertOfflineMessageQueueSchema>;
export type OfflineMessageQueue = typeof offlineMessageQueue.$inferSelect;
