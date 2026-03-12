import { describe, it, expect, vi } from "vitest";

vi.mock("../storage", () => ({
  storage: {
    seedDefaultSettings: vi.fn(async () => {}),
    getSettingsConfig: vi.fn(async () => [
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
    ]),
  },
}));

describe("getPublicSettings", () => {
  it("returns only public keys (no sensitive settings)", async () => {
    const { getPublicSettings } = await import("../services/settingsConfigService");

    const res = await getPublicSettings();
    expect(res.settings.app_name).toBe("My App");
    expect(res.settings.maintenance_mode).toBe(true);
    expect(res.settings.default_model).toBe("grok-4.1-fast");
    expect((res.settings as any).slack_webhook_url).toBeUndefined();
  });
});
