/**
 * PromptPreProcessor — Unit Tests
 *
 * Tests NFC normalization, language detection, structure analysis,
 * deduplication, whitespace normalization, and edge cases.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { PromptPreProcessor } from "../../server/lib/promptPreProcessor";

describe("PromptPreProcessor", () => {
  let pp: PromptPreProcessor;

  beforeEach(() => {
    pp = new PromptPreProcessor();
  });

  describe("NFC normalization", () => {
    it("normalizes decomposed Unicode to NFC", () => {
      // é as combining sequence (e + combining acute) → NFC form
      const decomposed = "caf\u0065\u0301"; // e + combining acute accent
      const result = pp.process(decomposed);
      expect(result.nfcApplied).toBe(true);
      expect(result.text).toBe(result.text.normalize("NFC"));
    });

    it("does not modify already-NFC text", () => {
      const nfcText = "café résumé";
      const result = pp.process(nfcText);
      // Might or might not apply NFC depending on input normalization
      expect(result.text).toBe(nfcText.normalize("NFC"));
    });

    it("NFC normalization is idempotent", () => {
      const text = "Hello wörld café";
      const first = pp.process(text);
      const second = pp.process(first.text);
      expect(first.text).toBe(second.text);
    });
  });

  describe("language detection", () => {
    it("detects English", () => {
      const result = pp.process("The quick brown fox jumps over the lazy dog");
      expect(result.language.primaryLanguage).toBe("en");
    });

    it("detects Spanish", () => {
      const result = pp.process("El rápido zorro marrón salta sobre el perro perezoso");
      expect(result.language.primaryLanguage).toBe("es");
    });

    it("detects Chinese", () => {
      const result = pp.process("你好世界今天天气怎么样");
      expect(result.language.primaryLanguage).toBe("zh");
    });

    it("detects Arabic", () => {
      const result = pp.process("مرحبا بالعالم كيف حالك اليوم");
      expect(result.language.primaryLanguage).toBe("ar");
    });

    it("detects multilingual text", () => {
      const result = pp.process("Hello 你好 مرحبا Привет");
      expect(result.language.isMultiLingual).toBe(true);
      expect(result.language.scripts.length).toBeGreaterThan(1);
    });

    it("detects scripts correctly", () => {
      const result = pp.process("Hello 你好 🔥");
      expect(result.language.scripts).toContain("latin");
      expect(result.language.scripts).toContain("cjk");
    });
  });

  describe("structure analysis", () => {
    it("detects freeform text", () => {
      const result = pp.process("Just a simple question about something");
      expect(result.structure.type).toBe("freeform");
    });

    it("detects code-heavy content", () => {
      const code = "```javascript\n" + "const x = 42;\n".repeat(20) + "```";
      const result = pp.process(code);
      expect(result.structure.hasCodeBlocks).toBe(true);
      expect(result.structure.codeBlockCount).toBe(1);
    });

    it("detects URLs", () => {
      const result = pp.process("Check out https://example.com and https://test.org/path");
      expect(result.structure.hasUrls).toBe(true);
      expect(result.structure.urlCount).toBe(2);
    });

    it("detects JSON blocks", () => {
      const result = pp.process('Use this config: {"key": "value", "nested": {"deep": true}}');
      expect(result.structure.hasJson).toBe(true);
    });

    it("detects markdown", () => {
      const result = pp.process("# Title\n\n- Item 1\n- Item 2\n\n**Bold text**");
      expect(result.structure.hasMarkdown).toBe(true);
      expect(result.structure.type).toBe("structured");
    });

    it("detects tables", () => {
      const result = pp.process("| Col1 | Col2 |\n|------|------|\n| data | data |");
      expect(result.structure.hasTables).toBe(true);
    });

    it("detects mixed content", () => {
      const text = "# Heading\n\nSome text\n\n```python\nprint('hello')\n```\n\nMore text";
      const result = pp.process(text);
      expect(result.structure.type).toBe("mixed");
    });
  });

  describe("deduplication", () => {
    it("first message is never a duplicate", () => {
      const result = pp.process("Hello world");
      expect(result.isDuplicate).toBe(false);
    });

    it("detects duplicate same text", () => {
      pp.process("Hello world");
      const result = pp.process("Hello world");
      expect(result.isDuplicate).toBe(true);
    });

    it("different text is not a duplicate", () => {
      pp.process("Hello world");
      const result = pp.process("Goodbye world");
      expect(result.isDuplicate).toBe(false);
    });

    it("produces consistent hash", () => {
      const r1 = pp.process("deterministic");
      pp.reset();
      const r2 = pp.process("deterministic");
      expect(r1.duplicateHash).toBe(r2.duplicateHash);
    });

    it("reset clears dedup state", () => {
      pp.process("Hello");
      pp.reset();
      const result = pp.process("Hello");
      expect(result.isDuplicate).toBe(false);
    });
  });

  describe("whitespace normalization", () => {
    it("converts CRLF to LF", () => {
      const result = pp.process("Line 1\r\nLine 2\r\nLine 3");
      expect(result.text).toBe("Line 1\nLine 2\nLine 3");
      expect(result.whitespace.crlfConverted).toBe(2);
    });

    it("converts standalone CR to LF", () => {
      const result = pp.process("Line 1\rLine 2");
      expect(result.text).toBe("Line 1\nLine 2");
    });

    it("collapses 3+ newlines to 2", () => {
      const result = pp.process("Para 1\n\n\n\nPara 2");
      expect(result.text).toBe("Para 1\n\nPara 2");
      expect(result.whitespace.excessNewlinesCollapsed).toBeGreaterThan(0);
    });

    it("preserves double newlines (paragraph breaks)", () => {
      const result = pp.process("Para 1\n\nPara 2");
      expect(result.text).toBe("Para 1\n\nPara 2");
      expect(result.whitespace.excessNewlinesCollapsed).toBe(0);
    });

    it("trims trailing whitespace per line", () => {
      const result = pp.process("Hello   \nWorld  \t");
      expect(result.text).toBe("Hello\nWorld");
      expect(result.whitespace.trailingWhitespaceRemoved).toBeGreaterThan(0);
    });

    it("reports applied = false when no changes needed", () => {
      const result = pp.process("Clean text");
      expect(result.whitespace.applied).toBe(false);
    });
  });

  describe("full pipeline timing", () => {
    it("processes typical prompt in < 10ms", () => {
      const text = "What is the meaning of life? Please explain in detail with examples and code snippets.";
      const result = pp.process(text);
      expect(result.processingTimeMs).toBeLessThan(10);
    });

    it("processes 10K char prompt in < 50ms", () => {
      const text = "x".repeat(10_000);
      const result = pp.process(text);
      expect(result.processingTimeMs).toBeLessThan(50);
    });
  });

  describe("edge cases", () => {
    it("handles empty string", () => {
      const result = pp.process("");
      expect(result.text).toBe("");
      expect(result.language.primaryLanguage).toBe("unknown");
    });

    it("handles emoji-only input", () => {
      const result = pp.process("🔥🚀💡🎯🏆");
      expect(result.language.scripts).toContain("emoji");
    });

    it("preserves original text reference", () => {
      const input = "Hello\r\nWorld";
      const result = pp.process(input);
      expect(result.originalText).toBe(input);
      expect(result.text).not.toBe(input); // Should be normalized
    });
  });
});
