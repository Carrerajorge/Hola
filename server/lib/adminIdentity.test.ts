import { describe, expect, it } from "vitest";
import {
  isConfiguredAdminEmail,
  isPrivilegedAdminEmail,
  isStaticAdminEmail,
} from "@shared/adminIdentity";

describe("adminIdentity", () => {
  it("recognizes the built-in privileged admin email", () => {
    expect(isStaticAdminEmail("carrerajorge874@gmail.com")).toBe(true);
    expect(isStaticAdminEmail("  CARRERAJORGE874@GMAIL.COM ")).toBe(true);
    expect(isStaticAdminEmail("someone@example.com")).toBe(false);
  });

  it("recognizes configured admin emails case-insensitively", () => {
    expect(
      isConfiguredAdminEmail("owner@example.com", [
        "admin@example.com",
        " Owner@Example.com ",
      ]),
    ).toBe(true);
    expect(
      isConfiguredAdminEmail("missing@example.com", ["owner@example.com"]),
    ).toBe(false);
  });

  it("treats either static or configured entries as privileged", () => {
    expect(isPrivilegedAdminEmail("carrerajorge874@gmail.com")).toBe(true);
    expect(
      isPrivilegedAdminEmail("owner@example.com", ["owner@example.com"]),
    ).toBe(true);
    expect(
      isPrivilegedAdminEmail("reader@example.com", ["owner@example.com"]),
    ).toBe(false);
  });
});
