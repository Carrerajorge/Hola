import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./auth";

export const kbNodeTypeSchema = z.enum([
  "note",
  "fact",
  "decision",
  "person",
  "project",
  "source",
]);
export type KbNodeType = z.infer<typeof kbNodeTypeSchema>;

export const kbNodes = pgTable(
  "kb_nodes",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),

    ownerUserId: varchar("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    type: varchar("type", { length: 32 }).notNull(),
    title: text("title"),
    content: text("content").notNull(),

    tags: text("tags").array().default([]),
    sourceRef: text("source_ref"),

    // Embedding is stored as JSON array (portable). Optional pgvector column may be added in SQL migration.
    embedding: jsonb("embedding").$type<number[]>().default([]),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("kb_nodes_owner_idx").on(table.ownerUserId),
    index("kb_nodes_type_idx").on(table.ownerUserId, table.type),
    index("kb_nodes_updated_idx").on(table.ownerUserId, table.updatedAt),
  ]
);

export const kbEdges = pgTable(
  "kb_edges",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),

    ownerUserId: varchar("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    fromNodeId: varchar("from_node_id").notNull().references(() => kbNodes.id, {
      onDelete: "cascade",
    }),
    toNodeId: varchar("to_node_id").notNull().references(() => kbNodes.id, {
      onDelete: "cascade",
    }),

    relation: varchar("relation", { length: 48 }).notNull(),
    metadata: jsonb("metadata").default({}),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("kb_edges_owner_from_idx").on(table.ownerUserId, table.fromNodeId),
    index("kb_edges_owner_to_idx").on(table.ownerUserId, table.toNodeId),
    uniqueIndex("kb_edges_unique").on(table.ownerUserId, table.fromNodeId, table.toNodeId, table.relation),
  ]
);

export const insertKbNodeSchema = createInsertSchema(kbNodes, {
  type: kbNodeTypeSchema,
});
export type InsertKbNode = z.infer<typeof insertKbNodeSchema>;
export type KbNode = typeof kbNodes.$inferSelect;

export const insertKbEdgeSchema = createInsertSchema(kbEdges);
export type InsertKbEdge = z.infer<typeof insertKbEdgeSchema>;
export type KbEdge = typeof kbEdges.$inferSelect;
