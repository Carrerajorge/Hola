import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load .env.production first (VPS), then .env as fallback (local dev)
dotenv.config({ path: ".env.production" });
dotenv.config(); // .env fallback — does not override already-set vars

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
