import { describe, it, expect, beforeEach } from "vitest";

import { sendPaymentEmail } from "./genericEmailService";

describe("genericEmailService.sendPaymentEmail", () => {
  beforeEach(() => {
    // Force dev-mode path; tests must not hit real email providers.
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_SMTP_HOST;
    delete process.env.EMAIL_SMTP_USER;
    delete process.env.EMAIL_SMTP_PASS;
  });

  it("accepts string amounts without throwing", async () => {
    const res = await sendPaymentEmail("test@example.com", {
      invoiceId: "INV-TEST-001",
      amount: "EUR 99,50",
      currency: "eur",
      status: "paid",
      invoiceUrl: "https://example.com/invoice.pdf",
    });

    expect(res.success).toBe(true);
    expect(res.messageId).toBeTruthy();
  });
});
