import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveCommandAuthorizedFromAuthorizers,
  resolveControlCommandGate,
  resolveDefaultCommandGatingModeWhenAccessGroupsOff,
} from "./command-gating.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveCommandAuthorizedFromAuthorizers", () => {
  it("denies when useAccessGroups is enabled and no authorizer is configured", () => {
    expect(
      resolveCommandAuthorizedFromAuthorizers({
        useAccessGroups: true,
        authorizers: [{ configured: false, allowed: true }],
      }),
    ).toBe(false);
  });

  it("allows when useAccessGroups is enabled and any configured authorizer allows", () => {
    expect(
      resolveCommandAuthorizedFromAuthorizers({
        useAccessGroups: true,
        authorizers: [
          { configured: true, allowed: false },
          { configured: true, allowed: true },
        ],
      }),
    ).toBe(true);
  });

  it("denies by default when access groups are disabled but a configured authorizer disallows", () => {
    expect(
      resolveCommandAuthorizedFromAuthorizers({
        useAccessGroups: false,
        authorizers: [{ configured: true, allowed: false }],
      }),
    ).toBe(false);
  });

  it("allows by default when access groups are disabled and no authorizer is configured", () => {
    expect(
      resolveCommandAuthorizedFromAuthorizers({
        useAccessGroups: false,
        authorizers: [{ configured: false, allowed: false }],
      }),
    ).toBe(true);
  });

  it("honors modeWhenAccessGroupsOff=deny", () => {
    expect(
      resolveCommandAuthorizedFromAuthorizers({
        useAccessGroups: false,
        authorizers: [{ configured: false, allowed: true }],
        modeWhenAccessGroupsOff: "deny",
      }),
    ).toBe(false);
  });

  it("honors modeWhenAccessGroupsOff=configured (allow when none configured)", () => {
    expect(
      resolveCommandAuthorizedFromAuthorizers({
        useAccessGroups: false,
        authorizers: [{ configured: false, allowed: false }],
        modeWhenAccessGroupsOff: "configured",
      }),
    ).toBe(true);
  });

  it("honors modeWhenAccessGroupsOff=configured (enforce when configured)", () => {
    expect(
      resolveCommandAuthorizedFromAuthorizers({
        useAccessGroups: false,
        authorizers: [{ configured: true, allowed: false }],
        modeWhenAccessGroupsOff: "configured",
      }),
    ).toBe(false);
    expect(
      resolveCommandAuthorizedFromAuthorizers({
        useAccessGroups: false,
        authorizers: [{ configured: true, allowed: true }],
        modeWhenAccessGroupsOff: "configured",
      }),
    ).toBe(true);
  });

  it("supports environment override for the default mode", () => {
    vi.stubEnv("CHANNEL_COMMAND_GATING_MODE_WHEN_ACCESS_GROUPS_OFF", "allow");
    expect(resolveDefaultCommandGatingModeWhenAccessGroupsOff()).toBe("allow");
    expect(
      resolveCommandAuthorizedFromAuthorizers({
        useAccessGroups: false,
        authorizers: [{ configured: true, allowed: false }],
      }),
    ).toBe(true);
  });
});

describe("resolveControlCommandGate", () => {
  it("blocks control commands when unauthorized", () => {
    const result = resolveControlCommandGate({
      useAccessGroups: true,
      authorizers: [{ configured: true, allowed: false }],
      allowTextCommands: true,
      hasControlCommand: true,
    });
    expect(result.commandAuthorized).toBe(false);
    expect(result.shouldBlock).toBe(true);
  });

  it("does not block when control commands are disabled", () => {
    const result = resolveControlCommandGate({
      useAccessGroups: true,
      authorizers: [{ configured: true, allowed: false }],
      allowTextCommands: false,
      hasControlCommand: true,
    });
    expect(result.shouldBlock).toBe(false);
  });
});
