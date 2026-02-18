import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  integer,
  timestamp,
  jsonb,
  index,
  real,
  boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { users } from "./auth";
import { gpts, gptVersions } from "./gpt";

// ─── Conversation State Machine ───────────────────────────────────────────────

export const conversationStateSchema = z.enum([
  "idle",
  "composing",
  "sending",
  "streaming",
  "tool_calling",
  "rag_retrieving",
  "done",
  "error",
  "aborted",
]);
export type ConversationState = z.infer<typeof conversationStateSchema>;

// GPT Conversation Runs — tracks each turn through the state machine
export const gptConversationRuns = pgTable("gpt_conversation_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull(),
  gptId: varchar("gpt_id").notNull().references(() => gpts.id),
  userId: varchar("user_id"),
  requestId: varchar("request_id"),
  state: text("state").notNull().default("idle"),
  previousState: text("previous_state"),
  turnIndex: integer("turn_index").notNull().default(0),

  // Context snapshot
  modelUsed: text("model_used"),
  systemPromptHash: text("system_prompt_hash"),
  retrievalChunkCount: integer("retrieval_chunk_count").default(0),
  toolCallCount: integer("tool_call_count").default(0),
  inputTokens: integer("input_tokens").default(0),
  outputTokens: integer("output_tokens").default(0),

  // Latency breakdown (ms)
  latencyContextBuildMs: integer("latency_context_build_ms"),
  latencyRetrievalMs: integer("latency_retrieval_ms"),
  latencyModelMs: integer("latency_model_ms"),
  latencyToolMs: integer("latency_tool_ms"),
  latencyTotalMs: integer("latency_total_ms"),
  timeToFirstTokenMs: integer("time_to_first_token_ms"),

  // Error tracking
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").default(0),

  // Streaming
  streamAborted: text("stream_aborted").default("false"),
  streamTimeoutMs: integer("stream_timeout_ms"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
}, (table: any) => [
  index("gpt_conv_runs_conv_idx").on(table.conversationId),
  index("gpt_conv_runs_gpt_idx").on(table.gptId),
  index("gpt_conv_runs_state_idx").on(table.state),
  index("gpt_conv_runs_request_idx").on(table.requestId),
]);

export const insertGptConversationRunSchema = createInsertSchema(gptConversationRuns);
export type InsertGptConversationRun = z.infer<typeof insertGptConversationRunSchema>;
export type GptConversationRun = typeof gptConversationRuns.$inferSelect;

// ─── GPT Audit Log ────────────────────────────────────────────────────────────

export const gptAuditActions = z.enum([
  "created",
  "updated",
  "version_created",
  "rollback",
  "published",
  "unpublished",
  "deleted",
  "knowledge_added",
  "knowledge_removed",
  "action_added",
  "action_removed",
  "action_updated",
  "permissions_changed",
  "capability_changed",
  "policy_changed",
]);
export type GptAuditAction = z.infer<typeof gptAuditActions>;

export const gptAuditLog = pgTable("gpt_audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gptId: varchar("gpt_id").notNull().references(() => gpts.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  actorId: varchar("actor_id"),
  versionBefore: integer("version_before"),
  versionAfter: integer("version_after"),
  changeSummary: text("change_summary"),
  diff: jsonb("diff"), // JSON diff of what changed
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table: any) => [
  index("gpt_audit_gpt_idx").on(table.gptId),
  index("gpt_audit_action_idx").on(table.action),
  index("gpt_audit_actor_idx").on(table.actorId),
  index("gpt_audit_created_idx").on(table.createdAt),
]);

export const insertGptAuditLogSchema = createInsertSchema(gptAuditLog);
export type InsertGptAuditLog = z.infer<typeof insertGptAuditLogSchema>;
export type GptAuditLogEntry = typeof gptAuditLog.$inferSelect;

// ─── GPT Permissions (workspace/team level) ───────────────────────────────────

export const gptPermissionRoleSchema = z.enum(["owner", "editor", "viewer", "user"]);
export type GptPermissionRole = z.infer<typeof gptPermissionRoleSchema>;

export const gptPermissions = pgTable("gpt_permissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gptId: varchar("gpt_id").notNull().references(() => gpts.id, { onDelete: "cascade" }),
  granteeType: text("grantee_type").notNull().default("user"), // user, team, workspace
  granteeId: varchar("grantee_id").notNull(),
  role: text("role").notNull().default("user"),
  grantedBy: varchar("granted_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
}, (table: any) => [
  index("gpt_permissions_gpt_idx").on(table.gptId),
  index("gpt_permissions_grantee_idx").on(table.granteeId),
]);

export const insertGptPermissionSchema = createInsertSchema(gptPermissions);
export type InsertGptPermission = z.infer<typeof insertGptPermissionSchema>;
export type GptPermission = typeof gptPermissions.$inferSelect;

// ─── GPT Knowledge Chunks (for RAG embeddings) ───────────────────────────────

export const gptKnowledgeChunks = pgTable("gpt_knowledge_chunks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  knowledgeId: varchar("knowledge_id").notNull(),
  gptId: varchar("gpt_id").notNull().references(() => gpts.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  tokenCount: integer("token_count").default(0),
  embedding: jsonb("embedding"), // vector as JSON array
  pageNumber: integer("page_number"),
  sectionTitle: text("section_title"),
  sectionType: text("section_type"), // heading, paragraph, list, table, code
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table: any) => [
  index("gpt_kchunks_knowledge_idx").on(table.knowledgeId),
  index("gpt_kchunks_gpt_idx").on(table.gptId),
  index("gpt_kchunks_chunk_idx").on(table.chunkIndex),
]);

export const insertGptKnowledgeChunkSchema = createInsertSchema(gptKnowledgeChunks);
export type InsertGptKnowledgeChunk = z.infer<typeof insertGptKnowledgeChunkSchema>;
export type GptKnowledgeChunk = typeof gptKnowledgeChunks.$inferSelect;

// ─── GPT Golden Conversations (for evaluation) ───────────────────────────────

export const gptGoldenConversations = pgTable("gpt_golden_conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gptId: varchar("gpt_id").notNull().references(() => gpts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  turns: jsonb("turns").notNull(), // Array of { role, content, expectedToolCalls?, expectedCitations? }
  expectedBehaviors: jsonb("expected_behaviors"), // { mustCite: bool, mustUseTool: string[], mustNotHallucinate: bool }
  tags: jsonb("tags").default([]),
  isActive: text("is_active").default("true"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table: any) => [
  index("gpt_golden_gpt_idx").on(table.gptId),
]);

export const insertGptGoldenConversationSchema = createInsertSchema(gptGoldenConversations);
export type InsertGptGoldenConversation = z.infer<typeof insertGptGoldenConversationSchema>;
export type GptGoldenConversation = typeof gptGoldenConversations.$inferSelect;

// ─── GPT Evaluation Runs ─────────────────────────────────────────────────────

export const gptEvaluationRuns = pgTable("gpt_evaluation_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gptId: varchar("gpt_id").notNull().references(() => gpts.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  triggeredBy: varchar("triggered_by"), // userId or "system"
  triggerReason: text("trigger_reason"), // "version_change", "scheduled", "manual"
  status: text("status").notNull().default("pending"), // pending, running, completed, failed
  totalTests: integer("total_tests").default(0),
  passedTests: integer("passed_tests").default(0),
  failedTests: integer("failed_tests").default(0),
  results: jsonb("results"), // detailed per-test results
  metrics: jsonb("metrics"), // { avgLatency, timeoutRate, toolFailureRate, hallucRate, citationAccuracy }
  summary: text("summary"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
}, (table: any) => [
  index("gpt_eval_gpt_idx").on(table.gptId),
  index("gpt_eval_version_idx").on(table.versionNumber),
  index("gpt_eval_status_idx").on(table.status),
]);

export const insertGptEvaluationRunSchema = createInsertSchema(gptEvaluationRuns);
export type InsertGptEvaluationRun = z.infer<typeof insertGptEvaluationRunSchema>;
export type GptEvaluationRun = typeof gptEvaluationRuns.$inferSelect;

// ─── GPT Observability Traces ─────────────────────────────────────────────────

export const gptTraces = pgTable("gpt_traces", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gptId: varchar("gpt_id").notNull().references(() => gpts.id, { onDelete: "cascade" }),
  conversationId: varchar("conversation_id").notNull(),
  requestId: varchar("request_id"),
  traceType: text("trace_type").notNull(), // context_build, retrieval, tool_call, model_call, streaming, error
  stage: text("stage").notNull(), // which pipeline stage
  durationMs: integer("duration_ms"),
  inputSize: integer("input_size"),
  outputSize: integer("output_size"),
  success: text("success").default("true"),
  errorCode: text("error_code"),
  metadata: jsonb("metadata"), // stage-specific metadata
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table: any) => [
  index("gpt_traces_gpt_idx").on(table.gptId),
  index("gpt_traces_conv_idx").on(table.conversationId),
  index("gpt_traces_request_idx").on(table.requestId),
  index("gpt_traces_type_idx").on(table.traceType),
  index("gpt_traces_created_idx").on(table.createdAt),
]);

export const insertGptTraceSchema = createInsertSchema(gptTraces);
export type InsertGptTrace = z.infer<typeof insertGptTraceSchema>;
export type GptTrace = typeof gptTraces.$inferSelect;

// ─── GPT Metrics Aggregates (pre-computed per GPT per hour) ──────────────────

export const gptMetricsHourly = pgTable("gpt_metrics_hourly", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gptId: varchar("gpt_id").notNull().references(() => gpts.id, { onDelete: "cascade" }),
  hourBucket: timestamp("hour_bucket").notNull(),
  totalRequests: integer("total_requests").default(0),
  successfulRequests: integer("successful_requests").default(0),
  failedRequests: integer("failed_requests").default(0),
  timeoutCount: integer("timeout_count").default(0),
  toolCallCount: integer("tool_call_count").default(0),
  toolFailureCount: integer("tool_failure_count").default(0),
  retrievalCount: integer("retrieval_count").default(0),
  avgLatencyMs: integer("avg_latency_ms"),
  p50LatencyMs: integer("p50_latency_ms"),
  p95LatencyMs: integer("p95_latency_ms"),
  p99LatencyMs: integer("p99_latency_ms"),
  avgTimeToFirstTokenMs: integer("avg_time_to_first_token_ms"),
  totalInputTokens: integer("total_input_tokens").default(0),
  totalOutputTokens: integer("total_output_tokens").default(0),
  citationAccuracy: real("citation_accuracy"),
  hallucinationFlags: integer("hallucination_flags").default(0),
  streamAbortCount: integer("stream_abort_count").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table: any) => [
  index("gpt_metrics_gpt_hour_idx").on(table.gptId, table.hourBucket),
]);

export const insertGptMetricsHourlySchema = createInsertSchema(gptMetricsHourly);
export type InsertGptMetricsHourly = z.infer<typeof insertGptMetricsHourlySchema>;
export type GptMetricsHourly = typeof gptMetricsHourly.$inferSelect;

// ─── GPT Publication Registry ─────────────────────────────────────────────────

export const gptPublications = pgTable("gpt_publications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gptId: varchar("gpt_id").notNull().references(() => gpts.id, { onDelete: "cascade" }),
  publishedVersion: integer("published_version").notNull(),
  publishedBy: varchar("published_by"),
  scope: text("scope").notNull().default("internal"), // internal, workspace, public
  approvedBy: varchar("approved_by"),
  releaseNotes: text("release_notes"),
  isActive: text("is_active").default("true"),
  publishedAt: timestamp("published_at").defaultNow().notNull(),
  unpublishedAt: timestamp("unpublished_at"),
}, (table: any) => [
  index("gpt_pub_gpt_idx").on(table.gptId),
  index("gpt_pub_scope_idx").on(table.scope),
]);

export const insertGptPublicationSchema = createInsertSchema(gptPublications);
export type InsertGptPublication = z.infer<typeof insertGptPublicationSchema>;
export type GptPublication = typeof gptPublications.$inferSelect;
