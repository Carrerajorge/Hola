import pg from "pg";

/**
 * Ensures required Postgres extensions exist in the target DATABASE_URL.
 *
 * Why:
 * - Drizzle migrations can reference types provided by extensions (e.g. pgvector).
 * - CI/prod frequently start from a fresh database.
 */
const REQUIRED_EXTENSIONS = ["vector", "pgcrypto"];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");

  const { Client } = pg;
  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    for (const ext of REQUIRED_EXTENSIONS) {
      // Extension names are identifiers; still keep them on an allowlist.
      await client.query(`CREATE EXTENSION IF NOT EXISTS ${ext};`);
      console.log(`[db] ensured extension: ${ext}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
