import { describe, it, expect } from "vitest";

const BASE_URL = process.env.TEST_API_BASE || "http://localhost:5000";
const describeIntegration = process.env.TEST_API_BASE ? describe : describe.skip;

describeIntegration("ComplexityAnalyzer API", () => {
  describe("POST /api/chat/complexity", () => {
    it("should analyze trivial prompts correctly", async () => {
      const response = await fetch(`${BASE_URL}/api/chat/complexity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hola" }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty("complexity_score");
      expect(data).toHaveProperty("category", "trivial");
      expect(data).toHaveProperty("recommended_path", "fast");
      expect(data).toHaveProperty("dimensions");
      expect(data).toHaveProperty("estimated_tokens");
    });

    it("should detect complex prompts with technical terms", async () => {
      const response = await fetch(`${BASE_URL}/api/chat/complexity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "implement a jwt authentication system with oauth integration and database security",
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty("complexity_score");
      expect(data.complexity_score).toBeGreaterThanOrEqual(6);
      expect(["complex", "architectural"]).toContain(data.category);
    });

    it("should detect architectural prompts", async () => {
      const response = await fetch(`${BASE_URL}/api/chat/complexity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "design a microservice architecture with kubernetes and high availability for enterprise scale",
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.complexity_score).toBeGreaterThanOrEqual(8);
      expect(data.category).toBe("architectural");
      expect(data.recommended_path).toBe("architect");
    });

    it("should return signals for complex requests", async () => {
      const response = await fetch(`${BASE_URL}/api/chat/complexity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "design and implement a distributed caching system with redis and load balancing",
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(Array.isArray(data.signals)).toBe(true);
    });

    it("should handle empty prompt gracefully", async () => {
      const response = await fetch(`${BASE_URL}/api/chat/complexity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "" }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty("category", "trivial");
    });
  });
});

