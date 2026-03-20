import {
  GEMINI_CLI_BRIDGE_STORAGE_KEY,
  clearGeminiCliBridgePayload,
  parseGeminiCliBridgePayload,
  readGeminiCliBridgePayload,
} from "./geminiCliOAuthBridge";

describe("geminiCliOAuthBridge helpers", () => {
  it("parses a valid stored callback payload", () => {
    const payload = parseGeminiCliBridgePayload(
      JSON.stringify({
        type: "gemini-cli-oauth-callback",
        flowId: "flow-123",
        callbackUrl: "https://iliagpt.com/api/auth/google/callback?code=abc",
        createdAt: Date.now(),
      }),
    );

    expect(payload).toEqual(
      expect.objectContaining({
        type: "gemini-cli-oauth-callback",
        flowId: "flow-123",
      }),
    );
  });

  it("rejects expired payloads", () => {
    const payload = parseGeminiCliBridgePayload(
      JSON.stringify({
        type: "gemini-cli-oauth-callback",
        flowId: "flow-123",
        createdAt: Date.now() - 31 * 60 * 1000,
      }),
    );

    expect(payload).toBeNull();
  });

  it("clears invalid bridge payloads from storage", () => {
    const storage = {
      value: "not-json",
      getItem: vi.fn(() => "not-json"),
      removeItem: vi.fn(),
    };

    const payload = readGeminiCliBridgePayload(storage);

    expect(payload).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(GEMINI_CLI_BRIDGE_STORAGE_KEY);
  });

  it("removes the stored payload when cleared", () => {
    const storage = {
      removeItem: vi.fn(),
    };

    clearGeminiCliBridgePayload(storage);

    expect(storage.removeItem).toHaveBeenCalledWith(GEMINI_CLI_BRIDGE_STORAGE_KEY);
  });
});
