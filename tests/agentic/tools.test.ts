import { describe, it, expect } from "vitest";

const BASE_URL = process.env.TEST_API_BASE || "http://localhost:5000";
const describeIntegration = process.env.TEST_API_BASE ? describe : describe.skip;

describeIntegration("Registry Tools API", () => {
  it("GET /api/registry/tools should return a tool list", async () => {
    const response = await fetch(`${BASE_URL}/api/registry/tools`);

    expect(response.ok).toBe(true);
    const data = await response.json();

    expect(data).toHaveProperty("success", true);
    expect(typeof data.count).toBe("number");
    expect(Array.isArray(data.data)).toBe(true);
    expect(data.count).toBeGreaterThan(0);

    const tool = data.data[0];
    expect(tool).toHaveProperty("name");
    expect(tool).toHaveProperty("description");
    expect(tool).toHaveProperty("category");
    expect(tool).toHaveProperty("version");
    expect(tool).toHaveProperty("config");
  });

  it("GET /api/registry/tools/:name should return tool metadata", async () => {
    const listResponse = await fetch(`${BASE_URL}/api/registry/tools`);
    expect(listResponse.ok).toBe(true);
    const list = await listResponse.json();

    const name = list.data?.[0]?.name as string;
    expect(typeof name).toBe("string");

    const response = await fetch(`${BASE_URL}/api/registry/tools/${encodeURIComponent(name)}`);
    expect(response.ok).toBe(true);
    const data = await response.json();

    expect(data).toHaveProperty("success", true);
    expect(data.data).toHaveProperty("metadata");
    expect(data.data.metadata).toHaveProperty("name", name);
  });

  it("GET /api/registry/tools/category/:category should filter by category", async () => {
    const listResponse = await fetch(`${BASE_URL}/api/registry/tools`);
    expect(listResponse.ok).toBe(true);
    const list = await listResponse.json();

    const category = list.data?.[0]?.category as string;
    expect(typeof category).toBe("string");

    const response = await fetch(
      `${BASE_URL}/api/registry/tools/category/${encodeURIComponent(category)}`
    );
    expect(response.ok).toBe(true);
    const data = await response.json();

    expect(data).toHaveProperty("success", true);
    expect(data).toHaveProperty("category", category);
    expect(Array.isArray(data.data)).toBe(true);
  });

  it("GET /api/registry/tools/:name should return 404 for unknown tools", async () => {
    const response = await fetch(`${BASE_URL}/api/registry/tools/__does_not_exist__`);
    expect(response.status).toBe(404);
  });
});

