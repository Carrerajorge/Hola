import dotenv from "dotenv";
import fs from "fs";
import path from "path";

let loaded = false;

/**
 * Load environment variables from local dotenv files with predictable precedence.
 *
 * Why this exists:
 * - This codebase runs as ESM ("type": "module"). Static imports are hoisted, so
 *   loading dotenv in an entrypoint _before_ importing other modules is not reliable.
 * - `server/config/env.ts` must load dotenv _inside_ the module that validates env.
 */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;

  const cwd = process.cwd();
  const nodeEnv = process.env.NODE_ENV || "development";

  // Highest priority first (dotenv does not override existing variables by default).
  const candidates = [
    nodeEnv === "production" ? path.resolve(cwd, ".env.production") : null,
    path.resolve(cwd, ".env.local"),
    path.resolve(cwd, ".env"),
  ].filter((p): p is string => Boolean(p));

  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    dotenv.config({ path: p, quiet: true });
  }
}

