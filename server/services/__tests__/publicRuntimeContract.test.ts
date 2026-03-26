import { describe, expect, it } from "vitest";

import {
  DEFAULT_PUBLIC_RUNTIME_CONTRACT,
  validatePublicRuntimeContract,
} from "../../../scripts/verify-public-runtime-contract.mjs";

describe("validatePublicRuntimeContract", () => {
  it("accepts the Kimi-only public runtime contract", () => {
    const result = validatePublicRuntimeContract({
      modelsPayload: {
        models: [
          {
            provider: "openrouter",
            modelId: "moonshotai/kimi-k2.5",
            name: "Kimi K2.5",
          },
        ],
      },
      settingsPayload: {
        settings: {
          default_model: "moonshotai/kimi-k2.5",
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.contract).toEqual(DEFAULT_PUBLIC_RUNTIME_CONTRACT);
  });

  it("rejects extra public models", () => {
    const result = validatePublicRuntimeContract({
      modelsPayload: {
        models: [
          { provider: "openrouter", modelId: "moonshotai/kimi-k2.5" },
          { provider: "openrouter", modelId: "meta-llama/llama-3.3-70b" },
        ],
      },
      settingsPayload: {
        settings: {
          default_model: "moonshotai/kimi-k2.5",
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain("Se esperaba exactamente 1 modelo publico y llegaron 2.");
  });

  it("rejects a mismatched default_model", () => {
    const result = validatePublicRuntimeContract({
      modelsPayload: {
        models: [{ provider: "openrouter", modelId: "moonshotai/kimi-k2.5" }],
      },
      settingsPayload: {
        settings: {
          default_model: "z-ai/glm-5",
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toContain(
      "El default_model esperado era moonshotai/kimi-k2.5 y llego z-ai/glm-5.",
    );
  });
});
