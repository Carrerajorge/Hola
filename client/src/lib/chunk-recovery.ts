const CHUNK_ERROR_PATTERN =
  /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|Unable to load/i;

export const CHUNK_RELOAD_VERSION_KEY = "iliagpt_chunk_reload_version";

export function normalizeAppBuildVersion(version?: string | null): string {
  if (typeof version !== "string") return "dev";
  const trimmed = version.trim();
  return trimmed.length > 0 ? trimmed : "dev";
}

export function isChunkLoadError(err: unknown): boolean {
  const message =
    typeof err === "string"
      ? err
      : err && typeof err === "object" && "message" in err
        ? String((err as { message?: unknown }).message ?? "")
        : "";

  return CHUNK_ERROR_PATTERN.test(message);
}

export function shouldAttemptChunkRecovery(
  err: unknown,
  version: string,
  storage: Pick<Storage, "getItem" | "setItem"> | null =
    typeof sessionStorage !== "undefined" ? sessionStorage : null,
): boolean {
  if (!isChunkLoadError(err)) {
    return false;
  }

  const normalizedVersion = normalizeAppBuildVersion(version);

  try {
    if (storage?.getItem(CHUNK_RELOAD_VERSION_KEY) === normalizedVersion) {
      return false;
    }
    storage?.setItem(CHUNK_RELOAD_VERSION_KEY, normalizedVersion);
  } catch {
    // Storage failures should not block recovery.
  }

  return true;
}
