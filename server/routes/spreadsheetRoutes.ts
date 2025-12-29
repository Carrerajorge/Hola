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
  updateAnalysisSession,
  createAnalysisOutput,
} from "../services/spreadsheetAnalyzer";
import { generateAnalysisCode, validatePythonCode } from "../services/spreadsheetLlmAgent";
import { executePythonCode, initializeSandbox } from "../services/pythonSandbox";

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
        fileName: originalName,
        mimeType,
        size: buffer.length,
        storageKey: tempFilePath,
        checksum,
        status: "ready",
      });

      const sheetsResponse: { name: string; rowCount: number; columnCount: number; headers: string[] }[] = [];

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

        const headers = sheetInfo.inferredHeaders.length > 0
          ? sheetInfo.inferredHeaders
          : Array.from({ length: sheetInfo.columnCount }, (_, i) => `Column${i + 1}`);

        sheetsResponse.push({
          name: sheetInfo.name,
          rowCount: sheetInfo.rowCount,
          columnCount: sheetInfo.columnCount,
          headers,
        });
      }

      let firstSheetPreview: { headers: string[]; data: any[][] } | null = null;
      if (parsed.sheets.length > 0) {
        const firstSheet = parsed.sheets[0];
        const headers = firstSheet.inferredHeaders.length > 0
          ? firstSheet.inferredHeaders
          : Array.from({ length: firstSheet.columnCount }, (_, i) => `Column${i + 1}`);
        const dataStartRow = firstSheet.inferredHeaders.length > 0 ? 1 : 0;
        const previewRows = firstSheet.previewData.slice(dataStartRow, dataStartRow + 100);
        firstSheetPreview = {
          headers,
          data: previewRows,
        };
      }

      res.json({
        id: uploadRecord.id,
        filename: originalName,
        sheets: sheetsResponse.map(s => s.name),
        sheetDetails: sheetsResponse,
        firstSheetPreview,
        uploadedAt: uploadRecord.createdAt?.toISOString() || new Date().toISOString(),
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

      if (!upload.storageKey) {
        return res.status(400).json({ error: "File not available" });
      }

      const buffer = await fs.readFile(upload.storageKey);
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

      const uploadData = await getUpload(uploadId);
      if (!uploadData) {
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

      // Execute analysis asynchronously
      executeAnalysis(session.id, uploadData, sheet, mode, prompt).catch((error) => {
        console.error("[SpreadsheetRoutes] Async analysis error:", error);
      });
    } catch (error: any) {
      console.error("[SpreadsheetRoutes] Analyze error:", error);
      res.status(500).json({ error: error.message || "Failed to start analysis" });
    }
  });

  async function executeAnalysis(
    sessionId: string,
    uploadData: Awaited<ReturnType<typeof getUpload>>,
    sheet: Awaited<ReturnType<typeof getSheets>>[0],
    mode: "full" | "text_only" | "numbers_only",
    prompt?: string
  ) {
    try {
      await updateAnalysisSession(sessionId, { status: "generating_code", startedAt: new Date() });

      const headers = sheet.inferredHeaders || [];
      const columnTypes = sheet.columnTypes || [];
      const sampleData = sheet.previewData?.slice(0, 10) || [];

      // Generate Python code using LLM
      const { code, intent } = await generateAnalysisCode({
        sheetName: sheet.name,
        headers,
        columnTypes,
        sampleData,
        mode,
        userPrompt: prompt,
      });

      // Validate the generated code
      const codeValidation = validatePythonCode(code);
      if (!codeValidation.valid) {
        await updateAnalysisSession(sessionId, {
          status: "failed",
          errorMessage: `Code validation failed: ${codeValidation.errors.join(", ")}`,
          completedAt: new Date(),
        });
        return;
      }

      await updateAnalysisSession(sessionId, { status: "executing", generatedCode: code });

      // Initialize sandbox and execute
      await initializeSandbox();

      const executionResult = await executePythonCode({
        code,
        filePath: uploadData!.storageKey,
        sheetName: sheet.name,
        timeoutMs: 30000,
      });

      if (!executionResult.success) {
        await updateAnalysisSession(sessionId, {
          status: "failed",
          errorMessage: executionResult.error || "Execution failed",
          executionTimeMs: executionResult.executionTimeMs,
          completedAt: new Date(),
        });
        return;
      }

      // Save outputs
      const output = executionResult.output;
      let outputOrder = 0;

      // Save summary as metric
      if (output?.summary) {
        await createAnalysisOutput({
          sessionId,
          outputType: "metric",
          title: "Summary",
          payload: { summary: output.summary },
          order: outputOrder++,
        });
      }

      // Save metrics
      if (output?.metrics && Object.keys(output.metrics).length > 0) {
        await createAnalysisOutput({
          sessionId,
          outputType: "metric",
          title: "Metrics",
          payload: output.metrics,
          order: outputOrder++,
        });
      }

      // Save tables
      if (output?.tables?.length > 0) {
        for (const table of output.tables) {
          await createAnalysisOutput({
            sessionId,
            outputType: "table",
            title: table.name || "Data Table",
            payload: { data: table.data },
            order: outputOrder++,
          });
        }
      }

      // Save charts
      if (output?.charts?.length > 0) {
        for (const chart of output.charts) {
          await createAnalysisOutput({
            sessionId,
            outputType: "chart",
            title: chart.title || "Chart",
            payload: chart,
            order: outputOrder++,
          });
        }
      }

      // Save logs
      if (output?.logs?.length > 0) {
        await createAnalysisOutput({
          sessionId,
          outputType: "log",
          title: "Execution Logs",
          payload: { logs: output.logs },
          order: outputOrder++,
        });
      }

      await updateAnalysisSession(sessionId, {
        status: "succeeded",
        executionTimeMs: executionResult.executionTimeMs,
        completedAt: new Date(),
      });

      console.log(`[SpreadsheetRoutes] Analysis completed for session ${sessionId}`);
    } catch (error: any) {
      console.error(`[SpreadsheetRoutes] Analysis execution error:`, error);
      await updateAnalysisSession(sessionId, {
        status: "failed",
        errorMessage: error.message || "Analysis execution failed",
        completedAt: new Date(),
      });
    }
  }

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
          generatedCode: session.generatedCode,
          executionTimeMs: session.executionTimeMs,
          createdAt: session.createdAt,
          completedAt: session.completedAt,
        },
        outputs: outputs.map((output) => ({
          type: output.outputType,
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

      if (upload.storageKey) {
        try {
          await fs.unlink(upload.storageKey);
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
