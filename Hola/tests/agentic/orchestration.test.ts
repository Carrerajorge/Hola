import { describe, it, expect } from "vitest";

const BASE_URL = process.env.TEST_API_BASE || "http://localhost:5000";
const describeIntegration = process.env.TEST_API_BASE ? describe : describe.skip;

describeIntegration("Registry Orchestration Routing API", () => {
  it("POST /api/registry/route should classify intent and select tools", async () => {
    const response = await fetch(`${BASE_URL}/api/registry/route`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "search for information about agent orchestration" }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json();

    expect(data).toHaveProperty("success", true);
    expect(data.data).toHaveProperty("intent");
    expect(data.data).toHaveProperty("agentName");
    expect(Array.isArray(data.data.tools)).toBe(true);
  });

  it("POST /api/registry/route should include a workflow for complex queries", async () => {
    const response = await fetch(`${BASE_URL}/api/registry/route`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "search for policies and then generate a report and also summarize key findings",
      }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json();

    expect(data).toHaveProperty("success", true);
    expect(data.data).toHaveProperty("intent");
    expect(data.data).toHaveProperty("workflow");
    expect(data.data.workflow).toHaveProperty("steps");
    expect(Array.isArray(data.data.workflow.steps)).toBe(true);
  });

  it("GET /api/registry/stats should return registry stats", async () => {
    const response = await fetch(`${BASE_URL}/api/registry/stats`);

    expect(response.ok).toBe(true);
    const data = await response.json();

    expect(data).toHaveProperty("success", true);
    expect(data.data).toHaveProperty("tools");
    expect(data.data).toHaveProperty("agents");
    expect(data.data).toHaveProperty("orchestrator");
  });
});

