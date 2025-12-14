import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, index, customType } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1536)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value.slice(1, -1).split(",").map(Number);
  },
});

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const files = pgTable("files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"),
  name: text("name").notNull(),
  type: text("type").notNull(),
  size: integer("size").notNull(),
  storagePath: text("storage_path").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertFileSchema = createInsertSchema(files).omit({
  id: true,
  createdAt: true,
});

export type InsertFile = z.infer<typeof insertFileSchema>;
export type File = typeof files.$inferSelect;

export const fileChunks = pgTable("file_chunks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fileId: varchar("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  embedding: vector("embedding"),
  pageNumber: integer("page_number"),
  chunkIndex: integer("chunk_index").notNull(),
  metadata: jsonb("metadata"),
}, (table) => [
  index("file_chunks_file_id_idx").on(table.fileId),
]);

export const insertFileChunkSchema = createInsertSchema(fileChunks).omit({
  id: true,
});

export type InsertFileChunk = z.infer<typeof insertFileChunkSchema>;
export type FileChunk = typeof fileChunks.$inferSelect;
