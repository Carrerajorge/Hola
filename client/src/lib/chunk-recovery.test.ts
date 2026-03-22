import { describe, expect, it } from "vitest";

import {
  APP_VERSION_STORAGE_KEY,
  CHUNK_RELOAD_VERSION_KEY,
  isChunkLoadError,
  normalizeAppBuildVersion,
  recoverFromChunkError,
  shouldAttemptChunkRecovery,
} from "@/lib/chunk-recovery";

function createStorage(seed?: Record<string, string>): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map(Object.entries(seed ?? {}));

  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe("chunk recovery helpers", () => {
  it("detects dynamic import chunk failures", () => {
    expect(isChunkLoadError(new Error("Failed to fetch dynamically imported module"))).toBe(true);
    expect(isChunkLoadError("Loading chunk 4 failed.")).toBe(true);
    expect(isChunkLoadError(new Error("Regular API failure"))).toBe(false);
  });

  it("normalizes blank versions to dev", () => {
    expect(normalizeAppBuildVersion("  ")).toBe("dev");
    expect(normalizeAppBuildVersion(undefined)).toBe("dev");
    expect(normalizeAppBuildVersion("15a89375")).toBe("15a89375");
  });

  it("allows one recovery attempt per build version", () => {
    const storage = createStorage();
    const error = new Error("Failed to fetch dynamically imported module");

    expect(shouldAttemptChunkRecovery(error, "15a89375", storage)).toBe(true);
    expect(storage.getItem(CHUNK_RELOAD_VERSION_KEY)).toBe("15a89375");
    expect(shouldAttemptChunkRecovery(error, "15a89375", storage)).toBe(false);
  });

  it("allows recovery again after a new deploy version", () => {
    const storage = createStorage({
      [CHUNK_RELOAD_VERSION_KEY]: "15a89375",
    });
    const error = new Error("Importing a module script failed");

    expect(shouldAttemptChunkRecovery(error, "24860974", storage)).toBe(true);
    expect(storage.getItem(CHUNK_RELOAD_VERSION_KEY)).toBe("24860974");
  });

  it("clears service workers and caches before reloading on chunk errors", async () => {
    const sessionStorage = createStorage();
    const localStorage = createStorage();
    const deletedCaches: string[] = [];
    let unregisterCalls = 0;
    let reloadCalls = 0;

    const recovered = await recoverFromChunkError(
      new Error("Importing a module script failed"),
      "24860974",
      {
        sessionStorage,
        localStorage,
        getRegistrations: async () => [
          {
            unregister: async () => {
              unregisterCalls += 1;
              return true;
            },
          },
        ],
        getCacheNames: async () => ["v1", "v2"],
        deleteCache: async (cacheName) => {
          deletedCaches.push(cacheName);
          return true;
        },
        reload: () => {
          reloadCalls += 1;
        },
      },
    );

    expect(recovered).toBe(true);
    expect(sessionStorage.getItem(CHUNK_RELOAD_VERSION_KEY)).toBe("24860974");
    expect(localStorage.getItem(APP_VERSION_STORAGE_KEY)).toBe("24860974");
    expect(unregisterCalls).toBe(1);
    expect(deletedCaches).toEqual(["v1", "v2"]);
    expect(reloadCalls).toBe(1);
  });

  it("prevents duplicate recovery attempts for the same build version", async () => {
    const sessionStorage = createStorage();
    let reloadCalls = 0;

    const first = await recoverFromChunkError(new Error("Loading chunk 4 failed"), "24860974", {
      sessionStorage,
      localStorage: createStorage(),
      reload: () => {
        reloadCalls += 1;
      },
    });

    const second = await recoverFromChunkError(new Error("Loading chunk 4 failed"), "24860974", {
      sessionStorage,
      localStorage: createStorage(),
      reload: () => {
        reloadCalls += 1;
      },
    });

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(reloadCalls).toBe(1);
  });
});
