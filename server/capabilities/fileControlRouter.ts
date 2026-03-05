/**
 * File Control Router — REST API for the File Capability Plane.
 *
 * Endpoints:
 * - POST /api/file-control/read       — Read a file (with secret redaction)
 * - POST /api/file-control/write      — Write a file
 * - POST /api/file-control/delete     — Delete a file
 * - POST /api/file-control/list       — List directory contents
 * - POST /api/file-control/search     — Search files by pattern
 * - POST /api/file-control/ingest     — Ingest a file into the knowledge index
 * - GET  /api/file-control/documents  — List ingested documents
 * - POST /api/file-control/query      — Search ingested document chunks
 * - GET  /api/file-control/audit      — Get audit log
 * - GET  /api/file-control/stats      — Get index stats
 * - PATCH /api/file-control/policy    — Update file access policy
 */

import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import * as os from "os";
import { FileGateway, FileIndexService, FileAccessRequest } from "./file";

export function createFileControlRouter() {
  const router = Router();

  // Initialize with safe defaults
  const gateway = new FileGateway({
    allowedRoots: [process.cwd(), os.homedir()],
    permissions: ["read", "write", "delete"],
    confirmWrites: false,
    confirmDeletes: true,
  });
  const indexService = new FileIndexService(gateway);

  // ── Read File ──────────────────────────────────
  router.post("/read", async (req: Request, res: Response) => {
    const { path: filePath } = req.body;
    if (!filePath) return res.status(400).json({ error: "path is required" });

    const request: FileAccessRequest = {
      requestId: randomUUID(),
      userId: (req as any).user?.id || "anonymous",
      sessionId: (req as any).sessionId || "default",
      operation: "read",
      path: filePath,
      timestamp: Date.now(),
    };

    const result = await gateway.readFile(request);
    return res.status(result.success ? 200 : 403).json(result);
  });

  // ── Write File ─────────────────────────────────
  router.post("/write", async (req: Request, res: Response) => {
    const { path: filePath, content } = req.body;
    if (!filePath) return res.status(400).json({ error: "path is required" });

    const request: FileAccessRequest = {
      requestId: randomUUID(),
      userId: (req as any).user?.id || "anonymous",
      sessionId: (req as any).sessionId || "default",
      operation: "write",
      path: filePath,
      content,
      timestamp: Date.now(),
    };

    const result = await gateway.writeFile(request);
    return res.status(result.success ? 200 : 403).json(result);
  });

  // ── Delete File ────────────────────────────────
  router.post("/delete", async (req: Request, res: Response) => {
    const { path: filePath } = req.body;
    if (!filePath) return res.status(400).json({ error: "path is required" });

    const request: FileAccessRequest = {
      requestId: randomUUID(),
      userId: (req as any).user?.id || "anonymous",
      sessionId: (req as any).sessionId || "default",
      operation: "delete",
      path: filePath,
      timestamp: Date.now(),
    };

    const result = await gateway.deleteFile(request);
    return res.status(result.success ? 200 : 403).json(result);
  });

  // ── List Directory ─────────────────────────────
  router.post("/list", async (req: Request, res: Response) => {
    const { path: dirPath } = req.body;
    if (!dirPath) return res.status(400).json({ error: "path is required" });

    const request: FileAccessRequest = {
      requestId: randomUUID(),
      userId: (req as any).user?.id || "anonymous",
      sessionId: (req as any).sessionId || "default",
      operation: "list",
      path: dirPath,
      timestamp: Date.now(),
    };

    const result = await gateway.listDirectory(request);
    return res.status(result.success ? 200 : 400).json(result);
  });

  // ── Search Files ───────────────────────────────
  router.post("/search", async (req: Request, res: Response) => {
    const { path: dirPath, pattern, maxResults } = req.body;
    if (!dirPath || !pattern) return res.status(400).json({ error: "path and pattern are required" });

    const request: FileAccessRequest = {
      requestId: randomUUID(),
      userId: (req as any).user?.id || "anonymous",
      sessionId: (req as any).sessionId || "default",
      operation: "search",
      path: dirPath,
      timestamp: Date.now(),
    };

    const result = await gateway.searchFiles(request, pattern, maxResults || 100);
    return res.status(result.success ? 200 : 400).json(result);
  });

  // ── Ingest File ────────────────────────────────
  router.post("/ingest", async (req: Request, res: Response) => {
    const { path: filePath, ttl, forceReindex } = req.body;
    if (!filePath) return res.status(400).json({ error: "path is required" });

    try {
      const doc = await indexService.ingestFile(
        filePath,
        (req as any).user?.id || "anonymous",
        (req as any).sessionId || "default",
        { ttl, forceReindex },
      );

      if (doc) {
        return res.json({
          success: true,
          document: {
            id: doc.id,
            fileName: doc.fileName,
            mimeType: doc.mimeType,
            sizeBytes: doc.sizeBytes,
            chunkCount: doc.chunks.length,
            hash: doc.hash,
          },
        });
      }

      return res.json({ success: true, message: "File already ingested (dedup)" });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // ── List Documents ─────────────────────────────
  router.get("/documents", (_req: Request, res: Response) => {
    return res.json({ documents: indexService.listDocuments() });
  });

  // ── Query Chunks ───────────────────────────────
  router.post("/query", (req: Request, res: Response) => {
    const { query, maxResults } = req.body;
    if (!query) return res.status(400).json({ error: "query is required" });

    const results = indexService.searchChunks(query, maxResults || 20);
    return res.json({
      results: results.map((r) => ({
        chunkId: r.chunk.id,
        documentId: r.chunk.documentId,
        content: r.chunk.content,
        score: r.score,
        line: r.chunk.line,
        page: r.chunk.page,
        startOffset: r.chunk.startOffset,
        endOffset: r.chunk.endOffset,
        fileName: r.document.fileName,
        provenance: r.document.metadata.provenance,
      })),
    });
  });

  // ── Audit Log ──────────────────────────────────
  router.get("/audit", (req: Request, res: Response) => {
    const limit = parseInt(String(req.query.limit || "100"), 10);
    const offset = parseInt(String(req.query.offset || "0"), 10);
    return res.json({ entries: gateway.getAuditLog(limit, offset) });
  });

  // ── Stats ──────────────────────────────────────
  router.get("/stats", (_req: Request, res: Response) => {
    return res.json(indexService.getStats());
  });

  // ── Policy ─────────────────────────────────────
  router.patch("/policy", (req: Request, res: Response) => {
    const update = req.body;
    gateway.updatePolicy(update);
    return res.json({ policy: gateway.getPolicy() });
  });

  router.get("/policy", (_req: Request, res: Response) => {
    return res.json({ policy: gateway.getPolicy() });
  });

  return router;
}
