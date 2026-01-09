import { Router, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { getUpload, getSheets } from "../services/spreadsheetAnalyzer";
import {
  startAnalysis,
  getAnalysisProgress,
  getAnalysisResults,
} from "../services/analysisOrchestrator";
import { analysisLogger } from "../lib/analysisLogger";
import { complexityAnalyzer } from "../services/complexityAnalyzer";
import { checkDynamicEscalation } from "../services/router";
import { pareOrchestrator, type RoutingDecision } from "../services/pare";
import { runAgent, type AgentState } from "../services/agentRunner";

const analyzeRequestSchema = z.object({
  messageId: z.string().optional(),
  scope: z.enum(["all", "selected", "active"]).default("all"),
  sheetsToAnalyze: z.array(z.string()).optional(),
  prompt: z.string().optional(),
});

function getFileExtension(filename: string): string {
  return (filename.split('.').pop() || '').toLowerCase();
}

function isSpreadsheetFile(filename: string): boolean {
  const ext = getFileExtension(filename);
  return ['xlsx', 'xls', 'csv', 'tsv'].includes(ext);
}

const complexityRequestSchema = z.object({
  message: z.string(),
  hasAttachments: z.boolean().optional().default(false),
});

const routerRequestSchema = z.object({
  message: z.string().min(1, "Message cannot be empty"),
  hasAttachments: z.boolean().optional().default(false),
  attachmentTypes: z.array(z.string()).optional().default([]),
});

const agentRunRequestSchema = z.object({
  message: z.string(),
  planHint: z.array(z.string()).optional().default([]),
});

export function createChatRoutes(): Router {
  const router = Router();

  router.post("/complexity", async (req: Request, res: Response) => {
    try {
      const validation = complexityRequestSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.message });
      }

      const { message, hasAttachments } = validation.data;
      const result = complexityAnalyzer.analyze(message, hasAttachments);

      res.json({
        agent_required: result.agent_required,
        agent_reason: result.agent_reason,
        complexity_score: result.score,
        category: result.category,
        signals: result.signals,
      });
    } catch (error: any) {
      console.error("[ChatRoutes] Complexity analysis error:", error);
      res.status(500).json({ error: error.message || "Failed to analyze complexity" });
    }
  });

  router.post("/route", async (req: Request, res: Response) => {
    try {
      const validation = routerRequestSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          error: "Invalid request body", 
          details: validation.error.message,
          code: "VALIDATION_ERROR"
        });
      }

      const { message, hasAttachments, attachmentTypes } = validation.data;
      
      const attachments = hasAttachments 
        ? attachmentTypes.length > 0
          ? attachmentTypes.map((type, idx) => ({ type, name: `attachment_${idx}` }))
          : [{ type: 'file', name: 'attached' }]
        : undefined;

      const decision = await pareOrchestrator.route(message, hasAttachments, {
        attachments,
        attachmentTypes,
      });

      console.log(`[PARE] Route decision: ${decision.route}, confidence: ${decision.confidence}, reasons: ${decision.reasons.join(', ')}`);

      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        component: "PARE",
        event: "route_decision",
        route: decision.route,
        confidence: decision.confidence,
        reasons: decision.reasons,
        toolNeeds: decision.toolNeeds,
      }));

      res.json({
        route: decision.route,
        confidence: decision.confidence,
        reasons: decision.reasons,
        toolNeeds: decision.toolNeeds,
        planHint: decision.planHint,
        tool_needs: decision.toolNeeds,
        plan_hint: decision.planHint,
      });
    } catch (error: any) {
      const errorMsg = error.message || "Failed to route message";
      console.error("[ChatRoutes] PARE Router error:", JSON.stringify({ error: errorMsg }));
      res.json({
        route: "chat",
        confidence: 0.5,
        reasons: ["Router fallback due to error: " + errorMsg],
        toolNeeds: [],
        planHint: [],
        tool_needs: [],
        plan_hint: [],
      });
    }
  });

  router.post("/agent-run", async (req: Request, res: Response) => {
    try {
      const validation = agentRunRequestSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          error: "Invalid request body", 
          details: validation.error.message,
          code: "VALIDATION_ERROR"
        });
      }

      const { message, planHint } = validation.data;
      
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        component: "ChatRoutes",
        event: "agent_run_started",
        objective: message.slice(0, 100),
      }));
      
      const result = await runAgent(message, planHint);

      res.json({
        success: result.success,
        run_id: result.run_id,
        result: result.result,
        state: {
          objective: result.state.objective,
          plan: result.state.plan,
          toolsUsed: result.state.toolsUsed,
          stepsCompleted: result.state.history.length,
          status: result.state.status,
        },
      });
    } catch (error: any) {
      const errorMsg = error.message || "Failed to run agent";
      console.error("[ChatRoutes] Agent run error:", JSON.stringify({ error: errorMsg, stack: error.stack?.slice(0, 500) }));
      res.status(500).json({ 
        error: errorMsg, 
        code: "AGENT_RUN_ERROR",
        suggestion: "Check server logs for details. If LLM is unavailable, heuristic fallback should apply."
      });
    }
  });

  router.post("/escalation-check", async (req: Request, res: Response) => {
    try {
      const { response } = req.body;
      if (!response || typeof response !== "string") {
        return res.status(400).json({ error: "Response string required" });
      }

      const result = checkDynamicEscalation(response);
      res.json(result);
    } catch (error: any) {
      console.error("[ChatRoutes] Escalation check error:", error);
      res.status(500).json({ error: error.message || "Failed to check escalation" });
    }
  });

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

      let targetSheets: string[];
      const isSpreadsheet = isSpreadsheetFile(upload.originalFilename || '');

      if (isSpreadsheet) {
        const sheets = await getSheets(uploadId);
        if (sheets.length === 0) {
          targetSheets = ["Sheet1"];
        } else if (scope === "selected" && sheetsToAnalyze && sheetsToAnalyze.length > 0) {
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
      } else {
        const baseName = (upload.originalFilename || 'Document').replace(/\.[^.]+$/, '');
        targetSheets = [baseName];
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

      interface SheetStatus {
        sheetName: string;
        status: "queued" | "running" | "done" | "failed";
        error?: string;
      }

      interface SheetResult {
        sheetName: string;
        generatedCode?: string;
        summary?: string;
        metrics?: Array<{ label: string; value: string }>;
        preview?: { headers: string[]; rows: any[][] };
        error?: string;
      }

      let progressData = { 
        currentSheet: 0, 
        totalSheets: 0,
        sheets: [] as SheetStatus[]
      };
      let resultsData: {
        crossSheetSummary?: string;
        sheets: SheetResult[];
      } = { sheets: [] };
      let overallStatus: "pending" | "analyzing" | "completed" | "failed" = chatAnalysis.status as any;
      let errorMessage: string | undefined;

      if (chatAnalysis.sessionId) {
        try {
          const analysisProgress = await getAnalysisProgress(chatAnalysis.sessionId);
          
          progressData = {
            currentSheet: analysisProgress.completedJobs,
            totalSheets: analysisProgress.totalJobs,
            sheets: analysisProgress.jobs.map(job => ({
              sheetName: job.sheetName,
              status: job.status,
              error: job.error,
            })),
          };

          if (analysisProgress.status === "completed" || analysisProgress.status === "failed") {
            const results = await getAnalysisResults(chatAnalysis.sessionId);
            if (results) {
              resultsData.crossSheetSummary = results.crossSheetSummary;
              
              resultsData.sheets = analysisProgress.jobs.map(job => {
                const sheetResults = results.perSheet[job.sheetName];
                if (!sheetResults) {
                  return {
                    sheetName: job.sheetName,
                    error: job.error || "No results available",
                  };
                }

                const metricsObj = sheetResults.outputs?.metrics || {};
                const metricsArray = Object.entries(metricsObj).map(([label, value]) => ({
                  label,
                  value: typeof value === 'object' ? JSON.stringify(value) : String(value),
                }));

                const PREVIEW_ROW_LIMIT = 100;
                const PREVIEW_COL_LIMIT = 50;
                
                let preview: { headers: string[]; rows: any[][]; meta?: { totalRows: number; totalCols: number; truncated: boolean } } | undefined;
                const tables = sheetResults.outputs?.tables || [];
                if (tables.length > 0 && Array.isArray(tables[0])) {
                  const tableData = tables[0] as any[];
                  if (tableData.length > 0) {
                    const firstRow = tableData[0];
                    if (typeof firstRow === 'object' && firstRow !== null) {
                      const allHeaders = Object.keys(firstRow);
                      const limitedHeaders = allHeaders.slice(0, PREVIEW_COL_LIMIT);
                      const totalRows = tableData.length;
                      const totalCols = allHeaders.length;
                      const truncated = totalRows > PREVIEW_ROW_LIMIT || totalCols > PREVIEW_COL_LIMIT;
                      
                      preview = {
                        headers: limitedHeaders,
                        rows: tableData.slice(0, PREVIEW_ROW_LIMIT).map(row => {
                          const values = Object.values(row) as any[];
                          return values.slice(0, PREVIEW_COL_LIMIT);
                        }),
                        meta: { totalRows, totalCols, truncated },
                      };
                      
                      analysisLogger.trackPreviewGeneration(
                        { uploadId, sessionId: chatAnalysis.sessionId || undefined },
                        Math.min(totalRows, PREVIEW_ROW_LIMIT),
                        Math.min(totalCols, PREVIEW_COL_LIMIT),
                        truncated
                      );
                    }
                  }
                }

                return {
                  sheetName: job.sheetName,
                  generatedCode: sheetResults.generatedCode,
                  summary: sheetResults.summary,
                  metrics: metricsArray.length > 0 ? metricsArray : undefined,
                  preview,
                };
              });
            }

            overallStatus = analysisProgress.status;
            
            if (chatAnalysis.status !== "completed" && chatAnalysis.status !== "failed") {
              await storage.updateChatMessageAnalysis(chatAnalysis.id, {
                status: analysisProgress.status,
                completedAt: new Date(),
                summary: resultsData.crossSheetSummary,
              });
            }
          } else {
            overallStatus = analysisProgress.status === "running" ? "analyzing" : "pending";
          }
        } catch (progressError: any) {
          console.error("[ChatRoutes] Error getting analysis progress:", progressError);
          errorMessage = progressError.message;
        }
      }

      res.json({
        analysisId: chatAnalysis.id,
        status: overallStatus,
        progress: progressData,
        results: resultsData.sheets.length > 0 ? resultsData : undefined,
        error: errorMessage,
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
