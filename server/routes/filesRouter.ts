import { Router } from "express";
import { storage } from "../storage";
import { ObjectStorageService, ObjectNotFoundError, objectStorageClient } from "../objectStorage";
import { ALLOWED_MIME_TYPES, ALLOWED_EXTENSIONS, FILE_UPLOAD_CONFIG, LIMITS } from "../lib/constants";
import { fileProcessingQueue } from "../lib/fileProcessingQueue";
import { processDocument } from "../services/documentProcessing";
import { chunkText, generateEmbeddingsBatch } from "../embeddingService";

interface MultipartUploadSession {
  uploadId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  totalChunks: number;
  storagePath: string;
  basePath: string;
  bucketName: string;
  uploadedParts: Map<number, string>;
  createdAt: Date;
}

const multipartSessions: Map<string, MultipartUploadSession> = new Map();

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }
  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");
  return { bucketName, objectName };
}

async function signObjectURLForMultipart({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}`
    );
  }
  const { signed_url: signedURL } = await response.json();
  return signedURL;
}

async function processFileAsync(fileId: string, storagePath: string, mimeType: string, filename?: string) {
  try {
    const objectStorageService = new ObjectStorageService();
    const objectFile = await objectStorageService.getObjectEntityFile(storagePath);
    const content = await objectStorageService.getFileContent(objectFile);
    
    const result = await processDocument(content, mimeType, filename);
    const chunks = chunkText(result.text, 1500, 150);
    
    const chunksWithoutEmbeddings = chunks.map((chunk) => ({
      fileId,
      content: chunk.content,
      embedding: null,
      chunkIndex: chunk.chunkIndex,
      pageNumber: chunk.pageNumber || null,
      metadata: null,
    }));
    
    await storage.createFileChunks(chunksWithoutEmbeddings);
    await storage.updateFileStatus(fileId, "ready");
    
    console.log(`File ${fileId} processed: ${chunks.length} chunks created (fast mode)`);
    
    generateEmbeddingsAsync(fileId, chunks);
  } catch (error) {
    console.error(`Error processing file ${fileId}:`, error);
    await storage.updateFileStatus(fileId, "error");
  }
}

async function generateEmbeddingsAsync(fileId: string, chunks: { content: string; chunkIndex: number; pageNumber?: number }[]) {
  try {
    const texts = chunks.map(c => c.content);
    const embeddings = await generateEmbeddingsBatch(texts);
    
    for (let i = 0; i < chunks.length; i++) {
      await storage.updateFileChunkEmbedding(fileId, chunks[i].chunkIndex, embeddings[i]);
    }
    console.log(`File ${fileId} embeddings generated asynchronously`);
  } catch (error) {
    console.error(`Error generating embeddings for file ${fileId}:`, error);
  }
}

export function createFilesRouter() {
  const router = Router();
  const objectStorageService = new ObjectStorageService();

  router.get("/api/files", async (req, res) => {
    try {
      const files = await storage.getFiles();
      res.json(files);
    } catch (error: any) {
      console.error("Error getting files:", error);
      res.status(500).json({ error: "Failed to get files" });
    }
  });

  router.post("/api/objects/upload", async (req, res) => {
    try {
      const { uploadURL, storagePath } = await objectStorageService.getObjectEntityUploadURLWithPath();
      res.json({ uploadURL, storagePath });
    } catch (error: any) {
      console.error("Error getting upload URL:", error);
      res.status(500).json({ error: "Failed to get upload URL" });
    }
  });

  router.post("/api/objects/multipart/create", async (req, res) => {
    try {
      const { fileName, mimeType, fileSize, totalChunks } = req.body;

      if (!fileName || !mimeType || !fileSize || !totalChunks) {
        return res.status(400).json({ error: "Missing required fields: fileName, mimeType, fileSize, totalChunks" });
      }

      if (!ALLOWED_MIME_TYPES.includes(mimeType as any)) {
        return res.status(400).json({ error: `Unsupported file type: ${mimeType}` });
      }

      if (fileSize > LIMITS.MAX_FILE_SIZE_BYTES) {
        return res.status(400).json({ error: `File size exceeds maximum limit of ${LIMITS.MAX_FILE_SIZE_MB}MB` });
      }

      const uploadId = `multipart_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
      const privateObjectDir = objectStorageService.getPrivateObjectDir();
      const objectId = `uploads/${uploadId}`;
      const storagePath = `/objects/${objectId}`;

      const session: MultipartUploadSession = {
        uploadId,
        fileName,
        mimeType,
        fileSize,
        totalChunks,
        storagePath,
        basePath: `${privateObjectDir}/${objectId}`,
        bucketName: privateObjectDir.split('/')[1] || '',
        uploadedParts: new Map(),
        createdAt: new Date(),
      };

      multipartSessions.set(uploadId, session);

      res.json({ uploadId, storagePath });
    } catch (error: any) {
      console.error("Error creating multipart upload:", error);
      res.status(500).json({ error: "Failed to create multipart upload session" });
    }
  });

  router.post("/api/objects/multipart/sign-part", async (req, res) => {
    try {
      const { uploadId, partNumber } = req.body;

      if (!uploadId || partNumber === undefined) {
        return res.status(400).json({ error: "Missing required fields: uploadId, partNumber" });
      }

      const session = multipartSessions.get(uploadId);
      if (!session) {
        return res.status(404).json({ error: "Upload session not found" });
      }

      if (partNumber < 1 || partNumber > session.totalChunks) {
        return res.status(400).json({ error: `Invalid part number. Must be between 1 and ${session.totalChunks}` });
      }

      const partPath = `${session.basePath}_part_${partNumber}`;
      const { bucketName, objectName } = parseObjectPath(partPath);
      
      const signedUrl = await signObjectURLForMultipart({
        bucketName,
        objectName,
        method: "PUT",
        ttlSec: 900,
      });

      res.json({ signedUrl });
    } catch (error: any) {
      console.error("Error signing multipart part:", error);
      res.status(500).json({ error: "Failed to get signed URL for part" });
    }
  });

  router.post("/api/objects/multipart/complete", async (req, res) => {
    try {
      const { uploadId, parts } = req.body;

      if (!uploadId || !parts || !Array.isArray(parts)) {
        return res.status(400).json({ error: "Missing required fields: uploadId, parts" });
      }

      const session = multipartSessions.get(uploadId);
      if (!session) {
        return res.status(404).json({ error: "Upload session not found" });
      }

      const { bucketName } = parseObjectPath(session.basePath);
      const bucket = objectStorageClient.bucket(bucketName);
      
      const partPaths = parts
        .sort((a: { partNumber: number }, b: { partNumber: number }) => a.partNumber - b.partNumber)
        .map((p: { partNumber: number }) => {
          const partPath = `${session.basePath}_part_${p.partNumber}`;
          const { objectName } = parseObjectPath(partPath);
          return objectName;
        });

      const { objectName: finalObjectName } = parseObjectPath(session.basePath);
      const destinationFile = bucket.file(finalObjectName);

      try {
        await bucket.combine(
          partPaths.map(p => bucket.file(p)),
          destinationFile
        );
        
        await destinationFile.setMetadata({ contentType: session.mimeType });

        for (const objectPath of partPaths) {
          try {
            const fileRef = bucket.file(objectPath);
            await fileRef.delete();
          } catch (cleanupErr) {
            console.warn(JSON.stringify({ 
              event: "multipart_cleanup_failed", 
              path: objectPath 
            }));
          }
        }
      } catch (composeError: any) {
        console.error("Failed to compose parts:", composeError);
        return res.status(500).json({ error: "Failed to compose file parts" });
      }

      multipartSessions.delete(uploadId);

      const file = await storage.createFile({
        name: session.fileName,
        type: session.mimeType,
        size: session.fileSize,
        storagePath: session.storagePath,
        status: "processing",
        userId: null,
      });

      await storage.createFileJob({
        fileId: file.id,
        status: "pending",
      });

      fileProcessingQueue.enqueue({
        fileId: file.id,
        storagePath: session.storagePath,
        mimeType: session.mimeType,
        fileName: session.fileName,
      });

      res.json({ success: true, storagePath: session.storagePath, fileId: file.id });
    } catch (error: any) {
      console.error("Error completing multipart upload:", error);
      res.status(500).json({ error: "Failed to complete multipart upload" });
    }
  });

  router.post("/api/objects/multipart/abort", async (req, res) => {
    try {
      const { uploadId } = req.body;

      if (!uploadId) {
        return res.status(400).json({ error: "Missing required field: uploadId" });
      }

      const session = multipartSessions.get(uploadId);
      if (!session) {
        return res.status(404).json({ error: "Upload session not found" });
      }

      const { bucketName } = parseObjectPath(session.basePath);
      const bucket = objectStorageClient.bucket(bucketName);

      for (let i = 1; i <= session.totalChunks; i++) {
        const chunkPath = session.basePath.concat("_part_", String(i));
        const { objectName } = parseObjectPath(chunkPath);
        try {
          const fileRef = bucket.file(objectName);
          await fileRef.delete();
        } catch (cleanupErr) {
        }
      }

      multipartSessions.delete(uploadId);

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error aborting multipart upload:", error);
      res.status(500).json({ error: "Failed to abort multipart upload" });
    }
  });

  router.get("/api/files/config", (req, res) => {
    res.json({
      allowedMimeTypes: [...ALLOWED_MIME_TYPES],
      allowedExtensions: ALLOWED_EXTENSIONS,
      maxFileSize: LIMITS.MAX_FILE_SIZE_BYTES,
      maxFileSizeMB: LIMITS.MAX_FILE_SIZE_MB,
      chunkSize: FILE_UPLOAD_CONFIG.CHUNK_SIZE_BYTES,
      chunkSizeMB: FILE_UPLOAD_CONFIG.CHUNK_SIZE_MB,
      maxParallelChunks: FILE_UPLOAD_CONFIG.MAX_PARALLEL_CHUNKS,
    });
  });

  router.post("/api/files/quick", async (req, res) => {
    try {
      const { name, type, size, storagePath } = req.body;

      if (!name || !type || !size || !storagePath) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const file = await storage.createFile({
        name,
        type,
        size,
        storagePath,
        status: "ready",
        userId: null,
      });

      res.json(file);
    } catch (error: any) {
      console.error("Error creating quick file:", error);
      res.status(500).json({ error: "Failed to create file" });
    }
  });

  router.post("/api/files", async (req, res) => {
    try {
      const { name, type, size, storagePath } = req.body;

      if (!name || !type || !size || !storagePath) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      if (!ALLOWED_MIME_TYPES.includes(type)) {
        return res.status(400).json({ error: `Unsupported file type: ${type}` });
      }

      const file = await storage.createFile({
        name,
        type,
        size,
        storagePath,
        status: "processing",
        userId: null,
      });

      processFileAsync(file.id, storagePath, type, name);

      res.json(file);
    } catch (error: any) {
      console.error("Error creating file:", error);
      res.status(500).json({ error: "Failed to create file" });
    }
  });

  router.delete("/api/files/:id", async (req, res) => {
    try {
      await storage.deleteFile(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting file:", error);
      res.status(500).json({ error: "Failed to delete file" });
    }
  });

  router.get("/api/files/:id/content", async (req, res) => {
    try {
      const file = await storage.getFile(req.params.id);
      if (!file) {
        return res.status(404).json({ error: "File not found" });
      }
      if (file.status !== "ready") {
        return res.status(202).json({ status: file.status, content: null });
      }
      const chunks = await storage.getFileChunks(req.params.id);
      const content = chunks
        .sort((a, b) => a.chunkIndex - b.chunkIndex)
        .map(c => c.content)
        .join("\n");
      res.json({ status: "ready", content, fileName: file.name });
    } catch (error: any) {
      console.error("Error getting file content:", error);
      res.status(500).json({ error: "Failed to get file content" });
    }
  });

  router.get("/objects/:objectPath(*)", async (req, res) => {
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        return res.sendStatus(404);
      }
      console.error("Error serving object:", error);
      return res.sendStatus(500);
    }
  });

  return router;
}

export { ObjectStorageService, ObjectNotFoundError };
