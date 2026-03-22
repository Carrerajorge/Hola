-- Multi-provider OAuth token tables for global (admin) and per-user tokens
-- Tokens are AES-256-GCM encrypted at rest

CREATE TABLE IF NOT EXISTS "oauth_tokens_global" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider" varchar(50) NOT NULL,
  "access_token" text NOT NULL,
  "refresh_token" text,
  "expires_at" bigint,
  "scope" text,
  "label" text,
  "models" text,
  "added_by_user_id" varchar NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "oauth_tokens_global_provider_unique"
  ON "oauth_tokens_global"("provider");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "oauth_tokens_user" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "provider" varchar(50) NOT NULL,
  "access_token" text NOT NULL,
  "refresh_token" text,
  "expires_at" bigint,
  "scope" text,
  "models" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "oauth_tokens_user_unique_user_provider"
  ON "oauth_tokens_user"("user_id", "provider");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "oauth_tokens_user_user_idx"
  ON "oauth_tokens_user"("user_id");--> statement-breakpoint
