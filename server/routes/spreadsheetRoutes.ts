import { Router, Request, Response } from "express";
import multer from "multer";
import fs from "fs/promises";
import path from "path";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  validateSpreadsheetFile,
  generateChecksum,
  parseSpreadsheet,
  createUpload,
  getUpload,
  deleteUpload,
  createSheet,
  getSheets,
  createAnalysisSession,
  getAnalysisSession,
  getAnalysisOutputs,
} from "../services/spreadsheetAnalyzer";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const TEMP_DIR = "/tmp/spreadsheets";

async function ensureTempDir(): Promise<void> {
  try {
    await fs.mkdir(TEMP_DIR, { recursive: true });
  } catch (error) {
  }
}

function getFileExtension(mimeType: string): string {
  const extensions: Record<string, string> = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-excel": "xls",
    "text/csv": "csv",
  };
  return extensions[mimeType] || "xlsx";
}

export function createSpreadsheetRouter(): Router {
  const router = Router();

  router.post("/upload", upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const userId = (req as any).user?.id || "anonymous";
      const buffer = req.file.buffer;
      const mimeType = req.file.mimetype;
      const originalName = req.file.originalname;

      const validation = validateSpreadsheetFile(buffer, mimeType);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      const checksum = generateChecksum(buffer);

      const parsed = await parseSpreadsheet(buffer, mimeType);

      const uploadId = nanoid();
      const ext = getFileExtension(mimeType);
      const tempFilePath = path.join(TEMP_DIR, `${uploadId}.${ext}`);

      await ensureTempDir();
      await fs.writeFile(tempFilePath, buffer);

      const uploadRecord = await createUpload({
        id: uploadId,
        userId,
        originalFilename: originalName,
        mimeType,
        fileSize: buffer.length,
        checksum,
        tempFilePath,
        status: "ready",
      });

      const sheetsResponse: { name: string; rowCount: number; columnCount: number }[] = [];

      for (const sheetInfo of parsed.sheets) {
        await createSheet({
          uploadId: uploadRecord.id,
          name: sheetInfo.name,
          sheetIndex: sheetInfo.sheetIndex,
          rowCount: sheetInfo.rowCount,
          columnCount: sheetInfo.columnCount,
          inferredHeaders: sheetInfo.inferredHeaders,
          columnTypes: sheetInfo.columnTypes,
          previewData: sheetInfo.previewData,
        });

        sheetsResponse.push({
          name: sheetInfo.name,
          rowCount: sheetInfo.rowCount,
          columnCount: sheetInfo.columnCount,
        });
      }

      res.json({
        uploadId: uploadRecord.id,
        sheets: sheetsResponse,
      });
    } catch (error: any) {
      console.error("[SpreadsheetRoutes] Upload error:", error);
      res.status(500).json({ error: error.message || "Failed to upload spreadsheet" });
    }
  });

  router.get("/:uploadId/sheets", async (req: Request, res: Response) => {
    try {
      const { uploadId } = req.params;

      const upload = await getUpload(uploadId);
      if (!upload) {
        return res.status(404).json({ error: "Upload not found" });
      }

      const sheets = await getSheets(uploadId);

      res.json({
        sheets: sheets.map((sheet) => ({
          id: sheet.id,
          name: sheet.name,
          sheetIndex: sheet.sheetIndex,
          rowCount: sheet.rowCount,
          columnCount: sheet.columnCount,
          inferredHeaders: sheet.inferredHeaders,
          columnTypes: sheet.columnTypes,
        })),
      });
    } catch (error: any) {
      console.error("[SpreadsheetRoutes] Get sheets error:", error);
      res.status(500).json({ error: error.message || "Failed to get sheets" });
    }
  });

  router.get("/:uploadId/sheet/:sheetName/data", async (req: Request, res: Response) => {
    try {
      const { uploadId, sheetName } = req.params;
      const offset = parseInt(req.query.offset as string) || 0;
      const limit = parseInt(req.query.limit as string) || 100;

      const upload = await getUpload(uploadId);
      if (!upload) {
        return res.status(404).json({ error: "Upload not found" });
      }

      if (!upload.tempFilePath) {
        return res.status(400).json({ error: "File not available" });
      }

      const buffer = await fs.readFile(upload.tempFilePath);
      const parsed = await parseSpreadsheet(buffer, upload.mimeType);

      const sheet = parsed.sheets.find((s) => s.name === sheetName);
      if (!sheet) {
        return res.status(404).json({ error: "Sheet not found" });
      }

      const headers = sheet.inferredHeaders.length > 0 
        ? sheet.inferredHeaders 
        : Array.from({ length: sheet.columnCount }, (_, i) => `Column${i + 1}`);

      const dataStartRow = sheet.inferredHeaders.length > 0 ? 1 : 0;
      const allData = sheet.previewData.slice(dataStartRow);
      const totalRows = allData.length;
      const paginatedData = allData.slice(offset, offset + limit);

      res.json({
        data: paginatedData,
        headers,
        totalRows,
      });
    } catch (error: any) {
      console.error("[SpreadsheetRoutes] Get sheet data error:", error);
      res.status(500).json({ error: error.message || "Failed to get sheet data" });
    }
  });

  const analyzeSchema = z.object({
    sheetName: z.string(),
    mode: z.enum(["full", "text_only", "numbers_only"]),
    prompt: z.string().optional(),
  });

  router.post("/:uploadId/analyze", async (req: Request, res: Response) => {
    try {
      const { uploadId } = req.params;
      const userId = (req as any).user?.id || "anonymous";

      const validation = analyzeSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.message });
      }

      const { sheetName, mode, prompt } = validation.data;

      const upload = await getUpload(uploadId);
      if (!upload) {
        return res.status(404).json({ error: "Upload not found" });
      }

      const sheets = await getSheets(uploadId);
      const sheet = sheets.find((s) => s.name === sheetName);
      if (!sheet) {
        return res.status(404).json({ error: "Sheet not found" });
      }

      const session = await createAnalysisSession({
        uploadId,
        userId,
        sheetName,
        mode,
        userPrompt: prompt,
        status: "pending",
      });

      res.json({
        sessionId: session.id,
        status: session.status,
      });
    } catch (error: any) {
      console.error("[SpreadsheetRoutes] Analyze error:", error);
      res.status(500).json({ error: error.message || "Failed to start analysis" });
    }
  });

  router.get("/analysis/:sessionId", async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;

      const session = await getAnalysisSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: "Analysis session not found" });
      }

      const outputs = await getAnalysisOutputs(sessionId);

      res.json({
        session: {
          id: session.id,
          uploadId: session.uploadId,
          sheetName: session.sheetName,
          mode: session.mode,
          userPrompt: session.userPrompt,
          status: session.status,
          errorMessage: session.errorMessage,
          createdAt: session.createdAt,
          completedAt: session.completedAt,
        },
        outputs: outputs.map((output) => ({
          type: output.type,
          title: output.title,
          payload: output.payload,
        })),
      });
    } catch (error: any) {
      console.error("[SpreadsheetRoutes] Get analysis error:", error);
      res.status(500).json({ error: error.message || "Failed to get analysis" });
    }
  });

  router.delete("/:uploadId", async (req: Request, res: Response) => {
    try {
      const { uploadId } = req.params;

      const upload = await getUpload(uploadId);
      if (!upload) {
        return res.status(404).json({ error: "Upload not found" });
      }

      if (upload.tempFilePath) {
        try {
          await fs.unlink(upload.tempFilePath);
        } catch (error) {
        }
      }

      await deleteUpload(uploadId);

      res.json({ success: true });
    } catch (error: any) {
      console.error("[SpreadsheetRoutes] Delete error:", error);
      res.status(500).json({ error: error.message || "Failed to delete upload" });
    }
  });

  return router;
}
