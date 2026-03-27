import * as fs from "fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArtifactInfo, PlanStep, ProductionRun } from "../../server/agent/registry/productionWorkflowRunner";
import { ProductionWorkflowRunner } from "../../server/agent/registry/productionWorkflowRunner";

function createRun(overrides?: Partial<ProductionRun>): ProductionRun {
  const step: PlanStep = {
    stepIndex: 0,
    toolName: "image_generate",
    description: "Generate image",
    input: { prompt: "gato futurista" },
    isGenerator: true,
    dependencies: [],
  };

  return {
    runId: "run-test",
    requestId: "request-test",
    status: "running",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currentStepIndex: 0,
    totalSteps: 1,
    replansCount: 0,
    query: "crea una imagen de un gato futurista",
    intent: "image_generate",
    plan: {
      objective: "Generar imagen",
      steps: [step],
      requiresArtifact: true,
      expectedArtifactType: "image/png",
    },
    evidence: [],
    artifacts: [],
    ...overrides,
  };
}

const createdArtifacts = new Set<string>();

afterEach(() => {
  vi.restoreAllMocks();
  for (const artifactPath of createdArtifacts) {
    try {
      if (fs.existsSync(artifactPath)) {
        fs.unlinkSync(artifactPath);
      }
    } catch {}
  }
  createdArtifacts.clear();
});

describe("ProductionWorkflowRunner", () => {
  it("does not replan image generation into a non-image tool", () => {
    const runner = new ProductionWorkflowRunner({ watchdogTimeoutMs: 1000, stepTimeoutMs: 10 });
    const run = createRun();
    const failedStep = run.plan.steps[0];

    run.evidence[0] = {
      stepId: "step_0",
      toolName: "image_generate",
      input: failedStep.input,
      output: null,
      schemaValidation: "fail",
      requestId: "req-step",
      durationMs: 5,
      retryCount: 0,
      replanEvents: [],
      status: "failed",
      errorStack: "forced failure",
    };

    const replanned = (runner as any).attemptReplan(run, failedStep);

    expect(replanned).toBe(false);
    expect(run.plan.steps[0].toolName).toBe("image_generate");
    expect(run.evidence[0]!.replanEvents).toHaveLength(0);
  });

  it("returns a PNG fallback when image generation circuit breaker is open", async () => {
    const runner = new ProductionWorkflowRunner({ watchdogTimeoutMs: 1000, stepTimeoutMs: 10 });
    const fakeCircuitBreaker = {
      canExecute: vi.fn(() => false),
      recordSuccess: vi.fn(),
      recordFailure: vi.fn(),
    };

    vi.spyOn(runner as any, "getCircuitBreaker").mockReturnValue(fakeCircuitBreaker);

    const result = await (runner as any).executeToolReal(
      "image_generate",
      { prompt: "gato futurista" },
      createRun()
    );
    const artifact = result.artifacts?.[0];
    const data = result.data as { model: string };

    expect(result.success).toBe(true);
    expect(result.artifacts).toHaveLength(1);
    expect(artifact?.mimeType).toBe("image/png");
    expect(data.model).toBe("fallback-local-png");
    expect(artifact).toBeDefined();
    createdArtifacts.add(artifact!.path);
  });

  it("uses the extended timeout budget for slides_create", async () => {
    const runner = new ProductionWorkflowRunner({ watchdogTimeoutMs: 1000, stepTimeoutMs: 5 });
    const run = createRun({
      query: "crea una presentación sobre transformación digital",
      intent: "slides_create",
      plan: {
        objective: "Generar presentación",
        steps: [
          {
            stepIndex: 0,
            toolName: "slides_create",
            description: "Generate slides",
            input: { title: "Transformación digital" },
            isGenerator: true,
            dependencies: [],
          },
        ],
        requiresArtifact: true,
        expectedArtifactType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      },
      evidence: [],
      artifacts: [],
    });

    vi.spyOn(runner as any, "executeToolReal").mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                success: true,
                data: { ok: true },
                artifacts: [],
              }),
            20
          )
        )
    );

    await (runner as any).executeStep(run, run.plan.steps[0]);

    expect(run.evidence[0]!.status).toBe("completed");
    expect(run.evidence[0]!.errorStack).toBeUndefined();
  });

  it("fails the run when the generated artifact MIME does not match the expected contract", async () => {
    const runner = new ProductionWorkflowRunner({ watchdogTimeoutMs: 1000, stepTimeoutMs: 10 });
    const run = createRun();
    const wrongArtifact: ArtifactInfo = {
      artifactId: "artifact-1",
      type: "document",
      mimeType: "text/plain",
      path: "/tmp/not-used.txt",
      sizeBytes: 20,
      createdAt: new Date().toISOString(),
    };

    vi.spyOn(runner as any, "startWatchdog").mockImplementation(() => {});
    vi.spyOn(runner as any, "resetWatchdog").mockImplementation(() => {});
    vi.spyOn(runner as any, "stopWatchdog").mockImplementation(() => {});
    vi.spyOn(runner as any, "executeStep").mockImplementation(async (activeRun: ProductionRun, step: PlanStep) => {
      activeRun.evidence[step.stepIndex] = {
        stepId: `step_${step.stepIndex}`,
        toolName: step.toolName,
        input: step.input,
        output: { ok: true },
        schemaValidation: "pass",
        requestId: "req-step",
        durationMs: 1,
        retryCount: 0,
        replanEvents: [],
        status: "completed",
        artifacts: [wrongArtifact],
      };
      activeRun.artifacts.push(wrongArtifact);
    });
    (runner as any).activeRuns.set(run.runId, run);

    await (runner as any).executeRun(run.runId);

    expect(run.status).toBe("failed");
    expect(run.error!).toContain("Required artifact (image/png) was not generated");
  });
});
