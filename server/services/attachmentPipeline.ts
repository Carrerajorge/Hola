/**
 * Attachment Processing Pipeline
 *
 * Async queue + workers that handle:
 *  1. Structural parsing of PDFs/Docs (text, tables, images)
 *  2. OCR for scanned docs and images
 *  3. Image captioning via vision model
 *  4. Chunking + embedding generation with rich metadata
 *
 * Each attachment goes through the pipeline asynchronously after upload.
 */

import { db } from "../db";
import { attachments, attachmentChunks } from "../../shared/schema";
import { eq } from "drizzle-orm";
import { ObjectStorageService } from "../replit_integrations/object_storage/objectStorage";
import { processDocument } from "./documentProcessing";
import { chunkText, generateEmbeddingsBatch } from "../embeddingService";
import { traceAttachmentOp } from "../lib/attachmentTracing";
import { llmGateway } from "../lib/llmGateway";
import path from "node:path";
import fs from "node:fs/promises";

export interface PipelineJob {
  attachmentId: string;
  storagePath: string;
  mimeType: string;
  fileName: string;
  fileSize: number;
  status: "pending" | "processing" | "completed" | "failed";
  retries: number;
  error?: string;
}

const MAX_RETRIES = 3;
const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 150;

class AttachmentProcessingPipeline {
  private queue: PipelineJob[] = [];
  private processing = false;
  private objectStorage = new ObjectStorageService();
  private uploadsDir = path.resolve(process.cwd(), "uploads");

  enqueue(job: Omit<PipelineJob, "status" | "retries">): void {
    this.queue.push({ ...job, status: "pending", retries: 0 });
    console.log(`[AttachmentPipeline] Enqueued ${job.attachmentId} (${job.mimeType})`);
    if (!this.processing) {
      this.processNext();
    }
  }

  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    const job = this.queue.shift();
    if (!job) return;

    this.processing = true;
    job.status = "processing";

    try {
      await this.processAttachment(job);
      job.status = "completed";
    } catch (error: any) {
      console.error(`[AttachmentPipeline] Error processing ${job.attachmentId}:`, error.message);
      job.retries++;
      job.error = error.message;

      if (job.retries < MAX_RETRIES) {
        job.status = "pending";
        this.queue.push(job);
        console.log(`[AttachmentPipeline] Retrying ${job.attachmentId} (attempt ${job.retries + 1})`);
      } else {
        job.status = "failed";
        await db.update(attachments)
          .set({ pipelineStatus: "failed", pipelineError: error.message, updatedAt: new Date() })
          .where(eq(attachments.id, job.attachmentId));
      }
    } finally {
      this.processing = false;
      this.processNext();
    }
  }

  private async processAttachment(job: PipelineJob): Promise<void> {
    const span = traceAttachmentOp("attachment.pipeline.process");
    span?.setAttribute("attachment.id", job.attachmentId);
    span?.setAttribute("attachment.mime", job.mimeType);

    try {
      // Mark as processing
      await db.update(attachments)
        .set({ pipelineStatus: "processing", updatedAt: new Date() })
        .where(eq(attachments.id, job.attachmentId));

      // 1. Fetch the file content
      const content = await this.fetchContent(job.storagePath);
      if (!content || content.length === 0) {
        throw new Error("Empty file content");
      }

      const isImage = job.mimeType.startsWith("image/");

      let extractedText = "";
      let ocrText: string | null = null;
      let imageCaption: string | null = null;
      let structuredData: any = null;
      const chunkMetas: { content: string; chunkIndex: number; pageNumber?: number; sourceType: string }[] = [];

      if (isImage) {
        // 2a. Image pipeline: OCR + caption
        const result = await this.processImage(content, job.mimeType, job.fileName);
        ocrText = result.ocrText;
        imageCaption = result.caption;
        extractedText = [result.caption, result.ocrText].filter(Boolean).join("\n\n");

        if (extractedText.trim()) {
          chunkMetas.push({
            content: extractedText,
            chunkIndex: 0,
            sourceType: "caption",
          });
        }
      } else {
        // 2b. Document pipeline: parse + extract text + tables
        const result = await this.processDocumentFile(content, job.mimeType, job.fileName);
        extractedText = result.text;
        structuredData = result.structuredData;

        if (result.text && result.text.trim().length > 0) {
          const textChunks = chunkText(result.text, CHUNK_SIZE, CHUNK_OVERLAP);
          for (const chunk of textChunks) {
            chunkMetas.push({
              content: chunk.content,
              chunkIndex: chunk.chunkIndex,
              pageNumber: chunk.pageNumber,
              sourceType: "text",
            });
          }
        }

        // Add table chunks separately for targeted retrieval
        if (result.tables && result.tables.length > 0) {
          let tableIdx = chunkMetas.length;
          for (const table of result.tables) {
            chunkMetas.push({
              content: table,
              chunkIndex: tableIdx++,
              sourceType: "table",
            });
          }
        }
      }

      // 3. Insert chunks (without embeddings first for fast pipeline)
      if (chunkMetas.length > 0) {
        await db.insert(attachmentChunks).values(
          chunkMetas.map(c => ({
            attachmentId: job.attachmentId,
            content: c.content,
            chunkIndex: c.chunkIndex,
            pageNumber: c.pageNumber ?? null,
            sourceType: c.sourceType,
            embedding: null,
            metadata: { fileName: job.fileName, mimeType: job.mimeType },
          }))
        );
      }

      // 4. Update attachment record with extracted content
      await db.update(attachments).set({
        pipelineStatus: "ready",
        extractedText: extractedText.slice(0, 100000), // cap storage
        ocrText,
        imageCaption,
        structuredData,
        chunkCount: chunkMetas.length,
        updatedAt: new Date(),
      }).where(eq(attachments.id, job.attachmentId));

      console.log(`[AttachmentPipeline] ✓ ${job.attachmentId}: ${chunkMetas.length} chunks created`);
      span?.setStatus({ code: 0 });

      // 5. Generate embeddings asynchronously (non-blocking)
      this.generateEmbeddingsAsync(job.attachmentId, chunkMetas);

    } catch (error: any) {
      span?.setStatus({ code: 2, message: error.message });
      throw error;
    } finally {
      span?.end();
    }
  }

  private async fetchContent(storagePath: string): Promise<Buffer> {
    // Try object storage first
    try {
      return await this.objectStorage.getObjectEntityBuffer(storagePath);
    } catch {
      // Fallback to local storage
      const objectId = storagePath.replace(/^\/objects\/uploads\//, "");
      const localPath = path.join(this.uploadsDir, objectId);

      // Wait for file to be written (upload may still be in progress)
      for (let i = 0; i < 10; i++) {
        try {
          return await fs.readFile(localPath);
        } catch {
          await new Promise(r => setTimeout(r, 500));
        }
      }
      throw new Error(`File not found: ${storagePath}`);
    }
  }

  private async processDocumentFile(
    buffer: Buffer,
    mimeType: string,
    fileName: string
  ): Promise<{ text: string; tables: string[]; structuredData: any }> {
    const span = traceAttachmentOp("attachment.pipeline.parse_document");
    try {
      const result = await processDocument(buffer, mimeType, fileName);
      span?.setStatus({ code: 0 });

      // Extract tables from structured metadata if available
      const tables: string[] = [];
      if (result.metadata?.tables && Array.isArray(result.metadata.tables)) {
        for (const table of result.metadata.tables) {
          if (typeof table === "string") tables.push(table);
          else if (table.content) tables.push(table.content);
        }
      }

      return {
        text: result.text || "",
        tables,
        structuredData: result.metadata || null,
      };
    } catch (error: any) {
      span?.setStatus({ code: 2, message: error.message });
      console.error(`[AttachmentPipeline] Document parse error for ${fileName}:`, error.message);
      return { text: "", tables: [], structuredData: null };
    } finally {
      span?.end();
    }
  }

  private async processImage(
    buffer: Buffer,
    mimeType: string,
    fileName: string
  ): Promise<{ ocrText: string | null; caption: string | null }> {
    const span = traceAttachmentOp("attachment.pipeline.process_image");
    try {
      const base64 = buffer.toString("base64");
      const dataUrl = `data:${mimeType};base64,${base64}`;

      // Use vision model for OCR + captioning in a single call
      let caption: string | null = null;
      let ocrText: string | null = null;

      try {
        const result = await llmGateway.chat([
          {
            role: "system",
            content: "You are an image analysis assistant. Analyze the image and provide: 1) A detailed description/caption of what the image contains. 2) Any text visible in the image (OCR). Format your response as:\nCAPTION: <description>\nOCR_TEXT: <any visible text, or NONE if no text is visible>"
          },
          {
            role: "user",
            content: [
              { type: "text", text: `Analyze this image (${fileName}):` },
              { type: "image_url", image_url: { url: dataUrl } },
            ] as any,
          }
        ], {
          model: "grok-4-fast-non-reasoning",
          maxTokens: 500,
          temperature: 0.3,
        });

        const response = result.content || "";
        const captionMatch = response.match(/CAPTION:\s*(.+?)(?=\nOCR_TEXT:|$)/s);
        const ocrMatch = response.match(/OCR_TEXT:\s*(.+?)$/s);

        caption = captionMatch?.[1]?.trim() || response.trim();
        const ocrResult = ocrMatch?.[1]?.trim();
        ocrText = ocrResult && ocrResult !== "NONE" ? ocrResult : null;

        console.log(`[AttachmentPipeline] Image analyzed: caption=${caption?.slice(0, 50)}..., hasOCR=${!!ocrText}`);
      } catch (visionError: any) {
        console.warn(`[AttachmentPipeline] Vision model unavailable for ${fileName}:`, visionError.message);
        caption = `Image file: ${fileName}`;
      }

      span?.setStatus({ code: 0 });
      return { ocrText, caption };
    } catch (error: any) {
      span?.setStatus({ code: 2, message: error.message });
      return { ocrText: null, caption: null };
    } finally {
      span?.end();
    }
  }

  private async generateEmbeddingsAsync(
    attachmentId: string,
    chunks: { content: string; chunkIndex: number }[]
  ): Promise<void> {
    try {
      if (chunks.length === 0) return;

      const texts = chunks.map(c => c.content);
      const embeddings = await generateEmbeddingsBatch(texts);

      for (let i = 0; i < chunks.length; i++) {
        await db.update(attachmentChunks)
          .set({ embedding: embeddings[i] })
          .where(
            and(
              eq(attachmentChunks.attachmentId, attachmentId),
              eq(attachmentChunks.chunkIndex, chunks[i].chunkIndex)
            )
          );
      }

      console.log(`[AttachmentPipeline] Embeddings generated for ${attachmentId} (${chunks.length} chunks)`);
    } catch (error: any) {
      console.error(`[AttachmentPipeline] Embedding error for ${attachmentId}:`, error.message);
    }
  }
}

export const attachmentPipeline = new AttachmentProcessingPipeline();
