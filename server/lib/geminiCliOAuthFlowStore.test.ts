import { describe, expect, it } from "vitest";
import {
  clearExpiredGeminiCliOAuthFlows,
  deleteGeminiCliOAuthCompleted,
  deleteGeminiCliOAuthFlow,
  extractGeminiCliFlowIdFromCallbackInput,
  extractGeminiCliFlowIdFromState,
  getGeminiCliOAuthCompleted,
  getGeminiCliOAuthFlow,
  saveGeminiCliOAuthCompleted,
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

  it("stores and retrieves completed flows for manual fallback", () => {
    saveGeminiCliOAuthCompleted("completed-flow", "user-2", {
      connected: true,
      defaultModelId: "gemini-3.1-pro-preview",
    });

    expect(getGeminiCliOAuthCompleted("completed-flow", "user-2")?.response.connected).toBe(true);

    deleteGeminiCliOAuthCompleted("completed-flow", "user-2");
    clearExpiredGeminiCliOAuthFlows();
    expect(getGeminiCliOAuthCompleted("completed-flow", "user-2")).toBeNull();
  });
});
