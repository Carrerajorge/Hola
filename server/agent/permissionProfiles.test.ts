import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getPermissionProfile,
  resolveDefaultPermissionProfile,
  setPermissionProfile,
} from "./permissionProfiles.js";

describe("resolveDefaultPermissionProfile", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    setPermissionProfile("full");
  });

  it("uses the configured environment default when valid", () => {
    vi.stubEnv("AGENT_PERMISSION_PROFILE_DEFAULT", "coding");
    expect(resolveDefaultPermissionProfile()).toBe("coding");
  });

  it("falls back to full when the environment default is invalid", () => {
    vi.stubEnv("AGENT_PERMISSION_PROFILE_DEFAULT", "not-a-profile");
    expect(resolveDefaultPermissionProfile()).toBe("full");
  });

  it("still allows explicit runtime profile changes", () => {
    setPermissionProfile("messaging");
    expect(getPermissionProfile()).toBe("messaging");
  });
});
