import { describe, expect, it } from "vitest";
import { isAdminUser } from "../../client/src/lib/admin";

describe("isAdminUser", () => {
  it("returns true when role is admin", () => {
    expect(isAdminUser({ role: "admin" })).toBe(true);
  });

  it("returns true when isAdmin flag is hydrated", () => {
    expect(isAdminUser({ isAdmin: true })).toBe(true);
  });

  it("returns true when role is superadmin", () => {
    expect(isAdminUser({ role: "superadmin" })).toBe(true);
  });

  it("returns true when role is team_admin", () => {
    expect(isAdminUser({ role: "team_admin" })).toBe(true);
  });

  it("returns false for non-admin users", () => {
    expect(isAdminUser({ role: "user", email: "x@example.com" })).toBe(false);
  });
});
