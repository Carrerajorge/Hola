import { sql } from "drizzle-orm";
import {
    pgTable, text, varchar, integer, timestamp, jsonb,
    index, boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// =============================================================================
// Agent Bindings — multi-agent routing configuration
// =============================================================================

export const agentBindings = pgTable("agent_bindings", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    agentId: varchar("agent_id", { length: 100 }).notNull(),
    priority: integer("priority").notNull().default(0),
    matchSource: varchar("match_source", { length: 50 }),
    matchUserId: varchar("match_user_id"),
    matchIntent: varchar("match_intent", { length: 100 }),
    matchTags: text("match_tags").array().default([]),
    agentConfig: jsonb("agent_config").notNull().default({}),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table: any) => [
    index("agent_bindings_agent_idx").on(table.agentId),
    index("agent_bindings_source_idx").on(table.matchSource),
    index("agent_bindings_active_idx").on(table.isActive),
]);

export const insertAgentBindingSchema = createInsertSchema(agentBindings).omit({
    id: true, createdAt: true, updatedAt: true,
});
export type InsertAgentBinding = z.infer<typeof insertAgentBindingSchema>;
export type AgentBinding = typeof agentBindings.$inferSelect;

// =============================================================================
// Agent Tool Policies — per-agent allow/deny lists
// =============================================================================

export const agentToolPolicies = pgTable("agent_tool_policies", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    agentId: varchar("agent_id", { length: 100 }).notNull(),
    allowTools: text("allow_tools").array().default([]),
    denyTools: text("deny_tools").array().default([]),
    ownerOnlyTools: text("owner_only_tools").array().default([]),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table: any) => [
    index("agent_tool_policies_agent_idx").on(table.agentId),
]);

export const insertToolPolicySchema = createInsertSchema(agentToolPolicies).omit({
    id: true, createdAt: true,
});
export type InsertToolPolicy = z.infer<typeof insertToolPolicySchema>;
export type AgentToolPolicy = typeof agentToolPolicies.$inferSelect;

// =============================================================================
// Agent Hooks — lifecycle event handlers
// =============================================================================

export const agentHooks = pgTable("agent_hooks", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    name: varchar("name", { length: 200 }).notNull(),
    event: varchar("event", { length: 50 }).notNull(),
    priority: integer("priority").notNull().default(100),
    handlerModule: text("handler_module").notNull(),
    enabled: boolean("enabled").default(true),
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table: any) => [
    index("agent_hooks_event_idx").on(table.event),
    index("agent_hooks_enabled_idx").on(table.enabled),
]);

export const insertAgentHookSchema = createInsertSchema(agentHooks).omit({
    id: true, createdAt: true,
});
export type InsertAgentHook = z.infer<typeof insertAgentHookSchema>;
export type AgentHook = typeof agentHooks.$inferSelect;
