ALTER TABLE "agent_mode_events" ADD COLUMN IF NOT EXISTS "event_seq" integer;--> statement-breakpoint
ALTER TABLE "agent_mode_events" ADD COLUMN IF NOT EXISTS "trace_id" text;--> statement-breakpoint
ALTER TABLE "agent_mode_events" ADD COLUMN IF NOT EXISTS "span_id" text;--> statement-breakpoint
ALTER TABLE "agent_mode_events" ADD COLUMN IF NOT EXISTS "step_id" text;--> statement-breakpoint
ALTER TABLE "agent_mode_events" ADD COLUMN IF NOT EXISTS "severity" text DEFAULT 'info';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "agent_mode_events_run_seq_idx" ON "agent_mode_events" USING btree ("run_id", "event_seq");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_mode_events_run_seq_unique" ON "agent_mode_events" USING btree ("run_id", "event_seq") WHERE "event_seq" IS NOT NULL;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "agent_mode_runs_chat_idempotency_unique"
  ON "agent_mode_runs" USING btree ("chat_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "agent_mode_artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" varchar NOT NULL,
  "step_id" varchar NOT NULL,
  "step_index" integer NOT NULL,
  "artifact_key" text NOT NULL,
  "type" text NOT NULL,
  "name" text NOT NULL,
  "url" text,
  "payload" jsonb,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "agent_mode_artifacts_dedupe_idx" UNIQUE("run_id", "step_id", "artifact_key")
);--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_mode_artifacts_run_id_agent_mode_runs_id_fk'
  ) THEN
    ALTER TABLE "agent_mode_artifacts"
      ADD CONSTRAINT "agent_mode_artifacts_run_id_agent_mode_runs_id_fk"
      FOREIGN KEY ("run_id") REFERENCES "public"."agent_mode_runs"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_mode_artifacts_step_id_agent_mode_steps_id_fk'
  ) THEN
    ALTER TABLE "agent_mode_artifacts"
      ADD CONSTRAINT "agent_mode_artifacts_step_id_agent_mode_steps_id_fk"
      FOREIGN KEY ("step_id") REFERENCES "public"."agent_mode_steps"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "agent_mode_artifacts_run_idx" ON "agent_mode_artifacts" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_mode_artifacts_step_idx" ON "agent_mode_artifacts" USING btree ("step_id");--> statement-breakpoint
