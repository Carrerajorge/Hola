import { sql } from "drizzle-orm";
import { pgTable, text, serial, integer, boolean, timestamp, jsonb, doublePrecision, uuid, varchar, index, real, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { users } from "./auth";
import { chats, chatMessages } from "./chat";

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

// =============================================================================
// Code Interpreter Runs — migrated from schema.bak.ts
// =============================================================================

export const codeInterpreterRuns = pgTable("code_interpreter_runs", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    conversationId: varchar("conversation_id"),
    userId: varchar("user_id"),
    code: text("code").notNull(),
    language: text("language").notNull().default("python"),
    status: text("status").notNull().default("pending"), // pending, running, success, error
    stdout: text("stdout"),
    stderr: text("stderr"),
    executionTimeMs: integer("execution_time_ms"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table: any) => [
    index("code_runs_conversation_idx").on(table.conversationId),
    index("code_runs_user_idx").on(table.userId),
]);

export const insertCodeInterpreterRunSchema = createInsertSchema(codeInterpreterRuns).omit({
    id: true,
    createdAt: true,
});

export type InsertCodeInterpreterRun = z.infer<typeof insertCodeInterpreterRunSchema>;
export type CodeInterpreterRun = typeof codeInterpreterRuns.$inferSelect;

// =============================================================================
// Code Interpreter Artifacts — migrated from schema.bak.ts
// =============================================================================

export const codeInterpreterArtifacts = pgTable("code_interpreter_artifacts", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    runId: varchar("run_id").notNull().references(() => codeInterpreterRuns.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // image, file, data
    name: text("name").notNull(),
    data: text("data"), // base64 encoded for images, or text content
    mimeType: text("mime_type"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table: any) => [
    index("code_artifacts_run_idx").on(table.runId),
]);

export const insertCodeInterpreterArtifactSchema = createInsertSchema(codeInterpreterArtifacts).omit({
    id: true,
    createdAt: true,
});

export type InsertCodeInterpreterArtifact = z.infer<typeof insertCodeInterpreterArtifactSchema>;
export type CodeInterpreterArtifact = typeof codeInterpreterArtifacts.$inferSelect;

// =============================================================================
// Agent Mode Runs — migrated from schema.bak.ts
// =============================================================================

export const agentModeRuns = pgTable("agent_mode_runs", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    chatId: varchar("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
    messageId: varchar("message_id").references(() => chatMessages.id, { onDelete: "set null" }),
    userId: varchar("user_id").references(() => users.id),
    status: text("status").notNull().default("queued"), // queued, planning, running, succeeded, failed, cancelled
    plan: jsonb("plan"), // array of planned steps
    artifacts: jsonb("artifacts"), // output artifacts
    summary: text("summary"),
    error: text("error"),
    totalSteps: integer("total_steps").default(0),
    completedSteps: integer("completed_steps").default(0),
    currentStepIndex: integer("current_step_index").default(0),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    idempotencyKey: varchar("idempotency_key"),
}, (table: any) => [
    index("agent_mode_runs_chat_idx").on(table.chatId),
    index("agent_mode_runs_message_idx").on(table.messageId),
    index("agent_mode_runs_status_idx").on(table.status),
    index("agent_mode_runs_created_idx").on(table.createdAt),
    index("agent_mode_runs_idempotency_idx").on(table.idempotencyKey),
]);

export const insertAgentModeRunSchema = createInsertSchema(agentModeRuns).omit({
    id: true,
    createdAt: true,
});

export type InsertAgentModeRun = z.infer<typeof insertAgentModeRunSchema>;
export type AgentModeRun = typeof agentModeRuns.$inferSelect;

// =============================================================================
// Agent Mode Steps — migrated from schema.bak.ts
// =============================================================================

export const agentModeSteps = pgTable("agent_mode_steps", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    runId: varchar("run_id").notNull().references(() => agentModeRuns.id, { onDelete: "cascade" }),
    stepIndex: integer("step_index").notNull(),
    toolName: text("tool_name").notNull(),
    toolInput: jsonb("tool_input"),
    toolOutput: jsonb("tool_output"),
    status: text("status").notNull().default("pending"), // pending, running, succeeded, failed, skipped
    error: text("error"),
    retryCount: integer("retry_count").default(0),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table: any) => [
    index("agent_mode_steps_run_idx").on(table.runId),
    index("agent_mode_steps_status_idx").on(table.status),
]);

export const insertAgentModeStepSchema = createInsertSchema(agentModeSteps).omit({
    id: true,
    createdAt: true,
});

export type InsertAgentModeStep = z.infer<typeof insertAgentModeStepSchema>;
export type AgentModeStep = typeof agentModeSteps.$inferSelect;

// =============================================================================
// Agent Memory Store — migrated from schema.bak.ts
// =============================================================================

export const agentMemoryStore = pgTable("agent_memory_store", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    chatId: varchar("chat_id").references(() => chats.id, { onDelete: "cascade" }),
    userId: varchar("user_id").references(() => users.id),
    memoryKey: text("memory_key").notNull(),
    memoryValue: jsonb("memory_value").notNull(),
    memoryType: text("memory_type").default("context"), // context, fact, preference, artifact_ref
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table: any) => [
    index("agent_memory_store_chat_key_idx").on(table.chatId, table.memoryKey),
    index("agent_memory_store_user_idx").on(table.userId),
    index("agent_memory_store_type_idx").on(table.memoryType),
]);

export const insertAgentMemoryStoreSchema = createInsertSchema(agentMemoryStore).omit({
    id: true,
    createdAt: true,
});

export type InsertAgentMemoryStore = z.infer<typeof insertAgentMemoryStoreSchema>;
export type AgentMemoryStore = typeof agentMemoryStore.$inferSelect;

// =============================================================================
// Request Spec History — migrated from schema.bak.ts
// =============================================================================

export const requestSpecHistory = pgTable("request_spec_history", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    chatId: varchar("chat_id").references(() => chats.id, { onDelete: "cascade" }),
    runId: varchar("run_id").references(() => agentModeRuns.id, { onDelete: "set null" }),
    messageId: varchar("message_id").references(() => chatMessages.id, { onDelete: "set null" }),
    intent: text("intent").notNull(),
    intentConfidence: real("intent_confidence"),
    deliverableType: text("deliverable_type"),
    primaryAgent: text("primary_agent"),
    targetAgents: text("target_agents").array(),
    attachmentsCount: integer("attachments_count").default(0),
    executionDurationMs: integer("execution_duration_ms"),
    status: text("status").default("pending"), // pending, completed, failed
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table: any) => [
    index("request_spec_history_chat_created_idx").on(table.chatId, table.createdAt),
    index("request_spec_history_run_idx").on(table.runId),
    index("request_spec_history_intent_idx").on(table.intent),
]);

export const insertRequestSpecHistorySchema = createInsertSchema(requestSpecHistory).omit({
    id: true,
    createdAt: true,
});

export type InsertRequestSpecHistory = z.infer<typeof insertRequestSpecHistorySchema>;
export type RequestSpecHistory = typeof requestSpecHistory.$inferSelect;

// =============================================================================
// Agent Memories (Vector-based) — migrated from schema.bak.ts
// =============================================================================

export const agentMemories = pgTable("agent_memories", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    namespace: varchar("namespace").notNull().default("default"),
    content: text("content").notNull(),
    embedding: vector("embedding"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table: any) => [
    index("agent_memories_namespace_idx").on(table.namespace),
    index("agent_memories_created_at_idx").on(table.createdAt),
]);

export const insertAgentMemorySchema = createInsertSchema(agentMemories).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});

export type InsertAgentMemory = z.infer<typeof insertAgentMemorySchema>;
export type AgentMemory = typeof agentMemories.$inferSelect;

// =============================================================================
// Agent Context — migrated from schema.bak.ts
// =============================================================================

export const agentContext = pgTable("agent_context", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    threadId: varchar("thread_id").notNull(),
    contextWindow: jsonb("context_window").$type<Array<{ role: string; content: string; timestamp: number }>>().default([]),
    tokenCount: integer("token_count").default(0),
    maxTokens: integer("max_tokens").default(128000),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table: any) => [
    index("agent_context_thread_id_idx").on(table.threadId),
    uniqueIndex("agent_context_thread_unique").on(table.threadId),
]);

export const insertAgentContextSchema = createInsertSchema(agentContext).omit({
    id: true,
    createdAt: true,
});

export type InsertAgentContext = z.infer<typeof insertAgentContextSchema>;
export type AgentContext = typeof agentContext.$inferSelect;

// =============================================================================
// Agent Session State — migrated from schema.bak.ts
// =============================================================================

export const agentSessionState = pgTable("agent_session_state", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    sessionId: varchar("session_id").notNull(),
    key: varchar("key").notNull(),
    value: jsonb("value"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table: any) => [
    index("agent_session_state_session_idx").on(table.sessionId),
    uniqueIndex("agent_session_state_unique").on(table.sessionId, table.key),
]);

export const insertAgentSessionStateSchema = createInsertSchema(agentSessionState).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});

export type InsertAgentSessionState = z.infer<typeof insertAgentSessionStateSchema>;
export type AgentSessionState = typeof agentSessionState.$inferSelect;

// =============================================================================
// Trace Event Schema & createTraceEvent — migrated from schema.bak.ts
// =============================================================================

export const TraceEventTypeSchema = z.enum([
    'task_start',
    'plan_created',
    'plan_step',
    'step_started',
    'tool_call',
    'tool_call_started',
    'tool_call_succeeded',
    'tool_call_failed',
    'tool_output',
    'tool_chunk',
    'observation',
    'verification',
    'verification_passed',
    'verification_failed',
    'step_completed',
    'step_failed',
    'step_retried',
    'replan',
    'thinking',
    'shell_output',
    'artifact_created',
    'artifact_ready',
    'citations_added',
    'memory_loaded',
    'memory_saved',
    'agent_delegated',
    'agent_completed',
    'progress_update',
    'error',
    'done',
    'cancelled',
    'heartbeat'
]);

export const TraceEventSchema = z.object({
    event_type: TraceEventTypeSchema,
    runId: z.string(),
    stepId: z.string().optional(),
    stepIndex: z.number().optional(),
    phase: z.enum(['planning', 'executing', 'verifying', 'completed', 'failed', 'cancelled']).optional(),
    status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled', 'retrying']).optional(),
    tool_name: z.string().optional(),
    tool_input: z.record(z.any()).optional(),
    command: z.string().optional(),
    output_snippet: z.string().optional(),
    chunk_sequence: z.number().optional(),
    is_final_chunk: z.boolean().optional(),
    artifact: z.object({
        id: z.string().optional(),
        type: z.string(),
        name: z.string(),
        url: z.string().optional(),
        mimeType: z.string().optional(),
        size: z.number().optional(),
        data: z.any().optional(),
    }).optional(),
    plan: z.object({
        objective: z.string(),
        steps: z.array(z.object({
            index: z.number(),
            toolName: z.string(),
            description: z.string(),
        })),
        estimatedTime: z.string().optional(),
    }).optional(),
    error: z.object({
        code: z.string().optional(),
        message: z.string(),
        retryable: z.boolean().optional(),
    }).optional(),
    citations: z.array(z.object({
        source: z.string(),
        text: z.string(),
        page: z.number().optional(),
        url: z.string().optional(),
    })).optional(),
    agent: z.object({
        name: z.string(),
        role: z.string().optional(),
        status: z.string().optional(),
    }).optional(),
    progress: z.object({
        current: z.number(),
        total: z.number(),
        percentage: z.number().optional(),
        message: z.string().optional(),
    }).optional(),
    memory: z.object({
        keys: z.array(z.string()).optional(),
        loaded: z.number().optional(),
        saved: z.number().optional(),
    }).optional(),
    content: z.string().optional(),
    summary: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    durationMs: z.number().optional(),
    timestamp: z.number(),
    metadata: z.record(z.any()).optional(),
});

export type TraceEventType = z.infer<typeof TraceEventTypeSchema>;
export type TraceEvent = z.infer<typeof TraceEventSchema>;

export function createTraceEvent(
    event_type: TraceEventType,
    runId: string,
    options?: Partial<Omit<TraceEvent, 'event_type' | 'runId' | 'timestamp'>>
): TraceEvent {
    return TraceEventSchema.parse({
        event_type,
        runId,
        timestamp: Date.now(),
        ...options,
    });
}
