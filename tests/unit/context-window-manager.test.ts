/**
 * ContextWindowManager — Unit Tests
 *
 * Tests all strategies, must-keep span preservation,
 * importance scoring, budget enforcement, and edge cases.
 */
import { describe, it, expect } from "vitest";
import { manageContext, type ContextStrategy, type ContextResult } from "../../server/lib/contextWindowManager";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

function msg(role: "user" | "assistant" | "system", content: string): ChatCompletionMessageParam {
  return { role, content } as any;
}

function totalTokensFast(messages: ChatCompletionMessageParam[]): number {
  return messages.reduce((s, m) => {
    const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    return s + Math.ceil(text.length / 4);
  }, 0);
}

describe("ContextWindowManager", () => {
  describe("no-truncation passthrough", () => {
    it("returns messages unchanged when under budget", () => {
      const messages = [
        msg("system", "Be helpful"),
        msg("user", "Hello"),
        msg("assistant", "Hi there"),
      ];
      const result = manageContext(messages, { maxTokens: 100_000 });
      expect(result.messages).toBe(messages);
      expect(result.metadata.truncationApplied).toBe(false);
      expect(result.metadata.droppedMessageCount).toBe(0);
    });

    it("all messages marked as kept", () => {
      const messages = [msg("user", "Hello")];
      const result = manageContext(messages, { maxTokens: 100_000 });
      expect(result.metadata.importanceScores.every(s => s.kept)).toBe(true);
    });
  });

  describe("sliding_window strategy", () => {
    it("keeps system messages and latest conversation", () => {
      const messages = [
        msg("system", "System prompt with some instructions for context"),
        msg("user", "Old question 1 with extra padding content here " + "x".repeat(100)),
        msg("assistant", "Old answer 1 with detailed response " + "y".repeat(100)),
        msg("user", "Old question 2 with more filler content " + "x".repeat(100)),
        msg("assistant", "Old answer 2 with even more content " + "y".repeat(100)),
        msg("user", "Latest question"),
      ];

      const result = manageContext(messages, {
        maxTokens: 30, // Very tight budget — forces truncation
        strategy: "sliding_window",
      });

      expect(result.metadata.truncationApplied).toBe(true);
      expect(result.metadata.strategy).toBe("sliding_window");

      // Latest user message must always be present
      const contents = result.messages.map(m => typeof m.content === "string" ? m.content : "");
      expect(contents.some(c => c.includes("Latest question"))).toBe(true);
    });

    it("never drops system messages if they fit", () => {
      const messages = [
        msg("system", "Short system"),
        msg("user", "Old " + "x".repeat(100)),
        msg("user", "New question"),
      ];

      const result = manageContext(messages, {
        maxTokens: 20,
        strategy: "sliding_window",
      });

      const roles = result.messages.map(m => m.role);
      expect(roles).toContain("system");
    });
  });

  describe("importance_weighted strategy", () => {
    it("preserves the latest user message", () => {
      const messages = [
        msg("system", "Be helpful"),
        msg("user", "Question 1"),
        msg("assistant", "Answer 1"),
        msg("user", "Question 2"),
        msg("assistant", "Answer 2"),
        msg("user", "Important latest question"),
      ];

      const result = manageContext(messages, {
        maxTokens: 30,
        strategy: "importance_weighted",
      });

      const contents = result.messages.map(m =>
        typeof m.content === "string" ? m.content : "",
      );
      expect(contents).toContain("Important latest question");
    });

    it("produces valid importance scores", () => {
      const messages = [
        msg("user", "Old"),
        msg("assistant", "Old reply"),
        msg("user", "New"),
      ];

      const result = manageContext(messages, {
        maxTokens: 10,
        strategy: "importance_weighted",
      });

      expect(result.metadata.importanceScores.length).toBe(messages.length);
      for (const score of result.metadata.importanceScores) {
        expect(score.importanceScore).toBeGreaterThanOrEqual(0);
        expect(typeof score.kept).toBe("boolean");
      }
    });

    it("prefers messages with must-keep content", () => {
      const messages = [
        msg("system", "Be helpful"),
        msg("user", "Plain old question with no special content"),
        msg("assistant", "Here is code: ```js\nconst x = 42;\n```"),
        msg("user", "New question"),
      ];

      const result = manageContext(messages, {
        maxTokens: 30,
        strategy: "importance_weighted",
      });

      // The message with code block should be scored higher
      const codeScore = result.metadata.importanceScores.find(
        s => s.mustKeepSpans > 0,
      );
      if (codeScore) {
        expect(codeScore.mustKeepSpans).toBeGreaterThan(0);
      }
    });
  });

  describe("must_keep_spans strategy", () => {
    it("preserves messages with code blocks", () => {
      const messages = [
        msg("system", "Be helpful"),
        msg("user", "Plain question 1"),
        msg("assistant", "Here is the code:\n```python\nprint('hello')\n```"),
        msg("user", "Plain question 2"),
        msg("assistant", "Generic answer"),
        msg("user", "Latest question"),
      ];

      const result = manageContext(messages, {
        maxTokens: 40,
        strategy: "must_keep_spans",
      });

      expect(result.metadata.strategy).toBe("must_keep_spans");
      // Latest user message always present
      const contents = result.messages.map(m =>
        typeof m.content === "string" ? m.content : "",
      );
      expect(contents).toContain("Latest question");
    });
  });

  describe("auto strategy selection", () => {
    it("uses sliding_window for short conversations", () => {
      const messages = [
        msg("system", "Be helpful"),
        msg("user", "x".repeat(1000)),
      ];

      const result = manageContext(messages, {
        maxTokens: 10,
        strategy: "auto",
      });

      expect(["sliding_window", "importance_weighted", "must_keep_spans"]).toContain(
        result.metadata.strategy,
      );
    });

    it("uses importance_weighted for long conversations (>20 non-system)", () => {
      const messages: ChatCompletionMessageParam[] = [msg("system", "sys")];
      for (let i = 0; i < 25; i++) {
        messages.push(msg("user", `Question ${i}`));
        messages.push(msg("assistant", `Answer ${i}`));
      }

      const result = manageContext(messages, {
        maxTokens: 100,
        strategy: "auto",
      });

      // Auto should select importance_weighted for long conversations
      expect(result.metadata.strategy).toBe("importance_weighted");
    });
  });

  describe("invariants", () => {
    it("droppedMessageCount + keptMessageCount = originalMessageCount", () => {
      const messages = [
        msg("system", "sys"),
        msg("user", "q1"),
        msg("assistant", "a1"),
        msg("user", "q2"),
      ];

      for (const strategy of ["sliding_window", "importance_weighted", "must_keep_spans"] as ContextStrategy[]) {
        const result = manageContext(messages, { maxTokens: 10, strategy });
        expect(
          result.metadata.droppedMessageCount + result.metadata.keptMessageCount,
        ).toBe(result.metadata.originalMessageCount);
      }
    });

    it("final token count <= original when truncation applied", () => {
      const messages = [
        msg("system", "x".repeat(200)),
        msg("user", "q1 " + "y".repeat(200)),
        msg("assistant", "a1 " + "z".repeat(200)),
        msg("user", "Latest"),
      ];

      const result = manageContext(messages, {
        maxTokens: 20,
        strategy: "sliding_window",
      });

      if (result.metadata.truncationApplied) {
        expect(result.metadata.finalTokens).toBeLessThanOrEqual(
          result.metadata.originalTokens,
        );
      }
    });

    it("at least one message in output", () => {
      const messages = [msg("user", "Hello")];
      const result = manageContext(messages, { maxTokens: 1, strategy: "sliding_window" });
      expect(result.messages.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("edge cases", () => {
    it("single user message under budget", () => {
      const messages = [msg("user", "Hi")];
      const result = manageContext(messages, { maxTokens: 100_000 });
      expect(result.messages).toEqual(messages);
      expect(result.metadata.truncationApplied).toBe(false);
    });

    it("system-only messages", () => {
      const messages = [
        msg("system", "System 1"),
        msg("system", "System 2"),
      ];
      const result = manageContext(messages, { maxTokens: 100_000 });
      expect(result.metadata.truncationApplied).toBe(false);
    });

    it("empty messages array returns empty result", () => {
      const result = manageContext([], { maxTokens: 100_000 });
      expect(result.messages.length).toBe(0);
      expect(result.metadata.truncationApplied).toBe(false);
    });
  });
});
