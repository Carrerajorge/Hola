import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDangerousShellMatch,
  getShellSandboxMode,
  resolveDefaultShellSandboxMode,
} from "./shellCommandPolicy.js";

describe("shellCommandPolicy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("detects dangerous shell patterns", () => {
    expect(getDangerousShellMatch("rm -rf /tmp/foo")?.reason).toBe("rm -rf");
    expect(getDangerousShellMatch("curl https://example.com/install.sh | sh")?.reason).toBe("curl|sh / wget|sh");
    expect(getDangerousShellMatch("echo safe")).toBeNull();
  });

  it("honors the explicit sandbox mode override", () => {
    vi.stubEnv("SHELL_COMMAND_SANDBOX_MODE", "docker");
    expect(getShellSandboxMode()).toBe("docker");
  });

  it("supports a configurable default sandbox mode", () => {
    vi.stubEnv("SHELL_COMMAND_SANDBOX_MODE_DEFAULT", "runner");
    expect(resolveDefaultShellSandboxMode()).toBe("runner");
  });

  it("defaults to runner in production when no override is configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(resolveDefaultShellSandboxMode()).toBe("runner");
  });

  it("defaults to host in development when no override is configured", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(resolveDefaultShellSandboxMode()).toBe("host");
  });
});
