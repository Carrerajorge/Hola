CREATE TABLE IF NOT EXISTS "chat_runs" (
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
CREATE TABLE IF NOT EXISTS "tool_invocations" (
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
DO $$ BEGIN
 ALTER TABLE "chat_runs" ADD CONSTRAINT "chat_runs_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_run_id_chat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."chat_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_runs_chat_idx" ON "chat_runs" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_runs_status_idx" ON "chat_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chat_runs_client_request_unique" ON "chat_runs" USING btree ("chat_id","client_request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_runs_chat_created_idx" ON "chat_runs" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_invocations_run_idx" ON "tool_invocations" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tool_invocations_unique" ON "tool_invocations" USING btree ("run_id","tool_call_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_invocations_run_created_idx" ON "tool_invocations" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_invocations_tool_name_idx" ON "tool_invocations" USING btree ("tool_name");
