/**
 * Property-Based Tests — Prompt Integrity
 *
 * Uses fast-check to verify invariants hold across random inputs.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { checkPromptIntegrity } from "../../server/lib/promptIntegrityService";
import { tokenCounter } from "../../server/lib/tokenCounter";
import { PromptPreProcessor } from "../../server/lib/promptPreProcessor";

describe("Property-based: Prompt Integrity", () => {
  it("SHA-256 hash is always deterministic", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const r1 = checkPromptIntegrity(text);
        const r2 = checkPromptIntegrity(text);
        expect(r1.serverPromptHash).toBe(r2.serverPromptHash);
        expect(r1.serverPromptLen).toBe(r2.serverPromptLen);
      }),
      { numRuns: 200 },
    );
  });

  it("hash is a 64-char hex string", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const result = checkPromptIntegrity(text);
        expect(result.serverPromptHash).toMatch(/^[0-9a-f]{64}$/);
      }),
      { numRuns: 100 },
    );
  });

  it("self-check always passes (content matches itself)", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const r = checkPromptIntegrity(text);
        const check = checkPromptIntegrity(text, r.serverPromptLen, r.serverPromptHash);
        expect(check.valid).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("different texts produce different hashes (with high probability)", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 5 }),
        fc.string({ minLength: 5 }),
        (a, b) => {
          fc.pre(a !== b);
          const ra = checkPromptIntegrity(a);
          const rb = checkPromptIntegrity(b);
          expect(ra.serverPromptHash).not.toBe(rb.serverPromptHash);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("backward compat: no client fields → always valid", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const result = checkPromptIntegrity(text);
        expect(result.valid).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

describe("Property-based: Token Counter", () => {
  it("countFast returns non-negative for any string", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(tokenCounter.countFast(text)).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 200 },
    );
  });

  it("countFast is deterministic", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(tokenCounter.countFast(text)).toBe(tokenCounter.countFast(text));
      }),
      { numRuns: 100 },
    );
  });

  it("longer text → higher or equal token count", () => {
    fc.assert(
      fc.property(fc.string(), fc.string({ minLength: 1 }), (a, b) => {
        expect(tokenCounter.countFast(a + b)).toBeGreaterThanOrEqual(
          tokenCounter.countFast(a),
        );
      }),
      { numRuns: 100 },
    );
  });
});

describe("Property-based: NFC Normalization", () => {
  // Generate strings with combining characters for meaningful NFC testing
  const unicodeArb = fc.string().map((s) => {
    // Inject some combining chars for diversity
    const combiningChars = ["\u0301", "\u0302", "\u0303", "\u0308", "\u0327"];
    let result = s;
    for (let i = 0; i < Math.min(s.length, 3); i++) {
      const pos = Math.floor(Math.random() * result.length);
      const cc = combiningChars[Math.floor(Math.random() * combiningChars.length)];
      result = result.slice(0, pos) + cc + result.slice(pos);
    }
    return result;
  });

  it("NFC normalization is idempotent", () => {
    fc.assert(
      fc.property(unicodeArb, (text) => {
        const nfc = text.normalize("NFC");
        expect(nfc.normalize("NFC")).toBe(nfc);
      }),
      { numRuns: 200 },
    );
  });

  it("NFC normalized text length <= original", () => {
    fc.assert(
      fc.property(unicodeArb, (text) => {
        const nfc = text.normalize("NFC");
        // NFC can be shorter (combining chars merge) but never longer
        expect(nfc.length).toBeLessThanOrEqual(text.length);
      }),
      { numRuns: 200 },
    );
  });
});
