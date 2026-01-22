CREATE TABLE "consent_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"consent_type" text NOT NULL,
	"value" text NOT NULL,
	"consent_version" text DEFAULT '1.0',
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "magic_links" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"token" varchar NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "magic_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"response_preferences" jsonb,
	"user_profile" jsonb,
	"feature_flags" jsonb,
	"privacy_settings" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text,
	"password" text,
	"email" text,
	"first_name" varchar,
	"last_name" varchar,
	"full_name" varchar,
	"profile_image_url" varchar,
	"phone" varchar,
	"company" varchar,
	"role" text DEFAULT 'user',
	"plan" text DEFAULT 'free',
	"status" text DEFAULT 'active',
	"query_count" integer DEFAULT 0,
	"tokens_consumed" integer DEFAULT 0,
	"tokens_limit" integer DEFAULT 100000,
	"credits_balance" integer DEFAULT 0,
	"last_login_at" timestamp,
	"last_ip" varchar,
	"user_agent" text,
	"country_code" varchar(2),
	"auth_provider" text DEFAULT 'email',
	"is_2fa_enabled" text DEFAULT 'false',
	"email_verified" text DEFAULT 'false',
	"referral_code" varchar,
	"referred_by" varchar,
	"internal_notes" text,
	"tags" text[],
	"subscription_expires_at" timestamp,
	"daily_requests_used" integer DEFAULT 0,
	"daily_requests_limit" integer DEFAULT 3,
	"daily_requests_reset_at" timestamp,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "admin_audit_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" varchar NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" varchar,
	"details" jsonb,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_reports" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"parameters" jsonb,
	"status" text DEFAULT 'pending',
	"file_url" text,
	"file_size" integer,
	"generated_by" varchar NOT NULL,
	"scheduled_id" varchar,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "ai_model_usage" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_tokens" integer DEFAULT 0,
	"completion_tokens" integer DEFAULT 0,
	"total_tokens" integer DEFAULT 0,
	"latency_ms" integer,
	"cost_estimate" text,
	"request_type" text,
	"success" text DEFAULT 'true',
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_models" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"status" text DEFAULT 'active',
	"cost_per_1k" text DEFAULT '0.00',
	"usage_percent" integer DEFAULT 0,
	"description" text,
	"capabilities" jsonb,
	"model_type" text DEFAULT 'TEXT',
	"context_window" integer,
	"max_output_tokens" integer,
	"input_cost_per_1k" text DEFAULT '0.00',
	"output_cost_per_1k" text DEFAULT '0.00',
	"last_sync_at" timestamp,
	"is_deprecated" text DEFAULT 'false',
	"release_date" text,
	"is_enabled" text DEFAULT 'false',
	"enabled_at" timestamp,
	"enabled_by_admin_id" varchar,
	"display_order" integer DEFAULT 0,
	"icon" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"session_id" varchar,
	"event_name" text NOT NULL,
	"event_data" jsonb,
	"page_url" text,
	"referrer" text,
	"device_type" text,
	"browser" text,
	"country" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_snapshots" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" timestamp NOT NULL,
	"total_users" integer DEFAULT 0,
	"active_users" integer DEFAULT 0,
	"total_queries" integer DEFAULT 0,
	"revenue" text DEFAULT '0',
	"new_signups" integer DEFAULT 0,
	"churned_users" integer DEFAULT 0,
	"avg_response_time" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"endpoint" text NOT NULL,
	"method" text NOT NULL,
	"status_code" integer,
	"latency_ms" integer,
	"tokens_in" integer,
	"tokens_out" integer,
	"model" text,
	"provider" text,
	"request_preview" text,
	"response_preview" text,
	"error_message" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"action" text NOT NULL,
	"resource" text,
	"resource_id" varchar,
	"details" jsonb,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_budgets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"budget_limit" text DEFAULT '100.00' NOT NULL,
	"alert_threshold" integer DEFAULT 80,
	"current_spend" text DEFAULT '0.00',
	"projected_monthly" text DEFAULT '0.00',
	"period_start" timestamp DEFAULT now() NOT NULL,
	"period_end" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cost_budgets_provider_unique" UNIQUE("provider")
);
--> statement-breakpoint
CREATE TABLE "generated_reports" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" varchar,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending',
	"parameters" jsonb,
	"result_summary" jsonb,
	"file_path" text,
	"format" text DEFAULT 'json',
	"generated_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"payment_id" varchar,
	"invoice_number" text NOT NULL,
	"amount" text NOT NULL,
	"currency" text DEFAULT 'EUR',
	"status" text DEFAULT 'pending',
	"due_date" timestamp,
	"paid_at" timestamp,
	"pdf_path" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ip_blocklist" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ip_address" text NOT NULL,
	"reason" text,
	"blocked_by" varchar NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ip_blocklist_ip_address_unique" UNIQUE("ip_address")
);
--> statement-breakpoint
CREATE TABLE "kpi_snapshots" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"active_users_now" integer DEFAULT 0,
	"queries_per_minute" integer DEFAULT 0,
	"tokens_consumed_today" bigint DEFAULT 0,
	"revenue_today" text DEFAULT '0.00',
	"avg_latency_ms" integer DEFAULT 0,
	"error_rate_percentage" text DEFAULT '0.00',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_event_types" (
	"id" varchar PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"severity" text DEFAULT 'normal',
	"default_opt_in" text DEFAULT 'true',
	"default_channels" text DEFAULT 'push',
	"frequency_cap" integer,
	"icon" text,
	"sort_order" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "notification_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"event_type_id" varchar NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider_response" jsonb,
	"error_message" text,
	"retry_count" integer DEFAULT 0,
	"sent_at" timestamp,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"event_type_id" varchar NOT NULL,
	"channels" text DEFAULT 'push' NOT NULL,
	"enabled" text DEFAULT 'true',
	"quiet_hours_start" text,
	"quiet_hours_end" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"amount" text NOT NULL,
	"currency" text DEFAULT 'EUR',
	"status" text DEFAULT 'pending',
	"method" text,
	"description" text,
	"stripe_payment_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" text,
	"description" text,
	"category" text DEFAULT 'general',
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "platform_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "provider_metrics" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"window_start" timestamp NOT NULL,
	"window_end" timestamp NOT NULL,
	"avg_latency" integer DEFAULT 0,
	"p50_latency" integer DEFAULT 0,
	"p95_latency" integer DEFAULT 0,
	"p99_latency" integer DEFAULT 0,
	"success_rate" text DEFAULT '100',
	"total_requests" integer DEFAULT 0,
	"error_count" integer DEFAULT 0,
	"tokens_in" integer DEFAULT 0,
	"tokens_out" integer DEFAULT 0,
	"total_cost" text DEFAULT '0.00',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"description" text,
	"columns" jsonb NOT NULL,
	"filters" jsonb,
	"group_by" jsonb,
	"is_system" text DEFAULT 'false',
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_reports" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"parameters" jsonb,
	"schedule" text NOT NULL,
	"recipients" text[],
	"is_active" text DEFAULT 'true',
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"event_type" text NOT NULL,
	"severity" text DEFAULT 'info',
	"ip_address" text,
	"user_agent" text,
	"details" jsonb,
	"resolved" text DEFAULT 'false',
	"resolved_by" varchar,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_policies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_name" text NOT NULL,
	"policy_type" text NOT NULL,
	"rules" jsonb NOT NULL,
	"priority" integer DEFAULT 0,
	"is_enabled" text DEFAULT 'true',
	"applied_to" text DEFAULT 'global' NOT NULL,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "security_policies_policy_name_unique" UNIQUE("policy_name")
);
--> statement-breakpoint
CREATE TABLE "settings_config" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb,
	"value_type" text DEFAULT 'string',
	"default_value" jsonb,
	"description" text,
	"is_sensitive" text DEFAULT 'false',
	"updated_by" varchar,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "settings_config_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "connector_usage_hourly" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector" text NOT NULL,
	"hour_bucket" timestamp NOT NULL,
	"total_calls" integer DEFAULT 0,
	"success_count" integer DEFAULT 0,
	"failure_count" integer DEFAULT 0,
	"total_latency_ms" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gmail_oauth_tokens" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"account_email" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"scopes" text[] NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_accounts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"provider_id" varchar NOT NULL,
	"external_user_id" text,
	"display_name" text,
	"email" text,
	"avatar_url" text,
	"access_token" text,
	"refresh_token" text,
	"token_expires_at" timestamp,
	"scopes" text,
	"is_default" text DEFAULT 'false',
	"status" text DEFAULT 'active',
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_policies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"enabled_apps" jsonb DEFAULT '[]'::jsonb,
	"enabled_tools" jsonb DEFAULT '[]'::jsonb,
	"disabled_tools" jsonb DEFAULT '[]'::jsonb,
	"resource_scopes" jsonb,
	"auto_confirm_policy" text DEFAULT 'ask',
	"sandbox_mode" text DEFAULT 'false',
	"max_parallel_calls" integer DEFAULT 3,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "integration_policies_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "integration_providers" (
	"id" varchar PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon_url" text,
	"auth_type" text DEFAULT 'oauth2' NOT NULL,
	"auth_config" jsonb,
	"category" text DEFAULT 'general',
	"is_active" text DEFAULT 'true',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_tools" (
	"id" varchar PRIMARY KEY NOT NULL,
	"provider_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"action_schema" jsonb,
	"result_schema" jsonb,
	"required_scopes" text[],
	"data_access_level" text DEFAULT 'read',
	"rate_limit" jsonb,
	"confirmation_required" text DEFAULT 'false',
	"is_active" text DEFAULT 'true',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pare_idempotency_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"response_json" jsonb,
	"status" text DEFAULT 'processing' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp DEFAULT NOW() + INTERVAL '24 hours' NOT NULL,
	CONSTRAINT "pare_idempotency_keys_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "shared_links" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" varchar NOT NULL,
	"token" varchar NOT NULL,
	"scope" text DEFAULT 'link_only',
	"permissions" text DEFAULT 'read',
	"expires_at" timestamp,
	"last_accessed_at" timestamp,
	"access_count" integer DEFAULT 0,
	"is_revoked" text DEFAULT 'false',
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "shared_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" varchar NOT NULL,
	"run_id" varchar,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"status" text DEFAULT 'done',
	"request_id" varchar,
	"user_message_id" varchar,
	"sequence" integer,
	"attachments" jsonb,
	"sources" jsonb,
	"figma_diagram" jsonb,
	"google_form_preview" jsonb,
	"gmail_preview" jsonb,
	"generated_image" text,
	"metadata" jsonb,
	"search_vector" "tsvector",
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_participants" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" varchar NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"invited_by" varchar,
	"invited_at" timestamp DEFAULT now() NOT NULL,
	"accepted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "chat_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" varchar NOT NULL,
	"client_request_id" varchar NOT NULL,
	"user_message_id" varchar,
	"assistant_message_id" varchar,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_seq" integer DEFAULT 0,
	"error" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "chat_shares" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" varchar NOT NULL,
	"recipient_user_id" varchar,
	"email" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"invited_by" varchar,
	"notification_sent" text DEFAULT 'false',
	"accepted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chats" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"title" text DEFAULT 'New Chat' NOT NULL,
	"gpt_id" varchar,
	"archived" text DEFAULT 'false',
	"hidden" text DEFAULT 'false',
	"pinned" text DEFAULT 'false',
	"pinned_at" timestamp,
	"deleted_at" timestamp,
	"last_message_at" timestamp,
	"message_count" integer DEFAULT 0,
	"tokens_used" integer DEFAULT 0,
	"ai_model_used" text,
	"conversation_status" text DEFAULT 'active',
	"flag_status" text,
	"ended_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offline_message_queue" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"content" jsonb NOT NULL,
	"status" text DEFAULT 'pending',
	"retry_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "response_quality_metrics" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" varchar,
	"user_id" varchar,
	"score" integer,
	"feedback" text,
	"category" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_invocations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" varchar NOT NULL,
	"tool_call_id" varchar NOT NULL,
	"tool_name" text NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "gpt_actions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gpt_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"action_type" text DEFAULT 'api' NOT NULL,
	"http_method" text DEFAULT 'GET',
	"endpoint" text NOT NULL,
	"headers" jsonb,
	"body_template" text,
	"response_mapping" jsonb,
	"auth_type" text DEFAULT 'none',
	"auth_config" jsonb,
	"parameters" jsonb,
	"rate_limit" integer DEFAULT 100,
	"timeout" integer DEFAULT 30000,
	"is_active" text DEFAULT 'true',
	"last_used_at" timestamp,
	"usage_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gpt_categories" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"icon" text,
	"sort_order" integer DEFAULT 0,
	CONSTRAINT "gpt_categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "gpt_knowledge" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gpt_id" varchar NOT NULL,
	"file_name" text NOT NULL,
	"file_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"storage_url" text NOT NULL,
	"content_hash" text,
	"extracted_text" text,
	"embedding_status" text DEFAULT 'pending',
	"chunk_count" integer DEFAULT 0,
	"metadata" jsonb,
	"is_active" text DEFAULT 'true',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gpt_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" varchar,
	"gpt_id" varchar NOT NULL,
	"config_version" integer NOT NULL,
	"frozen_system_prompt" text NOT NULL,
	"frozen_capabilities" jsonb,
	"frozen_tool_permissions" jsonb,
	"frozen_runtime_policy" jsonb,
	"enforced_model_id" text,
	"knowledge_context_ids" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "gpt_versions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gpt_id" varchar NOT NULL,
	"version_number" integer NOT NULL,
	"system_prompt" text NOT NULL,
	"temperature" text DEFAULT '0.7',
	"top_p" text DEFAULT '1',
	"max_tokens" integer DEFAULT 4096,
	"change_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" varchar
);
--> statement-breakpoint
CREATE TABLE "gpts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"avatar" text,
	"category_id" varchar,
	"creator_id" varchar,
	"visibility" text DEFAULT 'private',
	"system_prompt" text NOT NULL,
	"temperature" text DEFAULT '0.7',
	"top_p" text DEFAULT '1',
	"max_tokens" integer DEFAULT 4096,
	"welcome_message" text,
	"capabilities" jsonb,
	"conversation_starters" jsonb,
	"usage_count" integer DEFAULT 0,
	"version" integer DEFAULT 1,
	"recommended_model" text,
	"runtime_policy" jsonb,
	"tool_permissions" jsonb,
	"is_published" text DEFAULT 'false',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "gpts_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "sidebar_pinned_gpts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"gpt_id" varchar NOT NULL,
	"display_order" integer DEFAULT 0,
	"pinned_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_documents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" varchar NOT NULL,
	"message_id" varchar,
	"file_name" text NOT NULL,
	"storage_path" text,
	"mime_type" text NOT NULL,
	"file_size" integer,
	"extracted_text" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_chunks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" varchar NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536),
	"page_number" integer,
	"chunk_index" integer NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "file_jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" varchar NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"retries" integer DEFAULT 0,
	"last_error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"size" integer NOT NULL,
	"storage_path" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"processing_progress" integer DEFAULT 0,
	"processing_error" text,
	"completed_at" timestamp,
	"total_chunks" integer,
	"uploaded_chunks" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_assets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" varchar NOT NULL,
	"step_id" varchar,
	"asset_type" text NOT NULL,
	"storage_path" text,
	"content" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_context" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" varchar NOT NULL,
	"context_window" jsonb DEFAULT '[]'::jsonb,
	"token_count" integer DEFAULT 0,
	"max_tokens" integer DEFAULT 128000,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_gap_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_prompt" text NOT NULL,
	"detected_intent" text,
	"gap_reason" text,
	"suggested_capability" text,
	"status" text DEFAULT 'pending',
	"reviewed_by" varchar,
	"gap_signature" varchar,
	"frequency_count" integer DEFAULT 1,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_memories" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"namespace" varchar DEFAULT 'default' NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_memory_store" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" varchar,
	"user_id" varchar,
	"memory_key" text NOT NULL,
	"memory_value" jsonb NOT NULL,
	"memory_type" text DEFAULT 'context',
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_mode_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" varchar NOT NULL,
	"step_index" integer,
	"correlation_id" varchar NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"metadata" jsonb,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"input_hash" varchar,
	"output_ref" text,
	"duration_ms" integer,
	"error_code" text,
	"retry_count" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "agent_mode_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" varchar NOT NULL,
	"message_id" varchar,
	"user_id" varchar,
	"status" text DEFAULT 'queued' NOT NULL,
	"plan" jsonb,
	"artifacts" jsonb,
	"summary" text,
	"error" text,
	"total_steps" integer DEFAULT 0,
	"completed_steps" integer DEFAULT 0,
	"current_step_index" integer DEFAULT 0,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"idempotency_key" varchar
);
--> statement-breakpoint
CREATE TABLE "agent_mode_steps" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" varchar NOT NULL,
	"step_index" integer NOT NULL,
	"tool_name" text NOT NULL,
	"tool_input" jsonb,
	"tool_output" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"retry_count" integer DEFAULT 0,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" varchar,
	"status" text DEFAULT 'pending' NOT NULL,
	"router_decision" text,
	"objective" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "agent_session_state" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" varchar NOT NULL,
	"key" varchar NOT NULL,
	"value" jsonb,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_steps" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" varchar NOT NULL,
	"step_type" text NOT NULL,
	"url" text,
	"detail" jsonb,
	"screenshot" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"success" text DEFAULT 'pending',
	"error" text,
	"step_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_workspaces" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" varchar NOT NULL,
	"file_path" text NOT NULL,
	"file_type" text NOT NULL,
	"content" text,
	"storage_path" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cached_pages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url_hash" text NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"content" text,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	CONSTRAINT "cached_pages_url_hash_unique" UNIQUE("url_hash")
);
--> statement-breakpoint
CREATE TABLE "code_interpreter_artifacts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" varchar NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"data" text,
	"mime_type" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_interpreter_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" varchar,
	"user_id" varchar,
	"code" text NOT NULL,
	"language" text DEFAULT 'python' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"stdout" text,
	"stderr" text,
	"execution_time_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_skills" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"instructions" text,
	"category" varchar(50) DEFAULT 'custom' NOT NULL,
	"icon" varchar(50),
	"color" varchar(20),
	"enabled" boolean DEFAULT true,
	"is_public" boolean DEFAULT false,
	"version" integer DEFAULT 1,
	"parameters" jsonb DEFAULT '[]'::jsonb,
	"actions" jsonb DEFAULT '[]'::jsonb,
	"triggers" jsonb DEFAULT '[]'::jsonb,
	"output_format" varchar(50),
	"features" text[],
	"tags" text[],
	"usage_count" integer DEFAULT 0,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_policies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" text NOT NULL,
	"allow_navigation" text DEFAULT 'true' NOT NULL,
	"cookie_policy" text DEFAULT 'accept',
	"rate_limit" integer DEFAULT 10,
	"custom_headers" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "domain_policies_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "request_spec_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" varchar,
	"run_id" varchar,
	"message_id" varchar,
	"intent" text NOT NULL,
	"intent_confidence" real,
	"deliverable_type" text,
	"primary_agent" text,
	"target_agents" text[],
	"attachments_count" integer DEFAULT 0,
	"execution_duration_ms" integer,
	"status" text DEFAULT 'pending',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_call_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"chat_id" varchar,
	"run_id" varchar,
	"tool_id" varchar NOT NULL,
	"provider_id" varchar NOT NULL,
	"account_id" varchar,
	"input_redacted" jsonb,
	"output_redacted" jsonb,
	"status" text NOT NULL,
	"error_code" text,
	"error_message" text,
	"latency_ms" integer,
	"idempotency_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_message_analysis" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" varchar,
	"upload_id" varchar,
	"session_id" varchar,
	"status" text DEFAULT 'pending' NOT NULL,
	"scope" text DEFAULT 'all' NOT NULL,
	"sheets_to_analyze" text[],
	"started_at" timestamp,
	"completed_at" timestamp,
	"summary" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_knowledge" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"content" text,
	"embedding" text,
	"metadata" jsonb,
	"source" text DEFAULT 'manual',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "excel_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" text NOT NULL,
	"name" text NOT NULL,
	"data" jsonb,
	"sheets" jsonb,
	"metadata" jsonb,
	"created_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"size" integer DEFAULT 0,
	"is_template" boolean DEFAULT false,
	"template_category" text,
	"version" integer DEFAULT 1,
	CONSTRAINT "excel_documents_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "library_activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_id" integer,
	"folder_id" integer,
	"collection_id" integer,
	"action" text NOT NULL,
	"user_id" varchar NOT NULL,
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_collections" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"cover_file_id" integer,
	"type" text DEFAULT 'album',
	"smart_rules" jsonb,
	"user_id" varchar NOT NULL,
	"is_public" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "library_collections_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "library_file_collections" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_id" integer NOT NULL,
	"collection_id" integer NOT NULL,
	"order" integer DEFAULT 0,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" text NOT NULL,
	"name" text NOT NULL,
	"original_name" text NOT NULL,
	"description" text,
	"type" text NOT NULL,
	"mime_type" text NOT NULL,
	"extension" text NOT NULL,
	"storage_path" text NOT NULL,
	"storage_url" text,
	"thumbnail_path" text,
	"thumbnail_url" text,
	"size" integer DEFAULT 0 NOT NULL,
	"width" integer,
	"height" integer,
	"duration" integer,
	"pages" integer,
	"metadata" jsonb,
	"folder_id" integer,
	"tags" text[],
	"is_favorite" boolean DEFAULT false,
	"is_archived" boolean DEFAULT false,
	"is_pinned" boolean DEFAULT false,
	"user_id" varchar NOT NULL,
	"is_public" boolean DEFAULT false,
	"shared_with" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_accessed_at" timestamp,
	"deleted_at" timestamp,
	"version" integer DEFAULT 1,
	"parent_version_id" integer,
	CONSTRAINT "library_files_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "library_folders" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text DEFAULT '#6366f1',
	"icon" text DEFAULT 'folder',
	"parent_id" integer,
	"path" text NOT NULL,
	"user_id" varchar NOT NULL,
	"is_system" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "library_folders_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "library_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"media_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"storage_path" text NOT NULL,
	"thumbnail_path" text,
	"mime_type" text,
	"size" integer,
	"metadata" jsonb,
	"source_chat_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_storage" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"total_bytes" bigint DEFAULT 0,
	"image_bytes" bigint DEFAULT 0,
	"video_bytes" bigint DEFAULT 0,
	"document_bytes" bigint DEFAULT 0,
	"other_bytes" bigint DEFAULT 0,
	"file_count" integer DEFAULT 0,
	"quota_bytes" bigint DEFAULT 5368709120,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "library_storage_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "spreadsheet_analysis_jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" varchar NOT NULL,
	"sheet_name" text NOT NULL,
	"status" text DEFAULT 'queued',
	"generated_code" text,
	"error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spreadsheet_analysis_outputs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" varchar NOT NULL,
	"output_type" text NOT NULL,
	"title" text,
	"payload" jsonb NOT NULL,
	"order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spreadsheet_analysis_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"sheet_name" text NOT NULL,
	"mode" text DEFAULT 'full',
	"user_prompt" text,
	"generated_code" text,
	"code_hash" text,
	"status" text DEFAULT 'pending',
	"error_message" text,
	"execution_time_ms" integer,
	"started_at" timestamp,
	"completed_at" timestamp,
	"scope" text,
	"target_sheets" jsonb,
	"analysis_mode" text,
	"cross_sheet_summary" text,
	"total_jobs" integer,
	"completed_jobs" integer DEFAULT 0,
	"failed_jobs" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spreadsheet_sheets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_id" varchar NOT NULL,
	"name" text NOT NULL,
	"sheet_index" integer NOT NULL,
	"row_count" integer DEFAULT 0,
	"column_count" integer DEFAULT 0,
	"inferred_headers" jsonb,
	"column_types" jsonb,
	"preview_data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spreadsheet_uploads" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"checksum" text,
	"status" text DEFAULT 'pending',
	"error_message" text,
	"expires_at" timestamp,
	"file_type" text,
	"encoding" text,
	"page_count" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_artifacts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_id" varchar NOT NULL,
	"message_id" varchar,
	"artifact_type" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_name" text,
	"file_size" integer,
	"checksum" varchar(64),
	"storage_url" text NOT NULL,
	"extracted_text" text,
	"metadata" jsonb,
	"processing_status" text DEFAULT 'pending',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_contexts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_id" varchar NOT NULL,
	"summary" text,
	"entities" jsonb DEFAULT '[]'::jsonb,
	"user_preferences" jsonb DEFAULT '{}'::jsonb,
	"topics" text[] DEFAULT '{}',
	"sentiment" text,
	"last_updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_images" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_id" varchar NOT NULL,
	"message_id" varchar,
	"parent_image_id" varchar,
	"prompt" text NOT NULL,
	"image_url" text NOT NULL,
	"thumbnail_url" text,
	"base64_preview" text,
	"model" text,
	"mode" text DEFAULT 'generate',
	"width" integer,
	"height" integer,
	"edit_history" jsonb DEFAULT '[]'::jsonb,
	"is_latest" text DEFAULT 'true',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_id" varchar NOT NULL,
	"chat_message_id" varchar,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"token_count" integer DEFAULT 0,
	"sequence" integer NOT NULL,
	"parent_message_id" varchar,
	"attachment_ids" text[] DEFAULT '{}',
	"image_ids" text[] DEFAULT '{}',
	"keywords" text[] DEFAULT '{}',
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_state_versions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_id" varchar NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"change_description" text,
	"author_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_states" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" varchar NOT NULL,
	"user_id" varchar,
	"version" integer DEFAULT 1 NOT NULL,
	"total_tokens" integer DEFAULT 0,
	"message_count" integer DEFAULT 0,
	"artifact_count" integer DEFAULT 0,
	"image_count" integer DEFAULT 0,
	"last_message_id" varchar,
	"last_image_id" varchar,
	"is_active" text DEFAULT 'true',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_facts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_id" varchar NOT NULL,
	"fact_type" varchar(50) NOT NULL,
	"content" text NOT NULL,
	"confidence" integer DEFAULT 80,
	"source" varchar(50),
	"extracted_at_turn" integer,
	"valid_until" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_requests" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" varchar(100) NOT NULL,
	"state_id" varchar NOT NULL,
	"message_id" varchar(100),
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_requests_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE "retrieval_telemetry" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_id" varchar NOT NULL,
	"request_id" varchar(100) NOT NULL,
	"query" text NOT NULL,
	"chunks_retrieved" integer DEFAULT 0,
	"total_time_ms" integer DEFAULT 0,
	"top_scores" jsonb DEFAULT '[]'::jsonb,
	"retrieval_type" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "running_summaries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_id" varchar NOT NULL,
	"content" text DEFAULT '',
	"token_count" integer DEFAULT 0,
	"last_updated_at_turn" integer DEFAULT 0,
	"main_topics" text[] DEFAULT '{}',
	"last_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "running_summaries_state_id_unique" UNIQUE("state_id")
);
--> statement-breakpoint
ALTER TABLE "consent_logs" ADD CONSTRAINT "consent_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_reports" ADD CONSTRAINT "admin_reports_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_model_usage" ADD CONSTRAINT "ai_model_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_logs" ADD CONSTRAINT "api_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ip_blocklist" ADD CONSTRAINT "ip_blocklist_blocked_by_users_id_fk" FOREIGN KEY ("blocked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_event_type_id_notification_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."notification_event_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmail_oauth_tokens" ADD CONSTRAINT "gmail_oauth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_accounts" ADD CONSTRAINT "integration_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_accounts" ADD CONSTRAINT "integration_accounts_provider_id_integration_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."integration_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_policies" ADD CONSTRAINT "integration_policies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_tools" ADD CONSTRAINT "integration_tools_provider_id_integration_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."integration_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_links" ADD CONSTRAINT "shared_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_runs" ADD CONSTRAINT "chat_runs_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_shares" ADD CONSTRAINT "chat_shares_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_run_id_chat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."chat_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gpt_actions" ADD CONSTRAINT "gpt_actions_gpt_id_gpts_id_fk" FOREIGN KEY ("gpt_id") REFERENCES "public"."gpts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gpt_knowledge" ADD CONSTRAINT "gpt_knowledge_gpt_id_gpts_id_fk" FOREIGN KEY ("gpt_id") REFERENCES "public"."gpts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gpt_sessions" ADD CONSTRAINT "gpt_sessions_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gpt_sessions" ADD CONSTRAINT "gpt_sessions_gpt_id_gpts_id_fk" FOREIGN KEY ("gpt_id") REFERENCES "public"."gpts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gpt_versions" ADD CONSTRAINT "gpt_versions_gpt_id_gpts_id_fk" FOREIGN KEY ("gpt_id") REFERENCES "public"."gpts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gpts" ADD CONSTRAINT "gpts_category_id_gpt_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."gpt_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sidebar_pinned_gpts" ADD CONSTRAINT "sidebar_pinned_gpts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sidebar_pinned_gpts" ADD CONSTRAINT "sidebar_pinned_gpts_gpt_id_gpts_id_fk" FOREIGN KEY ("gpt_id") REFERENCES "public"."gpts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_documents" ADD CONSTRAINT "conversation_documents_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_documents" ADD CONSTRAINT "conversation_documents_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_chunks" ADD CONSTRAINT "file_chunks_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_jobs" ADD CONSTRAINT "file_jobs_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_assets" ADD CONSTRAINT "agent_assets_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_assets" ADD CONSTRAINT "agent_assets_step_id_agent_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."agent_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memory_store" ADD CONSTRAINT "agent_memory_store_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memory_store" ADD CONSTRAINT "agent_memory_store_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_mode_events" ADD CONSTRAINT "agent_mode_events_run_id_agent_mode_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_mode_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_mode_runs" ADD CONSTRAINT "agent_mode_runs_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_mode_runs" ADD CONSTRAINT "agent_mode_runs_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_mode_runs" ADD CONSTRAINT "agent_mode_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_mode_steps" ADD CONSTRAINT "agent_mode_steps_run_id_agent_mode_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_mode_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_workspaces" ADD CONSTRAINT "agent_workspaces_run_id_agent_mode_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_mode_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_interpreter_artifacts" ADD CONSTRAINT "code_interpreter_artifacts_run_id_code_interpreter_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."code_interpreter_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_skills" ADD CONSTRAINT "custom_skills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_spec_history" ADD CONSTRAINT "request_spec_history_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_spec_history" ADD CONSTRAINT "request_spec_history_run_id_agent_mode_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_mode_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_spec_history" ADD CONSTRAINT "request_spec_history_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call_logs" ADD CONSTRAINT "tool_call_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_call_logs" ADD CONSTRAINT "tool_call_logs_account_id_integration_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."integration_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message_analysis" ADD CONSTRAINT "chat_message_analysis_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message_analysis" ADD CONSTRAINT "chat_message_analysis_upload_id_spreadsheet_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."spreadsheet_uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message_analysis" ADD CONSTRAINT "chat_message_analysis_session_id_spreadsheet_analysis_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."spreadsheet_analysis_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spreadsheet_analysis_jobs" ADD CONSTRAINT "spreadsheet_analysis_jobs_session_id_spreadsheet_analysis_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."spreadsheet_analysis_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spreadsheet_analysis_outputs" ADD CONSTRAINT "spreadsheet_analysis_outputs_session_id_spreadsheet_analysis_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."spreadsheet_analysis_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spreadsheet_analysis_sessions" ADD CONSTRAINT "spreadsheet_analysis_sessions_upload_id_spreadsheet_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."spreadsheet_uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spreadsheet_sheets" ADD CONSTRAINT "spreadsheet_sheets_upload_id_spreadsheet_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."spreadsheet_uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_artifacts" ADD CONSTRAINT "conversation_artifacts_state_id_conversation_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."conversation_states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_artifacts" ADD CONSTRAINT "conversation_artifacts_message_id_conversation_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_contexts" ADD CONSTRAINT "conversation_contexts_state_id_conversation_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."conversation_states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_images" ADD CONSTRAINT "conversation_images_state_id_conversation_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."conversation_states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_images" ADD CONSTRAINT "conversation_images_message_id_conversation_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_state_id_conversation_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."conversation_states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_chat_message_id_chat_messages_id_fk" FOREIGN KEY ("chat_message_id") REFERENCES "public"."chat_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_state_versions" ADD CONSTRAINT "conversation_state_versions_state_id_conversation_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."conversation_states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_states" ADD CONSTRAINT "conversation_states_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_states" ADD CONSTRAINT "conversation_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_facts" ADD CONSTRAINT "memory_facts_state_id_conversation_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."conversation_states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processed_requests" ADD CONSTRAINT "processed_requests_state_id_conversation_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."conversation_states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_telemetry" ADD CONSTRAINT "retrieval_telemetry_state_id_conversation_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."conversation_states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "running_summaries" ADD CONSTRAINT "running_summaries_state_id_conversation_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."conversation_states"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_logs_user_idx" ON "consent_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "magic_links_token_idx" ON "magic_links" USING btree ("token");--> statement-breakpoint
CREATE INDEX "magic_links_user_idx" ON "magic_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE INDEX "user_settings_user_id_idx" ON "user_settings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "admin_audit_logs_admin_idx" ON "admin_audit_logs" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "admin_audit_logs_action_idx" ON "admin_audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "admin_audit_logs_created_idx" ON "admin_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "admin_reports_type_idx" ON "admin_reports" USING btree ("type");--> statement-breakpoint
CREATE INDEX "admin_reports_status_idx" ON "admin_reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "admin_reports_generated_by_idx" ON "admin_reports" USING btree ("generated_by");--> statement-breakpoint
CREATE INDEX "ai_model_usage_user_idx" ON "ai_model_usage" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_model_usage_provider_idx" ON "ai_model_usage" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "ai_model_usage_created_idx" ON "ai_model_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_models_provider_idx" ON "ai_models" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "ai_models_model_type_idx" ON "ai_models" USING btree ("model_type");--> statement-breakpoint
CREATE INDEX "ai_models_status_idx" ON "ai_models" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ai_models_is_enabled_idx" ON "ai_models" USING btree ("is_enabled");--> statement-breakpoint
CREATE INDEX "analytics_events_user_idx" ON "analytics_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "analytics_events_event_idx" ON "analytics_events" USING btree ("event_name");--> statement-breakpoint
CREATE INDEX "analytics_events_created_idx" ON "analytics_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "analytics_events_user_created_idx" ON "analytics_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "api_logs_user_idx" ON "api_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_logs_endpoint_idx" ON "api_logs" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "api_logs_created_idx" ON "api_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "api_logs_status_idx" ON "api_logs" USING btree ("status_code");--> statement-breakpoint
CREATE INDEX "api_logs_provider_idx" ON "api_logs" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "api_logs_user_created_idx" ON "api_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_user_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "cost_budgets_provider_idx" ON "cost_budgets" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "generated_reports_status_idx" ON "generated_reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "generated_reports_created_idx" ON "generated_reports" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "invoices_user_idx" ON "invoices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ip_blocklist_ip_idx" ON "ip_blocklist" USING btree ("ip_address");--> statement-breakpoint
CREATE INDEX "ip_blocklist_expires_idx" ON "ip_blocklist" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "kpi_snapshots_created_idx" ON "kpi_snapshots" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notification_logs_user_idx" ON "notification_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notification_logs_event_idx" ON "notification_logs" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_logs_idempotency_idx" ON "notification_logs" USING btree ("event_id","channel");--> statement-breakpoint
CREATE INDEX "notification_prefs_user_idx" ON "notification_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_prefs_unique_idx" ON "notification_preferences" USING btree ("user_id","event_type_id");--> statement-breakpoint
CREATE INDEX "payments_user_idx" ON "payments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "provider_metrics_provider_idx" ON "provider_metrics" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "provider_metrics_window_idx" ON "provider_metrics" USING btree ("window_start","window_end");--> statement-breakpoint
CREATE INDEX "report_templates_type_idx" ON "report_templates" USING btree ("type");--> statement-breakpoint
CREATE INDEX "scheduled_reports_active_next_idx" ON "scheduled_reports" USING btree ("is_active","next_run_at");--> statement-breakpoint
CREATE INDEX "security_events_user_idx" ON "security_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "security_events_type_idx" ON "security_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "security_events_severity_idx" ON "security_events" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "security_events_created_idx" ON "security_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "security_policies_type_idx" ON "security_policies" USING btree ("policy_type");--> statement-breakpoint
CREATE INDEX "security_policies_enabled_idx" ON "security_policies" USING btree ("is_enabled");--> statement-breakpoint
CREATE INDEX "security_policies_applied_idx" ON "security_policies" USING btree ("applied_to");--> statement-breakpoint
CREATE INDEX "settings_category_idx" ON "settings_config" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "connector_usage_hourly_connector_bucket_idx" ON "connector_usage_hourly" USING btree ("connector","hour_bucket");--> statement-breakpoint
CREATE INDEX "connector_usage_hourly_connector_created_idx" ON "connector_usage_hourly" USING btree ("connector","created_at");--> statement-breakpoint
CREATE INDEX "gmail_oauth_user_idx" ON "gmail_oauth_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gmail_oauth_user_email_idx" ON "gmail_oauth_tokens" USING btree ("user_id","account_email");--> statement-breakpoint
CREATE INDEX "integration_accounts_user_id_idx" ON "integration_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "integration_accounts_provider_idx" ON "integration_accounts" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "integration_policies_user_id_idx" ON "integration_policies" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "pare_idempotency_key_idx" ON "pare_idempotency_keys" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "pare_idempotency_expires_idx" ON "pare_idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "shared_links_user_idx" ON "shared_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "shared_links_token_idx" ON "shared_links" USING btree ("token");--> statement-breakpoint
CREATE INDEX "shared_links_resource_idx" ON "shared_links" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "chat_messages_chat_idx" ON "chat_messages" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "chat_messages_request_idx" ON "chat_messages" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "chat_messages_status_idx" ON "chat_messages" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_messages_request_unique" ON "chat_messages" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "chat_messages_chat_created_idx" ON "chat_messages" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_messages_created_at_idx" ON "chat_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "chat_messages_search_idx" ON "chat_messages" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "chat_participants_chat_idx" ON "chat_participants" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "chat_participants_email_idx" ON "chat_participants" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_participants_unique_idx" ON "chat_participants" USING btree ("chat_id","email");--> statement-breakpoint
CREATE INDEX "chat_runs_chat_idx" ON "chat_runs" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "chat_runs_status_idx" ON "chat_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_runs_client_request_unique" ON "chat_runs" USING btree ("chat_id","client_request_id");--> statement-breakpoint
CREATE INDEX "chat_runs_chat_created_idx" ON "chat_runs" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_shares_chat_idx" ON "chat_shares" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "chat_shares_email_idx" ON "chat_shares" USING btree ("email");--> statement-breakpoint
CREATE INDEX "chat_shares_recipient_idx" ON "chat_shares" USING btree ("recipient_user_id");--> statement-breakpoint
CREATE INDEX "chats_user_idx" ON "chats" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chats_status_idx" ON "chats" USING btree ("conversation_status");--> statement-breakpoint
CREATE INDEX "chats_flag_idx" ON "chats" USING btree ("flag_status");--> statement-breakpoint
CREATE INDEX "chats_user_updated_idx" ON "chats" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "chats_user_archived_deleted_idx" ON "chats" USING btree ("user_id","archived","deleted_at");--> statement-breakpoint
CREATE INDEX "chats_updated_at_idx" ON "chats" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "offline_message_queue_user_idx" ON "offline_message_queue" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "offline_message_queue_status_idx" ON "offline_message_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "response_quality_metrics_run_idx" ON "response_quality_metrics" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "tool_invocations_run_idx" ON "tool_invocations" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_invocations_unique" ON "tool_invocations" USING btree ("run_id","tool_call_id");--> statement-breakpoint
CREATE INDEX "tool_invocations_run_created_idx" ON "tool_invocations" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "gpt_actions_gpt_idx" ON "gpt_actions" USING btree ("gpt_id");--> statement-breakpoint
CREATE INDEX "gpt_actions_type_idx" ON "gpt_actions" USING btree ("action_type");--> statement-breakpoint
CREATE INDEX "gpt_knowledge_gpt_idx" ON "gpt_knowledge" USING btree ("gpt_id");--> statement-breakpoint
CREATE INDEX "gpt_knowledge_status_idx" ON "gpt_knowledge" USING btree ("embedding_status");--> statement-breakpoint
CREATE INDEX "gpt_sessions_chat_idx" ON "gpt_sessions" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "gpt_sessions_gpt_idx" ON "gpt_sessions" USING btree ("gpt_id");--> statement-breakpoint
CREATE INDEX "gpt_versions_gpt_idx" ON "gpt_versions" USING btree ("gpt_id");--> statement-breakpoint
CREATE INDEX "gpts_category_idx" ON "gpts" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "gpts_creator_idx" ON "gpts" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "gpts_visibility_idx" ON "gpts" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "sidebar_pinned_gpts_user_idx" ON "sidebar_pinned_gpts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sidebar_pinned_gpts_gpt_idx" ON "sidebar_pinned_gpts" USING btree ("gpt_id");--> statement-breakpoint
CREATE INDEX "conversation_documents_chat_idx" ON "conversation_documents" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "conversation_documents_created_idx" ON "conversation_documents" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "file_chunks_file_id_idx" ON "file_chunks" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "file_chunks_embedding_idx" ON "file_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "file_jobs_file_id_idx" ON "file_jobs" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "file_jobs_status_idx" ON "file_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "files_user_created_idx" ON "files" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "files_user_id_idx" ON "files" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "files_status_idx" ON "files" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_assets_run_idx" ON "agent_assets" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "agent_context_thread_id_idx" ON "agent_context" USING btree ("thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_context_thread_unique" ON "agent_context" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "agent_gap_logs_status_idx" ON "agent_gap_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_gap_logs_created_idx" ON "agent_gap_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "agent_gap_logs_signature_idx" ON "agent_gap_logs" USING btree ("gap_signature");--> statement-breakpoint
CREATE INDEX "agent_memories_namespace_idx" ON "agent_memories" USING btree ("namespace");--> statement-breakpoint
CREATE INDEX "agent_memories_created_at_idx" ON "agent_memories" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "agent_memory_store_chat_key_idx" ON "agent_memory_store" USING btree ("chat_id","memory_key");--> statement-breakpoint
CREATE INDEX "agent_memory_store_user_idx" ON "agent_memory_store" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_memory_store_type_idx" ON "agent_memory_store" USING btree ("memory_type");--> statement-breakpoint
CREATE INDEX "agent_mode_events_run_idx" ON "agent_mode_events" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "agent_mode_events_correlation_idx" ON "agent_mode_events" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "agent_mode_events_type_idx" ON "agent_mode_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "agent_mode_events_timestamp_idx" ON "agent_mode_events" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "agent_mode_runs_chat_idx" ON "agent_mode_runs" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "agent_mode_runs_message_idx" ON "agent_mode_runs" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "agent_mode_runs_status_idx" ON "agent_mode_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_mode_runs_created_idx" ON "agent_mode_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "agent_mode_runs_idempotency_idx" ON "agent_mode_runs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "agent_mode_steps_run_idx" ON "agent_mode_steps" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "agent_mode_steps_status_idx" ON "agent_mode_steps" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_runs_conversation_idx" ON "agent_runs" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "agent_runs_status_idx" ON "agent_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_runs_conversation_started_idx" ON "agent_runs" USING btree ("conversation_id","started_at");--> statement-breakpoint
CREATE INDEX "agent_session_state_session_idx" ON "agent_session_state" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_session_state_unique" ON "agent_session_state" USING btree ("session_id","key");--> statement-breakpoint
CREATE INDEX "agent_steps_run_idx" ON "agent_steps" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "agent_steps_run_step_idx" ON "agent_steps" USING btree ("run_id","step_index");--> statement-breakpoint
CREATE INDEX "agent_workspaces_run_idx" ON "agent_workspaces" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "agent_workspaces_path_idx" ON "agent_workspaces" USING btree ("run_id","file_path");--> statement-breakpoint
CREATE INDEX "cached_pages_url_hash_idx" ON "cached_pages" USING btree ("url_hash");--> statement-breakpoint
CREATE INDEX "code_artifacts_run_idx" ON "code_interpreter_artifacts" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "code_runs_conversation_idx" ON "code_interpreter_runs" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "code_runs_user_idx" ON "code_interpreter_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "custom_skills_user_id_idx" ON "custom_skills" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "custom_skills_category_idx" ON "custom_skills" USING btree ("category");--> statement-breakpoint
CREATE INDEX "custom_skills_enabled_idx" ON "custom_skills" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "request_spec_history_chat_created_idx" ON "request_spec_history" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "request_spec_history_run_idx" ON "request_spec_history" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "request_spec_history_intent_idx" ON "request_spec_history" USING btree ("intent");--> statement-breakpoint
CREATE INDEX "tool_call_logs_user_id_idx" ON "tool_call_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tool_call_logs_tool_id_idx" ON "tool_call_logs" USING btree ("tool_id");--> statement-breakpoint
CREATE INDEX "tool_call_logs_created_at_idx" ON "tool_call_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "tool_call_logs_run_created_idx" ON "tool_call_logs" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_message_analysis_message_idx" ON "chat_message_analysis" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "chat_message_analysis_upload_idx" ON "chat_message_analysis" USING btree ("upload_id");--> statement-breakpoint
CREATE INDEX "chat_message_analysis_session_idx" ON "chat_message_analysis" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "company_knowledge_user_idx" ON "company_knowledge" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "excel_documents_uuid_idx" ON "excel_documents" USING btree ("uuid");--> statement-breakpoint
CREATE INDEX "excel_documents_created_idx" ON "excel_documents" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "library_activity_user_idx" ON "library_activity" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "library_activity_file_idx" ON "library_activity" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "library_activity_created_idx" ON "library_activity" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "library_collections_user_idx" ON "library_collections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "library_file_collections_file_idx" ON "library_file_collections" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "library_file_collections_collection_idx" ON "library_file_collections" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "library_files_user_idx" ON "library_files" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "library_files_type_idx" ON "library_files" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "library_files_folder_idx" ON "library_files" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "library_files_created_idx" ON "library_files" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "library_folders_user_idx" ON "library_folders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "library_folders_parent_idx" ON "library_folders" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "library_items_user_idx" ON "library_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "library_items_type_idx" ON "library_items" USING btree ("user_id","media_type");--> statement-breakpoint
CREATE INDEX "library_storage_user_idx" ON "library_storage" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "spreadsheet_analysis_jobs_session_idx" ON "spreadsheet_analysis_jobs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "spreadsheet_analysis_jobs_status_idx" ON "spreadsheet_analysis_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "spreadsheet_outputs_session_idx" ON "spreadsheet_analysis_outputs" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "spreadsheet_analysis_user_idx" ON "spreadsheet_analysis_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "spreadsheet_analysis_upload_idx" ON "spreadsheet_analysis_sessions" USING btree ("upload_id");--> statement-breakpoint
CREATE INDEX "spreadsheet_analysis_status_idx" ON "spreadsheet_analysis_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "spreadsheet_sheets_upload_idx" ON "spreadsheet_sheets" USING btree ("upload_id");--> statement-breakpoint
CREATE INDEX "spreadsheet_uploads_user_idx" ON "spreadsheet_uploads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "spreadsheet_uploads_status_idx" ON "spreadsheet_uploads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "conversation_artifacts_state_idx" ON "conversation_artifacts" USING btree ("state_id");--> statement-breakpoint
CREATE INDEX "conversation_artifacts_message_idx" ON "conversation_artifacts" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "conversation_artifacts_type_idx" ON "conversation_artifacts" USING btree ("artifact_type");--> statement-breakpoint
CREATE INDEX "conversation_artifacts_checksum_idx" ON "conversation_artifacts" USING btree ("checksum");--> statement-breakpoint
CREATE INDEX "conversation_contexts_state_idx" ON "conversation_contexts" USING btree ("state_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_contexts_state_unique" ON "conversation_contexts" USING btree ("state_id");--> statement-breakpoint
CREATE INDEX "conversation_images_state_idx" ON "conversation_images" USING btree ("state_id");--> statement-breakpoint
CREATE INDEX "conversation_images_message_idx" ON "conversation_images" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "conversation_images_parent_idx" ON "conversation_images" USING btree ("parent_image_id");--> statement-breakpoint
CREATE INDEX "conversation_images_latest_idx" ON "conversation_images" USING btree ("state_id","is_latest");--> statement-breakpoint
CREATE INDEX "conversation_messages_state_idx" ON "conversation_messages" USING btree ("state_id");--> statement-breakpoint
CREATE INDEX "conversation_messages_sequence_idx" ON "conversation_messages" USING btree ("state_id","sequence");--> statement-breakpoint
CREATE INDEX "conversation_messages_created_idx" ON "conversation_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "conversation_versions_state_idx" ON "conversation_state_versions" USING btree ("state_id");--> statement-breakpoint
CREATE INDEX "conversation_versions_version_idx" ON "conversation_state_versions" USING btree ("state_id","version");--> statement-breakpoint
CREATE INDEX "conversation_states_chat_idx" ON "conversation_states" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "conversation_states_user_idx" ON "conversation_states" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "conversation_states_version_idx" ON "conversation_states" USING btree ("chat_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_states_chat_unique" ON "conversation_states" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "memory_facts_state_idx" ON "memory_facts" USING btree ("state_id");--> statement-breakpoint
CREATE INDEX "memory_facts_type_idx" ON "memory_facts" USING btree ("fact_type");--> statement-breakpoint
CREATE INDEX "processed_requests_request_idx" ON "processed_requests" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "processed_requests_state_idx" ON "processed_requests" USING btree ("state_id");--> statement-breakpoint
CREATE INDEX "retrieval_telemetry_state_idx" ON "retrieval_telemetry" USING btree ("state_id");--> statement-breakpoint
CREATE INDEX "retrieval_telemetry_request_idx" ON "retrieval_telemetry" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "retrieval_telemetry_created_idx" ON "retrieval_telemetry" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "running_summaries_state_idx" ON "running_summaries" USING btree ("state_id");