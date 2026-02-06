-- Add missing column used by shared/schema/auth.ts (users.phoneVerified)
-- Idempotent to allow safe re-runs across environments.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "phone_verified" text DEFAULT 'false';

-- Backfill older rows (safe even if column already existed)
UPDATE "users"
SET "phone_verified" = 'false'
WHERE "phone_verified" IS NULL;

