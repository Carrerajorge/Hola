-- Persist execution profile for long-running agent sessions

ALTER TABLE "agent_mode_runs"
  ADD COLUMN IF NOT EXISTS "execution_profile" text NOT NULL DEFAULT 'standard';
