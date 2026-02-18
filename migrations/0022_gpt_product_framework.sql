-- GPT Product Framework Migration
-- Adds tables for: conversation state tracking, audit, permissions,
-- knowledge chunks, golden conversations, evaluations, observability, metrics, publications

-- 1. GPT Conversation Runs — state machine tracking per turn
CREATE TABLE IF NOT EXISTS "gpt_conversation_runs" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "conversation_id" varchar NOT NULL,
  "gpt_id" varchar NOT NULL REFERENCES "gpts"("id"),
  "user_id" varchar,
  "request_id" varchar,
  "state" text NOT NULL DEFAULT 'idle',
  "previous_state" text,
  "turn_index" integer NOT NULL DEFAULT 0,
  "model_used" text,
  "system_prompt_hash" text,
  "retrieval_chunk_count" integer DEFAULT 0,
  "tool_call_count" integer DEFAULT 0,
  "input_tokens" integer DEFAULT 0,
  "output_tokens" integer DEFAULT 0,
  "latency_context_build_ms" integer,
  "latency_retrieval_ms" integer,
  "latency_model_ms" integer,
  "latency_tool_ms" integer,
  "latency_total_ms" integer,
  "time_to_first_token_ms" integer,
  "error_code" text,
  "error_message" text,
  "retry_count" integer DEFAULT 0,
  "stream_aborted" text DEFAULT 'false',
  "stream_timeout_ms" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp
);

CREATE INDEX IF NOT EXISTS "gpt_conv_runs_conv_idx" ON "gpt_conversation_runs" ("conversation_id");
CREATE INDEX IF NOT EXISTS "gpt_conv_runs_gpt_idx" ON "gpt_conversation_runs" ("gpt_id");
CREATE INDEX IF NOT EXISTS "gpt_conv_runs_state_idx" ON "gpt_conversation_runs" ("state");
CREATE INDEX IF NOT EXISTS "gpt_conv_runs_request_idx" ON "gpt_conversation_runs" ("request_id");

-- 2. GPT Audit Log
CREATE TABLE IF NOT EXISTS "gpt_audit_log" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "gpt_id" varchar NOT NULL REFERENCES "gpts"("id") ON DELETE CASCADE,
  "action" text NOT NULL,
  "actor_id" varchar,
  "version_before" integer,
  "version_after" integer,
  "change_summary" text,
  "diff" jsonb,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "gpt_audit_gpt_idx" ON "gpt_audit_log" ("gpt_id");
CREATE INDEX IF NOT EXISTS "gpt_audit_action_idx" ON "gpt_audit_log" ("action");
CREATE INDEX IF NOT EXISTS "gpt_audit_actor_idx" ON "gpt_audit_log" ("actor_id");
CREATE INDEX IF NOT EXISTS "gpt_audit_created_idx" ON "gpt_audit_log" ("created_at");

-- 3. GPT Permissions
CREATE TABLE IF NOT EXISTS "gpt_permissions" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "gpt_id" varchar NOT NULL REFERENCES "gpts"("id") ON DELETE CASCADE,
  "grantee_type" text NOT NULL DEFAULT 'user',
  "grantee_id" varchar NOT NULL,
  "role" text NOT NULL DEFAULT 'user',
  "granted_by" varchar,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp
);

CREATE INDEX IF NOT EXISTS "gpt_permissions_gpt_idx" ON "gpt_permissions" ("gpt_id");
CREATE INDEX IF NOT EXISTS "gpt_permissions_grantee_idx" ON "gpt_permissions" ("grantee_id");

-- 4. GPT Knowledge Chunks (for RAG embeddings)
CREATE TABLE IF NOT EXISTS "gpt_knowledge_chunks" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "knowledge_id" varchar NOT NULL,
  "gpt_id" varchar NOT NULL REFERENCES "gpts"("id") ON DELETE CASCADE,
  "content" text NOT NULL,
  "chunk_index" integer NOT NULL,
  "token_count" integer DEFAULT 0,
  "embedding" jsonb,
  "page_number" integer,
  "section_title" text,
  "section_type" text,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "gpt_kchunks_knowledge_idx" ON "gpt_knowledge_chunks" ("knowledge_id");
CREATE INDEX IF NOT EXISTS "gpt_kchunks_gpt_idx" ON "gpt_knowledge_chunks" ("gpt_id");
CREATE INDEX IF NOT EXISTS "gpt_kchunks_chunk_idx" ON "gpt_knowledge_chunks" ("chunk_index");

-- 5. GPT Golden Conversations (evaluation test cases)
CREATE TABLE IF NOT EXISTS "gpt_golden_conversations" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "gpt_id" varchar NOT NULL REFERENCES "gpts"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "turns" jsonb NOT NULL,
  "expected_behaviors" jsonb,
  "tags" jsonb DEFAULT '[]'::jsonb,
  "is_active" text DEFAULT 'true',
  "created_by" varchar,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "gpt_golden_gpt_idx" ON "gpt_golden_conversations" ("gpt_id");

-- 6. GPT Evaluation Runs
CREATE TABLE IF NOT EXISTS "gpt_evaluation_runs" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "gpt_id" varchar NOT NULL REFERENCES "gpts"("id") ON DELETE CASCADE,
  "version_number" integer NOT NULL,
  "triggered_by" varchar,
  "trigger_reason" text,
  "status" text NOT NULL DEFAULT 'pending',
  "total_tests" integer DEFAULT 0,
  "passed_tests" integer DEFAULT 0,
  "failed_tests" integer DEFAULT 0,
  "results" jsonb,
  "metrics" jsonb,
  "summary" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp
);

CREATE INDEX IF NOT EXISTS "gpt_eval_gpt_idx" ON "gpt_evaluation_runs" ("gpt_id");
CREATE INDEX IF NOT EXISTS "gpt_eval_version_idx" ON "gpt_evaluation_runs" ("version_number");
CREATE INDEX IF NOT EXISTS "gpt_eval_status_idx" ON "gpt_evaluation_runs" ("status");

-- 7. GPT Observability Traces
CREATE TABLE IF NOT EXISTS "gpt_traces" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "gpt_id" varchar NOT NULL REFERENCES "gpts"("id") ON DELETE CASCADE,
  "conversation_id" varchar NOT NULL,
  "request_id" varchar,
  "trace_type" text NOT NULL,
  "stage" text NOT NULL,
  "duration_ms" integer,
  "input_size" integer,
  "output_size" integer,
  "success" text DEFAULT 'true',
  "error_code" text,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "gpt_traces_gpt_idx" ON "gpt_traces" ("gpt_id");
CREATE INDEX IF NOT EXISTS "gpt_traces_conv_idx" ON "gpt_traces" ("conversation_id");
CREATE INDEX IF NOT EXISTS "gpt_traces_request_idx" ON "gpt_traces" ("request_id");
CREATE INDEX IF NOT EXISTS "gpt_traces_type_idx" ON "gpt_traces" ("trace_type");
CREATE INDEX IF NOT EXISTS "gpt_traces_created_idx" ON "gpt_traces" ("created_at");

-- 8. GPT Metrics (hourly aggregates)
CREATE TABLE IF NOT EXISTS "gpt_metrics_hourly" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "gpt_id" varchar NOT NULL REFERENCES "gpts"("id") ON DELETE CASCADE,
  "hour_bucket" timestamp NOT NULL,
  "total_requests" integer DEFAULT 0,
  "successful_requests" integer DEFAULT 0,
  "failed_requests" integer DEFAULT 0,
  "timeout_count" integer DEFAULT 0,
  "tool_call_count" integer DEFAULT 0,
  "tool_failure_count" integer DEFAULT 0,
  "retrieval_count" integer DEFAULT 0,
  "avg_latency_ms" integer,
  "p50_latency_ms" integer,
  "p95_latency_ms" integer,
  "p99_latency_ms" integer,
  "avg_time_to_first_token_ms" integer,
  "total_input_tokens" integer DEFAULT 0,
  "total_output_tokens" integer DEFAULT 0,
  "citation_accuracy" real,
  "hallucination_flags" integer DEFAULT 0,
  "stream_abort_count" integer DEFAULT 0,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "gpt_metrics_gpt_hour_idx" ON "gpt_metrics_hourly" ("gpt_id", "hour_bucket");

-- 9. GPT Publications
CREATE TABLE IF NOT EXISTS "gpt_publications" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "gpt_id" varchar NOT NULL REFERENCES "gpts"("id") ON DELETE CASCADE,
  "published_version" integer NOT NULL,
  "published_by" varchar,
  "scope" text NOT NULL DEFAULT 'internal',
  "approved_by" varchar,
  "release_notes" text,
  "is_active" text DEFAULT 'true',
  "published_at" timestamp DEFAULT now() NOT NULL,
  "unpublished_at" timestamp
);

CREATE INDEX IF NOT EXISTS "gpt_pub_gpt_idx" ON "gpt_publications" ("gpt_id");
CREATE INDEX IF NOT EXISTS "gpt_pub_scope_idx" ON "gpt_publications" ("scope");
