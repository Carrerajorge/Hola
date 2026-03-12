import { describe, expect, it } from "vitest";

import { isAdminRole, normalizeRole } from "./adminRole";

describe("adminRole", () => {
  it("normalizes role strings safely", () => {
    expect(normalizeRole(" ADMIN ")).toBe("admin");
    expect(normalizeRole(null)).toBe("");
  });

  it("accepts admin roles regardless of casing", () => {
    expect(isAdminRole("ADMIN")).toBe(true);
    expect(isAdminRole(" admin ")).toBe(true);
    expect(isAdminRole("SuperAdmin")).toBe(true);
    expect(isAdminRole("user")).toBe(false);
  });
});
