import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./auth";
import { chats } from "./chat";

// GPT Categories
export const gptCategories = pgTable("gpt_categories", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("description"),
    icon: text("icon"),
    sortOrder: integer("sort_order").default(0),
});

export const insertGptCategorySchema = createInsertSchema(gptCategories);

export type InsertGptCategory = z.infer<typeof insertGptCategorySchema>;
export type GptCategory = typeof gptCategories.$inferSelect;

// GPT Visibility Schema
export const gptVisibilitySchema = z.enum(['private', 'team', 'public']);
export type GptVisibility = z.infer<typeof gptVisibilitySchema>;

// GPT Capabilities Schema
export const gptCapabilitiesSchema = z.object({
    webBrowsing: z.boolean().default(false),
    codeInterpreter: z.boolean().default(false),
    imageGeneration: z.boolean().default(false),
    fileUpload: z.boolean().default(false),
    dataAnalysis: z.boolean().default(false),
});

// GPT Runtime Policy Schema
export const gptRuntimePolicySchema = z.object({
    enforceModel: z.boolean().default(false),
    modelFallbacks: z.array(z.string()).default([]),
    maxTokensOverride: z.number().optional(),
    temperatureOverride: z.number().optional(),
    allowClientOverride: z.boolean().default(false),
});

// GPT Tool Permissions Schema
export const gptToolPermissionsSchema = z.object({
    mode: z.enum(['allowlist', 'denylist']).default('allowlist'),
    tools: z.array(z.string()).default([]),
    actionsEnabled: z.boolean().default(true),
});

// Custom GPTs
export const gpts = pgTable("gpts", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("description"),
    avatar: text("avatar"),
    categoryId: varchar("category_id").references(() => gptCategories.id),
    creatorId: varchar("creator_id"),
    visibility: text("visibility").default("private"), // private, team, public
    systemPrompt: text("system_prompt").notNull(),
    temperature: text("temperature").default("0.7"),
    topP: text("top_p").default("1"),
    maxTokens: integer("max_tokens").default(4096),
    welcomeMessage: text("welcome_message"),
    capabilities: jsonb("capabilities"), // { webBrowsing: boolean, codeInterpreter: boolean, imageGeneration: boolean }
    conversationStarters: jsonb("conversation_starters"), // array of starter prompts
    usageCount: integer("usage_count").default(0),
    version: integer("version").default(1),
    recommendedModel: text("recommended_model"),
    runtimePolicy: jsonb("runtime_policy").$type<z.infer<typeof gptRuntimePolicySchema>>(),
    toolPermissions: jsonb("tool_permissions").$type<z.infer<typeof gptToolPermissionsSchema>>(),
    isPublished: text("is_published").default("false"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
    index("gpts_category_idx").on(table.categoryId),
    index("gpts_creator_idx").on(table.creatorId),
    index("gpts_visibility_idx").on(table.visibility),
]);

export const insertGptSchema = createInsertSchema(gpts).extend({
    recommendedModel: z.string().optional(),
    runtimePolicy: gptRuntimePolicySchema.optional(),
    toolPermissions: gptToolPermissionsSchema.optional(),
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

export const insertGptVersionSchema = createInsertSchema(gptVersions);

export type InsertGptVersion = z.infer<typeof insertGptVersionSchema>;
export type GptVersion = typeof gptVersions.$inferSelect;

// GPT Knowledge Base - files and documents attached to GPTs
export const gptKnowledge = pgTable("gpt_knowledge", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    gptId: varchar("gpt_id").notNull().references(() => gpts.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    fileType: text("file_type").notNull(), // pdf, txt, docx, xlsx, etc.
    fileSize: integer("file_size").notNull(),
    storageUrl: text("storage_url").notNull(),
    contentHash: text("content_hash"), // for deduplication
    extractedText: text("extracted_text"), // parsed text content for RAG
    embeddingStatus: text("embedding_status").default("pending"), // pending, processing, completed, failed
    chunkCount: integer("chunk_count").default(0),
    metadata: jsonb("metadata"), // { pages, wordCount, language, etc. }
    isActive: text("is_active").default("true"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
    index("gpt_knowledge_gpt_idx").on(table.gptId),
    index("gpt_knowledge_status_idx").on(table.embeddingStatus),
]);

export const insertGptKnowledgeSchema = createInsertSchema(gptKnowledge);

export type InsertGptKnowledge = z.infer<typeof insertGptKnowledgeSchema>;
export type GptKnowledge = typeof gptKnowledge.$inferSelect;

// GPT Actions - custom API integrations for GPTs
export const gptActions = pgTable("gpt_actions", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    gptId: varchar("gpt_id").notNull().references(() => gpts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    actionType: text("action_type").notNull().default("api"), // api, webhook, function
    httpMethod: text("http_method").default("GET"), // GET, POST, PUT, DELETE, PATCH
    endpoint: text("endpoint").notNull(),
    headers: jsonb("headers"), // { "Authorization": "Bearer {{API_KEY}}", etc. }
    bodyTemplate: text("body_template"), // JSON template with {{variable}} placeholders
    responseMapping: jsonb("response_mapping"), // how to parse the response
    authType: text("auth_type").default("none"), // none, api_key, oauth, bearer
    authConfig: jsonb("auth_config"), // encrypted auth configuration
    parameters: jsonb("parameters"), // [{ name, type, required, description }]
    rateLimit: integer("rate_limit").default(100), // calls per minute
    timeout: integer("timeout").default(30000), // ms
    isActive: text("is_active").default("true"),
    lastUsedAt: timestamp("last_used_at"),
    usageCount: integer("usage_count").default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
    index("gpt_actions_gpt_idx").on(table.gptId),
    index("gpt_actions_type_idx").on(table.actionType),
]);

export const insertGptActionSchema = createInsertSchema(gptActions);

export type InsertGptAction = z.infer<typeof insertGptActionSchema>;
export type GptAction = typeof gptActions.$inferSelect;

// Sidebar Pinned GPTs - user preferences for GPTs shown in sidebar
export const sidebarPinnedGpts = pgTable("sidebar_pinned_gpts", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").references(() => users.id).notNull(),
    gptId: varchar("gpt_id").references(() => gpts.id).notNull(),
    displayOrder: integer("display_order").default(0),
    pinnedAt: timestamp("pinned_at").defaultNow().notNull(),
}, (table) => [
    index("sidebar_pinned_gpts_user_idx").on(table.userId),
    index("sidebar_pinned_gpts_gpt_idx").on(table.gptId),
]);

export const insertSidebarPinnedGptSchema = createInsertSchema(sidebarPinnedGpts);

export type InsertSidebarPinnedGpt = z.infer<typeof insertSidebarPinnedGptSchema>;
export type SidebarPinnedGpt = typeof sidebarPinnedGpts.$inferSelect;

// GPT Sessions - Immutable session contracts with frozen config
export const gptSessions = pgTable("gpt_sessions", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    chatId: varchar("chat_id").references(() => chats.id, { onDelete: "cascade" }),
    gptId: varchar("gpt_id").notNull().references(() => gpts.id),
    configVersion: integer("config_version").notNull(),
    frozenSystemPrompt: text("frozen_system_prompt").notNull(),
    frozenCapabilities: jsonb("frozen_capabilities").$type<z.infer<typeof gptCapabilitiesSchema>>(),
    frozenToolPermissions: jsonb("frozen_tool_permissions").$type<z.infer<typeof gptToolPermissionsSchema>>(),
    frozenRuntimePolicy: jsonb("frozen_runtime_policy").$type<z.infer<typeof gptRuntimePolicySchema>>(),
    enforcedModelId: text("enforced_model_id"),
    knowledgeContextIds: jsonb("knowledge_context_ids").$type<string[]>().default([]),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at"),
}, (table) => [
    index("gpt_sessions_chat_idx").on(table.chatId),
    index("gpt_sessions_gpt_idx").on(table.gptId),
]);

export const insertGptSessionSchema = createInsertSchema(gptSessions).extend({
    frozenCapabilities: gptCapabilitiesSchema.optional(),
    frozenToolPermissions: gptToolPermissionsSchema.optional(),
    frozenRuntimePolicy: gptRuntimePolicySchema.optional(),
    knowledgeContextIds: z.array(z.string()).optional(),
});

export type InsertGptSession = z.infer<typeof insertGptSessionSchema>;
export type GptSession = typeof gptSessions.$inferSelect;
