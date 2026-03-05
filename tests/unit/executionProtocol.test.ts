import { describe, it, expect, beforeEach } from "vitest";
import {
  StepStatusSchema,
  StepKindSchema,
  StepSchema,
  ToolCallStatusSchema,
  ArtifactKindSchema,
  PlanSchema,
  ExecutionEventSchema,
  createInitialRunState,
  reduceEvent,
  createEvent,
  resetEventSequence,
} from "@shared/executionProtocol";

describe("Zod schemas", () => {
  it("StepStatusSchema accepts valid statuses", () => {
    for (const s of ["pending", "running", "completed", "failed", "skipped", "cancelled"]) {
      expect(StepStatusSchema.parse(s)).toBe(s);
    }
  });
  it("StepStatusSchema rejects invalid", () => {
    expect(() => StepStatusSchema.parse("unknown")).toThrow();
  });

  it("StepKindSchema accepts valid kinds", () => {
    for (const k of ["plan", "research", "execute", "validate", "generate", "transform", "aggregate", "deliver", "custom"]) {
      expect(StepKindSchema.parse(k)).toBe(k);
    }
  });

  it("ToolCallStatusSchema accepts all values", () => {
    for (const s of ["pending", "running", "streaming", "completed", "failed", "retrying", "cancelled"]) {
      expect(ToolCallStatusSchema.parse(s)).toBe(s);
    }
  });

  it("ArtifactKindSchema includes common types", () => {
    for (const k of ["excel", "word", "pdf", "csv", "json", "image", "code", "markdown"]) {
      expect(ArtifactKindSchema.parse(k)).toBe(k);
    }
  });

  it("StepSchema accepts valid step", () => {
    const step = {
      id: "step-1",
      title: "Research",
      kind: "research",
      status: "pending",
      progress: 50,
    };
    expect(StepSchema.parse(step)).toMatchObject(step);
  });

  it("StepSchema rejects progress out of range", () => {
    expect(() => StepSchema.parse({
      id: "s1", title: "t", kind: "plan", status: "pending", progress: 150,
    })).toThrow();
  });

  it("PlanSchema accepts valid plan", () => {
    const plan = {
      plan_id: "plan-1",
      title: "Test Plan",
      total_steps: 2,
      steps: [
        { id: "s1", title: "Step 1", kind: "research", status: "pending" },
        { id: "s2", title: "Step 2", kind: "execute", status: "pending" },
      ],
    };
    expect(PlanSchema.parse(plan)).toMatchObject(plan);
  });
});

describe("createInitialRunState", () => {
  it("creates empty run state", () => {
    const state = createInitialRunState("run-123");
    expect(state.run_id).toBe("run-123");
    expect(state.status).toBe("idle");
    expect(state.plan).toBeNull();
    expect(state.steps.size).toBe(0);
    expect(state.tool_calls.size).toBe(0);
    expect(state.artifacts.size).toBe(0);
    expect(state.progress).toBe(0);
    expect(state.error).toBeNull();
    expect(state.metrics.total_tool_calls).toBe(0);
  });
});

describe("createEvent", () => {
  beforeEach(() => resetEventSequence());

  it("creates an event with incrementing seq", () => {
    const e1 = createEvent("run-1", "run_started", {
      request_type: "test",
      request_summary: "testing",
    });
    const e2 = createEvent("run-1", "info", { message: "hello" });

    expect(e1.schema_version).toBe("v1");
    expect(e1.run_id).toBe("run-1");
    expect(e1.type).toBe("run_started");
    expect(e1.seq).toBe(1);
    expect(e2.seq).toBe(2);
    expect(e1.ts).toBeLessThanOrEqual(Date.now());
  });
});

describe("reduceEvent", () => {
  let state: ReturnType<typeof createInitialRunState>;

  beforeEach(() => {
    resetEventSequence();
    state = createInitialRunState("run-1");
  });

  it("handles run_started", () => {
    const event = createEvent("run-1", "run_started", {
      request_type: "test",
      request_summary: "testing",
    });
    const next = reduceEvent(state, event);
    expect(next.status).toBe("running");
    expect(next.started_at).toBeTruthy();
    expect(next.events).toHaveLength(1);
  });

  it("handles run_completed", () => {
    const event = createEvent("run-1", "run_completed", {
      duration_ms: 5000,
      total_steps: 2,
      completed_steps: 2,
      artifacts_count: 1,
    });
    const next = reduceEvent(state, event);
    expect(next.status).toBe("completed");
    expect(next.progress).toBe(100);
    expect(next.metrics.total_duration_ms).toBe(5000);
  });

  it("handles run_failed", () => {
    const event = createEvent("run-1", "run_failed", {
      error: "Something broke",
    });
    const next = reduceEvent(state, event);
    expect(next.status).toBe("failed");
    expect(next.error).toBe("Something broke");
  });

  it("handles run_cancelled", () => {
    const event = createEvent("run-1", "run_cancelled", {
      message: "cancelled",
    });
    const next = reduceEvent(state, event);
    expect(next.status).toBe("cancelled");
  });

  it("handles plan_created", () => {
    const event = createEvent("run-1", "plan_created", {
      plan: {
        plan_id: "p1",
        title: "Plan",
        total_steps: 2,
        steps: [
          { id: "s1", title: "S1", kind: "research", status: "pending" },
          { id: "s2", title: "S2", kind: "execute", status: "pending" },
        ],
      },
    });
    const next = reduceEvent(state, event);
    expect(next.plan).toBeTruthy();
    expect(next.steps.size).toBe(2);
  });

  it("handles tool_call lifecycle", () => {
    const startEvent = createEvent("run-1", "tool_call_started", {
      call: {
        call_id: "tc1",
        tool: "search",
        summary: "Searching",
        status: "running",
      },
    });
    let next = reduceEvent(state, startEvent);
    expect(next.tool_calls.size).toBe(1);
    expect(next.metrics.total_tool_calls).toBe(1);

    const completeEvent = createEvent("run-1", "tool_call_completed", {
      call: {
        call_id: "tc1",
        tool: "search",
        summary: "Done",
        status: "completed",
      },
    });
    next = reduceEvent(next, completeEvent);
    expect(next.metrics.completed_tool_calls).toBe(1);
  });

  it("handles artifact lifecycle", () => {
    const declareEvent = createEvent("run-1", "artifact_declared", {
      artifact: {
        artifact_id: "a1",
        kind: "excel",
        filename: "report.xlsx",
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        status: "declared",
      },
    });
    let next = reduceEvent(state, declareEvent);
    expect(next.artifacts.size).toBe(1);

    const readyEvent = createEvent("run-1", "artifact_ready", {
      artifact: {
        artifact_id: "a1",
        kind: "excel",
        filename: "report.xlsx",
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        status: "ready",
        size_bytes: 1024,
      },
    });
    next = reduceEvent(next, readyEvent);
    expect(next.artifacts.get("a1")!.status).toBe("ready");
  });

  it("handles fatal error event", () => {
    const event = createEvent("run-1", "error", {
      message: "Fatal error",
      fatal: true,
    });
    const next = reduceEvent(state, event);
    expect(next.status).toBe("failed");
    expect(next.error).toBe("Fatal error");
  });

  it("handles non-fatal error without status change", () => {
    state = { ...state, status: "running" };
    const event = createEvent("run-1", "error", {
      message: "Non-fatal",
      fatal: false,
    });
    const next = reduceEvent(state, event);
    expect(next.status).toBe("running");
  });
});
