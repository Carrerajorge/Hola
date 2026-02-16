import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

import pg from "pg";

const { Client } = pg;

function splitStatements(sql) {
  // Drizzle-style SQL files often include this marker to preserve statement boundaries.
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => {
      if (!s) return false;
      // Avoid "empty query" when a chunk is only comments.
      const meaningful = s.replace(/--.*$/gm, "").trim();
      return meaningful.length > 0;
    });
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const sslMode =
    (process.env.PGSSLMODE || "").toLowerCase() ||
    (databaseUrl.includes("sslmode=require") ? "require" : "");
  const ssl =
    sslMode === "require" || sslMode === "verify-full" || sslMode === "verify-ca"
      ? { rejectUnauthorized: false }
      : undefined;

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.resolve(__dirname, "..");

  // Apply safe, idempotent SQL patches that drizzle-kit push does NOT manage well
  // (e.g., triggers, backfills, conditional FK additions).
  //
  // IMPORTANT: Do not add non-idempotent files here (e.g., initial migrations with CREATE TABLE ...)
  // because this script runs on every deploy.
  const sqlFiles = [
    "0005_session_user_tracking.sql",
    "0006_agent_gap_logs_user_id.sql",
  ];

  const fileStatements = [];
  for (const file of sqlFiles) {
    const sqlPath = path.join(repoRoot, "migrations", file);
    const sqlRaw = await readFile(sqlPath, "utf8");
    const statements = splitStatements(sqlRaw);
    if (statements.length > 0) {
      fileStatements.push({ file, statements });
    }
  }

  const totalStatements = fileStatements.reduce((sum, f) => sum + f.statements.length, 0);
  if (totalStatements === 0) {
    console.log("[db-post-push] No SQL statements to apply");
    return;
  }

  const client = new Client({ connectionString: databaseUrl, ssl });
  await client.connect();

  try {
    await client.query("BEGIN");
    for (const { file, statements } of fileStatements) {
      for (const stmt of statements) {
        await client.query(stmt);
      }
      console.log(`[db-post-push] Applied ${statements.length} statements from ${file}`);
    }
    await client.query("COMMIT");
    console.log(`[db-post-push] Completed (${totalStatements} total statements)`);
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failure
    }
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[db-post-push] Failed:", err?.message || err);
  process.exitCode = 1;
});
