import { describe, it, expect } from "vitest";
import {
  getEffectivePlan,
  getPlanLabel,
  isActivePaidSubscriptionStatus,
  isPaidPlan,
  shouldShowUpgradeCTA,
} from "./planUtils";

describe("getEffectivePlan", () => {
  it("returns 'free' for null/undefined user", () => {
    expect(getEffectivePlan(null)).toBe("free");
    expect(getEffectivePlan(undefined)).toBe("free");
  });

  it("returns 'admin' for admin/superadmin roles", () => {
    expect(getEffectivePlan({ role: "admin" })).toBe("admin");
    expect(getEffectivePlan({ role: "superadmin" })).toBe("admin");
    expect(getEffectivePlan({ role: "ADMIN" })).toBe("admin");
    expect(getEffectivePlan({ role: "  Admin  " })).toBe("admin");
    expect(getEffectivePlan({ isAdmin: true })).toBe("admin");
  });

  it("prefers active subscription plan", () => {
    expect(
      getEffectivePlan({ subscriptionStatus: "active", subscriptionPlan: "pro" })
    ).toBe("pro");
    expect(
      getEffectivePlan({ subscriptionStatus: "trialing", subscriptionPlan: "go" })
    ).toBe("go");
    expect(
      getEffectivePlan({ subscriptionStatus: "active", plan: "plus" })
    ).toBe("plus");
    expect(
      getEffectivePlan({ subscriptionStatus: "active", subscriptionPlan: "enterprise" })
    ).toBe("enterprise");
  });

  it("ignores inactive subscription", () => {
    expect(
      getEffectivePlan({ subscriptionStatus: "canceled", subscriptionPlan: "pro", plan: "free" })
    ).toBe("free");
    expect(
      getEffectivePlan({ subscriptionStatus: "past_due", subscriptionPlan: "pro" })
    ).toBe("free");
    expect(
      getEffectivePlan({ subscriptionStatus: "canceled", subscriptionPlan: "plus", plan: "plus" })
    ).toBe("free");
  });

  it("falls back to user.plan", () => {
    expect(getEffectivePlan({ plan: "go" })).toBe("go");
    expect(getEffectivePlan({ plan: "Plus" })).toBe("plus");
  });

  it("returns 'free' when no plan info", () => {
    expect(getEffectivePlan({})).toBe("free");
    expect(getEffectivePlan({ plan: null })).toBe("free");
    expect(getEffectivePlan({ plan: "" })).toBe("free");
  });
});

describe("getPlanLabel", () => {
  it("returns correct labels for known plans", () => {
    expect(getPlanLabel(null)).toBe("Free");
    expect(getPlanLabel({ role: "admin" })).toBe("Admin");
    expect(getPlanLabel({ subscriptionStatus: "active", subscriptionPlan: "enterprise" })).toBe("Enterprise");
    expect(getPlanLabel({ subscriptionStatus: "active", subscriptionPlan: "business" })).toBe("Enterprise");
    expect(getPlanLabel({ subscriptionStatus: "active", subscriptionPlan: "go" })).toBe("Go");
    expect(getPlanLabel({ subscriptionStatus: "active", subscriptionPlan: "plus" })).toBe("Plus");
    expect(getPlanLabel({ subscriptionStatus: "active", subscriptionPlan: "pro" })).toBe("Pro");
  });

  it("capitalizes unknown plans", () => {
    expect(getPlanLabel({ subscriptionStatus: "active", subscriptionPlan: "custom" })).toBe("Custom");
  });
});

describe("isPaidPlan", () => {
  it("returns false for free users", () => {
    expect(isPaidPlan(null)).toBe(false);
    expect(isPaidPlan({ plan: "free" })).toBe(false);
  });
  it("returns false for admin", () => {
    expect(isPaidPlan({ role: "admin" })).toBe(false);
    expect(isPaidPlan({ isAdmin: true, isPaid: true })).toBe(false);
  });
  it("returns true for paid plans", () => {
    expect(isPaidPlan({ subscriptionStatus: "active", subscriptionPlan: "pro" })).toBe(true);
    expect(isPaidPlan({ subscriptionStatus: "trialing", subscriptionPlan: "go" })).toBe(true);
    expect(isPaidPlan({ subscriptionStatus: "active", subscriptionPlan: "enterprise" })).toBe(true);
    expect(isPaidPlan({ plan: "go" })).toBe(true);
    expect(isPaidPlan({ isPaid: true })).toBe(true);
  });
});

describe("shouldShowUpgradeCTA", () => {
  it("shows the CTA for free or cancelled users", () => {
    expect(shouldShowUpgradeCTA(null)).toBe(true);
    expect(shouldShowUpgradeCTA({ plan: "free" })).toBe(true);
    expect(
      shouldShowUpgradeCTA({
        plan: "go",
        subscriptionPlan: "go",
        subscriptionStatus: "cancelled",
      }),
    ).toBe(true);
  });

  it("shows the CTA again when a paid plan is scheduled to deactivate", () => {
    expect(
      shouldShowUpgradeCTA({
        plan: "go",
        subscriptionPlan: "go",
        subscriptionStatus: "inactive",
        willDeactivate: true,
      }),
    ).toBe(true);
    expect(
      shouldShowUpgradeCTA({
        plan: "go",
        subscriptionPlan: "go",
        subscriptionStatus: "active",
        willDeactivate: true,
      }),
    ).toBe(true);
  });

  it("hides the CTA for active paid subscribers", () => {
    expect(
      shouldShowUpgradeCTA({
        plan: "free",
        subscriptionPlan: "go",
        subscriptionStatus: "active",
      }),
    ).toBe(false);
    expect(
      shouldShowUpgradeCTA({
        plan: "free",
        subscriptionPlan: "go",
        subscriptionStatus: "trialing",
      }),
    ).toBe(false);
  });

  it("hides the CTA for admins", () => {
    expect(shouldShowUpgradeCTA({ role: "admin" })).toBe(false);
    expect(shouldShowUpgradeCTA({ isAdmin: true })).toBe(false);
  });

  it("falls back to isPaid when subscription metadata is unavailable", () => {
    expect(shouldShowUpgradeCTA({ isPaid: true, plan: "free" })).toBe(false);
    expect(shouldShowUpgradeCTA({ isPaid: false, plan: "free" })).toBe(true);
  });
});

describe("isActivePaidSubscriptionStatus", () => {
  it("treats active and trialing as billable states", () => {
    expect(isActivePaidSubscriptionStatus("active")).toBe(true);
    expect(isActivePaidSubscriptionStatus("trialing")).toBe(true);
  });

  it("treats cancelled-like states as unpaid", () => {
    expect(isActivePaidSubscriptionStatus("canceled")).toBe(false);
    expect(isActivePaidSubscriptionStatus("cancelled")).toBe(false);
    expect(isActivePaidSubscriptionStatus("past_due")).toBe(false);
    expect(isActivePaidSubscriptionStatus(undefined)).toBe(false);
  });
});
