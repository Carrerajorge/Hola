import { describe, it, expect, vi } from "vitest";

const getSettingsConfigMock = vi.fn(async () => [
  {
    key: "app_name",
    value: "My App",
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  },
  {
    key: "maintenance_mode",
    value: true,
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  },
  {
    key: "slack_webhook_url",
    value: "https://hooks.slack.com/services/SECRET",
    updatedAt: new Date("2026-01-03T00:00:00.000Z"),
  },
  {
    key: "default_model",
    value: "\"grok-4-1-fast-non-reasoning\"",
    updatedAt: new Date("2026-01-04T00:00:00.000Z"),
  },
]);

vi.mock("../storage", () => ({
  storage: {
    seedDefaultSettings: vi.fn(async () => {}),
    getSettingsConfig: getSettingsConfigMock,
  },
}));

describe("getPublicSettings", () => {
  it("returns only public keys (no sensitive settings)", async () => {
    const { getPublicSettings } = await import("../services/settingsConfigService");

    const res = await getPublicSettings();
    expect(res.settings.app_name).toBe("My App");
    expect(res.settings.maintenance_mode).toBe(true);
    expect(res.settings.default_model).toBe("moonshotai/kimi-k2.5");
    expect((res.settings as any).slack_webhook_url).toBeUndefined();
  });

  it("normalizes legacy OpenRouter GLM-5 defaults to Kimi", async () => {
    getSettingsConfigMock.mockResolvedValueOnce([
      {
        key: "default_model",
        value: "z-ai/glm-5",
        updatedAt: new Date("2026-01-05T00:00:00.000Z"),
      },
    ]);

    const { getPublicSettings } = await import("../services/settingsConfigService");

    const res = await getPublicSettings();
    expect(res.settings.default_model).toBe("moonshotai/kimi-k2.5");
  });
});
