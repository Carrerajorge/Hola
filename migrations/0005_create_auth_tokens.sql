-- Create auth_tokens table used by server/lib/auth/tokenManager.ts
-- Idempotent to allow safe re-runs across environments.

CREATE TABLE IF NOT EXISTS "auth_tokens" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" varchar NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade,
  "provider" varchar(50) NOT NULL,
  "access_token" text NOT NULL,
  "refresh_token" text,
  "expires_at" bigint,
  "scope" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "auth_tokens_user_provider_idx"
  ON "auth_tokens" USING btree ("user_id","provider");

CREATE UNIQUE INDEX IF NOT EXISTS "auth_tokens_unique_user_provider"
  ON "auth_tokens" USING btree ("user_id","provider");

