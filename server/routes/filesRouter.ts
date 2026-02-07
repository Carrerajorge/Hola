import { Router } from "express";
import { storage } from "../storage";
import { ObjectStorageService, ObjectNotFoundError, objectStorageClient } from "../objectStorage";
import { ALLOWED_MIME_TYPES, ALLOWED_EXTENSIONS, FILE_UPLOAD_CONFIG, HTTP_HEADERS, LIMITS } from "../lib/constants";
import { fileProcessingQueue } from "../lib/fileProcessingQueue";
import { validateAttachmentSecurity } from "../lib/pareSecurityGuard";
import { processDocument } from "../services/documentProcessing";
import { chunkText, generateEmbeddingsBatch } from "../embeddingService";
import { sanitizeFilename } from "../services/fileValidation";
import dns from "node:dns/promises";
import net from "node:net";
import path from "node:path";

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

function isPrivateIpAddress(ip: string): boolean {
  const normalized = ip.toLowerCase();

  // IPv4-mapped IPv6, e.g. ::ffff:127.0.0.1
  if (normalized.startsWith("::ffff:")) {
    const v4 = normalized.slice("::ffff:".length);
    return isPrivateIpAddress(v4);
  }

  if (net.isIPv4(normalized)) {
    const parts = normalized.split(".").map(Number);
    if (parts.length !== 4 || parts.some(p => Number.isNaN(p) || p < 0 || p > 255)) return true;
    const [a, b, c] = parts;

    if (a === 0) return true; // "this host on this network"
    if (a === 10) return true; // RFC1918
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT

    // TEST-NET ranges and benchmarking ranges (avoid SSRF to non-routable)
    if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24
    if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15
    if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24
    if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24

    if (a >= 224) return true; // multicast/reserved
    return false;
  }

  if (net.isIPv6(normalized)) {
    if (normalized === "::" || normalized === "::1") return true;
    if (normalized.startsWith("fe80:")) return true; // link-local
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local
    if (normalized.startsWith("2001:db8:")) return true; // documentation
    return false;
  }

  // Unknown format: be safe and block.
  return true;
}

async function assertSafeRemoteHttpUrl(rawUrl: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Unsupported URL protocol");
  }

  // Strip credentials (userinfo) to avoid leaking secrets and weird auth flows.
  parsed.username = "";
  parsed.password = "";

  const hostname = (parsed.hostname || "").toLowerCase();
  if (!hostname) throw new Error("Invalid URL hostname");

  // Block obvious internal domains.
  const blocked = [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
  ];
  if (blocked.includes(hostname) || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("Blocked internal hostname");
  }

  const ipType = net.isIP(hostname);
  if (ipType) {
    if (isPrivateIpAddress(hostname)) {
      throw new Error("Blocked private IP");
    }
    return parsed.href;
  }

  // DNS resolve and reject any private/reserved targets.
  const addrs = await dns.lookup(hostname, { all: true });
  if (!addrs || addrs.length === 0) {
    throw new Error("Unable to resolve hostname");
  }
  if (addrs.some(a => isPrivateIpAddress(a.address))) {
    throw new Error("Blocked private IP (DNS)");
  }

  return parsed.href;
}

function stripContentType(contentType: string | null): string | null {
  if (!contentType) return null;
  const base = contentType.split(";")[0]?.trim().toLowerCase();
  return base || null;
}

function parseFilenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;

  // RFC 5987: filename*=UTF-8''...
  const filenameStarMatch = header.match(/filename\\*\\s*=\\s*([^']*)''([^;]+)/i);
  if (filenameStarMatch) {
    try {
      const encoded = filenameStarMatch[2].trim();
      return decodeURIComponent(encoded);
    } catch {
      // fall through to filename=
    }
  }

  const filenameMatch = header.match(/filename\\s*=\\s*\"?([^\";]+)\"?/i);
  if (filenameMatch) {
    return filenameMatch[1].trim();
  }
  return null;
}

function inferMimeTypeFromFileName(fileName: string): string | null {
  const ext = (path.extname(fileName || "").toLowerCase() || "").replace(".", "");
  if (!ext) return null;

  const map: Record<string, string> = {
    // documents
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ppt: "application/vnd.ms-powerpoint",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    html: "text/html",
    htm: "text/html",
    json: "application/json",

    // images
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    bmp: "image/bmp",
    webp: "image/webp",
    tif: "image/tiff",
    tiff: "image/tiff",
    svg: "image/svg+xml",
  };

  return map[ext] || null;
}

function ensureExtensionForMimeType(fileName: string, mimeType: string): string {
  if (!fileName) return fileName;
  if (path.extname(fileName)) return fileName;

  if (mimeType.startsWith("image/")) {
    const imageExtMap: Record<string, string> = {
      "image/jpeg": ".jpg",
      "image/jpg": ".jpg",
      "image/png": ".png",
      "image/gif": ".gif",
      "image/bmp": ".bmp",
      "image/webp": ".webp",
      "image/tiff": ".tiff",
      "image/svg+xml": ".svg",
    };
    return fileName + (imageExtMap[mimeType] || "");
  }

  const ext = (ALLOWED_EXTENSIONS as Record<string, string>)[mimeType];
  if (ext) return fileName + ext;
  return fileName;
}

async function downloadUrlToBufferWithRedirects(
  rawUrl: string,
  {
    maxBytes,
    timeoutMs,
    maxRedirects,
  }: {
    maxBytes: number;
    timeoutMs: number;
    maxRedirects: number;
  }
): Promise<{
  finalUrl: string;
  contentType: string | null;
  contentDisposition: string | null;
  buffer: Buffer;
}> {
  let currentUrl = await assertSafeRemoteHttpUrl(rawUrl);

  for (let i = 0; i <= maxRedirects; i++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": HTTP_HEADERS.USER_AGENT,
          "Accept": "*/*",
          "Accept-Language": HTTP_HEADERS.ACCEPT_LANGUAGE,
        },
      });

      // Redirect handling
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new Error(`Redirect without location (status ${response.status})`);
        }
        const next = new URL(location, currentUrl).href;
        currentUrl = await assertSafeRemoteHttpUrl(next);
        continue;
      }

      if (!response.ok) {
        throw new Error(`Failed to download (status ${response.status})`);
      }

      const contentType = stripContentType(response.headers.get("content-type"));
      const contentDisposition = response.headers.get("content-disposition");
      const declaredLen = response.headers.get("content-length");
      const contentLength = declaredLen ? parseInt(declaredLen, 10) : NaN;
      if (!Number.isNaN(contentLength) && contentLength > maxBytes) {
        throw new Error("File too large");
      }

      const chunks: Buffer[] = [];
      let received = 0;

      // Node/undici ReadableStream is async iterable.
      const body = response.body as any;
      if (!body) {
        throw new Error("Empty response body");
      }

      for await (const chunk of body) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        received += buf.length;
        if (received > maxBytes) {
          controller.abort();
          throw new Error("File too large");
        }
        chunks.push(buf);
      }

      return {
        finalUrl: currentUrl,
        contentType,
        contentDisposition,
        buffer: Buffer.concat(chunks),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("Too many redirects");
}

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
    let content: Buffer;

    // Check if this is a local storage path (from our local fallback)
    if (storagePath.startsWith('/objects/uploads/')) {
      // Extract the object ID from the path and read from local uploads directory
      const objectId = storagePath.replace('/objects/uploads/', '');
      const fs = await import("fs");
      const path = await import("path");
      const localFilePath = path.default.join(process.cwd(), "uploads", objectId);

      console.log(`[processFileAsync] Reading local file: ${localFilePath}`);

      if (!fs.default.existsSync(localFilePath)) {
        throw new Error(`Local file not found: ${localFilePath}`);
      }

      content = await fs.promises.readFile(localFilePath);
      console.log(`[processFileAsync] Read ${content.length} bytes from local file`);
    } else {
      // Use object storage for non-local paths
      const objectStorageService = new ObjectStorageService();
      const objectFile = await objectStorageService.getObjectEntityFile(storagePath);
      content = await objectStorageService.getFileContent(objectFile);
    }

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
  const uploadsDir = path.resolve(process.cwd(), "uploads");

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
      // Fallback to local storage for development
      console.log("[FilesRouter] Replit object storage unavailable, using local fallback");
      try {
        const fs = await import("fs");
        const path = await import("path");
        const crypto = await import("crypto");

        const UPLOADS_DIR = path.default.join(process.cwd(), "uploads");
        if (!fs.default.existsSync(UPLOADS_DIR)) {
          fs.default.mkdirSync(UPLOADS_DIR, { recursive: true });
        }

        const objectId = crypto.randomUUID();
        const storagePath = `/objects/uploads/${objectId}`;
        // Return local upload endpoint URL
        const uploadURL = `/api/local-upload/${objectId}`;

        res.json({ uploadURL, storagePath, localFallback: true });
      } catch (localError: any) {
        console.error("Error with local fallback:", localError);
        res.status(500).json({ error: "Failed to get upload URL" });
      }
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

  router.post("/api/files/import-url", async (req, res) => {
    try {
      const { url } = req.body as { url?: unknown };
      if (!url || typeof url !== "string") {
        return res.status(400).json({ error: "Missing required field: url" });
      }

      const download = await downloadUrlToBufferWithRedirects(url, {
        maxBytes: LIMITS.MAX_FILE_SIZE_BYTES,
        timeoutMs: 15000,
        maxRedirects: 5,
      });

      const fromDisposition = parseFilenameFromContentDisposition(download.contentDisposition);
      const fromUrlPath = (() => {
        try {
          const u = new URL(download.finalUrl);
          const base = path.basename(u.pathname || "");
          return base ? decodeURIComponent(base) : null;
        } catch {
          return null;
        }
      })();

      let fileName = sanitizeFilename(fromDisposition || fromUrlPath || `imported-${Date.now()}`);

      // Determine MIME type: prefer header when usable; otherwise infer from filename.
      const headerType = download.contentType;
      let claimedMimeType = headerType && headerType !== "application/octet-stream" ? headerType : null;
      if (!claimedMimeType) {
        claimedMimeType = inferMimeTypeFromFileName(fileName);
      }
      if (!claimedMimeType) {
        claimedMimeType = "application/octet-stream";
      }

      // Security validation (magic bytes, dangerous formats, zip bomb/path traversal checks).
      const security = await validateAttachmentSecurity(
        {
          filename: fileName,
          buffer: download.buffer,
          providedMimeType: claimedMimeType,
        },
        {
          strictMode: true,
          allowMimeMismatch: true,
          maxFileSizeMB: LIMITS.MAX_FILE_SIZE_MB,
        }
      );

      if (!security.safe) {
        const topViolation =
          security.violations.find(v => v.severity === "critical") ||
          security.violations.find(v => v.severity === "high") ||
          security.violations[0];
        return res.status(400).json({ error: topViolation?.message || "Archivo rechazado por seguridad" });
      }

      const detectedMimeType = security.mimeDetection?.detectedMime || claimedMimeType;
      const mimeType =
        ALLOWED_MIME_TYPES.includes(detectedMimeType as any) ? detectedMimeType :
          ALLOWED_MIME_TYPES.includes(claimedMimeType as any) ? claimedMimeType :
            null;

      if (!mimeType) {
        return res.status(400).json({ error: `Unsupported file type: ${detectedMimeType}` });
      }

      const hasAttachmentDisposition = (download.contentDisposition || "").toLowerCase().includes("attachment");
      const hasHtmlExtension = /\.html?$/i.test(fileName);
      if (mimeType === "text/html" && !hasAttachmentDisposition && !hasHtmlExtension) {
        return res.status(400).json({ error: "El enlace no parece un archivo descargable (HTML)" });
      }

      fileName = ensureExtensionForMimeType(fileName, mimeType);
      const fileSize = download.buffer.length;

      if (fileSize === 0) {
        return res.status(400).json({ error: "Downloaded file is empty" });
      }

      if (fileSize > LIMITS.MAX_FILE_SIZE_BYTES) {
        return res.status(413).json({ error: "File too large" });
      }

      // Upload to object storage (or local fallback).
      let storagePath: string;
      try {
        const { uploadURL, storagePath: sp } = await objectStorageService.getObjectEntityUploadURLWithPath();
        const putRes = await fetch(uploadURL, {
          method: "PUT",
          headers: { "Content-Type": mimeType },
          body: download.buffer,
        });
        if (!putRes.ok) {
          throw new Error(`Upload failed with status ${putRes.status}`);
        }
        storagePath = sp;
      } catch (error: any) {
        // Local fallback
        const fs = await import("node:fs/promises");
        const crypto = await import("node:crypto");

        await fs.mkdir(uploadsDir, { recursive: true });
        const objectId = crypto.randomUUID();
        const localFilePath = path.join(uploadsDir, objectId);
        await fs.writeFile(localFilePath, download.buffer);
        storagePath = `/objects/uploads/${objectId}`;
      }

      const isImage = mimeType.startsWith("image/");
      if (isImage) {
        const file = await storage.createFile({
          name: fileName,
          type: mimeType,
          size: fileSize,
          storagePath,
          status: "ready",
          userId: null,
        });
        const shouldInlineDataUrl = fileSize <= 15 * 1024 * 1024;
        const dataUrl = shouldInlineDataUrl
          ? `data:${mimeType};base64,${download.buffer.toString("base64")}`
          : undefined;
        return res.json({ ...file, ...(dataUrl ? { dataUrl } : {}) });
      }

      const file = await storage.createFile({
        name: fileName,
        type: mimeType,
        size: fileSize,
        storagePath,
        status: "processing",
        userId: null,
      });

      // Process immediately (same behavior as /api/files).
      processFileAsync(file.id, storagePath, mimeType, fileName);

      return res.json(file);
    } catch (error: any) {
      console.error("Error importing file from URL:", error);
      const msg = String(error?.message || "Failed to import file");
      const lower = msg.toLowerCase();

      if (lower.includes("file too large") || lower.includes("too large")) {
        return res.status(413).json({ error: msg });
      }
      if (lower.includes("invalid url") || lower.includes("unsupported url protocol") || lower.includes("blocked") || lower.includes("resolve hostname") || lower.includes("redirect")) {
        return res.status(400).json({ error: msg });
      }
      if (lower.includes("unsupported file type")) {
        return res.status(400).json({ error: msg });
      }

      return res.status(500).json({ error: msg });
    }
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
      // LOCAL FALLBACK: In development, /api/objects/upload can return storage paths like
      // /objects/uploads/<uuid> when the Replit object storage sidecar is unavailable.
      // Serve those files directly from disk so the client can preview attachments.
      if (req.path.startsWith("/objects/uploads/")) {
        const fs = await import("fs");
        const path = await import("path");
        const objectId = req.path.replace("/objects/uploads/", "");
        const uploadsDir = path.default.resolve(process.cwd(), "uploads");
        const localFilePath = path.default.resolve(uploadsDir, objectId);
        const safePrefix = uploadsDir + path.default.sep;

        // Prevent path traversal outside uploads/.
        if (!localFilePath.startsWith(safePrefix)) {
          return res.sendStatus(404);
        }

        if (!fs.default.existsSync(localFilePath)) {
          return res.sendStatus(404);
        }

        return res.sendFile(localFilePath);
      }

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

  // Local file upload handler (development fallback)
  router.put("/api/local-upload/:objectId", async (req, res) => {
    try {
      const { objectId } = req.params;
      const fsSync = await import("fs");
      const pathMod = await import("path");

      const UPLOADS_DIR = pathMod.default.join(process.cwd(), "uploads");
      if (!fsSync.default.existsSync(UPLOADS_DIR)) {
        fsSync.default.mkdirSync(UPLOADS_DIR, { recursive: true });
      }

      const filePath = pathMod.default.join(UPLOADS_DIR, objectId);


      const MAX_SIZE = 100 * 1024 * 1024; // Hard limit 100MB for local uploads

      const contentLength = parseInt(req.headers['content-length'] || '0');
      if (contentLength > MAX_SIZE) {
        return res.status(413).json({ error: "File too large" });
      }

      const writeStream = fsSync.default.createWriteStream(filePath);
      let receivedBytes = 0;

      req.pipe(writeStream);

      req.on("data", (chunk: Buffer) => {
        receivedBytes += chunk.length;
        if (receivedBytes > MAX_SIZE) {
          writeStream.destroy();
          fsSync.default.unlinkSync(filePath); // Cleanup
          // We can't easily send a response if we're pipe-ing, but we can try destroying request
          req.destroy(new Error("File limit exceeded"));
        }
      });

      writeStream.on("finish", async () => {
        console.log(`[LocalStorage] File streamed to disk: ${filePath} (${receivedBytes} bytes)`);
        res.status(200).json({ success: true, path: filePath, size: receivedBytes });
      });

      writeStream.on("error", (error: Error) => {
        console.error("Upload stream error:", error);
        if (!res.headersSent) res.status(500).json({ error: "Upload failed" });
      });
    } catch (error: any) {
      console.error("Error handling local upload:", error);
      res.status(500).json({ error: "Upload failed" });
    }
  });

  // Serve locally uploaded files
  router.get("/api/local-files/:objectId", async (req, res) => {
    try {
      const { objectId } = req.params;
      const fsSync = await import("fs");
      const pathMod = await import("path");

      const filePath = pathMod.default.join(process.cwd(), "uploads", objectId);

      if (!fsSync.default.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found" });
      }

      const content = await fsSync.promises.readFile(filePath);
      res.send(content);
    } catch (error: any) {
      console.error("Error serving file:", error);
      res.status(500).json({ error: "Failed to serve file" });
    }
  });

  return router;
}

export { ObjectStorageService, ObjectNotFoundError };
