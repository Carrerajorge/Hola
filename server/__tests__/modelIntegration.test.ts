import { afterEach, describe, expect, it, vi } from "vitest";

describe("modelIntegration", () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    const { invalidateKeyCache } = await import("../services/modelIntegration");
    invalidateKeyCache();
  });

  it("treats OpenRouter Kimi as the default end-user model", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
    const {
      DEFAULT_END_USER_MODEL_ID,
      DEFAULT_END_USER_MODEL_PROVIDER,
      isDefaultEndUserModel,
      isModelEligibleForPublic,
    } = await import("../services/modelIntegration");

    const model = {
      provider: DEFAULT_END_USER_MODEL_PROVIDER,
      modelId: DEFAULT_END_USER_MODEL_ID,
      modelType: "chat",
      status: "active",
      isEnabled: "true",
    };

    expect(isDefaultEndUserModel(model)).toBe(true);
    expect(isModelEligibleForPublic(model)).toBe(true);
  });

  it("blocks non-Kimi OpenRouter models from admin and public exposure", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
    const { isModelEligibleForAdmin, isModelEligibleForPublic } = await import("../services/modelIntegration");

    const model = {
      provider: "openrouter",
      modelId: "meta-llama/llama-3.3-70b",
      modelType: "TEXT",
      status: "active",
      isEnabled: "false",
    };

    expect(isModelEligibleForAdmin(model)).toBe(false);
    expect(isModelEligibleForPublic(model)).toBe(false);
  });
});
