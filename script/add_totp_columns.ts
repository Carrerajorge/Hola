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
    await client.query('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_secret" text;');
    await client.query('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_enabled" boolean DEFAULT false;');
    console.log("Added TOTP columns (or they already existed)." );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Failed to add TOTP columns:", error);
  process.exit(1);
});
