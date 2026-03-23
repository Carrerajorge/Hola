import { describe, expect, it } from "vitest";

import {
  getAgentExecutionProfileConfig,
  resolveAgentExecutionProfile,
  resolveAgentExecutionProfileFromHints,
} from "./executionProfiles";

describe("executionProfiles", () => {
  it("falls back to standard for unknown profiles", () => {
    expect(resolveAgentExecutionProfile("unknown-profile")).toBe("standard");
  });

  it("resolves marathon profile from plan hints", () => {
    expect(resolveAgentExecutionProfileFromHints(["role:coder", "profile:marathon_12h"])).toBe("marathon_12h");
  });

  it("exposes expanded limits for marathon mode", () => {
    const standard = getAgentExecutionProfileConfig("standard");
    const marathon = getAgentExecutionProfileConfig("marathon_12h");

    expect(marathon.maxPlanSteps).toBeGreaterThan(standard.maxPlanSteps);
    expect(marathon.maxRunDurationMs).toBeGreaterThan(standard.maxRunDurationMs);
    expect(marathon.subagent.maxSteps).toBeGreaterThan(standard.subagent.maxSteps);
    expect(marathon.subagent.stepTimeoutMs).toBeGreaterThan(standard.subagent.stepTimeoutMs);
  });
});
