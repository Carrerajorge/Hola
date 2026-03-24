import { describe, expect, it } from "vitest";
import { UnifiedToolRuntime } from "../../runtime/unifiedToolRuntime";

describe("UnifiedToolRuntime", () => {
  it("returns facade health", async () => {
    const runtime = new UnifiedToolRuntime();
    const health = await runtime.health();
    expect(health.status).toBe("healthy");
    expect(health.details?.facade).toBe("UnifiedToolRuntime");
  });
});
