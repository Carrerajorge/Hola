import dotenv from "dotenv";
import { Client } from "pg";

dotenv.config();

const statements = [
  'ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "name" text;',
  'ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "provider" text;',
  'ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "model_id" text;',
  'ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "status" text DEFAULT \'active\';',
  'ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "cost_per_1k" text DEFAULT \'0.00\';',
  'ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "usage_percent" integer DEFAULT 0;',
  'ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "description" text;',
  'ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "capabilities" jsonb;',
  'ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "model_type" text DEFAULT \'TEXT\';',
  'ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "context_window" integer;',
  'ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "max_output_tokens" integer;',
  'ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "input_cost_per_1k" text DEFAULT \'0.00\';',
  'ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "output_cost_per_1k" text DEFAULT \'0.00\';',
  'ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "last_sync_at" timestamp;',
  'ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "last_synced_at" timestamp;',
  'ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "is_deprecated" text DEFAULT \'false\';',
  'ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "release_date" text;',
  'ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "is_enabled" text DEFAULT \'false\';',
  'ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "enabled_at" timestamp;',
  'ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "enabled_by_admin_id" varchar;',
  'ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "display_order" integer DEFAULT 0;',
  'ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "icon" text;',
  'ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now();',
];

const indexStatements = [
  'CREATE INDEX IF NOT EXISTS "ai_models_provider_idx" ON "ai_models" ("provider");',
  'CREATE INDEX IF NOT EXISTS "ai_models_model_type_idx" ON "ai_models" ("model_type");',
  'CREATE INDEX IF NOT EXISTS "ai_models_status_idx" ON "ai_models" ("status");',
  'CREATE INDEX IF NOT EXISTS "ai_models_is_enabled_idx" ON "ai_models" ("is_enabled");',
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
    for (const stmt of indexStatements) {
      await client.query(stmt);
    }
    console.log("ai_models columns synced with schema.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Failed to update ai_models table:", error);
  process.exit(1);
});
