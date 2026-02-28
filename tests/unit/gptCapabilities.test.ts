import { describe, expect, it } from "vitest";
import {
  DEFAULT_GPT_CAPABILITIES,
  normalizeGptCapabilities,
  normalizeGptCapabilitiesPatch,
} from "../../server/lib/gptCapabilities";

describe("gpt capability normalization", () => {
  it("infers doc tools from canvas for legacy records with missing doc flags", () => {
    const normalized = normalizeGptCapabilities({
      webBrowsing: true,
      imageGeneration: true,
      canvas: true,
    });

    expect(normalized.webBrowsing).toBe(true);
    expect(normalized.imageGeneration).toBe(true);
    expect(normalized.canvas).toBe(true);
    expect(normalized.wordCreation).toBe(true);
    expect(normalized.excelCreation).toBe(true);
    expect(normalized.pptCreation).toBe(true);
  });

  it("preserves explicit doc flags even when canvas is true", () => {
    const normalized = normalizeGptCapabilities({
      canvas: true,
      wordCreation: false,
      excelCreation: true,
      pptCreation: false,
    });

    expect(normalized.wordCreation).toBe(false);
    expect(normalized.excelCreation).toBe(true);
    expect(normalized.pptCreation).toBe(false);
  });

  it("applies fallback values when definition omits capability fields", () => {
    const fallback = normalizeGptCapabilities({
      webBrowsing: true,
      canvas: true,
      wordCreation: true,
      excelCreation: true,
      pptCreation: true,
    });

    const normalized = normalizeGptCapabilities({}, fallback);
    expect(normalized).toEqual(fallback);
  });

  it("normalizes partial patch payload without zeroing unspecified fields", () => {
    const patch = normalizeGptCapabilitiesPatch({ codeInterpreter: true });

    expect(patch).toEqual({ codeInterpreter: true });
    expect(Object.prototype.hasOwnProperty.call(patch, "webBrowsing")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(patch, "canvas")).toBe(false);
  });

  it("enabling canvas in patch infers doc tools unless explicitly provided", () => {
    const patch = normalizeGptCapabilitiesPatch({
      canvas: true,
      pptCreation: false,
    });

    expect(patch.canvas).toBe(true);
    expect(patch.wordCreation).toBe(true);
    expect(patch.excelCreation).toBe(true);
    expect(patch.pptCreation).toBe(false);
  });

  it("returns defaults for invalid payloads", () => {
    const normalized = normalizeGptCapabilities("invalid", DEFAULT_GPT_CAPABILITIES);
    expect(normalized).toEqual(DEFAULT_GPT_CAPABILITIES);
  });
});
