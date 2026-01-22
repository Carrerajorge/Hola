import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, index, uniqueIndex, boolean, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { vector } from "./common";
import { users } from "./auth";
import { chats, chatMessages } from "./chat";
import { integrationAccounts } from "./integration";

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
    index("agent_runs_conversation_started_idx").on(table.conversationId, table.startedAt),
]);

export const insertAgentRunSchema = createInsertSchema(agentRuns);

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
    index("agent_steps_run_step_idx").on(table.runId, table.stepIndex),
]);

export const insertAgentStepSchema = createInsertSchema(agentSteps);

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

export const insertAgentAssetSchema = createInsertSchema(agentAssets);

export type InsertAgentAsset = z.infer<typeof insertAgentAssetSchema>;
export type AgentAsset = typeof agentAssets.$inferSelect;

// Tool Call Logs - Audit log for tool invocations
export const toolCallLogs = pgTable("tool_call_logs", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").references(() => users.id),
    chatId: varchar("chat_id"),
    runId: varchar("run_id"),
    toolId: varchar("tool_id").notNull(),
    providerId: varchar("provider_id").notNull(),
    accountId: varchar("account_id").references(() => integrationAccounts.id),
    inputRedacted: jsonb("input_redacted"),
    outputRedacted: jsonb("output_redacted"),
    status: text("status").notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    latencyMs: integer("latency_ms"),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
    index("tool_call_logs_user_id_idx").on(table.userId),
    index("tool_call_logs_tool_id_idx").on(table.toolId),
    index("tool_call_logs_created_at_idx").on(table.createdAt),
    index("tool_call_logs_run_created_idx").on(table.runId, table.createdAt),
]);

export const insertToolCallLogSchema = createInsertSchema(toolCallLogs);

export type InsertToolCallLog = z.infer<typeof insertToolCallLogSchema>;
export type ToolCallLog = typeof toolCallLogs.$inferSelect;

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

export const insertCachedPageSchema = createInsertSchema(cachedPages);

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

export const insertDomainPolicySchema = createInsertSchema(domainPolicies);

export type InsertDomainPolicy = z.infer<typeof insertDomainPolicySchema>;
export type DomainPolicy = typeof domainPolicies.$inferSelect;

// Agent Mode Tables - For autonomous agent execution within chats
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
}, (table) => [
    index("agent_mode_runs_chat_idx").on(table.chatId),
    index("agent_mode_runs_message_idx").on(table.messageId),
    index("agent_mode_runs_status_idx").on(table.status),
    index("agent_mode_runs_created_idx").on(table.createdAt),
    index("agent_mode_runs_idempotency_idx").on(table.idempotencyKey),
]);

export const insertAgentModeRunSchema = createInsertSchema(agentModeRuns);

export type InsertAgentModeRun = z.infer<typeof insertAgentModeRunSchema>;
export type AgentModeRun = typeof agentModeRuns.$inferSelect;

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
}, (table) => [
    index("agent_mode_steps_run_idx").on(table.runId),
    index("agent_mode_steps_status_idx").on(table.status),
]);

export const insertAgentModeStepSchema = createInsertSchema(agentModeSteps);

export type InsertAgentModeStep = z.infer<typeof insertAgentModeStepSchema>;
export type AgentModeStep = typeof agentModeSteps.$inferSelect;

export const agentModeEvents = pgTable("agent_mode_events", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    runId: varchar("run_id").notNull().references(() => agentModeRuns.id, { onDelete: "cascade" }),
    stepIndex: integer("step_index"),
    correlationId: varchar("correlation_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    metadata: jsonb("metadata"),
    timestamp: timestamp("timestamp").defaultNow().notNull(),
    inputHash: varchar("input_hash"),
    outputRef: text("output_ref"),
    durationMs: integer("duration_ms"),
    errorCode: text("error_code"),
    retryCount: integer("retry_count").default(0),
}, (table) => [
    index("agent_mode_events_run_idx").on(table.runId),
    index("agent_mode_events_correlation_idx").on(table.correlationId),
    index("agent_mode_events_type_idx").on(table.eventType),
    index("agent_mode_events_timestamp_idx").on(table.timestamp),
]);

export const insertAgentModeEventSchema = createInsertSchema(agentModeEvents);

export type InsertAgentModeEvent = z.infer<typeof insertAgentModeEventSchema>;
export type AgentModeEvent = typeof agentModeEvents.$inferSelect;

export const agentWorkspaces = pgTable("agent_workspaces", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    runId: varchar("run_id").notNull().references(() => agentModeRuns.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(), // e.g., "todo.md", "output/report.xlsx"
    fileType: text("file_type").notNull(), // "todo", "artifact", "temp", "memory"
    content: text("content"), // text content for small files
    storagePath: text("storage_path"), // object storage path for large files
    metadata: jsonb("metadata"), // additional metadata
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
    index("agent_workspaces_run_idx").on(table.runId),
    index("agent_workspaces_path_idx").on(table.runId, table.filePath),
]);

export const insertAgentWorkspaceSchema = createInsertSchema(agentWorkspaces);

export type InsertAgentWorkspace = z.infer<typeof insertAgentWorkspaceSchema>;
export type AgentWorkspace = typeof agentWorkspaces.$inferSelect;

// Agent Memory Persistence Tables
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
}, (table) => [
    index("agent_memory_store_chat_key_idx").on(table.chatId, table.memoryKey),
    index("agent_memory_store_user_idx").on(table.userId),
    index("agent_memory_store_type_idx").on(table.memoryType),
]);

export const insertAgentMemoryStoreSchema = createInsertSchema(agentMemoryStore);

export type InsertAgentMemoryStore = z.infer<typeof insertAgentMemoryStoreSchema>;
export type AgentMemoryStore = typeof agentMemoryStore.$inferSelect;

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
}, (table) => [
    index("request_spec_history_chat_created_idx").on(table.chatId, table.createdAt),
    index("request_spec_history_run_idx").on(table.runId),
    index("request_spec_history_intent_idx").on(table.intent),
]);

export const insertRequestSpecHistorySchema = createInsertSchema(requestSpecHistory);

export type InsertRequestSpecHistory = z.infer<typeof insertRequestSpecHistorySchema>;
export type RequestSpecHistory = typeof requestSpecHistory.$inferSelect;

// Agentic Engine - Gap Logging
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
}, (table) => [
    index("agent_gap_logs_status_idx").on(table.status),
    index("agent_gap_logs_created_idx").on(table.createdAt),
    index("agent_gap_logs_signature_idx").on(table.gapSignature),
]);

export const insertAgentGapLogSchema = createInsertSchema(agentGapLogs);

export type InsertAgentGapLog = z.infer<typeof insertAgentGapLogSchema>;
export type AgentGapLog = typeof agentGapLogs.$inferSelect;

// Agent Memory System - Vector-based Storage
export const agentMemories = pgTable("agent_memories", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    namespace: varchar("namespace").notNull().default("default"),
    content: text("content").notNull(),
    embedding: vector("embedding"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
    index("agent_memories_namespace_idx").on(table.namespace),
    index("agent_memories_created_at_idx").on(table.createdAt),
]);

export const insertAgentMemorySchema = createInsertSchema(agentMemories);

export type InsertAgentMemory = z.infer<typeof insertAgentMemorySchema>;
export type AgentMemory = typeof agentMemories.$inferSelect;

export const agentContext = pgTable("agent_context", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    threadId: varchar("thread_id").notNull(),
    contextWindow: jsonb("context_window").$type<Array<{ role: string; content: string; timestamp: number }>>().default([]),
    tokenCount: integer("token_count").default(0),
    maxTokens: integer("max_tokens").default(128000),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
    index("agent_context_thread_id_idx").on(table.threadId),
    uniqueIndex("agent_context_thread_unique").on(table.threadId),
]);

export const insertAgentContextSchema = createInsertSchema(agentContext);

export type InsertAgentContext = z.infer<typeof insertAgentContextSchema>;
export type AgentContext = typeof agentContext.$inferSelect;

export const agentSessionState = pgTable("agent_session_state", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    sessionId: varchar("session_id").notNull(),
    key: varchar("key").notNull(),
    value: jsonb("value"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
    index("agent_session_state_session_idx").on(table.sessionId),
    uniqueIndex("agent_session_state_unique").on(table.sessionId, table.key),
]);

export const insertAgentSessionStateSchema = createInsertSchema(agentSessionState);

export type InsertAgentSessionState = z.infer<typeof insertAgentSessionStateSchema>;
export type AgentSessionState = typeof agentSessionState.$inferSelect;

// Code Interpreter Runs
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
}, (table) => [
    index("code_runs_conversation_idx").on(table.conversationId),
    index("code_runs_user_idx").on(table.userId),
]);

export const insertCodeInterpreterRunSchema = createInsertSchema(codeInterpreterRuns);

export type InsertCodeInterpreterRun = z.infer<typeof insertCodeInterpreterRunSchema>;
export type CodeInterpreterRun = typeof codeInterpreterRuns.$inferSelect;

// Code Interpreter Artifacts (generated files, charts, etc.)
export const codeInterpreterArtifacts = pgTable("code_interpreter_artifacts", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    runId: varchar("run_id").notNull().references(() => codeInterpreterRuns.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // image, file, data
    name: text("name").notNull(),
    data: text("data"), // base64 encoded for images, or text content
    mimeType: text("mime_type"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
    index("code_artifacts_run_idx").on(table.runId),
]);

export const insertCodeInterpreterArtifactSchema = createInsertSchema(codeInterpreterArtifacts);

export type InsertCodeInterpreterArtifact = z.infer<typeof insertCodeInterpreterArtifactSchema>;
export type CodeInterpreterArtifact = typeof codeInterpreterArtifacts.$inferSelect;

// ==========================================
// Custom Skills Schema - User-defined Agent Skills
// ==========================================

export const skillCategorySchema = z.enum(["documents", "data", "integrations", "automation", "custom"]);
export const skillActionTypeSchema = z.enum(["api_call", "shell_command", "file_operation", "llm_prompt", "chain", "conditional"]);

export const skillParameterSchema = z.object({
    name: z.string(),
    type: z.enum(["string", "number", "boolean", "array", "object", "file"]),
    description: z.string(),
    required: z.boolean().default(true),
    defaultValue: z.any().optional(),
    validation: z.string().optional(),
    options: z.array(z.string()).optional(),
});

export const skillActionSchema = z.object({
    id: z.string(),
    type: skillActionTypeSchema,
    name: z.string(),
    description: z.string().optional(),
    config: z.record(z.any()),
    dependsOn: z.array(z.string()).optional(),
    condition: z.string().optional(),
    onSuccess: z.string().optional(),
    onError: z.string().optional(),
});

export const skillTriggerSchema = z.object({
    type: z.enum(["keyword", "pattern", "intent", "manual"]),
    value: z.string(),
    priority: z.number().default(0),
});

export const customSkills = pgTable("custom_skills", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    description: text("description"),
    instructions: text("instructions"),
    category: varchar("category", { length: 50 }).notNull().default("custom"),
    icon: varchar("icon", { length: 50 }),
    color: varchar("color", { length: 20 }),
    enabled: boolean("enabled").default(true),
    isPublic: boolean("is_public").default(false),
    version: integer("version").default(1),
    parameters: jsonb("parameters").$type<z.infer<typeof skillParameterSchema>[]>().default([]),
    actions: jsonb("actions").$type<z.infer<typeof skillActionSchema>[]>().default([]),
    triggers: jsonb("triggers").$type<z.infer<typeof skillTriggerSchema>[]>().default([]),
    outputFormat: varchar("output_format", { length: 50 }),
    features: text("features").array(),
    tags: text("tags").array(),
    usageCount: integer("usage_count").default(0),
    lastUsedAt: timestamp("last_used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
    index("custom_skills_user_id_idx").on(table.userId),
    index("custom_skills_category_idx").on(table.category),
    index("custom_skills_enabled_idx").on(table.enabled),
]);

export const insertCustomSkillSchema = createInsertSchema(customSkills);

export type InsertCustomSkill = z.infer<typeof insertCustomSkillSchema>;
export type CustomSkill = typeof customSkills.$inferSelect;
export type SkillCategory = z.infer<typeof skillCategorySchema>;
export type SkillActionType = z.infer<typeof skillActionTypeSchema>;
export type SkillParameter = z.infer<typeof skillParameterSchema>;
export type SkillAction = z.infer<typeof skillActionSchema>;
export type SkillTrigger = z.infer<typeof skillTriggerSchema>;

// ==========================================
// Agent Event Schema - Standardized Contract
// ==========================================

export const AgentEventKindSchema = z.enum([
    'action',
    'observation',
    'result',
    'verification',
    'error',
    'plan',
    'thinking',
    'progress'
]);

export const AgentEventStatusSchema = z.enum(['ok', 'warn', 'fail']);

export const AgentEventPhaseSchema = z.enum([
    'planning',
    'executing',
    'verifying',
    'completed',
    'failed',
    'cancelled'
]);

export const AgentEventSchema = z.object({
    id: z.string().uuid().optional(),
    kind: AgentEventKindSchema,
    status: AgentEventStatusSchema,
    runId: z.string(),
    stepId: z.string().optional(),
    stepIndex: z.number().optional(),
    phase: AgentEventPhaseSchema.optional(),
    title: z.string(),
    summary: z.string().optional(),
    payload: z.any().optional(),
    confidence: z.number().min(0).max(1).optional(),
    shouldRetry: z.boolean().optional(),
    shouldReplan: z.boolean().optional(),
    timestamp: z.number(),
    metadata: z.record(z.any()).optional(),
});

export type AgentEventKind = z.infer<typeof AgentEventKindSchema>;
export type AgentEventStatus = z.infer<typeof AgentEventStatusSchema>;
export type AgentEventPhase = z.infer<typeof AgentEventPhaseSchema>;
export type AgentEvent = z.infer<typeof AgentEventSchema>;

export function createAgentEvent(
    kind: AgentEventKind,
    status: AgentEventStatus,
    runId: string,
    title: string,
    options?: Partial<Omit<AgentEvent, 'kind' | 'status' | 'runId' | 'title' | 'timestamp'>>
): AgentEvent {
    return AgentEventSchema.parse({
        kind,
        status,
        runId,
        title,
        timestamp: Date.now(),
        ...options,
    });
}

// ==========================================
// Trace Event Schema - SSE Streaming Contract
// ==========================================

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
