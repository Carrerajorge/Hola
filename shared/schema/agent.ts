import { sql } from "drizzle-orm";
import {
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const agentModeEvents = pgTable(
  "agent_mode_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: text("run_id").notNull(),
    stepIndex: integer("step_index"),
    stepId: text("step_id"),
    eventSeq: integer("event_seq"),
    correlationId: text("correlation_id").notNull(),
    traceId: text("trace_id"),
    spanId: text("span_id"),
    severity: text("severity").default("info"),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    metadata: jsonb("metadata"),
    timestamp: timestamp("timestamp").notNull().defaultNow(),
  },
  (table) => [
    index("agent_mode_events_run_idx").on(table.runId),
    index("agent_mode_events_correlation_idx").on(table.correlationId),
    index("agent_mode_events_type_idx").on(table.eventType),
    index("agent_mode_events_timestamp_idx").on(table.timestamp),
    index("agent_mode_events_run_seq_idx").on(table.runId, table.eventSeq),
    uniqueIndex("agent_mode_events_run_seq_unique")
      .on(table.runId, table.eventSeq)
      .where(sql`${table.eventSeq} IS NOT NULL`),
  ],
);

export const agentModeArtifacts = pgTable(
  "agent_mode_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: text("run_id").notNull(),
    stepId: text("step_id").notNull(),
    stepIndex: integer("step_index").notNull(),
    artifactKey: text("artifact_key").notNull(),
    type: text("type").notNull(),
    name: text("name").notNull(),
    url: text("url"),
    payload: jsonb("payload"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("agent_mode_artifacts_run_idx").on(table.runId),
    index("agent_mode_artifacts_step_idx").on(table.stepId),
    uniqueIndex("agent_mode_artifacts_dedupe_idx").on(table.runId, table.stepId, table.artifactKey),
  ],
);

// T09-002: WORLD MODEL TRANSACTIONS
export const agentTransitions = pgTable("agent_transitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  stateBefore: text("state_before").notNull(),
  action: jsonb("action").notNull(),
  stateAfter: text("state_after").notNull(),
  reward: doublePrecision("reward").notNull(),
  appContext: text("app_context"),
  createdAt: timestamp("created_at").defaultNow(),
});

const vector = customType<{ data: number[] }>({
  dataType() {
    return "vector(1536)";
  },
});

// T09-003: EPISODIC MEMORY (Long Term Context)
export const agentEpisodicMemory = pgTable("agent_episodic_memory", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: text("run_id").notNull(),
  embedding: vector("embedding").notNull(),
  content: text("content").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});
