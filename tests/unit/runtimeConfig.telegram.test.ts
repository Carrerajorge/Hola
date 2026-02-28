import { describe, expect, it } from "vitest";
import { buildResponseStyleSystemPrompt, resolveRuntimeConfig } from "../../server/channels/runtimeConfig";

describe("runtimeConfig telegram formatting", () => {
  it("injects telegram formatting guidelines for default style", () => {
    const config = resolveRuntimeConfig({});
    const prompt = buildResponseStyleSystemPrompt(config, "telegram");

    expect(prompt).toBeTruthy();
    expect(prompt).toContain("Formato obligatorio para Telegram");
    expect(prompt).toContain("símbolos Unicode");
  });

  it("keeps non-telegram default style unchanged", () => {
    const config = resolveRuntimeConfig({});
    const prompt = buildResponseStyleSystemPrompt(config, "whatsapp_cloud");

    expect(prompt).toBeNull();
  });
});
