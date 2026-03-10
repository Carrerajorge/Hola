import { describe, expect, it } from "vitest";

import { AGENT_TOOLS } from "../config/agentTools";
import { PolicyEngine } from "./policyEngine";

describe("PolicyEngine default tool coverage", () => {
  it("registers a policy for every configured agent tool", () => {
    const engine = new PolicyEngine();
    const missing = AGENT_TOOLS
      .map((tool) => tool.name)
      .filter((toolName) => !engine.getPolicy(toolName));

    expect(missing).toEqual([]);
  });

  it("allows free users to use fetch_url", () => {
    const engine = new PolicyEngine();
    const result = engine.checkAccess({
      userId: "user-1",
      userPlan: "free",
      toolName: "fetch_url",
    });

    expect(result.allowed).toBe(true);
    expect(result.requiresConfirmation).toBe(false);
  });

  it("requires admin confirmation for browse_and_act", () => {
    const engine = new PolicyEngine();
    const result = engine.checkAccess({
      userId: "user-1",
      userPlan: "admin",
      toolName: "browse_and_act",
      isConfirmed: false,
    });

    expect(result.allowed).toBe(false);
    expect(result.requiresConfirmation).toBe(true);
  });
});
