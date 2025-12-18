import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, index, uniqueIndex, customType } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1536)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value.slice(1, -1).split(",").map(Number);
  },
});

// Session storage table for Replit Auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)]
);

// Users table (compatible with Replit Auth)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username"),
  password: text("password"),
  email: text("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  phone: varchar("phone"),
  company: varchar("company"),
  role: text("role").default("user"),
  plan: text("plan").default("free"),
  status: text("status").default("active"),
  queryCount: integer("query_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const files = pgTable("files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"),
  name: text("name").notNull(),
  type: text("type").notNull(),
  size: integer("size").notNull(),
  storagePath: text("storage_path").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertFileSchema = createInsertSchema(files).omit({
  id: true,
  createdAt: true,
});

export type InsertFile = z.infer<typeof insertFileSchema>;
export type File = typeof files.$inferSelect;

export const fileChunks = pgTable("file_chunks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fileId: varchar("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  embedding: vector("embedding"),
  pageNumber: integer("page_number"),
  chunkIndex: integer("chunk_index").notNull(),
  metadata: jsonb("metadata"),
}, (table) => [
  index("file_chunks_file_id_idx").on(table.fileId),
]);

export const insertFileChunkSchema = createInsertSchema(fileChunks).omit({
  id: true,
});

export type InsertFileChunk = z.infer<typeof insertFileChunkSchema>;
export type FileChunk = typeof fileChunks.$inferSelect;

// Agent Web Navigation Tables
export const agentRuns = pgTable("agent_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id"),
  status: text("status").notNull().default("pending"), // pending, running, completed, failed, cancelled
  routerDecision: text("router_decision"), // llm, agent, hybrid
  objective: text("objective"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  error: text("error"),
}, (table) => [
  index("agent_runs_conversation_idx").on(table.conversationId),
  index("agent_runs_status_idx").on(table.status),
]);

export const insertAgentRunSchema = createInsertSchema(agentRuns).omit({
  id: true,
  startedAt: true,
});

export type InsertAgentRun = z.infer<typeof insertAgentRunSchema>;
export type AgentRun = typeof agentRuns.$inferSelect;

export const agentSteps = pgTable("agent_steps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
  stepType: text("step_type").notNull(), // navigate, extract, click, input, screenshot, document
  url: text("url"),
  detail: jsonb("detail"),
  screenshot: text("screenshot"), // storage path
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  success: text("success").default("pending"), // pending, success, failed
  error: text("error"),
  stepIndex: integer("step_index").notNull().default(0),
}, (table) => [
  index("agent_steps_run_idx").on(table.runId),
]);

export const insertAgentStepSchema = createInsertSchema(agentSteps).omit({
  id: true,
  startedAt: true,
});

export type InsertAgentStep = z.infer<typeof insertAgentStepSchema>;
export type AgentStep = typeof agentSteps.$inferSelect;

export const agentAssets = pgTable("agent_assets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
  stepId: varchar("step_id").references(() => agentSteps.id, { onDelete: "set null" }),
  assetType: text("asset_type").notNull(), // screenshot, document, extracted_content
  storagePath: text("storage_path"),
  content: text("content"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("agent_assets_run_idx").on(table.runId),
]);

export const insertAgentAssetSchema = createInsertSchema(agentAssets).omit({
  id: true,
  createdAt: true,
});

export type InsertAgentAsset = z.infer<typeof insertAgentAssetSchema>;
export type AgentAsset = typeof agentAssets.$inferSelect;

export const cachedPages = pgTable("cached_pages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  urlHash: text("url_hash").notNull().unique(),
  url: text("url").notNull(),
  title: text("title"),
  content: text("content"),
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
}, (table) => [
  index("cached_pages_url_hash_idx").on(table.urlHash),
]);

export const insertCachedPageSchema = createInsertSchema(cachedPages).omit({
  id: true,
  fetchedAt: true,
});

export type InsertCachedPage = z.infer<typeof insertCachedPageSchema>;
export type CachedPage = typeof cachedPages.$inferSelect;

export const domainPolicies = pgTable("domain_policies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  domain: text("domain").notNull().unique(),
  allowNavigation: text("allow_navigation").notNull().default("true"),
  cookiePolicy: text("cookie_policy").default("accept"), // accept, reject, essential
  rateLimit: integer("rate_limit").default(10), // requests per minute
  customHeaders: jsonb("custom_headers"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDomainPolicySchema = createInsertSchema(domainPolicies).omit({
  id: true,
  createdAt: true,
});

export type InsertDomainPolicy = z.infer<typeof insertDomainPolicySchema>;
export type DomainPolicy = typeof domainPolicies.$inferSelect;

export const chats = pgTable("chats", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"),
  title: text("title").notNull().default("New Chat"),
  gptId: varchar("gpt_id"),
  archived: text("archived").default("false"),
  hidden: text("hidden").default("false"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("chats_user_idx").on(table.userId),
]);

export const insertChatSchema = createInsertSchema(chats).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertChat = z.infer<typeof insertChatSchema>;
export type Chat = typeof chats.$inferSelect;

export const chatMessages = pgTable("chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  chatId: varchar("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // "user" or "assistant"
  content: text("content").notNull(),
  attachments: jsonb("attachments"), // array of attachments
  sources: jsonb("sources"), // array of sources
  figmaDiagram: jsonb("figma_diagram"), // Figma diagram data
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("chat_messages_chat_idx").on(table.chatId),
]);

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({
  id: true,
  createdAt: true,
});

export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;

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

export const insertChatShareSchema = createInsertSchema(chatShares).omit({
  id: true,
  createdAt: true,
});

export type InsertChatShare = z.infer<typeof insertChatShareSchema>;
export type ChatShare = typeof chatShares.$inferSelect;

// GPT Categories
export const gptCategories = pgTable("gpt_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  icon: text("icon"),
  sortOrder: integer("sort_order").default(0),
});

export const insertGptCategorySchema = createInsertSchema(gptCategories).omit({
  id: true,
});

export type InsertGptCategory = z.infer<typeof insertGptCategorySchema>;
export type GptCategory = typeof gptCategories.$inferSelect;

// Custom GPTs
export const gpts = pgTable("gpts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  avatar: text("avatar"),
  categoryId: varchar("category_id").references(() => gptCategories.id),
  creatorId: varchar("creator_id"),
  visibility: text("visibility").default("private"), // private, public, unlisted
  systemPrompt: text("system_prompt").notNull(),
  temperature: text("temperature").default("0.7"),
  topP: text("top_p").default("1"),
  maxTokens: integer("max_tokens").default(4096),
  welcomeMessage: text("welcome_message"),
  capabilities: jsonb("capabilities"), // { webBrowsing: boolean, codeInterpreter: boolean, imageGeneration: boolean }
  conversationStarters: jsonb("conversation_starters"), // array of starter prompts
  usageCount: integer("usage_count").default(0),
  version: integer("version").default(1),
  isPublished: text("is_published").default("false"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("gpts_category_idx").on(table.categoryId),
  index("gpts_creator_idx").on(table.creatorId),
  index("gpts_visibility_idx").on(table.visibility),
]);

export const insertGptSchema = createInsertSchema(gpts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  usageCount: true,
});

export type InsertGpt = z.infer<typeof insertGptSchema>;
export type Gpt = typeof gpts.$inferSelect;

// GPT Versions for version control
export const gptVersions = pgTable("gpt_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gptId: varchar("gpt_id").notNull().references(() => gpts.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  temperature: text("temperature").default("0.7"),
  topP: text("top_p").default("1"),
  maxTokens: integer("max_tokens").default(4096),
  changeNotes: text("change_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  createdBy: varchar("created_by"),
}, (table) => [
  index("gpt_versions_gpt_idx").on(table.gptId),
]);

export const insertGptVersionSchema = createInsertSchema(gptVersions).omit({
  id: true,
  createdAt: true,
});

export type InsertGptVersion = z.infer<typeof insertGptVersionSchema>;
export type GptVersion = typeof gptVersions.$inferSelect;

// Admin Tables

// AI Models Registry
export const aiModels = pgTable("ai_models", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  provider: text("provider").notNull(),
  modelId: text("model_id").notNull(),
  status: text("status").default("active"),
  costPer1k: text("cost_per_1k").default("0.00"),
  usagePercent: integer("usage_percent").default(0),
  description: text("description"),
  capabilities: jsonb("capabilities"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAiModelSchema = createInsertSchema(aiModels).omit({
  id: true,
  createdAt: true,
});

export type InsertAiModel = z.infer<typeof insertAiModelSchema>;
export type AiModel = typeof aiModels.$inferSelect;

// Payments
export const payments = pgTable("payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  amount: text("amount").notNull(),
  currency: text("currency").default("EUR"),
  status: text("status").default("pending"),
  method: text("method"),
  description: text("description"),
  stripePaymentId: text("stripe_payment_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("payments_user_idx").on(table.userId),
]);

export const insertPaymentSchema = createInsertSchema(payments).omit({
  id: true,
  createdAt: true,
});

export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof payments.$inferSelect;

// Invoices
export const invoices = pgTable("invoices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  paymentId: varchar("payment_id").references(() => payments.id),
  invoiceNumber: text("invoice_number").notNull(),
  amount: text("amount").notNull(),
  currency: text("currency").default("EUR"),
  status: text("status").default("pending"),
  dueDate: timestamp("due_date"),
  paidAt: timestamp("paid_at"),
  pdfPath: text("pdf_path"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("invoices_user_idx").on(table.userId),
]);

export const insertInvoiceSchema = createInsertSchema(invoices).omit({
  id: true,
  createdAt: true,
});

export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoices.$inferSelect;

// Platform Settings
export const platformSettings = pgTable("platform_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
  value: text("value"),
  description: text("description"),
  category: text("category").default("general"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPlatformSettingSchema = createInsertSchema(platformSettings).omit({
  id: true,
  updatedAt: true,
});

export type InsertPlatformSetting = z.infer<typeof insertPlatformSettingSchema>;
export type PlatformSetting = typeof platformSettings.$inferSelect;

// Audit Logs
export const auditLogs = pgTable("audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"),
  action: text("action").notNull(),
  resource: text("resource"),
  resourceId: varchar("resource_id"),
  details: jsonb("details"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("audit_logs_user_idx").on(table.userId),
  index("audit_logs_action_idx").on(table.action),
]);

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({
  id: true,
  createdAt: true,
});

export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;

// Analytics Snapshots
export const analyticsSnapshots = pgTable("analytics_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: timestamp("date").notNull(),
  totalUsers: integer("total_users").default(0),
  activeUsers: integer("active_users").default(0),
  totalQueries: integer("total_queries").default(0),
  revenue: text("revenue").default("0"),
  newSignups: integer("new_signups").default(0),
  churnedUsers: integer("churned_users").default(0),
  avgResponseTime: integer("avg_response_time").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAnalyticsSnapshotSchema = createInsertSchema(analyticsSnapshots).omit({
  id: true,
  createdAt: true,
});

export type InsertAnalyticsSnapshot = z.infer<typeof insertAnalyticsSnapshotSchema>;
export type AnalyticsSnapshot = typeof analyticsSnapshots.$inferSelect;

// Reports
export const reports = pgTable("reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  type: text("type").notNull(),
  status: text("status").default("pending"),
  parameters: jsonb("parameters"),
  filePath: text("file_path"),
  generatedBy: varchar("generated_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const insertReportSchema = createInsertSchema(reports).omit({
  id: true,
  createdAt: true,
});

export type InsertReport = z.infer<typeof insertReportSchema>;
export type Report = typeof reports.$inferSelect;

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

export const insertChatParticipantSchema = createInsertSchema(chatParticipants).omit({
  id: true,
  invitedAt: true,
});

export type InsertChatParticipant = z.infer<typeof insertChatParticipantSchema>;
export type ChatParticipant = typeof chatParticipants.$inferSelect;
