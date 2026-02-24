import { sql } from "drizzle-orm";
import { pgTable, text, serial, integer, boolean, timestamp, jsonb, doublePrecision, uuid, varchar, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// =============================================================================
// Agent Runs / Steps / Assets — migrated from schema.bak.ts
// =============================================================================

export const agentRuns = pgTable("agent_runs", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    conversationId: varchar("conversation_id"),
    status: text("status").notNull().default("pending"),
    routerDecision: text("router_decision"),
    objective: text("objective"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
    error: text("error"),
}, (table: any) => [
    index("agent_runs_conversation_idx").on(table.conversationId),
    index("agent_runs_status_idx").on(table.status),
    index("agent_runs_conversation_started_idx").on(table.conversationId, table.startedAt),
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
    stepType: text("step_type").notNull(),
    url: text("url"),
    detail: jsonb("detail"),
    screenshot: text("screenshot"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
    success: text("success").default("pending"),
    error: text("error"),
    stepIndex: integer("step_index").notNull().default(0),
}, (table: any) => [
    index("agent_steps_run_idx").on(table.runId),
    index("agent_steps_run_step_idx").on(table.runId, table.stepIndex),
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
    assetType: text("asset_type").notNull(),
    storagePath: text("storage_path"),
    content: text("content"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table: any) => [
    index("agent_assets_run_idx").on(table.runId),
]);

export const insertAgentAssetSchema = createInsertSchema(agentAssets).omit({
    id: true,
    createdAt: true,
});
export type InsertAgentAsset = z.infer<typeof insertAgentAssetSchema>;
export type AgentAsset = typeof agentAssets.$inferSelect;

// =============================================================================
// Domain Policies — migrated from schema.bak.ts
// =============================================================================

export const domainPolicies = pgTable("domain_policies", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    domain: text("domain").notNull().unique(),
    allowNavigation: text("allow_navigation").notNull().default("true"),
    cookiePolicy: text("cookie_policy").default("accept"),
    rateLimit: integer("rate_limit").default(10),
    customHeaders: jsonb("custom_headers"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDomainPolicySchema = createInsertSchema(domainPolicies).omit({
    id: true,
    createdAt: true,
});
export type InsertDomainPolicy = z.infer<typeof insertDomainPolicySchema>;
export type DomainPolicy = typeof domainPolicies.$inferSelect;

// =============================================================================
// Agent Gap Logs — migrated from schema.bak.ts
// =============================================================================

export const agentGapLogs = pgTable("agent_gap_logs", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userPrompt: text("user_prompt").notNull(),
    detectedIntent: text("detected_intent"),
    gapReason: text("gap_reason"),
    suggestedCapability: text("suggested_capability"),
    status: text("status").default("pending"),
    reviewedBy: varchar("reviewed_by"),
    gapSignature: varchar("gap_signature"),
    frequencyCount: integer("frequency_count").default(1),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table: any) => [
    index("agent_gap_logs_status_idx").on(table.status),
    index("agent_gap_logs_created_idx").on(table.createdAt),
    index("agent_gap_logs_signature_idx").on(table.gapSignature),
]);

export const insertAgentGapLogSchema = createInsertSchema(agentGapLogs).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});
export type InsertAgentGapLog = z.infer<typeof insertAgentGapLogSchema>;
export type AgentGapLog = typeof agentGapLogs.$inferSelect;

// =============================================================================
// Agent Mode Events
// =============================================================================

// --- EXISTING SCHEMAS (Mocks for append to preserve module) ---
export const agentModeEvents = pgTable("agent_mode_events", {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: text("run_id").notNull(),
    stepIndex: integer("step_index"),
    correlationId: text("correlation_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    metadata: jsonb("metadata"),
    timestamp: timestamp("timestamp").notNull().defaultNow(),
});

// T09-002: WORLD MODEL TRANSACTIONS
export const agentTransitions = pgTable("agent_transitions", {
    id: uuid('id').primaryKey().defaultRandom(),
    stateBefore: text('state_before').notNull(),
    action: jsonb('action').notNull(),
    stateAfter: text('state_after').notNull(),
    reward: doublePrecision('reward').notNull(),
    appContext: text('app_context'),
    createdAt: timestamp('created_at').defaultNow(),
});

import { customType } from "drizzle-orm/pg-core";
const vector = customType<{ data: number[] }>({
    dataType() { return 'vector(1536)'; },
});

// T09-003: EPISODIC MEMORY (Long Term Context)
export const agentEpisodicMemory = pgTable("agent_episodic_memory", {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: text('run_id').notNull(),
    embedding: vector('embedding').notNull(),
    content: text('content').notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').defaultNow(),
});
