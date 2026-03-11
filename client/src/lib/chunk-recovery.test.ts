import { describe, expect, it } from "vitest";

import {
  CHUNK_RELOAD_VERSION_KEY,
  isChunkLoadError,
  normalizeAppBuildVersion,
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
});
