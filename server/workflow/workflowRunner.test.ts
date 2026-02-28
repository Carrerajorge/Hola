import { afterEach, describe, expect, it, vi } from "vitest";

import { agentEventBus } from "../agent/eventBus";
import { InMemoryStepExecutorRegistry, WorkflowRunInstance } from "./workflowRunner";
import { WorkflowDefinition } from "./types";

class FakeStore {
  public events: Array<any> = [];
  public runUpdates: Array<any> = [];
  public stepUpdates: Array<{ stepId: string; updates: any }> = [];
  public artifactWrites: Array<any> = [];

  async getLastEventSeq(): Promise<number> {
    if (this.events.length === 0) {
      return 0;
    }
    return Math.max(...this.events.map((event) => event.eventSeq || 0));
  }

  async appendEventIdempotent(event: any): Promise<{ inserted: boolean; eventId: string | null }> {
    const duplicate = this.events.find((existing) => existing.eventSeq === event.eventSeq && existing.runId === event.runId);
    if (duplicate) {
      return { inserted: false, eventId: null };
    }
    this.events.push(event);
    return { inserted: true, eventId: `${event.runId}:${event.eventSeq}` };
  }

  async updateRunStatus(_runId: string, updates: any): Promise<void> {
    this.runUpdates.push(updates);
  }

  async updateStepStatus(stepId: string, updates: any): Promise<void> {
    this.stepUpdates.push({ stepId, updates });
  }

  async appendArtifactsIdempotent(entries: any[]): Promise<{ inserted: number; deduplicated: number }> {
    this.artifactWrites.push(...entries);
    return { inserted: entries.length, deduplicated: 0 };
  }
}

describe("WorkflowRunInstance", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits monotonic event_seq and retries flaky step before completion", async () => {
    const store = new FakeStore();
    const emitSpy = vi.spyOn(agentEventBus, "emit").mockResolvedValue({} as any);

    const plan: WorkflowDefinition = {
      objective: "retry plan",
      steps: [
        {
          id: "flaky-step",
          name: "Flaky",
          toolName: "flaky",
          executorKey: "flaky",
          retryPolicy: {
            attempts: 2,
            backoffMs: 0,
          },
        },
      ],
      concurrency: 1,
    };

    const registry = new InMemoryStepExecutorRegistry();
    let calls = 0;
    registry.registerExecutor("flaky", async () => {
      calls += 1;
      if (calls === 1) {
        return {
          success: false,
          error: {
            message: "first attempt fails",
            retryable: true,
          },
        };
      }
      return {
        success: true,
        output: { ok: true },
      };
    });

    const run = new WorkflowRunInstance(
      store as any,
      plan,
      "run-test-retry",
      "chat-test-retry",
      "trace-test-retry",
      registry,
      [{ stepIndex: 0, stepId: "step-db-id-1" }],
      { userId: null },
    );

    await run.start();

    const sequences = store.events.map((event) => event.eventSeq);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(new Set(sequences).size).toBe(sequences.length);

    const eventTypes = store.events.map((event) => event.eventType);
    expect(eventTypes).toContain("step_retried");
    expect(eventTypes).toContain("step_completed");
    expect(eventTypes).toContain("run_completed");

    expect(emitSpy).toHaveBeenCalled();
  });

  it("marks pending steps as cancelled when cancellation is requested", async () => {
    const store = new FakeStore();
    vi.spyOn(agentEventBus, "emit").mockResolvedValue({} as any);

    const plan: WorkflowDefinition = {
      objective: "cancel plan",
      steps: [
        {
          id: "long",
          name: "Long step",
          toolName: "sleep",
          executorKey: "sleep",
          retryPolicy: {
            attempts: 1,
            backoffMs: 0,
          },
        },
        {
          id: "after",
          name: "After step",
          toolName: "noop",
          executorKey: "noop",
          dependencies: ["long"],
          retryPolicy: {
            attempts: 1,
            backoffMs: 0,
          },
        },
      ],
      concurrency: 1,
    };

    const registry = new InMemoryStepExecutorRegistry();
    registry.registerExecutor("sleep", async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return { success: true };
    });
    registry.registerExecutor("noop", async () => ({ success: true }));

    const run = new WorkflowRunInstance(
      store as any,
      plan,
      "run-test-cancel",
      "chat-test-cancel",
      "trace-test-cancel",
      registry,
      [
        { stepIndex: 0, stepId: "step-long" },
        { stepIndex: 1, stepId: "step-after" },
      ],
      { userId: null },
    );

    const running = run.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    run.requestCancel();
    await running;

    const finalRunUpdate = store.runUpdates[store.runUpdates.length - 1];
    expect(finalRunUpdate.status).toBe("cancelled");

    const cancelledStepUpdate = store.stepUpdates.find((step) => step.stepId === "step-after" && step.updates.status === "cancelled");
    expect(cancelledStepUpdate).toBeTruthy();

    const eventTypes = store.events.map((event) => event.eventType);
    expect(eventTypes).toContain("run_cancelled");
  });
});
