import { describe, it, expect } from "vitest";

import { detectProviderFromModel, normalizeProvider } from "../llmProviders";

describe("llmProviders", () => {
  it("normalizeProvider maps common aliases to stable ids", () => {
    expect(normalizeProvider("google")).toBe("gemini");
    expect(normalizeProvider("Gemini")).toBe("gemini");
    expect(normalizeProvider("grok")).toBe("xai");
    expect(normalizeProvider("xai")).toBe("xai");
    expect(normalizeProvider("claude")).toBe("anthropic");
    expect(normalizeProvider("anthropic")).toBe("anthropic");
    expect(normalizeProvider("deepsep")).toBe("deepseek");
    expect(normalizeProvider("deepseek")).toBe("deepseek");
    expect(normalizeProvider("auto")).toBe("auto");
  });

  it("normalizeProvider returns null for unknown inputs", () => {
    expect(normalizeProvider("")).toBeNull();
    expect(normalizeProvider("   ")).toBeNull();
    expect(normalizeProvider("unknown-provider")).toBeNull();
    expect(normalizeProvider(null)).toBeNull();
    expect(normalizeProvider(undefined)).toBeNull();
  });

  it("detectProviderFromModel infers providers from model ids", () => {
    expect(detectProviderFromModel("gemini-3-flash-preview")).toBe("gemini");
    expect(detectProviderFromModel("grok-4-1-fast")).toBe("xai");
    expect(detectProviderFromModel("gpt-4o-mini")).toBe("openai");
    expect(detectProviderFromModel("o3-mini")).toBe("openai");
    expect(detectProviderFromModel("claude-3-5-sonnet-20241022")).toBe("anthropic");
    expect(detectProviderFromModel("deepseek-chat")).toBe("deepseek");
  });
});

