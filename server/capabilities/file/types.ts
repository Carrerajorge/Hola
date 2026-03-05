/**
 * FILE-PLANE Types — First-class file capability with security and provenance.
 */

export type FilePermission = "read" | "write" | "delete";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface FileAccessPolicy {
  /** Allowed workspace roots (absolute paths) */
  allowedRoots: string[];
  /** Max file size in bytes for read operations */
  maxReadBytes: number;
  /** Max file size in bytes for write operations */
  maxWriteBytes: number;
  /** Allowed MIME types for ingestion (empty = all supported) */
  allowedMimeTypes: string[];
  /** Permissions granted */
  permissions: FilePermission[];
  /** Require human confirmation for writes/deletes */
  confirmWrites: boolean;
  confirmDeletes: boolean;
}

export interface FileAccessRequest {
  requestId: string;
  userId: string;
  sessionId: string;
  operation: FilePermission | "list" | "search" | "ingest";
  path: string;
  destinationPath?: string;
  content?: string | Buffer;
  timestamp: number;
}

export interface FileAccessResult {
  requestId: string;
  success: boolean;
  operation: string;
  path: string;
  data?: unknown;
  error?: string;
  hash?: string;
  sizeBytes?: number;
  mimeType?: string;
  durationMs: number;
}

export interface AuditLogEntry {
  id: string;
  timestamp: number;
  userId: string;
  sessionId: string;
  operation: string;
  path: string;
  allowed: boolean;
  deniedReason?: string;
  hash?: string;
  sizeBytes?: number;
  durationMs: number;
  riskLevel: RiskLevel;
}

export interface IngestedDocument {
  id: string;
  filePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  hash: string;
  chunks: DocumentChunk[];
  metadata: DocumentMetadata;
  ingestedAt: number;
  ttl?: number;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  content: string;
  index: number;
  startOffset: number;
  endOffset: number;
  page?: number;
  line?: number;
  embedding?: number[];
  metadata?: Record<string, unknown>;
}

export interface DocumentMetadata {
  title?: string;
  author?: string;
  createdDate?: string;
  modifiedDate?: string;
  pageCount?: number;
  wordCount?: number;
  language?: string;
  extractionMethod: "native" | "ocr" | "fallback";
  confidence?: number;
  provenance: ProvenanceInfo;
}

export interface ProvenanceInfo {
  sourcePath: string;
  sourceHash: string;
  extractedAt: number;
  extractionVersion: string;
  chunkStrategy: string;
}

export interface SecretPattern {
  name: string;
  pattern: RegExp;
  redactWith: string;
}
