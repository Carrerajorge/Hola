import { describe, it, expect } from "vitest";

const BASE_URL = process.env.TEST_API_BASE || "http://localhost:5000";
const describeIntegration = process.env.TEST_API_BASE ? describe : describe.skip;

describeIntegration("Context Orchestrator (Memory) API", () => {
  it("GET /api/context/metrics should return cache and latency metrics", async () => {
    const response = await fetch(`${BASE_URL}/api/context/metrics`);

    expect(response.ok).toBe(true);
    const data = await response.json();

    expect(data).toHaveProperty("cache_size");
    expect(data).toHaveProperty("hit_rate");
    expect(data).toHaveProperty("avg_latency_ms");
    expect(typeof data.cache_size).toBe("number");
  });

  it("POST /api/context/:chatId/invalidate should invalidate cache tiers", async () => {
    const chatId = `test-chat-${Date.now()}`;
    const response = await fetch(`${BASE_URL}/api/context/${encodeURIComponent(chatId)}/invalidate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data).toHaveProperty("success", true);
    expect(data).toHaveProperty("chat_id", chatId);
  });
});

