import { describe, expect, it } from "vitest";
import { getEffectivePlan, getPlanLabel, isPaidPlan } from "../../client/src/lib/planUtils";

describe("planUtils", () => {
  it("defaults to free when user is null", () => {
    expect(getEffectivePlan(null)).toBe("free");
    expect(getPlanLabel(null)).toBe("Free");
    expect(isPaidPlan(null)).toBe(false);
  });

  it("treats admin role as admin", () => {
    expect(getEffectivePlan({ role: "admin", plan: "enterprise" })).toBe("admin");
    expect(getPlanLabel({ role: "admin", plan: "enterprise" })).toBe("Admin");
    expect(isPaidPlan({ role: "admin", plan: "pro" })).toBe(false);
  });

  it("prefers active subscriptionPlan over stored plan", () => {
    const u = { plan: "free", subscriptionStatus: "active", subscriptionPlan: "pro" };
    expect(getEffectivePlan(u)).toBe("pro");
    expect(getPlanLabel(u)).toBe("Pro");
    expect(isPaidPlan(u)).toBe(true);
  });

  it("ignores subscriptionPlan when subscription is not active", () => {
    const u = { plan: "free", subscriptionStatus: "canceled", subscriptionPlan: "pro" };
    expect(getEffectivePlan(u)).toBe("free");
    expect(getPlanLabel(u)).toBe("Free");
    expect(isPaidPlan(u)).toBe(false);
  });

  it("maps known plans to labels", () => {
    expect(getPlanLabel({ plan: "go" })).toBe("Go");
    expect(getPlanLabel({ plan: "plus" })).toBe("Plus");
    expect(getPlanLabel({ plan: "enterprise" })).toBe("Enterprise");
  });
});
