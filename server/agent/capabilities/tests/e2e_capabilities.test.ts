import { describe, expect, it } from "vitest";
import { capabilityRegistry } from "../registry";

describe("Capabilities registry integration", () => {
  it("exposes a non-empty tool schema list with core capabilities", () => {
    const tools = capabilityRegistry.getToolSchemas();
    const names = tools.map((tool) => tool.name);

    expect(tools.length).toBeGreaterThan(0);
    expect(names).toContain("browser.scrape_page");
    expect(names).toContain("system.file_search");
    expect(names).toContain("system.docker_operate");
    expect(names).toContain("communication.email_fetch");
  });

  it("returns function-calling shape for each capability", () => {
    const tools = capabilityRegistry.getToolSchemas();

    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBe("JSON_SCHEMA");
    }
  });
});
