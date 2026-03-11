import { describe, expect, it } from "vitest";
import { AGENT_TOOLS } from "../../config/agentTools";
import { policyEngine } from "../policyEngine";

describe("agent tool policy coverage", () => {
  it("defines a policy for every declared agent tool", () => {
    const missingPolicies = AGENT_TOOLS
      .map((tool) => tool.name)
      .filter((name) => !policyEngine.getPolicy(name));

    expect(missingPolicies).toEqual([]);
  });

  it("defines policies for the new computer-use runtime tools", () => {
    const requiredTools = [
      "computer_use_session",
      "computer_use_navigate",
      "computer_use_interact",
      "computer_use_screenshot",
      "computer_use_extract",
      "computer_use_agentic",
      "terminal_execute",
      "terminal_system_info",
      "terminal_file_op",
      "vision_analyze",
      "physical_desktop_control",
    ];

    for (const toolName of requiredTools) {
      expect(policyEngine.getPolicy(toolName), `${toolName} should have a policy`).toBeDefined();
    }
  });
});
