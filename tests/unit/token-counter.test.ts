/**
 * TokenCounter — Unit Tests
 *
 * Tests fast/accurate counting, cache behavior, model encoding,
 * edge cases (empty, unicode, emoji), and message counting.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { tokenCounter, TokenCounter } from "../../server/lib/tokenCounter";

describe("TokenCounter", () => {
  describe("countFast", () => {
    it("returns 0 for empty string", () => {
      expect(tokenCounter.countFast("")).toBe(0);
    });

    it("estimates short text", () => {
      expect(tokenCounter.countFast("hello")).toBe(2); // ceil(5/4) = 2
    });

    it("estimates longer text", () => {
      expect(tokenCounter.countFast("x".repeat(100))).toBe(25);
    });

    it("estimates 1000 chars", () => {
      expect(tokenCounter.countFast("a".repeat(1000))).toBe(250);
    });

    it("handles unicode (counts JS chars, not bytes)", () => {
      // Chinese chars: 4 JS chars → ceil(4/4) = 1
      expect(tokenCounter.countFast("你好世界")).toBe(1);
    });

    it("handles emoji (surrogate pairs count as 2 chars each)", () => {
      // 🔥 = 2 JS chars, 🚀 = 2 JS chars → ceil(4/4) = 1
      expect(tokenCounter.countFast("🔥🚀")).toBe(1);
    });

    it("always returns non-negative", () => {
      expect(tokenCounter.countFast("")).toBeGreaterThanOrEqual(0);
      expect(tokenCounter.countFast("a")).toBeGreaterThanOrEqual(0);
    });
  });

  describe("countAccurate", () => {
    it("returns a positive number for non-empty text", () => {
      const count = tokenCounter.countAccurate("Hello, world!");
      expect(count).toBeGreaterThan(0);
    });

    it("handles empty string", () => {
      expect(tokenCounter.countAccurate("")).toBe(0);
    });

    it("returns reasonable count for English text", () => {
      const text = "The quick brown fox jumps over the lazy dog";
      const count = tokenCounter.countAccurate(text);
      // Should be ~10 tokens, within 2x of fast estimate
      const fast = tokenCounter.countFast(text);
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThan(fast * 3); // Within 3x margin
    });

    it("handles CJK text", () => {
      const count = tokenCounter.countAccurate("你好世界，今天天气怎么样？");
      expect(count).toBeGreaterThan(0);
    });

    it("handles mixed content", () => {
      const text = "Hello 你好 🔥 world";
      const count = tokenCounter.countAccurate(text);
      expect(count).toBeGreaterThan(0);
    });

    it("accepts model parameter", () => {
      const text = "Hello world";
      const countDefault = tokenCounter.countAccurate(text);
      const countGpt4 = tokenCounter.countAccurate(text, "gpt-4o");
      // Both should return valid counts
      expect(countDefault).toBeGreaterThan(0);
      expect(countGpt4).toBeGreaterThan(0);
    });
  });

  describe("countCached", () => {
    beforeEach(() => {
      tokenCounter.clearCache();
    });

    it("returns same result as countAccurate", () => {
      const text = "Hello caching world";
      const accurate = tokenCounter.countAccurate(text);
      const cached = tokenCounter.countCached(text);
      expect(cached).toBe(accurate);
    });

    it("populates cache on first call", () => {
      expect(tokenCounter.cacheSize).toBe(0);
      tokenCounter.countCached("test text");
      expect(tokenCounter.cacheSize).toBe(1);
    });

    it("returns cached value on second call", () => {
      const text = "deterministic caching";
      const first = tokenCounter.countCached(text);
      const second = tokenCounter.countCached(text);
      expect(first).toBe(second);
    });

    it("different models produce different cache entries", () => {
      tokenCounter.clearCache();
      tokenCounter.countCached("hello", "gpt-4o");
      tokenCounter.countCached("hello", "gemini-2.5-flash");
      expect(tokenCounter.cacheSize).toBe(2);
    });
  });

  describe("countMessages", () => {
    it("counts a single message", () => {
      const count = tokenCounter.countMessages([
        { role: "user", content: "Hello" },
      ]);
      expect(count).toBeGreaterThan(0);
    });

    it("adds overhead per message", () => {
      const singleCount = tokenCounter.countMessages([
        { role: "user", content: "Hello" },
      ]);
      const doubleCount = tokenCounter.countMessages([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ]);
      // Double should include overhead for both messages
      expect(doubleCount).toBeGreaterThan(singleCount);
    });

    it("handles non-string content (JSON)", () => {
      const count = tokenCounter.countMessages([
        { role: "user", content: { text: "Hello", images: [] } },
      ]);
      expect(count).toBeGreaterThan(0);
    });

    it("handles empty array", () => {
      expect(tokenCounter.countMessages([])).toBe(0);
    });
  });

  describe("isAccurateAvailable", () => {
    it("returns a boolean", () => {
      expect(typeof tokenCounter.isAccurateAvailable).toBe("boolean");
    });
  });

  describe("clearCache", () => {
    it("resets cache size to 0", () => {
      tokenCounter.countCached("some text");
      expect(tokenCounter.cacheSize).toBeGreaterThan(0);
      tokenCounter.clearCache();
      expect(tokenCounter.cacheSize).toBe(0);
    });
  });
});
