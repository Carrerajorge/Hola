import dotenv from "dotenv";
import { Client } from "pg";

dotenv.config();

const statements = [
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "full_name" varchar;',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "profile_image_url" varchar;',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone" varchar;',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "company" varchar;',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "status" text DEFAULT \'active\';',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tokens_consumed" integer DEFAULT 0;',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tokens_limit" integer DEFAULT 100000;',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "credits_balance" integer DEFAULT 0;',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_login_at" timestamp;',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_ip" varchar;',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "user_agent" text;',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "country_code" varchar(2);',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "auth_provider" text DEFAULT \'email\';',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_2fa_enabled" text DEFAULT \'false\';',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified" text DEFAULT \'false\';',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referral_code" varchar;',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referred_by" varchar;',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "internal_notes" text;',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tags" text[];',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "subscription_expires_at" timestamp;',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "daily_requests_used" integer DEFAULT 0;',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "daily_requests_limit" integer DEFAULT 3;',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "daily_requests_reset_at" timestamp;',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "stripe_customer_id" text;',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "stripe_subscription_id" text;',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_secret" text;',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_enabled" boolean DEFAULT false;',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "login_count" integer DEFAULT 0;',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "subscription_status" text;',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "subscription_plan" text;',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "subscription_period_end" timestamp;',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "monthly_token_limit" integer;',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "monthly_tokens_used" integer;',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tokens_reset_at" timestamp;',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "preferences" jsonb;',
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;',
  // Ensure email is unique if not already
  `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'users_email_unique'
    ) THEN
      ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE ("email");
    END IF;
  END $$;`
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    for (const stmt of statements) {
      await client.query(stmt);
    }
    console.log("User table columns synced with schema.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Failed to update users table:", error);
  process.exit(1);
});
