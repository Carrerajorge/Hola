import { describe, expect, it } from "vitest";
import { getAvailableTools } from "../../server/agent/pipeline/engine";

describe("Pipeline tool registration", () => {
  it("registers builtin tools without throwing and exposes generate_code", () => {
    const tools = getAvailableTools();
    const toolIds = new Set(tools.map((tool) => tool.id));

    expect(toolIds.has("search_web")).toBe(true);
    expect(toolIds.has("fetch_url")).toBe(true);
    expect(toolIds.has("generate_code")).toBe(true);
    expect(toolIds.has("slides_generate")).toBe(true);
  });
});
