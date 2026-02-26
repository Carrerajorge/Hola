import { pgTable, text, varchar, integer, boolean, jsonb, timestamp, real, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { users } from "./auth";

export const skillScopeSchema = z.enum([
  "storage.read",
  "storage.write",
  "browser",
  "email",
  "database",
  "external_network",
  "code_interpreter",
  "files",
  "system",
]);

export const skillModeSchema = z.enum(["workflow", "code"]);
export const skillStatusSchema = z.enum(["draft", "active", "inactive", "deprecated", "archived"]);
export const skillExecutionStatusSchema = z.enum(["pending", "running", "partial", "completed", "failed", "skipped"]);

export const jsonSchemaSchema = z.record(z.string(), z.any());

export const skillErrorContractSchema = z.object({
  code: z.string().min(1).max(80),
  message: z.string().min(1).max(200),
  retryable: z.boolean().default(false),
  retryDelayMs: z.number().min(0).max(120000).default(2000),
  fallbackHint: z.string().max(400).optional(),
});

export const skillExecutionPolicySchema = z.object({
  maxRetries: z.number().int().min(0).max(6).default(2),
  timeoutMs: z.number().int().min(100).max(180000).default(30000),
  cpuLimitMs: z.number().int().min(10).max(600000).optional(),
  memoryLimitMb: z.number().int().min(32).max(2048).optional(),
  requiresConfirmation: z.boolean().default(false),
  allowExternalSideEffects: z.boolean().default(false),
});

export const skillDependencySchema = z.object({
  skillId: z.string(),
  minVersion: z.number().int().positive().default(1),
  reason: z.string().max(300).optional(),
});

export const skillWorkflowStepSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(["internal", "tool", "code"]),
  name: z.string().min(1).max(80),
  toolName: z.string().max(120).optional(),
  input: z.record(z.string(), z.any()).default({}),
  inputSchema: jsonSchemaSchema.optional(),
  outputKey: z.string().min(1).max(80),
  continueOnError: z.boolean().default(false),
  dependsOn: z.array(z.string()).default([]),
  timeoutMs: z.number().int().min(100).max(120000).optional(),
  requiredScopes: z.array(skillScopeSchema).default([]),
});

export const skillWorkflowDefinitionSchema = z.object({
  steps: z.array(skillWorkflowStepSchema).min(1).max(12),
  resultStep: z.string().max(80).optional(),
});

export const skillCodeDefinitionSchema = z.object({
  language: z.enum(["javascript", "python"]),
  source: z.string().min(1).max(40000),
});

export const skillSpecSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(500),
  category: z.string().min(1).max(80).default("general"),
  inputSchema: jsonSchemaSchema,
  outputSchema: jsonSchemaSchema,
  permissions: z.array(skillScopeSchema).default([]),
  expectedLatencyMs: z.number().min(1).default(1500),
  expectedCostCents: z.number().min(0).default(0),
  dependencies: z.array(skillDependencySchema).default([]),
  errorContract: z.array(skillErrorContractSchema).default([]),
  examples: z.array(z.string()).max(8).default([]),
  tags: z.array(z.string().max(60)).max(20).default([]),
  implementationMode: skillModeSchema,
  workflow: skillWorkflowDefinitionSchema.optional(),
  code: skillCodeDefinitionSchema.optional(),
  executionPolicy: skillExecutionPolicySchema.default({
    maxRetries: 2,
    timeoutMs: 30000,
    requiresConfirmation: false,
    allowExternalSideEffects: false,
  }),
  status: skillStatusSchema.default("draft"),
});

export type SkillScope = z.infer<typeof skillScopeSchema>;
export type SkillMode = z.infer<typeof skillModeSchema>;
export type SkillStatus = z.infer<typeof skillStatusSchema>;
export type SkillExecutionStatus = z.infer<typeof skillExecutionStatusSchema>;
export type SkillSpec = z.infer<typeof skillSpecSchema>;
export type SkillErrorContract = z.infer<typeof skillErrorContractSchema>;
export type SkillExecutionPolicy = z.infer<typeof skillExecutionPolicySchema>;
export type SkillWorkflowStep = z.infer<typeof skillWorkflowStepSchema>;
export type SkillWorkflowDefinition = z.infer<typeof skillWorkflowDefinitionSchema>;
export type SkillCodeDefinition = z.infer<typeof skillCodeDefinitionSchema>;

export const skillCatalog = pgTable("skill_catalog", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  slug: varchar("slug", { length: 140 }).notNull().unique(),
  ownerId: varchar("owner_id").references(() => users.id, { onDelete: "set null" }),
  name: varchar("name", { length: 160 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 80 }).notNull().default("general"),
  isManaged: boolean("is_managed").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  latestVersion: integer("latest_version").notNull().default(1),
  activeVersion: integer("active_version").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table: any) => [
  index("skill_catalog_owner_idx").on(table.ownerId),
  index("skill_catalog_category_idx").on(table.category),
  uniqueIndex("skill_catalog_slug_idx").on(table.slug),
]);

export const insertSkillCatalogSchema = createInsertSchema(skillCatalog);
export type InsertSkillCatalog = z.infer<typeof insertSkillCatalogSchema>;
export type SkillCatalog = typeof skillCatalog.$inferSelect;

export const skillCatalogVersions = pgTable("skill_catalog_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  catalogId: varchar("catalog_id").notNull().references(() => skillCatalog.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  status: text("status").notNull().default("draft"),
  spec: jsonb("spec").notNull(),
  inputSchema: jsonb("input_schema").notNull(),
  outputSchema: jsonb("output_schema").notNull(),
  permissions: text("permissions").array().notNull().default([]),
  expectedLatencyMs: integer("expected_latency_ms").notNull().default(1500),
  expectedCostCents: real("expected_cost_cents").notNull().default(0),
  dependencies: jsonb("dependencies").$type<z.infer<typeof skillDependencySchema>[]>().default([]),
  errorContract: jsonb("error_contract").$type<SkillErrorContract[]>().default([]),
  executionPolicy: jsonb("execution_policy").$type<SkillExecutionPolicy>().notNull(),
  implementationMode: text("implementation_mode").notNull().default("workflow"),
  workflow: jsonb("workflow"),
  code: jsonb("code"),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  createdFrom: text("created_from"),
  approvedBy: varchar("approved_by").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at"),
}, (table: any) => [
  uniqueIndex("skill_catalog_versions_unique").on(table.catalogId, table.version),
  index("skill_catalog_versions_catalog_idx").on(table.catalogId),
  index("skill_catalog_versions_status_idx").on(table.status),
]);

export const insertSkillCatalogVersionSchema = createInsertSchema(skillCatalogVersions);
export type InsertSkillCatalogVersion = z.infer<typeof insertSkillCatalogVersionSchema>;
export type SkillCatalogVersion = typeof skillCatalogVersions.$inferSelect;

export const skillExecutionRuns = pgTable("skill_execution_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id"),
  runId: varchar("run_id"),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  catalogId: varchar("catalog_id").notNull().references(() => skillCatalog.id, { onDelete: "cascade" }),
  versionId: varchar("version_id").notNull().references(() => skillCatalogVersions.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("running"),
  requestText: text("request_text").notNull(),
  input: jsonb("input").notNull().default({}),
  output: jsonb("output"),
  partialOutput: jsonb("partial_output"),
  policy: jsonb("policy").$type<SkillExecutionPolicy>(),
  error: jsonb("error"),
  fallbackUsed: boolean("fallback_used").default(false),
  latencyMs: integer("latency_ms"),
  traces: jsonb("traces").$type<Record<string, any>[]>().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
}, (table: any) => [
  index("skill_execution_runs_conversation_idx").on(table.conversationId),
  index("skill_execution_runs_run_idx").on(table.runId),
  index("skill_execution_runs_user_idx").on(table.userId),
  index("skill_execution_runs_status_idx").on(table.status),
]);

export const insertSkillExecutionRunsSchema = createInsertSchema(skillExecutionRuns);
export type InsertSkillExecutionRun = z.infer<typeof insertSkillExecutionRunsSchema>;
export type SkillExecutionRun = typeof skillExecutionRuns.$inferSelect;

// =============================================================================
// Custom Skills — migrated from schema.bak.ts
// =============================================================================

export const skillCategorySchema = z.enum(["documents", "data", "integrations", "automation", "custom"]);
export const skillActionTypeSchema = z.enum(["api_call", "shell_command", "file_operation", "llm_prompt", "chain", "conditional"]);

export const skillParameterSchema = z.object({
    name: z.string(),
    type: z.enum(["string", "number", "boolean", "array", "object", "file"]),
    description: z.string(),
    required: z.boolean().default(true),
    defaultValue: z.any().optional(),
    validation: z.string().optional(),
    options: z.array(z.string()).optional(),
});

export const skillActionSchema = z.object({
    id: z.string(),
    type: skillActionTypeSchema,
    name: z.string(),
    description: z.string().optional(),
    config: z.record(z.any()),
    dependsOn: z.array(z.string()).optional(),
    condition: z.string().optional(),
    onSuccess: z.string().optional(),
    onError: z.string().optional(),
});

export const skillTriggerSchema = z.object({
    type: z.enum(["keyword", "pattern", "intent", "manual"]),
    value: z.string(),
    priority: z.number().default(0),
});

export const customSkills = pgTable("custom_skills", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    description: text("description"),
    instructions: text("instructions"),
    category: varchar("category", { length: 50 }).notNull().default("custom"),
    icon: varchar("icon", { length: 50 }),
    color: varchar("color", { length: 20 }),
    enabled: boolean("enabled").default(true),
    isPublic: boolean("is_public").default(false),
    version: integer("version").default(1),
    parameters: jsonb("parameters").$type<z.infer<typeof skillParameterSchema>[]>().default([]),
    actions: jsonb("actions").$type<z.infer<typeof skillActionSchema>[]>().default([]),
    triggers: jsonb("triggers").$type<z.infer<typeof skillTriggerSchema>[]>().default([]),
    outputFormat: varchar("output_format", { length: 50 }),
    features: text("features").array(),
    tags: text("tags").array(),
    usageCount: integer("usage_count").default(0),
    lastUsedAt: timestamp("last_used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table: any) => [
    index("custom_skills_user_id_idx").on(table.userId),
    index("custom_skills_category_idx").on(table.category),
    index("custom_skills_enabled_idx").on(table.enabled),
]);

export const insertCustomSkillSchema = createInsertSchema(customSkills).omit({
    id: true,
    usageCount: true,
    lastUsedAt: true,
    createdAt: true,
    updatedAt: true,
});

export type InsertCustomSkill = z.infer<typeof insertCustomSkillSchema>;
export type CustomSkill = typeof customSkills.$inferSelect;
export type SkillCategory = z.infer<typeof skillCategorySchema>;
export type SkillActionType = z.infer<typeof skillActionTypeSchema>;
export type SkillParameter = z.infer<typeof skillParameterSchema>;
export type SkillAction = z.infer<typeof skillActionSchema>;
export type SkillTrigger = z.infer<typeof skillTriggerSchema>;
