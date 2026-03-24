import { describe, expect, it } from "vitest";
import { OpenClawRuntimeAdapter } from "../../runtime/adapters/OpenClawRuntimeAdapter";

describe("AgentRuntime contract skeleton", () => {
  it("has health", async () => {
    const runtime = new OpenClawRuntimeAdapter();
    const health = await runtime.health();
    expect(health.engine).toBe("openclaw-native");
  });
});
