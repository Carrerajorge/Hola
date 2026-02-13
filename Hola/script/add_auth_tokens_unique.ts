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
    await client.query(`DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'auth_tokens_unique_user_provider'
        ) THEN
          ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_unique_user_provider" UNIQUE ("user_id", "provider");
        END IF;
      END $$;`);
    console.log("auth_tokens unique constraint ensured.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Failed to ensure auth_tokens unique constraint:", error);
  process.exit(1);
});
