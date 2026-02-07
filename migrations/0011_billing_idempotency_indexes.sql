-- Ensure billing idempotency for Stripe webhooks and invoice email delivery.
-- Safe to re-run.

CREATE UNIQUE INDEX IF NOT EXISTS payments_stripe_payment_id_unique_idx
  ON payments (stripe_payment_id);

CREATE UNIQUE INDEX IF NOT EXISTS invoices_user_invoice_number_unique_idx
  ON invoices (user_id, invoice_number);

