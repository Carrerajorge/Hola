import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { interpretIntent, createPlan } from "../../server/agent/pipeline/planner";

describe("Pipeline planner fallbacks", () => {
  const originalKey = process.env.XAI_API_KEY;

  beforeEach(() => {
    delete process.env.XAI_API_KEY;
  });

  afterEach(() => {
    if (originalKey) {
      process.env.XAI_API_KEY = originalKey;
    } else {
      delete process.env.XAI_API_KEY;
    }
  });

  it("falls back to heuristic intent when XAI key is unavailable", async () => {
    const intent = await interpretIntent("Search the web for DeepSeek R1 GitHub README");
    expect(intent.action).toBe("search_web");
    expect(intent.confidence).toBeGreaterThan(0);
  });

  it("builds deterministic search plan without LLM", async () => {
    const intent = await interpretIntent("Search the web for DeepSeek R1 latest version");
    const plan = await createPlan("run_test", "Search the web for DeepSeek R1 latest version", intent);

    expect(plan.steps.length).toBeGreaterThanOrEqual(1);
    expect(plan.steps[0].toolId).toBe("search_web");
  });

  it("returns minimal respond plan when LLM planning is unavailable", async () => {
    const intent = await interpretIntent("Summarize this architecture decision");
    const plan = await createPlan("run_test_2", "Summarize this architecture decision", intent);

    expect(plan.steps.length).toBe(1);
    expect(plan.steps[0].toolId).toBe("respond");
  });
});
