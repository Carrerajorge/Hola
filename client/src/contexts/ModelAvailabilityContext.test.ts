import { describe, expect, it } from "vitest";
import {
  pickPreferredEnabledModel,
  selectVisibleModels,
  shouldExposeLocalMockModels,
  type AvailableModel,
} from "@/contexts/ModelAvailabilityContext";

function makeModel(overrides: Partial<AvailableModel>): AvailableModel {
  return {
    id: overrides.id || overrides.modelId || "model-id",
    name: overrides.name || "Model",
    provider: overrides.provider || "gemini",
    modelId: overrides.modelId || "gemini-2.5-flash",
    description: overrides.description ?? null,
    isEnabled: overrides.isEnabled || "true",
    enabledAt: overrides.enabledAt ?? null,
    enabledByAdminId: overrides.enabledByAdminId ?? null,
    displayOrder: overrides.displayOrder ?? 0,
    icon: overrides.icon ?? null,
    modelType: overrides.modelType || "TEXT",
    contextWindow: overrides.contextWindow ?? null,
  };
}

describe("ModelAvailabilityContext helpers", () => {
  it("hides local mock models outside localhost", () => {
    expect(shouldExposeLocalMockModels("iliagpt.com")).toBe(false);
    expect(shouldExposeLocalMockModels("localhost")).toBe(true);
    expect(shouldExposeLocalMockModels("127.0.0.1")).toBe(true);
  });

  it("prefers configured defaults when available", () => {
    const gemini = makeModel({ id: "gemini-id", provider: "gemini", modelId: "gemini-2.5-flash" });
    const grok = makeModel({ id: "grok-id", provider: "xai", modelId: "grok-4-fast" });

    expect(pickPreferredEnabledModel([grok, gemini], "grok-id", null)?.id).toBe("grok-id");
    expect(pickPreferredEnabledModel([grok, gemini], "gemini-2.5-flash", null)?.id).toBe("gemini-id");
  });

  it("prefers safer providers before xai when no explicit default exists", () => {
    const grok = makeModel({ id: "grok-id", provider: "xai", modelId: "grok-4-fast" });
    const gemini = makeModel({ id: "gemini-id", provider: "gemini", modelId: "gemini-2.5-flash" });

    expect(pickPreferredEnabledModel([grok, gemini], null, null)?.id).toBe("gemini-id");
  });

  it("keeps DeepSeek visible when additional models are collapsed", () => {
    const visible = selectVisibleModels({
      enabledModels: [
        makeModel({ id: "grok-id", provider: "xai", modelId: "grok-4-fast" }),
        makeModel({ id: "gemini-id", provider: "gemini", modelId: "gemini-2.5-flash" }),
        makeModel({ id: "gpt-id", provider: "openai", modelId: "gpt-5-mini" }),
        makeModel({ id: "deepseek-id", provider: "deepseek", modelId: "deepseek-chat" }),
      ],
      selectedModelId: null,
      showAdditionalModels: false,
    });

    expect(visible).toHaveLength(3);
    expect(visible.some((model) => model.provider === "deepseek")).toBe(true);
  });

  it("preserves the selected model while surfacing DeepSeek", () => {
    const visible = selectVisibleModels({
      enabledModels: [
        makeModel({ id: "grok-id", provider: "xai", modelId: "grok-4-fast" }),
        makeModel({ id: "gemini-id", provider: "gemini", modelId: "gemini-2.5-flash" }),
        makeModel({ id: "gpt-id", provider: "openai", modelId: "gpt-5-mini" }),
        makeModel({ id: "claude-id", provider: "anthropic", modelId: "claude-sonnet-4-5" }),
        makeModel({ id: "deepseek-id", provider: "deepseek", modelId: "deepseek-chat" }),
      ],
      selectedModelId: "claude-id",
      showAdditionalModels: false,
    });

    expect(visible.some((model) => model.id === "claude-id")).toBe(true);
    expect(visible.some((model) => model.id === "deepseek-id")).toBe(true);
  });
});
