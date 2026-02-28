import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { WorkflowStore } from "./store";
import { ensureWorkflowTraceSchema } from "./schemaSetup";
import { buildPlan, deleteRunCascade, ensureTestChat, makeId } from "./testUtils";

describe("WorkflowStore", () => {
  const store = new WorkflowStore();
  const createdRuns: string[] = [];

  beforeAll(async () => {
    await ensureWorkflowTraceSchema();
  });

  afterEach(async () => {
    while (createdRuns.length > 0) {
      const runId = createdRuns.pop();
      if (runId) {
        await deleteRunCascade(runId);
      }
    }
  });

  it("persists events idempotently by (run_id, event_seq)", async () => {
    const chatId = makeId("chat-store-events");
    const runId = makeId("run-store-events");
    createdRuns.push(runId);

    await ensureTestChat(chatId);
    const plan = buildPlan({ steps: [buildPlan().steps[0]] });

    await store.createRun({ runId, chatId, plan, userId: null, idempotencyKey: null });
    await store.createSteps(runId, plan.steps);

    const first = await store.appendEventIdempotent({
      runId,
      eventSeq: 1,
      correlationId: `${runId}:1:run_created`,
      eventType: "run_created",
      payload: { status: "pending" },
      metadata: { source: "unit-test" },
      traceId: runId,
      severity: "info",
      timestamp: new Date(),
    });

    const second = await store.appendEventIdempotent({
      runId,
      eventSeq: 1,
      correlationId: `${runId}:1:run_created`,
      eventType: "run_created",
      payload: { status: "pending" },
      metadata: { source: "unit-test" },
      traceId: runId,
      severity: "info",
      timestamp: new Date(),
    });

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);

    const events = await store.listEvents({ runId, afterSeq: 0, order: "asc", limit: 50 });
    expect(events).toHaveLength(1);
    expect(events[0].eventSeq).toBe(1);
    expect(events[0].eventType).toBe("run_created");

    const lastSeq = await store.getLastEventSeq(runId);
    expect(lastSeq).toBe(1);
  });

  it("deduplicates artifacts by (run_id, step_id, artifact_key)", async () => {
    const chatId = makeId("chat-store-artifacts");
    const runId = makeId("run-store-artifacts");
    createdRuns.push(runId);

    await ensureTestChat(chatId);
    const plan = buildPlan({ steps: [buildPlan().steps[0]] });

    await store.createRun({ runId, chatId, plan, userId: null, idempotencyKey: null });
    const steps = await store.createSteps(runId, plan.steps);
    const firstStep = steps[0];

    const writeResult = await store.appendArtifactsIdempotent([
      {
        runId,
        stepId: firstStep.stepId,
        stepIndex: firstStep.stepIndex,
        artifact: {
          key: "artifact:dedupe",
          type: "application/json",
          name: "result.json",
          payload: { ok: true },
          metadata: { source: "unit-test" },
        },
      },
      {
        runId,
        stepId: firstStep.stepId,
        stepIndex: firstStep.stepIndex,
        artifact: {
          key: "artifact:dedupe",
          type: "application/json",
          name: "result.json",
          payload: { ok: true },
          metadata: { source: "unit-test" },
        },
      },
    ]);

    expect(writeResult.inserted).toBe(1);
    expect(writeResult.deduplicated).toBe(1);

    const artifacts = await store.loadArtifacts(runId);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].artifactKey).toBe("artifact:dedupe");
    expect(artifacts[0].stepId).toBe(firstStep.stepId);
  });
});
