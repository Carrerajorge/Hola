import { describe, expect, it } from "vitest";
import { formatStripeAmountToMajorUnit, getStripeCustomerIdFromInvoice } from "./paymentIngestionService";

describe("paymentIngestionService", () => {
  describe("formatStripeAmountToMajorUnit", () => {
    it("formats 2-decimal currencies (USD)", () => {
      expect(formatStripeAmountToMajorUnit(1234, "usd")).toBe("12.34");
      expect(formatStripeAmountToMajorUnit("99", "USD")).toBe("0.99");
    });

    it("formats 0-decimal currencies (JPY)", () => {
      expect(formatStripeAmountToMajorUnit(1234, "jpy")).toBe("1234");
    });

    it("formats 3-decimal currencies (BHD)", () => {
      expect(formatStripeAmountToMajorUnit(1234, "bhd")).toBe("1.234");
    });

    it("returns a safe default for invalid amounts", () => {
      expect(formatStripeAmountToMajorUnit("not-a-number", "usd")).toBe("0.00");
    });
  });

  describe("getStripeCustomerIdFromInvoice", () => {
    it("returns a customer id when customer is a string", () => {
      expect(getStripeCustomerIdFromInvoice({ customer: "cus_123" })).toBe("cus_123");
    });

    it("returns a customer id when customer is an object", () => {
      expect(getStripeCustomerIdFromInvoice({ customer: { id: "cus_abc" } })).toBe("cus_abc");
    });

    it("returns null when missing or invalid", () => {
      expect(getStripeCustomerIdFromInvoice({})).toBe(null);
      expect(getStripeCustomerIdFromInvoice({ customer: 123 })).toBe(null);
    });
  });
});

