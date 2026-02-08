import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, index, uniqueIndex, bigint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { vector } from "./common";
import { chats, chatMessages } from "./chat";
import { users } from "./auth";

// ============================================================================
// ATTACHMENTS — first-class persistent entities for multimodal ingestion
// ============================================================================

export const attachments = pgTable("attachments", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSize: integer("file_size").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    storagePath: text("storage_path").notNull(),
    signedUrl: text("signed_url"),                        // short-lived presigned URL for client preview
    signedUrlExpiresAt: timestamp("signed_url_expires_at"),
    // processing pipeline state
    pipelineStatus: text("pipeline_status").notNull().default("pending"),  // pending, processing, ready, failed
    pipelineError: text("pipeline_error"),
    extractedText: text("extracted_text"),                 // full text extracted (OCR / parser)
    ocrText: text("ocr_text"),                             // OCR-specific output
    imageCaption: text("image_caption"),                   // vision model caption for images
    structuredData: jsonb("structured_data"),               // tables, metrics, etc.
    chunkCount: integer("chunk_count").default(0),
    metadata: jsonb("metadata"),                           // source, page count, bbox, etc.
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
    index("attachments_user_idx").on(table.userId),
    index("attachments_sha256_idx").on(table.sha256),
    index("attachments_pipeline_status_idx").on(table.pipelineStatus),
    index("attachments_created_at_idx").on(table.createdAt),
    index("attachments_user_created_idx").on(table.userId, table.createdAt),
]);

export const insertAttachmentSchema = createInsertSchema(attachments).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});

export type InsertAttachment = z.infer<typeof insertAttachmentSchema>;
export type Attachment = typeof attachments.$inferSelect;

// Junction table: many-to-many between messages and attachments
export const messageAttachments = pgTable("message_attachments", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    messageId: varchar("message_id").notNull().references(() => chatMessages.id, { onDelete: "cascade" }),
    attachmentId: varchar("attachment_id").notNull().references(() => attachments.id, { onDelete: "cascade" }),
    displayOrder: integer("display_order").default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
    index("message_attachments_message_idx").on(table.messageId),
    index("message_attachments_attachment_idx").on(table.attachmentId),
    uniqueIndex("message_attachments_unique").on(table.messageId, table.attachmentId),
]);

export const insertMessageAttachmentSchema = createInsertSchema(messageAttachments).omit({
    id: true,
    createdAt: true,
});

export type InsertMessageAttachment = z.infer<typeof insertMessageAttachmentSchema>;
export type MessageAttachment = typeof messageAttachments.$inferSelect;

// Attachment chunks — RAG-ready chunks with rich metadata
// BM25 full-text search is handled via to_tsvector() in SQL queries + a GIN index.
export const attachmentChunks = pgTable("attachment_chunks", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    attachmentId: varchar("attachment_id").notNull().references(() => attachments.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    embedding: vector("embedding"),
    chunkIndex: integer("chunk_index").notNull(),
    pageNumber: integer("page_number"),
    // rich metadata for retrieval
    sourceType: text("source_type"),     // "text", "table", "ocr", "caption"
    bbox: jsonb("bbox"),                 // bounding box if applicable
    metadata: jsonb("metadata"),         // user/thread, source, etc.
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
    index("attachment_chunks_attachment_idx").on(table.attachmentId),
    index("attachment_chunks_embedding_idx").using("hnsw", sql`${table.embedding} vector_cosine_ops`),
    index("attachment_chunks_tsv_idx").using("gin", sql`to_tsvector('spanish', coalesce(${table.content}, ''))`),
]);

export const insertAttachmentChunkSchema = createInsertSchema(attachmentChunks).omit({
    id: true,
    createdAt: true,
}).extend({
    embedding: z.array(z.number()).nullish(),
    bbox: z.any().nullish(),
    metadata: z.any().nullish(),
});

export type InsertAttachmentChunk = z.infer<typeof insertAttachmentChunkSchema>;
export type AttachmentChunk = typeof attachmentChunks.$inferSelect;

// ============================================================================
// LEGACY TABLES (kept for backward compatibility)
// ============================================================================

export const files = pgTable("files", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id"),
    name: text("name").notNull(),
    type: text("type").notNull(),
    size: integer("size").notNull(),
    storagePath: text("storage_path").notNull(),
    status: text("status").notNull().default("pending"),
    processingProgress: integer("processing_progress").default(0),
    processingError: text("processing_error"),
    completedAt: timestamp("completed_at"),
    totalChunks: integer("total_chunks"),
    uploadedChunks: integer("uploaded_chunks").default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
    index("files_user_created_idx").on(table.userId, table.createdAt),
    index("files_user_id_idx").on(table.userId),
    index("files_status_idx").on(table.status),
]);

export const insertFileSchema = createInsertSchema(files).omit({
    id: true,
    createdAt: true,
}).extend({
    processingProgress: z.number().min(0).max(100).optional(),
    processingError: z.string().nullable().optional(),
    completedAt: z.date().nullable().optional(),
    totalChunks: z.number().nullable().optional(),
    uploadedChunks: z.number().optional(),
});

export type InsertFile = z.infer<typeof insertFileSchema>;
export type File = typeof files.$inferSelect;

export const fileJobs = pgTable("file_jobs", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    fileId: varchar("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    retries: integer("retries").default(0),
    lastError: text("last_error"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
    index("file_jobs_file_id_idx").on(table.fileId),
    index("file_jobs_status_idx").on(table.status),
]);

export const insertFileJobSchema = createInsertSchema(fileJobs).omit({
    id: true,
    createdAt: true,
});

export type InsertFileJob = z.infer<typeof insertFileJobSchema>;
export type FileJob = typeof fileJobs.$inferSelect;

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
    index("file_chunks_embedding_idx").using("hnsw", sql`${table.embedding} vector_cosine_ops`),
]);

export const insertFileChunkSchema = createInsertSchema(fileChunks).omit({
    id: true,
}).extend({
    embedding: z.array(z.number()).nullish(),
});

export type InsertFileChunk = z.infer<typeof insertFileChunkSchema>;
export type FileChunk = typeof fileChunks.$inferSelect;

// Conversation Documents - Persistent document context for chat conversations
// Stores extracted content from uploaded documents to maintain context across messages
export const conversationDocuments = pgTable("conversation_documents", {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    chatId: varchar("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
    messageId: varchar("message_id").references(() => chatMessages.id, { onDelete: "set null" }),
    fileName: text("file_name").notNull(),
    storagePath: text("storage_path"),
    mimeType: text("mime_type").notNull(),
    fileSize: integer("file_size"),
    extractedText: text("extracted_text"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
    index("conversation_documents_chat_idx").on(table.chatId),
    index("conversation_documents_created_idx").on(table.chatId, table.createdAt),
]);

export const insertConversationDocumentSchema = createInsertSchema(conversationDocuments).omit({
    id: true,
    createdAt: true,
});

export type InsertConversationDocument = z.infer<typeof insertConversationDocumentSchema>;
export type ConversationDocument = typeof conversationDocuments.$inferSelect;
