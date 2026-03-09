import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveCommandAuthorizedFromAuthorizers as resolveSuperIntelligenceCommandAuthorization,
  resolveDefaultCommandGatingModeWhenAccessGroupsOff as resolveSuperIntelligenceDefaultMode,
} from "../../server/services/superIntelligence/channels/command-gating.js";
import {
  resolveCommandAuthorizedFromAuthorizers as resolveOpenClawCommandAuthorization,
  resolveDefaultCommandGatingModeWhenAccessGroupsOff as resolveOpenClawDefaultMode,
} from "../../server/openclaw/src/channels/command-gating.js";

describe("command gating defaults", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses a secure configured default in the superIntelligence channel helpers", () => {
    expect(resolveSuperIntelligenceDefaultMode()).toBe("configured");
    expect(
      resolveSuperIntelligenceCommandAuthorization({
        useAccessGroups: false,
        authorizers: [{ configured: true, allowed: false }],
      }),
    ).toBe(false);
  });

  it("uses a secure configured default in the OpenClaw channel helpers", () => {
    expect(resolveOpenClawDefaultMode()).toBe("configured");
    expect(
      resolveOpenClawCommandAuthorization({
        useAccessGroups: false,
        authorizers: [{ configured: true, allowed: false }],
      }),
    ).toBe(false);
  });

  it("honors environment overrides for both command-gating implementations", () => {
    vi.stubEnv("CHANNEL_COMMAND_GATING_MODE_WHEN_ACCESS_GROUPS_OFF", "allow");
    expect(resolveSuperIntelligenceDefaultMode()).toBe("allow");
    expect(resolveOpenClawDefaultMode()).toBe("allow");
  });
});
