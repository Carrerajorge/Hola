import dotenv from "dotenv";
import { Client } from "pg";

dotenv.config();

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "ai_models" (
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
        "last_synced_at" timestamp,
        "is_deprecated" text DEFAULT 'false',
        "release_date" text,
        "is_enabled" text DEFAULT 'false',
        "enabled_at" timestamp,
        "enabled_by_admin_id" varchar,
        "display_order" integer DEFAULT 0,
        "icon" text,
        "created_at" timestamp DEFAULT now() NOT NULL
      );
    `);

    await client.query('CREATE INDEX IF NOT EXISTS "ai_models_provider_idx" ON "ai_models" ("provider");');
    await client.query('CREATE INDEX IF NOT EXISTS "ai_models_model_type_idx" ON "ai_models" ("model_type");');
    await client.query('CREATE INDEX IF NOT EXISTS "ai_models_status_idx" ON "ai_models" ("status");');
    await client.query('CREATE INDEX IF NOT EXISTS "ai_models_is_enabled_idx" ON "ai_models" ("is_enabled");');

    console.log("ai_models table ensured.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Failed to create ai_models table:", error);
  process.exit(1);
});
