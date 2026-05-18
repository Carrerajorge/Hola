import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
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

function tryCreateDir(dirPath: string): boolean {
  try {
    mkdirSync(dirPath, { recursive: true, mode: 0o700 });
    return existsSync(dirPath);
  } catch {
    return false;
  }
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

  const stateDir = resolveStateDir();
  const agentDir = path.join(
    stateDir,
    "iliagpt-users",
    `${safeUserSegment}-${hash}`,
    "agent",
  );

  if (tryCreateDir(agentDir)) {
    return agentDir;
  }

  // Fallback: try process.cwd()-based path if home dir isn't writable
  const fallbackDir = path.join(
    process.cwd(),
    ".openclaw",
    "iliagpt-users",
    `${safeUserSegment}-${hash}`,
    "agent",
  );

  if (fallbackDir !== agentDir && tryCreateDir(fallbackDir)) {
    console.warn(
      "[userScopedAgentDir] Primary path failed, using fallback:",
      fallbackDir,
    );
    return fallbackDir;
  }

  // Last resort: use /tmp
  const tmpDir = path.join(
    "/tmp",
    "iliagpt-state",
    "iliagpt-users",
    `${safeUserSegment}-${hash}`,
    "agent",
  );

  if (tryCreateDir(tmpDir)) {
    console.warn(
      "[userScopedAgentDir] Using /tmp fallback:",
      tmpDir,
    );
    return tmpDir;
  }

  console.error(
    "[userScopedAgentDir] All directory creation attempts failed for user:",
    normalizedUserId.slice(0, 20),
  );
  return undefined;
}
