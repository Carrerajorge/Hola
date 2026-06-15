// Migrations only need DATABASE_URL; seed env vars that the shared env
// validator requires but that are irrelevant for schema migrations so the
// migrate binary can run in minimal-env contexts (e.g. Docker deploy step
// where only DATABASE_URL is injected via docker-compose).
if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = "migration-only-placeholder-not-for-runtime-use";
}
if (!process.env.ADMIN_EMAIL) {
  process.env.ADMIN_EMAIL = "migration@placeholder.local";
}
if (!process.env.ADMIN_PASSWORD) {
  process.env.ADMIN_PASSWORD = "migration-placeholder-not-for-runtime";
}

import { drainConnections, runMigrations } from "./db";

async function main(): Promise<void> {
  try {
    console.log("[migrate] Running database migrations...");
    await runMigrations();
    console.log("[migrate] Migrations completed successfully");
  } finally {
    await drainConnections();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[migrate] Migration failed:", error);
    process.exit(1);
  });
