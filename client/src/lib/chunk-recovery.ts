const CHUNK_ERROR_PATTERN =
  /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|Unable to load/i;

export const CHUNK_RELOAD_VERSION_KEY = "iliagpt_chunk_reload_version";
export const APP_VERSION_STORAGE_KEY = "iliagpt_app_version";

type RecoveryStorage = Pick<Storage, "getItem" | "setItem"> | null;

type ChunkRecoveryRuntime = {
  sessionStorage?: RecoveryStorage;
  localStorage?: Pick<Storage, "setItem"> | null;
  getRegistrations?: (() => Promise<Array<Pick<ServiceWorkerRegistration, "unregister">>>) | null;
  getCacheNames?: (() => Promise<string[]>) | null;
  deleteCache?: ((name: string) => Promise<boolean>) | null;
  reload?: (() => void) | null;
};

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
  storage: RecoveryStorage =
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

function createBrowserChunkRecoveryRuntime(): ChunkRecoveryRuntime {
  const browserWindow = typeof window !== "undefined" ? window : null;
  const browserNavigator = typeof navigator !== "undefined" ? navigator : null;

  return {
    sessionStorage: typeof sessionStorage !== "undefined" ? sessionStorage : null,
    localStorage: typeof localStorage !== "undefined" ? localStorage : null,
    getRegistrations:
      browserNavigator && "serviceWorker" in browserNavigator
        ? () => browserNavigator.serviceWorker.getRegistrations()
        : null,
    getCacheNames:
      browserWindow && "caches" in browserWindow
        ? () => caches.keys()
        : null,
    deleteCache:
      browserWindow && "caches" in browserWindow
        ? (name: string) => caches.delete(name)
        : null,
    reload: browserWindow ? () => browserWindow.location.reload() : null,
  };
}

export async function recoverFromChunkError(
  err: unknown,
  version: string,
  runtime: ChunkRecoveryRuntime = createBrowserChunkRecoveryRuntime(),
): Promise<boolean> {
  if (!shouldAttemptChunkRecovery(err, version, runtime.sessionStorage ?? null)) {
    return false;
  }

  const normalizedVersion = normalizeAppBuildVersion(version);

  try {
    runtime.localStorage?.setItem(APP_VERSION_STORAGE_KEY, normalizedVersion);
  } catch {
    // Storage failures should not block recovery.
  }

  try {
    const registrations = await runtime.getRegistrations?.();
    if (registrations?.length) {
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
  } catch {
    // Best-effort cleanup. Reloading still gives the app a chance to recover.
  }

  try {
    const cacheNames = await runtime.getCacheNames?.();
    if (cacheNames?.length) {
      await Promise.all(
        cacheNames.map((cacheName) => runtime.deleteCache?.(cacheName) ?? Promise.resolve(false)),
      );
    }
  } catch {
    // Best-effort cleanup. Reloading still gives the app a chance to recover.
  }

  runtime.reload?.();
  return true;
}
