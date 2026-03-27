import { afterEach, describe, expect, it } from "vitest";

import {
  ACTIVE_SUBSCRIPTION_PLANS,
  getConfiguredProductId,
  getPlanKeyFromAlias,
  getPlanKeyFromAmount,
  getPlanKeyFromProductId,
} from "../server/lib/stripeActivePlans";

const originalStripeProductGo = process.env.STRIPE_PRODUCT_GO;
const originalStripeProductPlus = process.env.STRIPE_PRODUCT_PLUS;

afterEach(() => {
  if (originalStripeProductGo === undefined) {
    delete process.env.STRIPE_PRODUCT_GO;
  } else {
    process.env.STRIPE_PRODUCT_GO = originalStripeProductGo;
  }

  if (originalStripeProductPlus === undefined) {
    delete process.env.STRIPE_PRODUCT_PLUS;
  } else {
    process.env.STRIPE_PRODUCT_PLUS = originalStripeProductPlus;
  }
});

describe("stripeActivePlans", () => {
  it("uses the configured fallback product ids for go and plus", () => {
    delete process.env.STRIPE_PRODUCT_GO;
    delete process.env.STRIPE_PRODUCT_PLUS;

    expect(getConfiguredProductId("go")).toBe(ACTIVE_SUBSCRIPTION_PLANS.go.defaultProductId);
    expect(getConfiguredProductId("plus")).toBe(ACTIVE_SUBSCRIPTION_PLANS.plus.defaultProductId);
  });

  it("supports overriding the product ids from env", () => {
    process.env.STRIPE_PRODUCT_GO = "prod_override_go";
    process.env.STRIPE_PRODUCT_PLUS = "prod_override_plus";

    expect(getConfiguredProductId("go")).toBe("prod_override_go");
    expect(getConfiguredProductId("plus")).toBe("prod_override_plus");
  });

  it("maps aliases, amounts and product ids back to the active plans", () => {
    delete process.env.STRIPE_PRODUCT_GO;
    delete process.env.STRIPE_PRODUCT_PLUS;

    expect(getPlanKeyFromAlias("price_go_monthly")).toBe("go");
    expect(getPlanKeyFromAlias("price_plus_monthly")).toBe("plus");
    expect(getPlanKeyFromAmount(500)).toBe("go");
    expect(getPlanKeyFromAmount(1000)).toBe("plus");
    expect(getPlanKeyFromProductId("prod_UCZVvFMHeIWdLC")).toBe("go");
    expect(getPlanKeyFromProductId("prod_UCZWW8ZDfZzUWk")).toBe("plus");
  });
});
