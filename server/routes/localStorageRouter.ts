import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
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

    // Handle actual file upload
    router.put("/api/local-upload/:objectId", async (req: Request, res: Response) => {
        try {
            const { objectId } = req.params;
            const filePath = path.join(UPLOADS_DIR, objectId);

            const chunks: Buffer[] = [];
            req.on("data", (chunk) => chunks.push(chunk));
            req.on("end", async () => {
                const buffer = Buffer.concat(chunks);
                await fs.promises.writeFile(filePath, buffer);
                console.log(`[LocalStorage] File saved: ${filePath} (${buffer.length} bytes)`);
                res.status(200).json({ success: true, path: filePath });
            });
            req.on("error", (error) => {
                console.error("Upload error:", error);
                res.status(500).json({ error: "Upload failed" });
            });
        } catch (error: any) {
            console.error("Error handling local upload:", error);
            res.status(500).json({ error: "Upload failed" });
        }
    });

    // Serve uploaded files
    router.get("/api/local-files/:objectId", async (req: Request, res: Response) => {
        try {
            const { objectId } = req.params;
            const filePath = path.join(UPLOADS_DIR, objectId);

            if (!fs.existsSync(filePath)) {
                return res.status(404).json({ error: "File not found" });
            }

            const content = await fs.promises.readFile(filePath);
            res.send(content);
        } catch (error: any) {
            console.error("Error serving file:", error);
            res.status(500).json({ error: "Failed to serve file" });
        }
    });

    return router;
}
