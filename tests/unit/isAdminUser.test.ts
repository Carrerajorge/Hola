import { describe, expect, it } from "vitest";
import { isAdminUser } from "../../client/src/lib/admin";

describe("isAdminUser", () => {
  it("returns true when role is admin", () => {
    expect(isAdminUser({ role: "admin" })).toBe(true);
  });

  it("returns true when isAdmin flag is hydrated", () => {
    expect(isAdminUser({ isAdmin: true })).toBe(true);
  });

  it("returns true when email matches default admin email (direct)", () => {
    expect(isAdminUser({ email: "carrerajorge874@gmail.com" })).toBe(true);
    expect(isAdminUser({ email: "CARRERAJORGE874@GMAIL.COM" })).toBe(true);
  });

  it("returns true when email matches default admin email (claims)", () => {
    expect(isAdminUser({ claims: { email: "carrerajorge874@gmail.com" } })).toBe(true);
  });

  it("returns false for non-admin users", () => {
    expect(isAdminUser({ role: "user", email: "x@example.com" })).toBe(false);
  });
});

