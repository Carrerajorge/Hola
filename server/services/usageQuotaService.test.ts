import { describe, expect, it } from "vitest";

import { computeWillDeactivate } from "./usageQuotaService";

describe("computeWillDeactivate", () => {
  it("returns true when a paid subscription is set to cancel at period end", () => {
    expect(
      computeWillDeactivate({
        subscriptionStatus: "active",
        subscriptionCancelAtPeriodEnd: true,
        subscriptionPeriodEnd: new Date(Date.now() + 86_400_000),
        subscriptionExpiresAt: null,
      } as any),
    ).toBe(true);
  });

  it("returns true for cancelled-like states while access remains active", () => {
    expect(
      computeWillDeactivate({
        subscriptionStatus: "cancelled",
        subscriptionCancelAtPeriodEnd: false,
        subscriptionPeriodEnd: null,
        subscriptionExpiresAt: new Date(Date.now() + 86_400_000),
      } as any),
    ).toBe(true);
  });

  it("returns false when there is no future billing boundary", () => {
    expect(
      computeWillDeactivate({
        subscriptionStatus: "active",
        subscriptionCancelAtPeriodEnd: true,
        subscriptionPeriodEnd: new Date(Date.now() - 60_000),
        subscriptionExpiresAt: null,
      } as any),
    ).toBe(false);
  });
});
