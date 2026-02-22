/**
 * Prompt Integrity Service — Unit Tests
 *
 * Validates that the SHA-256 integrity check correctly detects
 * matches, mismatches, and handles edge cases (multi-lang, emoji, large prompts).
 */
import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { checkPromptIntegrity } from "../../server/lib/promptIntegrityService";

function computeClientHash(content: string): { len: number; hash: string } {
  const buf = Buffer.from(content, "utf-8");
  return {
    len: buf.byteLength,
    hash: crypto.createHash("sha256").update(buf).digest("hex"),
  };
}

describe("Prompt Integrity Service", () => {
  it("valid prompt passes integrity check", () => {
    const content = "Hello, this is a test prompt.";
    const client = computeClientHash(content);
    const result = checkPromptIntegrity(content, client.len, client.hash);
    expect(result.valid).toBe(true);
    expect(result.mismatchType).toBeUndefined();
  });

  it("mismatched hash is detected", () => {
    const content = "Hello, this is a test prompt.";
    const client = computeClientHash(content);
    const result = checkPromptIntegrity(content, client.len, "0000000000000000000000000000000000000000000000000000000000000000");
    expect(result.valid).toBe(false);
    expect(result.mismatchType).toBe("hash");
  });

  it("mismatched length is detected", () => {
    const content = "Hello, this is a test prompt.";
    const client = computeClientHash(content);
    const result = checkPromptIntegrity(content, client.len + 5, client.hash);
    expect(result.valid).toBe(false);
    // Both mismatch because hash also changes if length is wrong on the client side
    // But here we're just faking the length, hash is still correct → length only
    expect(result.mismatchType).toBe("length");
    expect(result.lenDelta).toBe(5);
  });

  it("both length and hash mismatch detected", () => {
    const content = "Hello world";
    const result = checkPromptIntegrity(content, 999, "badhash");
    expect(result.valid).toBe(false);
    expect(result.mismatchType).toBe("both");
  });

  it("missing client fields (backward compat) always passes", () => {
    const result1 = checkPromptIntegrity("anything", undefined, undefined);
    expect(result1.valid).toBe(true);
    expect(result1.serverPromptLen).toBeGreaterThan(0);
    expect(result1.serverPromptHash).toHaveLength(64);
  });

  it("10K char prompt preserves integrity", () => {
    const content = "A".repeat(10_000);
    const client = computeClientHash(content);
    const result = checkPromptIntegrity(content, client.len, client.hash);
    expect(result.valid).toBe(true);
    expect(result.serverPromptLen).toBe(10_000);
  });

  it("50K char prompt preserves integrity", () => {
    const content = "B".repeat(50_000);
    const client = computeClientHash(content);
    const result = checkPromptIntegrity(content, client.len, client.hash);
    expect(result.valid).toBe(true);
    expect(result.serverPromptLen).toBe(50_000);
  });

  it("200K char prompt preserves integrity", () => {
    const content = "C".repeat(200_000);
    const client = computeClientHash(content);
    const result = checkPromptIntegrity(content, client.len, client.hash);
    expect(result.valid).toBe(true);
    expect(result.serverPromptLen).toBe(200_000);
  });

  it("multi-language UTF-8 (Chinese + Arabic + emoji) preserves integrity", () => {
    const content = "你好世界 مرحبا بالعالم 🌍🎉 Hello World café résumé";
    const client = computeClientHash(content);
    const result = checkPromptIntegrity(content, client.len, client.hash);
    expect(result.valid).toBe(true);
    // UTF-8 byte length > char length for multi-byte chars
    expect(result.serverPromptLen).toBeGreaterThan(content.length);
  });

  it("emoji-only prompt preserves integrity", () => {
    const content = "🔥🚀💡🎯🏆🌈⚡️🎨🧠🔮🎪🌟✨🌺🦋🐉🦈🐙🦑🐋";
    const client = computeClientHash(content);
    const result = checkPromptIntegrity(content, client.len, client.hash);
    expect(result.valid).toBe(true);
  });

  it("markdown with code blocks preserves integrity", () => {
    const content = `# Heading

\`\`\`python
def hello():
    print("Hello, 世界!")
    return True
\`\`\`

- Item 1
- Item 2
  - Nested item

> Blockquote with **bold** and *italic*

| Column 1 | Column 2 |
|----------|----------|
| Data     | Data     |`;
    const client = computeClientHash(content);
    const result = checkPromptIntegrity(content, client.len, client.hash);
    expect(result.valid).toBe(true);
  });

  it("preserves newlines and special whitespace", () => {
    const content = "Line 1\nLine 2\rLine 3\r\nLine 4\tTabbed\n\n\nTriple newline";
    const client = computeClientHash(content);
    const result = checkPromptIntegrity(content, client.len, client.hash);
    expect(result.valid).toBe(true);
  });

  it("zero-width characters preserved", () => {
    const content = "Hello\u200BWorld\u200CTest\u200DFoo\uFEFFBar";
    const client = computeClientHash(content);
    const result = checkPromptIntegrity(content, client.len, client.hash);
    expect(result.valid).toBe(true);
  });

  it("RTL text preserved", () => {
    const content = "مرحبا بالعالم - שלום עולם - Hello";
    const client = computeClientHash(content);
    const result = checkPromptIntegrity(content, client.len, client.hash);
    expect(result.valid).toBe(true);
  });

  it("server hash is consistent across calls", () => {
    const content = "deterministic test";
    const r1 = checkPromptIntegrity(content);
    const r2 = checkPromptIntegrity(content);
    expect(r1.serverPromptHash).toBe(r2.serverPromptHash);
    expect(r1.serverPromptLen).toBe(r2.serverPromptLen);
  });

  it("empty string passes with no client fields", () => {
    // Content validation (min(1)) is handled by Zod, not by integrity check
    const result = checkPromptIntegrity("");
    expect(result.valid).toBe(true);
    expect(result.serverPromptLen).toBe(0);
  });

  it("lenDelta is computed correctly", () => {
    const content = "test";
    const client = computeClientHash(content);
    const result = checkPromptIntegrity(content, client.len + 10, client.hash);
    expect(result.lenDelta).toBe(10);
  });
});
