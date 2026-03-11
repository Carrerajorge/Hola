import { describe, expect, it } from "vitest";
import {
  clearExpiredGeminiCliOAuthFlows,
  deleteGeminiCliOAuthFlow,
  extractGeminiCliFlowIdFromCallbackInput,
  extractGeminiCliFlowIdFromState,
  getGeminiCliOAuthFlow,
  saveGeminiCliOAuthFlow,
} from "./geminiCliOAuthFlowStore";

describe("geminiCliOAuthFlowStore", () => {
  it("extracts the flow id from a Gemini CLI state value", () => {
    expect(extractGeminiCliFlowIdFromState("gemini-cli:test-flow")).toBe("test-flow");
    expect(extractGeminiCliFlowIdFromState("other-state")).toBeNull();
  });

  it("extracts the flow id from a callback URL or raw query string", () => {
    expect(
      extractGeminiCliFlowIdFromCallbackInput(
        "https://iliagpt.com/api/auth/google/callback?code=abc&state=gemini-cli:test-flow",
      ),
    ).toBe("test-flow");
    expect(
      extractGeminiCliFlowIdFromCallbackInput("code=abc&state=gemini-cli:raw-flow"),
    ).toBe("raw-flow");
  });

  it("stores and retrieves active flows", () => {
    saveGeminiCliOAuthFlow("active-flow", {
      verifier: "verifier",
      createdAt: Date.now(),
      userId: "user-1",
      oauthState: "gemini-cli:active-flow",
      redirectUri: "https://iliagpt.com/api/auth/google/callback",
    });

    expect(getGeminiCliOAuthFlow("active-flow")?.userId).toBe("user-1");

    deleteGeminiCliOAuthFlow("active-flow");
    clearExpiredGeminiCliOAuthFlows();
    expect(getGeminiCliOAuthFlow("active-flow")).toBeNull();
  });
});
