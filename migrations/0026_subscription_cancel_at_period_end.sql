ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "subscription_cancel_at_period_end" boolean DEFAULT false;--> statement-breakpoint

UPDATE "users"
SET "subscription_cancel_at_period_end" = false
WHERE "subscription_cancel_at_period_end" IS NULL;--> statement-breakpoint
