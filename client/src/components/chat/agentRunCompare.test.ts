import { describe, expect, it } from "vitest";

import { type AgentRunData } from "@/hooks/use-chats";

import { areAgentRunsEqual } from "./agentRunCompare";

function makeRun(overrides: Partial<AgentRunData> = {}): AgentRunData {
  return {
    runId: "run-1",
    status: "starting",
    userMessage: "hola",
    steps: [],
    eventStream: [],
    summary: null,
    error: null,
    ...overrides,
  };
}

describe("areAgentRunsEqual", () => {
  it("returns true for equivalent agent runs", () => {
    const previous = makeRun();
    const next = makeRun();

    expect(areAgentRunsEqual(previous, next)).toBe(true);
  });

  it("returns false when the visible status changes", () => {
    const previous = makeRun({ status: "starting" });
    const next = makeRun({ status: "completed" });

    expect(areAgentRunsEqual(previous, next)).toBe(false);
  });

  it("returns false when the event stream grows", () => {
    const previous = makeRun({ eventStream: [] });
    const next = makeRun({
      eventStream: [{ type: "observation", content: { event_type: "done" }, timestamp: 1 }],
    });

    expect(areAgentRunsEqual(previous, next)).toBe(false);
  });

  it("returns false when a step status changes", () => {
    const previous = makeRun({
      steps: [{ stepIndex: 0, toolName: "search", status: "running" }],
    });
    const next = makeRun({
      steps: [{ stepIndex: 0, toolName: "search", status: "succeeded" }],
    });

    expect(areAgentRunsEqual(previous, next)).toBe(false);
  });

  it("returns false when the summary changes", () => {
    const previous = makeRun({ status: "completed", summary: null });
    const next = makeRun({ status: "completed", summary: "Run completed successfully" });

    expect(areAgentRunsEqual(previous, next)).toBe(false);
  });
});
