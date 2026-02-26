import { describe, it, expect, vi, beforeEach } from "vitest";
import { init } from "../capabilityExpander";

describe("selfExpand startup integration", () => {
  it("init() returns 0 when fused/ has no capabilities", async () => {
    const count = await init();
    expect(count).toBe(0);
  });

  it("init() is a function that can be called without errors", async () => {
    expect(typeof init).toBe("function");
    // Should not throw even on empty fused/
    await expect(init()).resolves.not.toThrow();
  });

  it("init() returns a number", async () => {
    const result = await init();
    expect(typeof result).toBe("number");
    expect(result).toBeGreaterThanOrEqual(0);
  });
});
