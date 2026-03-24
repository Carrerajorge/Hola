import { describe, expect, it } from "vitest";
import { UnifiedAgentRuntime } from "../../runtime/unifiedAgentRuntime";

describe("UnifiedAgentRuntime", () => {
  it("returns facade health", async () => {
    const runtime = new UnifiedAgentRuntime();
    const health = await runtime.health();
    expect(health.status).toBe("healthy");
    expect(health.details?.facade).toBe("UnifiedAgentRuntime");
  });
});
