import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");
const MAX_UPLOAD_SIZE = 100 * 1024 * 1024; // 100MB hard limit

// UUID v4 pattern — strict validation to prevent path traversal
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Validate objectId is a safe UUID and resolve path stays within uploads dir */
function validateObjectId(objectId: string): { valid: boolean; filePath?: string } {
    if (!UUID_PATTERN.test(objectId)) return { valid: false };
    const filePath = path.resolve(UPLOADS_DIR, objectId);
    const safePrefix = path.resolve(UPLOADS_DIR) + path.sep;
    if (!filePath.startsWith(safePrefix)) return { valid: false };
    return { valid: true, filePath };
}

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true, mode: 0o750 });
}

export function createLocalStorageRouter() {
    const router = Router();

    // Generate a presigned-like URL for local uploads
    router.post("/api/objects/upload", async (_req: Request, res: Response) => {
        try {
            const objectId = randomUUID();
            const storagePath = `/objects/uploads/${objectId}`;
            // For local dev, return a URL to our own upload endpoint
            const uploadURL = `/api/local-upload/${objectId}`;

            res.json({ uploadURL, storagePath });
        } catch (error: any) {
            console.error("Error generating local upload URL:", error);
            res.status(500).json({ error: "Failed to generate upload URL" });
        }
    });

    // Handle actual file upload — with path traversal protection & size limits
    router.put("/api/local-upload/:objectId", async (req: Request, res: Response) => {
        try {
            const { objectId } = req.params;

            // Validate objectId to prevent path traversal
            const validation = validateObjectId(objectId);
            if (!validation.valid || !validation.filePath) {
                return res.status(400).json({ error: "Invalid object ID" });
            }
            const filePath = validation.filePath;

            const chunks: Buffer[] = [];
            let totalSize = 0;
            let aborted = false;

            req.on("data", (chunk: Buffer) => {
                if (aborted) return;
                totalSize += chunk.length;
                if (totalSize > MAX_UPLOAD_SIZE) {
                    aborted = true;
                    res.status(413).json({ error: "File too large" });
                    req.destroy();
                    return;
                }
                chunks.push(chunk);
            });
            req.on("end", async () => {
                if (aborted) return;
                try {
                    const buffer = Buffer.concat(chunks);
                    await fs.promises.writeFile(filePath, buffer, { mode: 0o640 });
                    console.log(`[LocalStorage] File saved: ${objectId} (${buffer.length} bytes)`);
                    // Don't leak filesystem path in response
                    res.status(200).json({ success: true, storagePath: `/objects/uploads/${objectId}` });
                } catch (writeErr: any) {
                    if (writeErr?.code === "ENOSPC") {
                        return res.status(507).json({ error: "Insufficient disk space" });
                    }
                    console.error("Error writing upload:", writeErr instanceof Error ? writeErr.message : String(writeErr));
                    if (!res.headersSent) res.status(500).json({ error: "Upload failed" });
                }
            });
            req.on("error", (error) => {
                console.error("Upload stream error:", error instanceof Error ? error.message : String(error));
                if (!res.headersSent) res.status(500).json({ error: "Upload failed" });
            });
        } catch (error: any) {
            console.error("Error handling local upload:", error instanceof Error ? error.message : String(error));
            if (!res.headersSent) res.status(500).json({ error: "Upload failed" });
        }
    });

    // Serve uploaded files — with path traversal protection & security headers
    router.get("/api/local-files/:objectId", async (req: Request, res: Response) => {
        try {
            const { objectId } = req.params;

            // Validate objectId to prevent path traversal
            const validation = validateObjectId(objectId);
            if (!validation.valid || !validation.filePath) {
                return res.status(400).json({ error: "Invalid object ID" });
            }
            const filePath = validation.filePath;

            if (!fs.existsSync(filePath)) {
                return res.status(404).json({ error: "File not found" });
            }

            // Security headers to prevent inline execution of potentially dangerous content
            res.setHeader("X-Content-Type-Options", "nosniff");
            res.setHeader("Content-Disposition", `attachment; filename="${objectId}"`);
            res.setHeader("Cache-Control", "private, max-age=3600");

            const content = await fs.promises.readFile(filePath);
            res.send(content);
        } catch (error: any) {
            console.error("Error serving file:", error instanceof Error ? error.message : String(error));
            res.status(500).json({ error: "Failed to serve file" });
        }
    });

    return router;
}
