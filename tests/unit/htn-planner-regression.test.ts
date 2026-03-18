import { describe, expect, it } from "vitest";

import { HTNPlanner } from "../../server/agent/htnPlanner";

describe("HTNPlanner regression coverage", () => {
  it("plans generic research requests against the registered research_deep tool", async () => {
    const planner = new HTNPlanner();
    const goal = "Investiga energias renovables";

    const result = await planner.plan(goal, { attachments: [] });

    expect(result.success).toBe(true);
    expect(result.plan).toBeDefined();
    expect(result.plan?.executionOrder).toHaveLength(1);

    const taskId = result.plan!.executionOrder[0];
    const task = result.plan!.allTasks.get(taskId);

    expect(task?.toolName).toBe("research_deep");
    expect(task?.toolParams).toMatchObject({
      goal,
      query: goal,
      topic: goal,
    });
  });

  it("inherits parent parameters into decomposed subtasks", async () => {
    const planner = new HTNPlanner();
    const goal = "Crear presentación sobre IA";

    const result = await planner.plan(goal, { topic: "impacto de la IA en educacion" });

    expect(result.success).toBe(true);
    expect(result.plan).toBeDefined();

    const researchTask = Array.from(result.plan!.allTasks.values()).find(
      (task) => task.toolName === "research_deep"
    );

    expect(researchTask).toBeDefined();
    expect(researchTask?.toolParams).toMatchObject({
      goal,
      query: goal,
      topic: "impacto de la IA en educacion",
    });
  });
});
