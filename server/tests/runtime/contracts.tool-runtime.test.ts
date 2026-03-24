import { describe, expect, it } from "vitest";
import { ToolExecutionAdapter } from "../../runtime/adapters/ToolExecutionAdapter";

describe("ToolRuntime contract skeleton", () => {
  it("has health", async () => {
    const runtime = new ToolExecutionAdapter();
    const health = await runtime.health();
    expect(health.engine).toBe("tool-execution");
  });
});
