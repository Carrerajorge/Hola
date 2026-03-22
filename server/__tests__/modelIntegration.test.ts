import { afterEach, describe, expect, it, vi } from "vitest";

describe("modelIntegration", () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    const { invalidateKeyCache } = await import("../services/modelIntegration");
    invalidateKeyCache();
  });

  it("treats OpenRouter GLM-5 as the default end-user model", async () => {
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

  it("lets admins access active OpenRouter chat models even when not publicly enabled", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
    const { isModelEligibleForAdmin, isModelEligibleForPublic } = await import("../services/modelIntegration");

    const model = {
      provider: "openrouter",
      modelId: "meta-llama/llama-3.3-70b",
      modelType: "TEXT",
      status: "active",
      isEnabled: "false",
    };

    expect(isModelEligibleForAdmin(model)).toBe(true);
    expect(isModelEligibleForPublic(model)).toBe(false);
  });
});
