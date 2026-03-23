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
    expect(resolveAgentExecutionProfileFromHints(["role:coder", "profile:marathon_24h"])).toBe("marathon_24h");
  });

  it("exposes expanded limits for marathon modes", () => {
    const standard = getAgentExecutionProfileConfig("standard");
    const marathon12h = getAgentExecutionProfileConfig("marathon_12h");
    const marathon24h = getAgentExecutionProfileConfig("marathon_24h");

    expect(marathon12h.maxPlanSteps).toBeGreaterThan(standard.maxPlanSteps);
    expect(marathon12h.maxRunDurationMs).toBeGreaterThan(standard.maxRunDurationMs);
    expect(marathon12h.subagent.maxSteps).toBeGreaterThan(standard.subagent.maxSteps);
    expect(marathon12h.subagent.stepTimeoutMs).toBeGreaterThan(standard.subagent.stepTimeoutMs);
    expect(marathon24h.maxPlanSteps).toBeGreaterThan(marathon12h.maxPlanSteps);
    expect(marathon24h.maxRunDurationMs).toBeGreaterThan(marathon12h.maxRunDurationMs);
    expect(marathon24h.subagent.maxSteps).toBeGreaterThan(marathon12h.subagent.maxSteps);
    expect(marathon24h.subagent.maxConsecutiveFailures).toBeGreaterThan(marathon12h.subagent.maxConsecutiveFailures);
  });
});
