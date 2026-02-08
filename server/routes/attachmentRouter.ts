/**
 * Attachment API Router
 *
 * Provides a first-class REST API for multimodal attachment ingestion:
 *   POST   /api/attachments/upload      — upload file, returns attachment_id + sha256 + mime + signed_url
 *   GET    /api/attachments/:id         — get attachment metadata (rehydrate on reload)
 *   GET    /api/attachments/:id/content — get extracted text / structured data
 *   GET    /api/attachments/:id/signed-url — refresh a short-lived signed URL
 *   GET    /api/attachments/by-message/:messageId — get all attachments for a message
 *   POST   /api/attachments/:id/link    — link an attachment to a message
 */

import { Router } from "express";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import { db } from "../db";
import { attachments, messageAttachments, attachmentChunks } from "../../shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { ObjectStorageService } from "../replit_integrations/object_storage/objectStorage";
import { ALLOWED_MIME_TYPES, LIMITS } from "../lib/constants";
import { validateAttachmentSecurity } from "../lib/pareSecurityGuard";
import { sanitizeFilename } from "../services/fileValidation";
import { attachmentPipeline } from "../services/attachmentPipeline";
import { traceAttachmentOp } from "../lib/attachmentTracing";
import type { AuthenticatedRequest } from "../types/express";
import { getOrCreateSecureUserId } from "../lib/anonUserHelper";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

async function generateSignedUrl(storagePath: string, ttlSec: number = 900): Promise<{ url: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + ttlSec * 1000);
  // Parse bucket and object from storagePath
  const pathWithoutPrefix = storagePath.replace(/^\/objects\//, "");
  const slashIdx = pathWithoutPrefix.indexOf("/");
  if (slashIdx < 0) {
    throw new Error("Invalid storage path for signing");
  }
  const bucketName = pathWithoutPrefix.slice(0, slashIdx);
  const objectName = pathWithoutPrefix.slice(slashIdx + 1);

  try {
    const response = await fetch(`${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket_name: bucketName,
        object_name: objectName,
        method: "GET",
        expires_at: expiresAt.toISOString(),
      }),
    });
    if (!response.ok) {
      throw new Error(`Signing failed: ${response.status}`);
    }
    const { signed_url } = await response.json();
    return { url: signed_url, expiresAt };
  } catch {
    // Fallback: return relative path for local dev
    return { url: storagePath, expiresAt };
  }
}

export function createAttachmentRouter() {
  const router = Router();
  const objectStorageService = new ObjectStorageService();
  const uploadsDir = path.resolve(process.cwd(), "uploads");

  // ────────────────────────────────────────────────────────
  // POST /api/attachments/upload
  // Accepts multipart body OR raw PUT-style binary.
  // Returns { attachment_id, sha256, mime, signed_url, file_name, file_size }
  // ────────────────────────────────────────────────────────
  router.post("/upload", async (req: AuthenticatedRequest, res) => {
    const span = traceAttachmentOp("attachment.upload");
    try {
      const userId = getOrCreateSecureUserId(req);
      const { name, type: mimeType, size, storagePath: clientStoragePath } = req.body;

      if (!name || !mimeType || !size || !clientStoragePath) {
        span?.setStatus({ code: 2, message: "missing fields" });
        return res.status(400).json({ error: "Missing required fields: name, type, size, storagePath" });
      }

      if (!ALLOWED_MIME_TYPES.includes(mimeType as any)) {
        return res.status(400).json({ error: `Unsupported file type: ${mimeType}` });
      }

      if (size > LIMITS.MAX_FILE_SIZE_BYTES) {
        return res.status(413).json({ error: `File exceeds maximum size of ${LIMITS.MAX_FILE_SIZE_MB}MB` });
      }

      const sanitizedName = sanitizeFilename(name);

      // Compute SHA-256 from the uploaded file content
      let sha256Hash: string;
      try {
        const buffer = await objectStorageService.getObjectEntityBuffer(clientStoragePath);
        sha256Hash = crypto.createHash("sha256").update(buffer).digest("hex");
      } catch {
        // Fallback for local storage
        try {
          const objectId = clientStoragePath.replace(/^\/objects\/uploads\//, "");
          const localPath = path.join(uploadsDir, objectId);
          const buffer = await fs.readFile(localPath);
          sha256Hash = crypto.createHash("sha256").update(buffer).digest("hex");
        } catch {
          sha256Hash = crypto.createHash("sha256").update(`${name}-${size}-${Date.now()}`).digest("hex");
        }
      }

      // Check for duplicate by sha256 + userId (dedup)
      const [existing] = await db.select().from(attachments)
        .where(and(eq(attachments.sha256, sha256Hash), eq(attachments.userId, userId)))
        .limit(1);

      if (existing) {
        // Refresh signed URL if expired
        let signedUrl = existing.signedUrl;
        let signedUrlExpiresAt = existing.signedUrlExpiresAt;
        if (!signedUrl || !signedUrlExpiresAt || signedUrlExpiresAt < new Date()) {
          const signed = await generateSignedUrl(existing.storagePath);
          signedUrl = signed.url;
          signedUrlExpiresAt = signed.expiresAt;
          await db.update(attachments)
            .set({ signedUrl, signedUrlExpiresAt, updatedAt: new Date() })
            .where(eq(attachments.id, existing.id));
        }

        span?.setAttribute("attachment.dedup", true);
        return res.json({
          attachment_id: existing.id,
          sha256: existing.sha256,
          mime: existing.mimeType,
          signed_url: signedUrl,
          file_name: existing.fileName,
          file_size: existing.fileSize,
          pipeline_status: existing.pipelineStatus,
          deduplicated: true,
        });
      }

      // Generate signed URL for preview
      const signed = await generateSignedUrl(clientStoragePath);

      // Insert attachment record
      const [attachment] = await db.insert(attachments).values({
        userId,
        fileName: sanitizedName,
        mimeType,
        fileSize: size,
        sha256: sha256Hash,
        storagePath: clientStoragePath,
        signedUrl: signed.url,
        signedUrlExpiresAt: signed.expiresAt,
        pipelineStatus: "pending",
        metadata: { originalName: name },
      }).returning();

      // Dispatch async processing pipeline
      attachmentPipeline.enqueue({
        attachmentId: attachment.id,
        storagePath: clientStoragePath,
        mimeType,
        fileName: sanitizedName,
        fileSize: size,
      });

      span?.setAttribute("attachment.id", attachment.id);
      span?.setStatus({ code: 0 });

      console.log(`[Attachment API] Created attachment ${attachment.id} (${mimeType}, ${size} bytes, sha256=${sha256Hash.slice(0, 12)}...)`);

      return res.status(201).json({
        attachment_id: attachment.id,
        sha256: sha256Hash,
        mime: mimeType,
        signed_url: signed.url,
        file_name: sanitizedName,
        file_size: size,
        pipeline_status: "pending",
        deduplicated: false,
      });
    } catch (error: any) {
      span?.setStatus({ code: 2, message: error.message });
      console.error("[Attachment API] Upload error:", error);
      return res.status(500).json({ error: "Failed to create attachment" });
    } finally {
      span?.end();
    }
  });

  // ────────────────────────────────────────────────────────
  // GET /api/attachments/:id
  // Rehydrate attachment metadata (for chat reload)
  // ────────────────────────────────────────────────────────
  router.get("/:id", async (req, res) => {
    try {
      const [attachment] = await db.select().from(attachments)
        .where(eq(attachments.id, req.params.id))
        .limit(1);

      if (!attachment) {
        return res.status(404).json({ error: "Attachment not found" });
      }

      // Refresh signed URL if expired
      let signedUrl = attachment.signedUrl;
      if (!signedUrl || !attachment.signedUrlExpiresAt || attachment.signedUrlExpiresAt < new Date()) {
        const signed = await generateSignedUrl(attachment.storagePath);
        signedUrl = signed.url;
        await db.update(attachments)
          .set({ signedUrl: signed.url, signedUrlExpiresAt: signed.expiresAt, updatedAt: new Date() })
          .where(eq(attachments.id, attachment.id));
      }

      return res.json({
        ...attachment,
        signedUrl,
      });
    } catch (error: any) {
      console.error("[Attachment API] Get error:", error);
      return res.status(500).json({ error: "Failed to get attachment" });
    }
  });

  // ────────────────────────────────────────────────────────
  // GET /api/attachments/:id/content
  // Returns extracted text and structured data
  // ────────────────────────────────────────────────────────
  router.get("/:id/content", async (req, res) => {
    try {
      const [attachment] = await db.select().from(attachments)
        .where(eq(attachments.id, req.params.id))
        .limit(1);

      if (!attachment) {
        return res.status(404).json({ error: "Attachment not found" });
      }

      if (attachment.pipelineStatus !== "ready") {
        return res.status(202).json({
          status: attachment.pipelineStatus,
          error: attachment.pipelineError,
        });
      }

      // Get chunks for this attachment
      const chunks = await db.select().from(attachmentChunks)
        .where(eq(attachmentChunks.attachmentId, attachment.id))
        .orderBy(attachmentChunks.chunkIndex);

      return res.json({
        attachment_id: attachment.id,
        file_name: attachment.fileName,
        mime_type: attachment.mimeType,
        pipeline_status: attachment.pipelineStatus,
        extracted_text: attachment.extractedText,
        ocr_text: attachment.ocrText,
        image_caption: attachment.imageCaption,
        structured_data: attachment.structuredData,
        chunk_count: chunks.length,
        chunks: chunks.map(c => ({
          index: c.chunkIndex,
          content: c.content,
          page: c.pageNumber,
          source_type: c.sourceType,
        })),
      });
    } catch (error: any) {
      console.error("[Attachment API] Content error:", error);
      return res.status(500).json({ error: "Failed to get attachment content" });
    }
  });

  // ────────────────────────────────────────────────────────
  // GET /api/attachments/:id/signed-url
  // Refresh the short-lived signed URL
  // ────────────────────────────────────────────────────────
  router.get("/:id/signed-url", async (req, res) => {
    try {
      const [attachment] = await db.select().from(attachments)
        .where(eq(attachments.id, req.params.id))
        .limit(1);

      if (!attachment) {
        return res.status(404).json({ error: "Attachment not found" });
      }

      const signed = await generateSignedUrl(attachment.storagePath);
      await db.update(attachments)
        .set({ signedUrl: signed.url, signedUrlExpiresAt: signed.expiresAt, updatedAt: new Date() })
        .where(eq(attachments.id, attachment.id));

      return res.json({ signed_url: signed.url, expires_at: signed.expiresAt.toISOString() });
    } catch (error: any) {
      console.error("[Attachment API] Signed URL error:", error);
      return res.status(500).json({ error: "Failed to generate signed URL" });
    }
  });

  // ────────────────────────────────────────────────────────
  // GET /api/attachments/by-message/:messageId
  // Get all attachments linked to a message (rehydration)
  // ────────────────────────────────────────────────────────
  router.get("/by-message/:messageId", async (req, res) => {
    try {
      const rows = await db
        .select({
          attachment: attachments,
          displayOrder: messageAttachments.displayOrder,
        })
        .from(messageAttachments)
        .innerJoin(attachments, eq(messageAttachments.attachmentId, attachments.id))
        .where(eq(messageAttachments.messageId, req.params.messageId))
        .orderBy(messageAttachments.displayOrder);

      // Refresh expired signed URLs
      const result = await Promise.all(rows.map(async (row) => {
        let signedUrl = row.attachment.signedUrl;
        if (!signedUrl || !row.attachment.signedUrlExpiresAt || row.attachment.signedUrlExpiresAt < new Date()) {
          const signed = await generateSignedUrl(row.attachment.storagePath);
          signedUrl = signed.url;
          // Fire-and-forget update
          db.update(attachments)
            .set({ signedUrl: signed.url, signedUrlExpiresAt: signed.expiresAt, updatedAt: new Date() })
            .where(eq(attachments.id, row.attachment.id))
            .catch(() => {});
        }
        return {
          ...row.attachment,
          signedUrl,
          displayOrder: row.displayOrder,
        };
      }));

      return res.json(result);
    } catch (error: any) {
      console.error("[Attachment API] By-message error:", error);
      return res.status(500).json({ error: "Failed to get attachments for message" });
    }
  });

  // ────────────────────────────────────────────────────────
  // POST /api/attachments/:id/link
  // Link an attachment to a message (message_attachments junction)
  // ────────────────────────────────────────────────────────
  router.post("/:id/link", async (req, res) => {
    try {
      const { messageId, displayOrder = 0 } = req.body;

      if (!messageId) {
        return res.status(400).json({ error: "messageId is required" });
      }

      // Verify attachment exists
      const [attachment] = await db.select().from(attachments)
        .where(eq(attachments.id, req.params.id))
        .limit(1);

      if (!attachment) {
        return res.status(404).json({ error: "Attachment not found" });
      }

      // Insert link (ON CONFLICT DO NOTHING via unique constraint)
      await db.insert(messageAttachments).values({
        messageId,
        attachmentId: req.params.id,
        displayOrder,
      }).onConflictDoNothing();

      return res.json({ success: true, attachment_id: req.params.id, message_id: messageId });
    } catch (error: any) {
      console.error("[Attachment API] Link error:", error);
      return res.status(500).json({ error: "Failed to link attachment to message" });
    }
  });

  return router;
}
