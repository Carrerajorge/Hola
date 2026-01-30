import dotenv from "dotenv";
import path from "path";

// Load .env.production first in production, then .env as fallback.
// dotenv.config() does NOT override already-set variables, so the
// more specific file takes precedence when both exist.
//
// This file MUST be imported as a side-effect import BEFORE any module
// that reads process.env (e.g., env.ts). In ESM, import statements are
// hoisted and evaluated in order — module body code runs AFTER all
// imports are resolved. A side-effect import ensures this runs during
// module evaluation, not in the body.
if (process.env.NODE_ENV === "production") {
  dotenv.config({ path: path.resolve(process.cwd(), ".env.production") });
}
dotenv.config();
