import { describe, it, expect } from "vitest";

import { sendPaymentEmail } from "./genericEmailService";

describe("genericEmailService.sendPaymentEmail", () => {
  it("accepts string amounts without throwing", async () => {
    const res = await sendPaymentEmail("test@example.com", {
      invoiceId: "INV-TEST-001",
      amount: "€99,50",
      currency: "eur",
      status: "paid",
      invoiceUrl: "https://example.com/invoice.pdf",
    });

    expect(res.success).toBe(true);
    expect(res.messageId).toBeTruthy();
  });
});

