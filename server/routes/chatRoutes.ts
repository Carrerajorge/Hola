import { Router, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { getUpload, getSheets } from "../services/spreadsheetAnalyzer";
import {
  startAnalysis,
  getAnalysisProgress,
  getAnalysisResults,
} from "../services/analysisOrchestrator";

const analyzeRequestSchema = z.object({
  messageId: z.string().optional(),
  scope: z.enum(["all", "selected", "active"]).default("all"),
  sheetsToAnalyze: z.array(z.string()).optional(),
  prompt: z.string().optional(),
});

export function createChatRoutes(): Router {
  const router = Router();

  router.post("/uploads/:uploadId/analyze", async (req: Request, res: Response) => {
    try {
      const { uploadId } = req.params;
      const userId = (req as any).user?.id || "anonymous";

      const validation = analyzeRequestSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.message });
      }

      const { messageId, scope, sheetsToAnalyze, prompt } = validation.data;

      const upload = await getUpload(uploadId);
      if (!upload) {
        return res.status(404).json({ error: "Upload not found" });
      }

      const sheets = await getSheets(uploadId);
      if (sheets.length === 0) {
        return res.status(400).json({ error: "No sheets found for this upload" });
      }

      let targetSheets: string[];
      if (scope === "selected" && sheetsToAnalyze && sheetsToAnalyze.length > 0) {
        targetSheets = sheetsToAnalyze.filter(name =>
          sheets.some(s => s.name === name)
        );
        if (targetSheets.length === 0) {
          return res.status(400).json({ error: "No valid sheets specified for analysis" });
        }
      } else if (scope === "active") {
        targetSheets = [sheets[0].name];
      } else {
        targetSheets = sheets.map(s => s.name);
      }

      const chatAnalysis = await storage.createChatMessageAnalysis({
        messageId: messageId || null,
        uploadId,
        status: "pending",
        scope,
        sheetsToAnalyze: targetSheets,
        startedAt: new Date(),
      });

      try {
        const { sessionId } = await startAnalysis({
          uploadId,
          userId,
          scope,
          sheetNames: targetSheets,
          analysisMode: "full",
          userPrompt: prompt,
        });

        await storage.updateChatMessageAnalysis(chatAnalysis.id, {
          sessionId,
          status: "analyzing",
        });

        res.json({
          analysisId: chatAnalysis.id,
          sessionId,
          status: "analyzing" as const,
        });
      } catch (analysisError: any) {
        await storage.updateChatMessageAnalysis(chatAnalysis.id, {
          status: "failed",
          completedAt: new Date(),
        });
        throw analysisError;
      }
    } catch (error: any) {
      console.error("[ChatRoutes] Start analysis error:", error);
      res.status(500).json({ error: error.message || "Failed to start analysis" });
    }
  });

  router.get("/uploads/:uploadId/analysis", async (req: Request, res: Response) => {
    try {
      const { uploadId } = req.params;

      const chatAnalysis = await storage.getChatMessageAnalysisByUploadId(uploadId);
      if (!chatAnalysis) {
        return res.status(404).json({ error: "Analysis not found for this upload" });
      }

      let progress = { completedJobs: 0, totalJobs: 0 };
      let perSheet: Array<{
        sheetName: string;
        status: "queued" | "running" | "done" | "failed";
        results?: { tables: any[]; metrics: any; charts: any[]; summary: string };
        error?: string;
      }> = [];
      let crossSheetSummary: string | undefined;
      let overallStatus: "pending" | "analyzing" | "completed" | "failed" = chatAnalysis.status as any;

      if (chatAnalysis.sessionId) {
        try {
          const analysisProgress = await getAnalysisProgress(chatAnalysis.sessionId);
          progress = {
            completedJobs: analysisProgress.completedJobs,
            totalJobs: analysisProgress.totalJobs,
          };

          perSheet = analysisProgress.jobs.map(job => ({
            sheetName: job.sheetName,
            status: job.status,
            error: job.error,
          }));

          if (analysisProgress.status === "completed" || analysisProgress.status === "failed") {
            const results = await getAnalysisResults(chatAnalysis.sessionId);
            if (results) {
              crossSheetSummary = results.crossSheetSummary;
              
              perSheet = perSheet.map(sheet => {
                const sheetResults = results.perSheet[sheet.sheetName];
                if (sheetResults && sheet.status === "done") {
                  return {
                    ...sheet,
                    results: {
                      tables: sheetResults.outputs?.tables || [],
                      metrics: sheetResults.outputs?.metrics || {},
                      charts: sheetResults.outputs?.charts || [],
                      summary: sheetResults.summary || "",
                    },
                  };
                }
                return sheet;
              });
            }

            overallStatus = analysisProgress.status;
            
            if (chatAnalysis.status !== "completed" && chatAnalysis.status !== "failed") {
              await storage.updateChatMessageAnalysis(chatAnalysis.id, {
                status: analysisProgress.status,
                completedAt: new Date(),
                summary: crossSheetSummary,
              });
            }
          } else {
            overallStatus = analysisProgress.status === "running" ? "analyzing" : "pending";
          }
        } catch (progressError: any) {
          console.error("[ChatRoutes] Error getting analysis progress:", progressError);
        }
      }

      res.json({
        analysisId: chatAnalysis.id,
        status: overallStatus,
        progress,
        perSheet,
        crossSheetSummary,
        startedAt: chatAnalysis.startedAt?.toISOString(),
        completedAt: chatAnalysis.completedAt?.toISOString(),
      });
    } catch (error: any) {
      console.error("[ChatRoutes] Get analysis error:", error);
      res.status(500).json({ error: error.message || "Failed to get analysis" });
    }
  });

  return router;
}
