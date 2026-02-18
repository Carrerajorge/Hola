-- Split Reply Modes: auto_reply_configs + thread_auto_reply_overrides
-- (A) Owner Assist — always ON, cannot be disabled
-- (B) Auto-Reply — scope-based toggle with per-thread overrides

CREATE TABLE IF NOT EXISTS "auto_reply_configs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"channel" text NOT NULL,
	"channel_account_id" text,
	"owner_assist_enabled" boolean DEFAULT true NOT NULL,
	"auto_reply_scope" text DEFAULT 'OWNER_ONLY' NOT NULL,
	"allowlist" jsonb DEFAULT '[]'::jsonb,
	"allow_groups" boolean DEFAULT false NOT NULL,
	"version" text DEFAULT '1' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "thread_auto_reply_overrides" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"channel" text NOT NULL,
	"thread_id" text NOT NULL,
	"auto_reply_enabled" boolean NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auto_reply_configs_user_channel_unique" ON "auto_reply_configs" USING btree ("user_id","channel");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auto_reply_configs_user_idx" ON "auto_reply_configs" USING btree ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "thread_overrides_user_channel_thread_unique" ON "thread_auto_reply_overrides" USING btree ("user_id","channel","thread_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thread_overrides_user_idx" ON "thread_auto_reply_overrides" USING btree ("user_id");
