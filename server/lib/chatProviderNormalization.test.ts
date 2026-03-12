import { describe, expect, it } from "vitest";
import { normalizeChatRequestProvider } from "./chatProviderNormalization";

describe("normalizeChatRequestProvider", () => {
  it("maps Google aliases to the Gemini runtime provider", () => {
    expect(normalizeChatRequestProvider("google")).toBe("gemini");
    expect(normalizeChatRequestProvider(" gemini ")).toBe("gemini");
  });

  it("preserves supported direct providers and auto mode", () => {
    expect(normalizeChatRequestProvider("xai")).toBe("xai");
    expect(normalizeChatRequestProvider("openai")).toBe("openai");
    expect(normalizeChatRequestProvider("google-gemini-cli")).toBe(
      "google-gemini-cli",
    );
    expect(normalizeChatRequestProvider("auto")).toBe("auto");
  });

  it("rejects unsupported providers safely", () => {
    expect(normalizeChatRequestProvider("perplexity")).toBeUndefined();
    expect(normalizeChatRequestProvider(null)).toBeUndefined();
  });
});
