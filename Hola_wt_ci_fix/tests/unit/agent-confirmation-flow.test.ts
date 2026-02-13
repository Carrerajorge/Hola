import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../server/db", () => {
  const chain = {
    set: () => ({ where: async () => ({}) }),
  };
  return {
    db: {
      update: () => chain,
    },
  };
});

const toolExecuteMock = vi.fn();
vi.mock("../../server/agent/toolRegistry", () => ({
  toolRegistry: {
    execute: (...args: any[]) => toolExecuteMock(...args),
  },
}));

import { AgentOrchestrator } from "../../server/agent/agentOrchestrator";

function minimalPlan() {
  return {
    objective: "send an email",
    estimatedTime: "1m",
    steps: [
      {
        index: 0,
        toolName: "gmail_send",
        description: "Send an email",
        input: { to: "a@b.com", subject: "Hi", body: "Test" },
        expectedOutput: "Email sent",
      },
    ],
  };
}

describe("AgentOrchestrator confirmation workflow", () => {
  beforeEach(() => {
    toolExecuteMock.mockReset();
  });

  it("pauses run and persists pending confirmation when tool returns REQUIRES_CONFIRMATION", async () => {
    toolExecuteMock.mockResolvedValue({
      success: false,
      output: null,
      error: { code: "REQUIRES_CONFIRMATION", message: "Need explicit confirmation", retryable: false },
      artifacts: [],
      previews: [],
      logs: [],
    });

    const orch = new AgentOrchestrator("run-1", "chat-1", "user-1", "pro");
    orch.plan = minimalPlan() as any;

    // Avoid external side effects
    (orch as any).emitTraceEvent = vi.fn().mockResolvedValue(undefined);
    (orch as any).generateSummary = vi.fn().mockResolvedValue("summary");
    (orch as any).verifyStepResult = vi.fn().mockResolvedValue({ success: true });

    await orch.run();

    expect(orch.status).toBe("awaiting_confirmation");
    const pending = orch.getPendingConfirmation();
    expect(pending).toBeTruthy();
    expect(pending?.toolName).toBe("gmail_send");
    expect(pending?.stepIndex).toBe(0);
  });

  it("after confirm, re-runs the pending step with isConfirmed=true", async () => {
    toolExecuteMock
      .mockResolvedValueOnce({
        success: false,
        output: null,
        error: { code: "REQUIRES_CONFIRMATION", message: "Need explicit confirmation", retryable: false },
        artifacts: [],
      })
      .mockResolvedValueOnce({
        success: true,
        output: { ok: true },
        artifacts: [],
      });

    const orch = new AgentOrchestrator("run-2", "chat-1", "user-1", "pro");
    orch.plan = minimalPlan() as any;

    (orch as any).emitTraceEvent = vi.fn().mockResolvedValue(undefined);
    (orch as any).generateSummary = vi.fn().mockResolvedValue("summary");
    (orch as any).verifyStepResult = vi.fn().mockResolvedValue({ success: true });

    await orch.run();
    expect(orch.status).toBe("awaiting_confirmation");

    const confirmed = await orch.confirmPendingConfirmation();
    expect(confirmed).toBe(true);

    await orch.run();

    // Second tool call should include context.isConfirmed=true
    const secondCallArgs = toolExecuteMock.mock.calls[1];
    expect(secondCallArgs?.[2]?.isConfirmed).toBe(true);

    expect(orch.status).toBe("completed");
  });
});
