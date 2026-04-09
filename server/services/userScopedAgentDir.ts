import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { resolveStateDir } from "./superIntelligence/config/paths.js";

function normalizeUserSegment(value: string): string {
  const safe = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return safe.slice(0, 48) || "user";
}

export function resolveUserScopedAgentDir(
  userId: string | null | undefined,
): string | undefined {
  const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
  if (!normalizedUserId) {
    return undefined;
  }

  const hash = createHash("sha256")
    .update(normalizedUserId)
    .digest("hex")
    .slice(0, 16);
  const safeUserSegment = normalizeUserSegment(normalizedUserId);

  const agentDir = path.join(
    resolveStateDir(),
    "iliagpt-users",
    `${safeUserSegment}-${hash}`,
    "agent",
  );

  // Ensure the directory exists so auth-profiles and other state files
  // can be written without ENOENT errors during credential persistence.
  try {
    mkdirSync(agentDir, { recursive: true });
  } catch {
    // Best-effort: if we can't create the dir, the caller will handle the error.
  }

  return agentDir;
}
