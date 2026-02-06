import { sql } from "drizzle-orm";

import { db } from "../../db";
import { storage } from "../../storage";
import type { IngestedChunk } from "./ingestionTypes";

export interface IndexToFileChunksResult {
  fileId: string;
  inserted: number;
  deletedPrevious: number;
  skipped: boolean;
  reason?: string;
}

function isEnabled(): boolean {
  return String(process.env.ENCARGO_DB_INDEX_ENABLED || "true").toLowerCase() === "true";
}

function normalizeFileId(fileId: unknown): string | null {
  const id = typeof fileId === "string" ? fileId.trim() : "";
  return id ? id : null;
}

function isDocChunk(c: IngestedChunk): boolean {
  return c.kind === "document";
}

function safeJson(value: any): any {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

/**
 * Persist ingestion2026 chunks into `file_chunks` for durable, DB-backed retrieval.
 *
 * Strategy:
 * - Best-effort (never throw to caller)
 * - Only indexes when fileId exists and belongs to userId (if provided)
 * - Deletes prior ingestion2026 rows for this fileId to avoid duplicates
 * - Inserts embeddings as NULL (embeddings are populated lazily during retrieval)
 */
export async function indexIngestedChunksToFileChunks(args: {
  fileId: string;
  chunks: IngestedChunk[];
  filename?: string;
  userId?: string;
  requestId?: string;
  ingestionVersion?: string;
  maxChunks?: number;
}): Promise<IndexToFileChunksResult> {
  const fileId = normalizeFileId(args.fileId);
  if (!fileId) {
    return { fileId: "", inserted: 0, deletedPrevious: 0, skipped: true, reason: "missing_fileId" };
  }

  if (!isEnabled()) {
    return { fileId, inserted: 0, deletedPrevious: 0, skipped: true, reason: "disabled" };
  }

  const ingestionVersion = args.ingestionVersion || "ingestion2026";
  const maxChunks = Math.max(50, Math.min(5000, args.maxChunks ?? Number.parseInt(process.env.ENCARGO_DB_INDEX_MAX_CHUNKS || "1200", 10)));

  const docChunks = (args.chunks || []).filter(isDocChunk).slice(0, maxChunks);
  if (docChunks.length === 0) {
    return { fileId, inserted: 0, deletedPrevious: 0, skipped: true, reason: "no_document_chunks" };
  }

  try {
    const file = await storage.getFile(fileId);
    if (!file) {
      return { fileId, inserted: 0, deletedPrevious: 0, skipped: true, reason: "file_not_found" };
    }
    if (args.userId && file.userId && file.userId !== args.userId) {
      return { fileId, inserted: 0, deletedPrevious: 0, skipped: true, reason: "ownership_mismatch" };
    }
  } catch (err: any) {
    return { fileId, inserted: 0, deletedPrevious: 0, skipped: true, reason: `file_check_failed:${err?.message || err}` };
  }

  try {
    // Delete only previous ingestion2026 rows for this fileId (do not wipe other indexing pipelines).
    const deleted = await db.execute(sql`
      DELETE FROM file_chunks
      WHERE file_id = ${fileId}
        AND (metadata ->> 'ingestionVersion') = ${ingestionVersion}
    `);

    const deletedPrevious = Number((deleted as any)?.rowCount || 0);

    // Insert chunks in manageable batches.
    const BATCH = 200;
    let inserted = 0;

    for (let i = 0; i < docChunks.length; i += BATCH) {
      const batch = docChunks.slice(i, i + BATCH);
      const rows = batch.map((c, idx) => {
        const chunkIndex = i + idx;
        const pageNumber = typeof c.location?.page === "number" ? c.location.page : null;
        const kindLabel = String(c.metadata?.kindLabel || "");

        const metadata = safeJson({
          ...(typeof c.metadata === "object" && c.metadata ? c.metadata : {}),
          ingestionVersion,
          sourceId: c.sourceId,
          location: c.location,
          headingPath: c.headingPath,
          rawContent: c.rawContent,
          kind: c.kind,
          kindLabel,
          filename: c.filename || args.filename,
        });

        return {
          fileId,
          content: c.content,
          embedding: null,
          pageNumber,
          chunkIndex,
          metadata,
        };
      });

      await storage.createFileChunks(rows as any);
      inserted += rows.length;
    }

    return { fileId, inserted, deletedPrevious, skipped: false };
  } catch (err: any) {
    console.warn(`[EncargoIndex] Failed to index ingestion chunks to DB for fileId=${fileId}:`, err?.message || err);
    return { fileId, inserted: 0, deletedPrevious: 0, skipped: true, reason: `db_error:${err?.message || err}` };
  }
}

