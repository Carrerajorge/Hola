import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, jsonb } from "drizzle-orm/pg-core";

export const packageOperations = pgTable("package_operations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  packageName: text("package_name").notNull(),
  manager: text("manager").notNull(),
  action: text("action").notNull(),
  status: text("status").notNull().default("planned"),
  osFamily: text("os_family"),
  osDistro: text("os_distro"),
  command: text("command"),
  policyDecision: text("policy_decision"),
  policyWarnings: jsonb("policy_warnings").$type<string[]>().default(sql`'[]'::jsonb`),
  requestedBy: varchar("requested_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type PackageOperation = typeof packageOperations.$inferSelect;
export type InsertPackageOperation = typeof packageOperations.$inferInsert;
