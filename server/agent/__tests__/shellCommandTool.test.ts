import { describe, it, expect } from "vitest";
import { toolRegistry } from "../toolRegistry";

// NOTE: this test only validates confirmation gating and basic execution.
// It does not assert streaming behavior (which is best-effort and event-based).

describe("shell_command tool", () => {
  it("should require confirmation for dangerous commands", async () => {
    const res = await toolRegistry.execute(
      "shell_command",
      { command: "rm -rf /tmp/agent-workspace/test", timeout: 2000 },
      {
        userId: "u1",
        chatId: "c1",
        runId: "run-test",
        userPlan: "admin",
        isConfirmed: false,
      }
    );

    expect(res.success).toBe(false);
    expect(res.error?.code).toBe("REQUIRES_CONFIRMATION");
  });

  it("should execute a safe command", async () => {
    const res = await toolRegistry.execute(
      "shell_command",
      { command: "echo hello", timeout: 5000 },
      {
        userId: "u1",
        chatId: "c1",
        runId: "run-test-2",
        userPlan: "admin",
        isConfirmed: true,
      }
    );

    expect(res.output?.stdout).toContain("hello");
    expect(res.output?.exitCode).toBe(0);
  });
});
