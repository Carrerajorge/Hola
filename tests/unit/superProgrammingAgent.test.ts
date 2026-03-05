import { describe, expect, it } from "vitest";
import { SuperProgrammingAgentService } from "../../server/services/superProgrammingAgent";

describe("SuperProgrammingAgentService", () => {
  const service = new SuperProgrammingAgentService(process.cwd());

  it("builds an assessment covering the 12 super programming capabilities", async () => {
    const assessment = await service.assess(
      "Integrar un super agente de programación para planear, implementar, probar y operar el software",
    );

    expect(assessment.capabilities).toHaveLength(12);
    expect(assessment.overallScore).toBeGreaterThanOrEqual(0);
    expect(assessment.overallScore).toBeLessThanOrEqual(100);
    expect(assessment.openClawProfile.recommendedTools.length).toBeGreaterThan(0);
  });

  it("creates a prioritized plan with actionable tasks", async () => {
    const plan = await service.buildPlan(
      "Elevar el sistema a nivel staff engineer autonomo con seguridad y observabilidad",
      { targetMaturity: 95 },
    );

    expect(plan.priorityBacklog.length).toBeGreaterThan(0);
    expect(plan.phases.length).toBe(4);
    expect(plan.guardrails.length).toBeGreaterThan(0);
  });

  it("executes a dry-run plan without invoking live orchestration", async () => {
    const plan = await service.buildPlan(
      "Fortalecer CI/CD, testing y governance para despliegues autonomos",
      { targetMaturity: 92 },
    );

    const run = await service.runPlan(plan, {
      dryRun: true,
      maxTasks: 3,
      stopOnFailure: true,
    });

    expect(run.mode).toBe("dry-run");
    expect(run.summary.total).toBeLessThanOrEqual(3);
    expect(run.summary.failed).toBe(0);
    expect(run.steps.every((step) => step.status === "completed")).toBe(true);
  });
});
