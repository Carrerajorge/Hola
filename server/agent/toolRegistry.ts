import { z } from "zod";
import { startAnalysis, type StartAnalysisParams } from "../services/analysisOrchestrator";
import { searchWeb, searchScholar } from "../services/webSearch";
import { generateImage } from "../services/imageGeneration";
import { browserWorker } from "./browser-worker";
import {
  generateWordDocument,
  generateExcelDocument,
  generatePptDocument,
  parseExcelFromText,
  parseSlidesFromText,
} from "../services/documentGeneration";
import fs from "fs/promises";
import path from "path";
import { libraryService } from "../services/libraryService";
import { executionEngine, type ExecutionOptions } from "./executionEngine";
import { policyEngine, type PolicyContext } from "./policyEngine";
import { ToolOutputSchema, ToolCapabilitySchema, type ToolCapability } from "./contracts";
import { randomUUID } from "crypto";
import { metricsCollector } from "./metricsCollector";
import { validateOrThrow } from "./validation";
import { defaultToolRegistry as sandboxToolRegistry } from "./sandbox/tools";

const AGENT_WORKSPACE_ROOT = process.env.AGENT_WORKSPACE_ROOT || "/tmp/agent-workspace";
const getRunWorkspaceDir = (runId: string) => path.resolve(AGENT_WORKSPACE_ROOT, runId);

export const ToolDefinitionSchema = z.object({
  name: z.string().min(1, "Tool name is required"),
  description: z.string().min(1, "Tool description is required"),
  inputSchema: z.custom<z.ZodSchema>((val) => val instanceof z.ZodType, {
    message: "inputSchema must be a valid Zod schema",
  }),
  capabilities: z.array(ToolCapabilitySchema).optional(),
  execute: z.custom<(input: any, context: ToolContext) => Promise<ToolResult>>(
    (val) => typeof val === "function",
    { message: "execute must be a function" }
  ),
});

export type ArtifactType = "file" | "image" | "document" | "chart" | "data" | "preview" | "link";

export interface ToolContext {
  userId: string;
  chatId: string;
  runId: string;
  /**
   * Optional source channel (e.g. "whatsapp_web"). Used to apply tighter tool policies.
   */
  channel?: string;
  correlationId?: string;
  stepIndex?: number;
  userPlan?: "free" | "pro" | "admin";
  isConfirmed?: boolean;
  signal?: AbortSignal;

  /**
   * Optional streaming hook for long-running tools (e.g. shell_command).
   * The callback MUST be best-effort (never throw); the tool will ignore failures.
   * Consumers should not assume chunk boundaries align with lines.
   */
  onStream?: (evt: { stream: "stdout" | "stderr"; chunk: string }) => void;

  /**
   * Optional hook invoked once when a tool-backed process exits.
   * Best-effort: errors are ignored by the tool.
   */
  onExit?: (evt: {
    exitCode: number;
    signal: string | null;
    wasKilled: boolean;
    durationMs: number;
  }) => void;
}

export interface ToolArtifact {
  id: string;
  type: ArtifactType;
  name: string;
  mimeType?: string;
  url?: string;
  data: any;
  size?: number;
  createdAt: Date;
}

export interface ToolPreview {
  type: "text" | "html" | "markdown" | "image" | "chart";
  content: any;
  title?: string;
}

export interface ToolLog {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  timestamp: Date;
  data?: any;
}

export interface ToolMetrics {
  durationMs: number;
  tokensUsed?: number;
  apiCalls?: number;
  bytesProcessed?: number;
  successRate?: number;
  errorRate?: number;
}

export interface ToolResult {
  success: boolean;
  output: any;
  artifacts?: ToolArtifact[];
  previews?: ToolPreview[];
  logs?: ToolLog[];
  metrics?: ToolMetrics;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    details?: any;
  };
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodSchema;
  capabilities?: ToolCapability[];
  execute: (input: any, context: ToolContext) => Promise<ToolResult>;
}

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  register(tool: ToolDefinition): void {
    const validatedTool = validateOrThrow(
      ToolDefinitionSchema,
      tool,
      `ToolRegistry.register(${tool?.name || "unknown"})`
    );
    
    if (this.tools.has(validatedTool.name)) {
      console.warn(`[ToolRegistry] Overwriting existing tool: ${validatedTool.name}`);
    }
    this.tools.set(validatedTool.name, validatedTool as ToolDefinition);
    console.log(`[ToolRegistry] Registered tool: ${validatedTool.name}`);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  listForPlan(plan: "free" | "pro" | "admin"): ToolDefinition[] {
    const allowedTools = policyEngine.getToolsForPlan(plan);
    return this.list().filter(t => allowedTools.includes(t.name));
  }

  async execute(name: string, input: any, context: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    const startTime = Date.now();
    const logs: ToolLog[] = [];
    
    const addLog = (level: ToolLog["level"], message: string, data?: any) => {
      logs.push({ level, message, timestamp: new Date(), data });
    };

    if (context.signal?.aborted) {
      addLog("info", "Tool execution aborted before start");
      return {
        success: false,
        output: null,
        artifacts: [],
        previews: [],
        logs,
        metrics: { durationMs: Date.now() - startTime },
        error: {
          code: "ABORTED",
          message: "Tool execution was cancelled",
          retryable: false,
        },
      };
    }

    // WhatsApp channel is a high-risk ingress: keep tool surface minimal by default.
    if (context.channel === "whatsapp_web") {
      const allowed = new Set(["search"]);
      if (!allowed.has(name)) {
        addLog("warn", `Tool blocked for WhatsApp channel: ${name}`);
        return {
          success: false,
          output: null,
          artifacts: [],
          previews: [],
          logs,
          metrics: { durationMs: Date.now() - startTime },
          error: {
            code: "ACCESS_DENIED",
            message: `Tool \"${name}\" is not available from WhatsApp channel`,
            retryable: false,
          },
        };
      }
    }
    
    if (!tool) {
      // Try sandbox tools as fallback with proper adaptation
      if (sandboxToolRegistry.has(name)) {
        addLog("info", `Using sandbox tool: ${name}`);
        
        // Check abort signal before sandbox execution
        if (context.signal?.aborted) {
          return {
            success: false,
            output: null,
            artifacts: [],
            previews: [],
            logs,
            metrics: { durationMs: Date.now() - startTime },
            error: {
              code: "ABORTED",
              message: "Tool execution was cancelled before sandbox tool",
              retryable: false,
            },
          };
        }
        
        try {
          const sandboxResult = await sandboxToolRegistry.execute(name, input);
          const artifacts: ToolArtifact[] = [];
          const previews: ToolPreview[] = [];
          
          // Convert sandbox file outputs to artifacts
          if (sandboxResult.filesCreated && sandboxResult.filesCreated.length > 0) {
            for (const filePath of sandboxResult.filesCreated) {
              const ext = filePath.split('.').pop()?.toLowerCase();
              let type: ArtifactType = "file";
              let mimeType = "application/octet-stream";
              
              if (ext === "pptx") { type = "document"; mimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation"; }
              else if (ext === "docx") { type = "document"; mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"; }
              else if (ext === "xlsx") { type = "document"; mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"; }
              else if (ext === "png" || ext === "jpg" || ext === "jpeg") { type = "image"; mimeType = `image/${ext}`; }
              
              artifacts.push({
                id: randomUUID(),
                type,
                name: filePath.split('/').pop() || filePath,
                mimeType,
                url: `/api/files/download?path=${encodeURIComponent(filePath)}`,
                data: { path: filePath },
                createdAt: new Date(),
              });
            }
          }
          
          // Properly format output based on sandbox tool type
          let output: any;
          if (sandboxResult.data) {
            // For structured data tools (search, browser, etc.), preserve the data structure
            output = sandboxResult.data;
            
            // Add preview for search results
            if (name === "search" && sandboxResult.data.results) {
              previews.push({
                type: "markdown",
                content: `### Search Results\n${sandboxResult.data.results.slice(0, 5).map((r: any) => 
                  `- **[${r.title}](${r.url})**\n  ${r.snippet || ''}`
                ).join('\n\n')}`,
                title: `Search: ${input.query || "results"}`,
              });
            }
            
            // Add preview for browser content
            if (name === "browser" && sandboxResult.data.content) {
              previews.push({
                type: "text",
                content: sandboxResult.data.content.substring(0, 1000) + (sandboxResult.data.content.length > 1000 ? "..." : ""),
                title: sandboxResult.data.title || input.url,
              });
            }
          } else {
            output = sandboxResult.message;
          }
          
          metricsCollector.record({
            toolName: name,
            latencyMs: sandboxResult.executionTimeMs || (Date.now() - startTime),
            success: sandboxResult.success,
            timestamp: new Date(),
          });
          
          return {
            success: sandboxResult.success,
            output,
            artifacts,
            previews,
            logs,
            metrics: { durationMs: sandboxResult.executionTimeMs || (Date.now() - startTime) },
            error: sandboxResult.error ? {
              code: "SANDBOX_ERROR",
              message: sandboxResult.error,
              retryable: true,
            } : undefined,
          };
        } catch (sandboxError: any) {
          addLog("error", `Sandbox tool error: ${sandboxError.message}`);
          
          metricsCollector.record({
            toolName: name,
            latencyMs: Date.now() - startTime,
            success: false,
            errorCode: "SANDBOX_ERROR",
            timestamp: new Date(),
          });
          
          return {
            success: false,
            output: null,
            artifacts: [],
            previews: [],
            logs,
            metrics: { durationMs: Date.now() - startTime },
            error: {
              code: "SANDBOX_ERROR",
              message: sandboxError.message,
              retryable: false,
            },
          };
        }
      }
      
      return {
        success: false,
        output: null,
        artifacts: [],
        previews: [],
        logs,
        metrics: { durationMs: Date.now() - startTime },
        error: {
          code: "TOOL_NOT_FOUND",
          message: `Tool "${name}" not found`,
          retryable: false,
        },
      };
    }

    const policyContext: PolicyContext = {
      userId: context.userId,
      userPlan: context.userPlan || "free",
      toolName: name,
      isConfirmed: context.isConfirmed,
    };

    const policyCheck = policyEngine.checkAccess(policyContext);
    
    if (!policyCheck.allowed) {
      addLog("warn", `Policy denied execution: ${policyCheck.reason}`);
      return {
        success: false,
        output: null,
        artifacts: [],
        previews: [],
        logs,
        metrics: { durationMs: Date.now() - startTime },
        error: {
          code: policyCheck.requiresConfirmation ? "REQUIRES_CONFIRMATION" : "ACCESS_DENIED",
          message: policyCheck.reason || "Access denied",
          retryable: false,
        },
      };
    }

    try {
      let validatedInput: unknown;
      try {
        validatedInput = validateOrThrow(
          tool.inputSchema,
          input,
          `ToolRegistry.execute(${name}).input`
        );
      } catch (validationError: any) {
        addLog("error", "Input validation failed", validationError.zodError?.errors || validationError.message);
        return {
          success: false,
          output: null,
          artifacts: [],
          previews: [],
          logs,
          metrics: { durationMs: Date.now() - startTime },
          error: {
            code: "INVALID_INPUT",
            message: `Invalid input: ${validationError.message}`,
            retryable: false,
            details: validationError.zodError?.errors,
          },
        };
      }

      addLog("info", `Executing tool: ${name}`);

      const executionResult = await executionEngine.execute(
        name,
        () => tool.execute(validatedInput, context),
        {
          maxRetries: policyCheck.policy.maxRetries,
          timeoutMs: policyCheck.policy.maxExecutionTimeMs,
        },
        {
          runId: context.runId,
          correlationId: context.correlationId || `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          stepIndex: context.stepIndex || 0,
          userId: context.userId,
          userPlan: context.userPlan || "free",
        }
      );

      if (executionResult.success && executionResult.data) {
        const result = executionResult.data;
        addLog("info", `Tool completed successfully in ${executionResult.metrics.totalDurationMs}ms`);
        
        metricsCollector.record({
          toolName: name,
          latencyMs: executionResult.metrics.totalDurationMs,
          success: true,
          timestamp: new Date(),
        });
        
        const validatedOutput = ToolOutputSchema.safeParse(result);
        if (!validatedOutput.success) {
          addLog("warn", `Tool output validation failed: ${validatedOutput.error.message}`);
        }
        
        return {
          success: result.success,
          output: result.output,
          artifacts: result.artifacts || [],
          previews: result.previews || [],
          logs: [...(result.logs || []), ...logs],
          metrics: {
            durationMs: executionResult.metrics.totalDurationMs,
            ...result.metrics,
          },
          error: result.error,
        };
      } else {
        addLog("error", `Tool failed: ${executionResult.error?.message}`, executionResult.error);
        
        metricsCollector.record({
          toolName: name,
          latencyMs: executionResult.metrics.totalDurationMs,
          success: false,
          errorCode: executionResult.error?.code || "EXECUTION_ERROR",
          timestamp: new Date(),
        });
        
        return {
          success: false,
          output: null,
          artifacts: [],
          previews: [],
          logs,
          metrics: {
            durationMs: executionResult.metrics.totalDurationMs,
          },
          error: {
            code: executionResult.error?.code || "EXECUTION_ERROR",
            message: executionResult.error?.message || "Unknown error",
            retryable: executionResult.error?.retryable || false,
          },
        };
      }
    } catch (error: any) {
      addLog("error", `Unexpected error: ${error.message}`, { stack: error.stack });
      
      metricsCollector.record({
        toolName: name,
        latencyMs: Date.now() - startTime,
        success: false,
        errorCode: "UNEXPECTED_ERROR",
        timestamp: new Date(),
      });
      
      return {
        success: false,
        output: null,
        artifacts: [],
        previews: [],
        logs,
        metrics: { durationMs: Date.now() - startTime },
        error: {
          code: "UNEXPECTED_ERROR",
          message: error.message || "Unknown error",
          retryable: false,
        },
      };
    }
  }

  createArtifact(type: ArtifactType, name: string, data: any, mimeType?: string): ToolArtifact {
    return createArtifact(type, name, data, mimeType);
  }
}

export function createArtifact(type: ArtifactType, name: string, data: any, mimeType?: string, url?: string): ToolArtifact {
  return {
    id: randomUUID(),
    type,
    name,
    mimeType,
    url,
    data,
    size: (typeof data === "string" && data.length > 0) ? data.length : (Buffer.isBuffer(data) && data.length > 0) ? data.length : undefined,
    createdAt: new Date(),
  };
}

export function createError(code: string, message: string, retryable: boolean = false, details?: any): ToolResult["error"] {
  return { code, message, retryable, details };
}

const analyzeSpreadsheetSchema = z.object({
  uploadId: z.string().describe("The ID of the uploaded spreadsheet file"),
  scope: z.enum(["active", "selected", "all"]).default("all").describe("Which sheets to analyze"),
  sheetNames: z.array(z.string()).default([]).describe("Specific sheet names to analyze (for 'selected' scope)"),
  analysisMode: z.enum(["full", "summary", "extract_tasks", "text_only", "custom"]).default("full"),
  userPrompt: z.string().optional().describe("Custom analysis instructions"),
});

const analyzeSpreadsheetTool: ToolDefinition = {
  name: "analyze_spreadsheet",
  description: "Analyze Excel or CSV spreadsheet files. Performs data analysis, generates insights, charts, and summaries from spreadsheet data.",
  inputSchema: analyzeSpreadsheetSchema,
  capabilities: ["reads_files", "produces_artifacts"],
  execute: async (input, context): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const params: StartAnalysisParams = {
        uploadId: input.uploadId,
        userId: context.userId,
        scope: input.scope,
        sheetNames: input.sheetNames,
        analysisMode: input.analysisMode,
        userPrompt: input.userPrompt,
      };

      const result = await startAnalysis(params);
      
      return {
        success: true,
        output: {
          sessionId: result.sessionId,
          message: "Analysis started successfully",
        },
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("ANALYSIS_ERROR", error.message, true),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

const webSearchSchema = z.object({
  query: z.string().describe("The search query"),
  maxResults: z.number().min(1).max(20).default(5).describe("Maximum number of results to return"),
  academic: z.boolean().default(false).describe("Whether to search academic/scholarly sources"),
});

const webSearchTool: ToolDefinition = {
  name: "web_search",
  description: "Search the web for information. Can search general web or academic/scholarly sources like Google Scholar.",
  inputSchema: webSearchSchema,
  capabilities: ["requires_network", "accesses_external_api"],
  execute: async (input, context): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      if (context.signal?.aborted) {
        return {
          success: false,
          output: null,
          error: createError("ABORTED", "Web search was cancelled", false),
          artifacts: [],
          previews: [],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      if (input.academic) {
        const results = await searchScholar(input.query, input.maxResults);
        if (context.signal?.aborted) {
          return {
            success: false,
            output: null,
            error: createError("ABORTED", "Web search was cancelled", false),
            artifacts: [],
            previews: [],
            logs: [],
            metrics: { durationMs: Date.now() - startTime },
          };
        }
        return {
          success: true,
          output: {
            query: input.query,
            type: "academic",
            results,
          },
          artifacts: [],
          previews: [],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      const response = await searchWeb(input.query, input.maxResults);
      if (context.signal?.aborted) {
        return {
          success: false,
          output: null,
          error: createError("ABORTED", "Web search was cancelled", false),
          artifacts: [],
          previews: [],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }
      return {
        success: true,
        output: {
          query: response.query,
          type: "web",
          results: response.results,
          contents: response.contents,
        },
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    } catch (error: any) {
      if (context.signal?.aborted) {
        return {
          success: false,
          output: null,
          error: createError("ABORTED", "Web search was cancelled", false),
          artifacts: [],
          previews: [],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }
      return {
        success: false,
        output: null,
        error: createError("SEARCH_ERROR", error.message, true),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

const generateImageSchema = z.object({
  prompt: z.string().describe("Description of the image to generate"),
});

const generateImageTool: ToolDefinition = {
  name: "generate_image",
  description: "Generate an image using Gemini AI based on a text description. Returns a base64-encoded image.",
  inputSchema: generateImageSchema,
  capabilities: ["requires_network", "accesses_external_api", "produces_artifacts"],
  execute: async (input, context): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const result = await generateImage(input.prompt);
      
      return {
        success: true,
        output: {
          prompt: result.prompt,
          mimeType: result.mimeType,
        },
        artifacts: [
          createArtifact(
            "image",
            "generated_image",
            { base64: result.imageBase64, mimeType: result.mimeType },
            result.mimeType
          ),
        ],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("IMAGE_GENERATION_ERROR", error.message, true),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

const browseUrlSchema = z.object({
  url: z.string().url().describe("The URL to navigate to"),
  takeScreenshot: z.boolean().default(true).describe("Whether to capture a screenshot"),
  sessionId: z.string().optional().describe("Existing browser session ID (creates new if not provided)"),
});

const browseUrlTool: ToolDefinition = {
  name: "browse_url",
  description: "Navigate to a URL using a headless browser. Returns page content, title, and optionally a screenshot.",
  inputSchema: browseUrlSchema,
  capabilities: ["requires_network", "accesses_external_api", "long_running"],
  execute: async (input, context): Promise<ToolResult> => {
    const startTime = Date.now();
    let sessionId = input.sessionId;
    let createdSession = false;

    try {
      if (context.signal?.aborted) {
        return {
          success: false,
          output: null,
          error: createError("ABORTED", "URL browsing was cancelled", false),
          artifacts: [],
          previews: [],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      if (!sessionId) {
        sessionId = await browserWorker.createSession();
        createdSession = true;
      }

      if (context.signal?.aborted) {
        if (createdSession && sessionId) {
          await browserWorker.destroySession(sessionId).catch(() => {});
        }
        return {
          success: false,
          output: null,
          error: createError("ABORTED", "URL browsing was cancelled", false),
          artifacts: [],
          previews: [],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      const result = await browserWorker.navigate(sessionId, input.url, input.takeScreenshot);

      if (context.signal?.aborted) {
        if (createdSession && sessionId) {
          await browserWorker.destroySession(sessionId).catch(() => {});
        }
        return {
          success: false,
          output: null,
          error: createError("ABORTED", "URL browsing was cancelled", false),
          artifacts: [],
          previews: [],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      const artifacts: ToolArtifact[] = [];
      if (result.screenshot) {
        artifacts.push(
          createArtifact(
            "image",
            "page_screenshot",
            { base64: result.screenshot.toString("base64"), mimeType: "image/png" },
            "image/png"
          )
        );
      }

      if (createdSession) {
        await browserWorker.destroySession(sessionId);
      }

      return {
        success: result.success,
        output: {
          url: result.url,
          title: result.title,
          html: result.html?.slice(0, 50000),
          timing: result.timing,
          sessionId: createdSession ? undefined : sessionId,
        },
        artifacts,
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
        error: result.error ? createError("BROWSE_ERROR", result.error, true) : undefined,
      };
    } catch (error: any) {
      if (createdSession && sessionId) {
        await browserWorker.destroySession(sessionId).catch(() => {});
      }
      if (context.signal?.aborted) {
        return {
          success: false,
          output: null,
          error: createError("ABORTED", "URL browsing was cancelled", false),
          artifacts: [],
          previews: [],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }
      return {
        success: false,
        output: null,
        error: createError("BROWSE_ERROR", error.message, true),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

const generateDocumentSchema = z.object({
  type: z.enum(["word", "excel", "ppt", "csv"]).describe("Type of document to generate"),
  title: z.string().describe("Document title"),
  content: z.string().describe("Document content (text for Word, data for Excel/CSV, slide structure for PPT)"),
});

const generateDocumentTool: ToolDefinition = {
  name: "generate_document",
  description: "Generate Office documents (Word, Excel, PowerPoint, CSV). For Word: provide markdown/text content. For Excel/CSV: provide tabular data (rows separated by newlines, columns by tabs or commas). For PowerPoint: provide slide content.",
  inputSchema: generateDocumentSchema,
  capabilities: ["produces_artifacts", "writes_files"],
  execute: async (input, context): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      let buffer: Buffer;
      let mimeType: string;
      let extension: string;

      switch (input.type) {
        case "word":
          buffer = await generateWordDocument(input.title, input.content);
          mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
          extension = "docx";
          break;

        case "excel": {
          const excelData = parseExcelFromText(input.content);
          buffer = await generateExcelDocument(input.title, excelData);
          mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
          extension = "xlsx";
          break;
        }

        case "ppt": {
          const slides = parseSlidesFromText(input.content);
          buffer = await generatePptDocument(input.title, slides);
          mimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
          extension = "pptx";
          break;
        }

        case "csv": {
          // Parse content as tabular data and convert to CSV format
          const csvData = parseExcelFromText(input.content);
          const csvContent = csvData
            .map((row) =>
              row
                .map((cell) => {
                  const cellStr = String(cell ?? "");
                  // Escape cells that contain commas, quotes, or newlines
                  if (cellStr.includes(",") || cellStr.includes('"') || cellStr.includes("\n")) {
                    return `"${cellStr.replace(/"/g, '""')}"`;
                  }
                  return cellStr;
                })
                .join(",")
            )
            .join("\n");
          buffer = Buffer.from(csvContent, "utf-8");
          mimeType = "text/csv";
          extension = "csv";
          break;
        }

        default:
          throw new Error(`Unsupported document type: ${input.type}`);
      }

      const filename = `${input.title.replace(/[^a-zA-Z0-9-_]/g, "_")}.${extension}`;

      // A) Make it downloadable via /api/artifacts/<filename>
      const artifactsDir = path.join(process.cwd(), "artifacts");
      await fs.mkdir(artifactsDir, { recursive: true });
      const artifactPath = path.join(artifactsDir, filename);
      await fs.writeFile(artifactPath, buffer);
      const downloadUrl = `/api/artifacts/${filename}`;

      // C) Save into Library (object storage + metadata)
      // If library upload fails, we still return the downloadable artifact.
      let library: any = null;
      try {
        const upload = await libraryService.generateUploadUrl(
          context.userId,
          filename,
          mimeType
        );

        await fetch(upload.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": mimeType },
          body: buffer,
        });

        const ext = extension;
        const fileType = input.type === "word" ? "document" : input.type === "excel" ? "spreadsheet" : input.type === "ppt" ? "presentation" : "other";

        const saved = await libraryService.saveFileMetadata(context.userId, upload.objectPath, {
          name: filename,
          originalName: filename,
          description: `Generated by agent run ${context.runId}`,
          type: fileType,
          mimeType,
          extension: ext,
          size: buffer.length,
          metadata: {
            runId: context.runId,
            chatId: context.chatId,
            tool: "generate_document",
            title: input.title,
          },
        });

        library = {
          fileUuid: saved.uuid,
          storageUrl: saved.storageUrl,
          name: saved.name,
        };
      } catch (e) {
        console.warn("[generate_document] Failed to save to library:", (e as any)?.message || e);
      }

      return {
        success: true,
        output: {
          type: input.type,
          title: input.title,
          filename,
          size: buffer.length,
          downloadUrl,
          library,
        },
        artifacts: [
          createArtifact(
            "document",
            filename,
            {
              base64: buffer.toString("base64"),
              mimeType,
              filename,
              downloadUrl,
              library,
            },
            mimeType,
            downloadUrl
          ),
        ],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("DOCUMENT_GENERATION_ERROR", error.message, false),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

const readFileSchema = z.object({
  filepath: z.string().describe("Path to file in workspace"),
});

const readFileTool: ToolDefinition = {
  name: "read_file",
  description: "Read contents of a file from the agent's workspace.",
  inputSchema: readFileSchema,
  capabilities: ["reads_files"],
  execute: async (input, context): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const safePath = path.resolve(getRunWorkspaceDir(context.runId), input.filepath);
      if (!safePath.startsWith(getRunWorkspaceDir(context.runId))) {
        throw new Error('Access denied: path outside workspace');
      }
      const content = await fs.readFile(safePath, 'utf-8');
      return {
        success: true,
        output: { filepath: input.filepath, content, size: content.length },
        artifacts: [],
        previews: [{ type: "text", content: content.slice(0, 1000), title: input.filepath }],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("FILE_READ_ERROR", error.message, false),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

const writeFileSchema = z.object({
  filepath: z.string().describe("Path to file in workspace"),
  content: z.string().describe("File content to write"),
});

const writeFileTool: ToolDefinition = {
  name: "write_file",
  description: "Write or create a file in the agent's workspace.",
  inputSchema: writeFileSchema,
  capabilities: ["writes_files"],
  execute: async (input, context): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const workspaceDir = getRunWorkspaceDir(context.runId);
      await fs.mkdir(workspaceDir, { recursive: true });
      const safePath = path.resolve(workspaceDir, input.filepath);
      if (!safePath.startsWith(workspaceDir)) {
        throw new Error('Access denied: path outside workspace');
      }
      await fs.mkdir(path.dirname(safePath), { recursive: true });
      await fs.writeFile(safePath, input.content, 'utf-8');
      return {
        success: true,
        output: { filepath: input.filepath, size: input.content.length, created: true },
        artifacts: [createArtifact("file", input.filepath, { path: safePath, size: input.content.length })],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("FILE_WRITE_ERROR", error.message, false),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

const shellCommandSchema = z.object({
  command: z.string().describe("Shell command to execute"),
  timeout: z.number().min(1000).max(60000).default(30000).describe("Timeout in milliseconds"),
});

const shellCommandTool: ToolDefinition = {
  name: "shell_command",
  description: "Execute a shell command in the agent's sandbox. Streams stdout/stderr and enforces safety checks.",
  inputSchema: shellCommandSchema,
  capabilities: ["executes_code", "long_running", "high_risk"],
  execute: async (input, context): Promise<ToolResult> => {
    const startTime = Date.now();

    // Ensure workspace exists
    const fs = await import("fs/promises");
    const path = await import("path");
    const workspaceDir = getRunWorkspaceDir(context.runId);
    await fs.mkdir(workspaceDir, { recursive: true });

    const cmd = String(input.command ?? "").trim();
    if (!cmd) {
      return {
        success: false,
        output: null,
        error: createError("INVALID_INPUT", "Command is required", false),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }

    // Dangerous command patterns: require explicit confirmation (not a blanket block).
    // This matches the requirements doc: dangerous operations require explicit user confirmation.
    const dangerousPatterns: Array<{ pattern: RegExp; reason: string }> = [
      // Match any rm invocation that includes both -r and -f flags (combined or separate: -rf, -fr, -r -f, etc.).
      { pattern: /\brm\b[\s\S]*-\S*r\S*f/i, reason: "rm -rf" },
      { pattern: /\bmkfs(\.|\s)/i, reason: "mkfs" },
      { pattern: /\bdd\b\s+if=/i, reason: "dd if=" },
      { pattern: />\s*\/dev\//i, reason: "> /dev/*" },
      { pattern: /\bsudo\b/i, reason: "sudo" },
      { pattern: /\bchmod\b\s+777\b/i, reason: "chmod 777" },
      { pattern: /\b(curl|wget)\b.*\|\s*sh\b/i, reason: "curl|sh / wget|sh" },
      { pattern: /\b(shutdown|reboot)\b/i, reason: "shutdown/reboot" },
    ];

    const matchedDanger = dangerousPatterns.find((d) => d.pattern.test(cmd));
    if (matchedDanger && context.isConfirmed !== true) {
      return {
        success: false,
        output: { command: cmd },
        error: createError(
          "REQUIRES_CONFIRMATION",
          `Command requires confirmation (${matchedDanger.reason}). Confirm to proceed.`,
          false,
          { reason: matchedDanger.reason }
        ),
        artifacts: [],
        previews: [
          {
            type: "text",
            title: "Confirmation required",
            content: `This command is considered high-risk and requires explicit confirmation before execution:\n\n${cmd}`,
          },
        ],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }

    const { spawn } = await import("child_process");

    const timeoutMs = Math.min(Math.max(Number(input.timeout ?? 30000), 1000), 60000);

    // Sandbox mode (v1): host (default) or docker.
    // NOTE: docker mode requires that the runtime has access to the Docker daemon
    // (typically via /var/run/docker.sock) and that the `docker` CLI is available.
    const sandboxMode = (process.env.SHELL_COMMAND_SANDBOX_MODE || "host").toLowerCase();
    const dockerImage = process.env.SHELL_COMMAND_DOCKER_IMAGE || "debian:bookworm-slim";

    const runnerUrl = process.env.SHELL_COMMAND_RUNNER_URL || "http://sandbox-runner:8080";
    const runnerToken = process.env.SHELL_COMMAND_RUNNER_TOKEN || process.env.SANDBOX_RUNNER_TOKEN || "";

    const runWithRunner = async (): Promise<ToolResult> => {
      if (!runnerToken) {
        return {
          success: false,
          output: { command: cmd, stdout: "", stderr: "", exitCode: 1 },
          error: createError("COMMAND_ERROR", "Runner token not configured (SHELL_COMMAND_RUNNER_TOKEN)", false),
          artifacts: [],
          previews: [{ type: "text", content: "Runner token not configured", title: "Error" }],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      // Start remote job
      const ac = new AbortController();
      const abortHandler = () => ac.abort();
      context.signal?.addEventListener?.("abort", abortHandler, { once: true });

      let stdout = "";
      let stderr = "";
      const maxCapture = 1024 * 1024;

      try {
        const startRes = await fetch(`${runnerUrl.replace(/\/$/, "")}/v1/shell/run`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${runnerToken}`,
          },
          body: JSON.stringify({ runId: context.runId, command: cmd, timeoutMs }),
          signal: ac.signal,
        });

        if (!startRes.ok) {
          const text = await startRes.text().catch(() => "");
          return {
            success: false,
            output: { command: cmd, stdout: "", stderr: text, exitCode: 1 },
            error: createError("COMMAND_ERROR", `Runner start failed: ${startRes.status}`, true, { body: text }),
            artifacts: [],
            previews: [{ type: "text", content: text, title: "Runner Error" }],
            logs: [],
            metrics: { durationMs: Date.now() - startTime },
          };
        }

        const { jobId, streamUrl } = (await startRes.json()) as any;
        const streamRes = await fetch(`${runnerUrl.replace(/\/$/, "")}${streamUrl || `/v1/shell/stream/${jobId}`}`, {
          headers: { Authorization: `Bearer ${runnerToken}` },
          signal: ac.signal,
        });

        if (!streamRes.ok || !streamRes.body) {
          const text = await streamRes.text().catch(() => "");
          return {
            success: false,
            output: { command: cmd, stdout: "", stderr: text, exitCode: 1 },
            error: createError("COMMAND_ERROR", `Runner stream failed: ${streamRes.status}`, true, { body: text }),
            artifacts: [],
            previews: [{ type: "text", content: text, title: "Runner Stream Error" }],
            logs: [],
            metrics: { durationMs: Date.now() - startTime },
          };
        }

        const reader = streamRes.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        let exitEvt: any = null;
        let doneReceived = false;

        const safeEmit = (stream: "stdout" | "stderr", chunk: string) => {
          if (!chunk) return;
          try {
            context.onStream?.({ stream, chunk });
          } catch {
            // ignore
          }
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          // parse SSE by events separated by blank line
          while (true) {
            const idx = buf.indexOf("\n\n");
            if (idx === -1) break;
            const raw = buf.slice(0, idx);
            buf = buf.slice(idx + 2);

            const lines = raw.split("\n");
            let eventName = "message";
            let data = "";
            for (const line of lines) {
              if (line.startsWith("event:")) eventName = line.slice("event:".length).trim();
              if (line.startsWith("data:")) data += line.slice("data:".length).trim();
            }

            if (eventName === "shell") {
              try {
                const evt = JSON.parse(data);
                if (evt?.type === "stdout") {
                  safeEmit("stdout", String(evt.chunk || ""));
                  if (stdout.length < maxCapture) stdout += String(evt.chunk || "").slice(0, maxCapture - stdout.length);
                } else if (evt?.type === "stderr") {
                  safeEmit("stderr", String(evt.chunk || ""));
                  if (stderr.length < maxCapture) stderr += String(evt.chunk || "").slice(0, maxCapture - stderr.length);
                } else if (evt?.type === "exit") {
                  exitEvt = evt;
                }
              } catch {
                // ignore malformed events
              }
            }

            // Some SSE servers keep the connection open. If we receive a terminal marker,
            // stop reading to avoid hanging indefinitely.
            if (eventName === "done") {
              doneReceived = true;
              try {
                void reader.cancel();
              } catch {
                // ignore
              }
              buf = "";
              break;
            }
          }

          // If we got a terminal marker, stop reading.
          if (doneReceived) {
            break;
          }

          // If we got an exit event, we can also stop early.
          if (exitEvt) {
            try {
              void reader.cancel();
            } catch {
              // ignore
            }
            break;
          }
        }

        const exitCode = Number(exitEvt?.exitCode ?? 1);
        const signal = exitEvt?.signal ? String(exitEvt.signal) : null;
        const wasKilled = Boolean(exitEvt?.wasKilled);
        const durationMs = Number(exitEvt?.durationMs ?? Date.now() - startTime);

        try {
          context.onExit?.({ exitCode, signal, wasKilled, durationMs });
        } catch {
          // ignore
        }

        const ok = exitCode === 0 && !wasKilled;
        return {
          success: ok,
          output: { command: cmd, stdout, stderr, exitCode },
          artifacts: [],
          previews: [{ type: "text", content: (stdout || stderr).slice(0, 100000), title: ok ? "Command Output" : "Error Output" }],
          logs: [],
          error: ok ? undefined : createError(wasKilled ? "COMMAND_TIMEOUT" : "COMMAND_ERROR", stderr || `Exit code ${exitCode}`, true),
          metrics: { durationMs: Date.now() - startTime },
        };
      } catch (err: any) {
        if (context.signal?.aborted || ac.signal.aborted) {
          return {
            success: false,
            output: { command: cmd, stdout: "", stderr: "", exitCode: 1 },
            error: createError("ABORTED", "Command cancelled", false),
            artifacts: [],
            previews: [],
            logs: [],
            metrics: { durationMs: Date.now() - startTime },
          };
        }
        return {
          success: false,
          output: { command: cmd, stdout: "", stderr: err?.message || String(err), exitCode: 1 },
          error: createError("COMMAND_ERROR", `Runner unavailable: ${err?.message || String(err)}`, true),
          artifacts: [],
          previews: [{ type: "text", content: err?.message || String(err), title: "Runner Error" }],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      } finally {
        context.signal?.removeEventListener?.("abort", abortHandler as any);
      }
    };

	    if (sandboxMode === "runner") {
	      return await runWithRunner();
	    }

	    const runWithHost = () => {
	      // Prefer /bin/bash for portability (macOS doesn't have /usr/bin/bash).
	      return spawn("/bin/bash", ["-lc", cmd], {
	        cwd: workspaceDir,
	        env: { ...process.env, HOME: workspaceDir },
	        shell: false,
	        windowsHide: true,
	      });
	    };

    const runWithDocker = () => {
      // Hardening defaults (v1): no network, drop caps, no new privileges.
      // We mount the per-run workspace as /workspace.
      const uid = typeof (process as any).getuid === "function" ? (process as any).getuid() : undefined;
      const gid = typeof (process as any).getgid === "function" ? (process as any).getgid() : undefined;

      const dockerArgs: string[] = [
        "run",
        "--rm",
        "-i",
        "--network",
        "none",
        "--security-opt",
        "no-new-privileges",
        "--cap-drop",
        "ALL",
        "--pids-limit",
        "256",
        "--cpus",
        process.env.SHELL_COMMAND_DOCKER_CPUS || "1",
        "--memory",
        process.env.SHELL_COMMAND_DOCKER_MEMORY || "512m",
        "-v",
        `${workspaceDir}:/workspace`,
        "-w",
        "/workspace",
      ];

      if (uid !== undefined && gid !== undefined) {
        dockerArgs.push("--user", `${uid}:${gid}`);
      }

      dockerArgs.push(dockerImage, "/bin/bash", "-lc", cmd);

      return spawn("docker", dockerArgs, {
        cwd: workspaceDir,
        env: { ...process.env, HOME: workspaceDir },
        shell: false,
        windowsHide: true,
      });
    };

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let killed = false;

      let child = null as any;
      try {
        child = sandboxMode === "docker" ? runWithDocker() : runWithHost();
      } catch (err: any) {
        return resolve({
          success: false,
          output: { command: cmd, stdout: "", stderr: "", exitCode: 1 },
          error: createError(
            "COMMAND_ERROR",
            sandboxMode === "docker"
              ? `Docker sandbox unavailable: ${err?.message || String(err)}`
              : `Command spawn failed: ${err?.message || String(err)}`,
            true
          ),
          artifacts: [],
          previews: [{ type: "text", content: err?.message || String(err), title: "Error Output" }],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        });
      }

      const maxCapture = 1024 * 1024; // 1MB each stream

      const safeEmit = (stream: "stdout" | "stderr", chunk: string) => {
        if (!chunk) return;
        try {
          context.onStream?.({ stream, chunk });
        } catch {
          // ignore
        }
      };

      const onData = (stream: "stdout" | "stderr") => (data: any) => {
        const chunk = data?.toString?.() ?? String(data);
        safeEmit(stream, chunk);

        if (stream === "stdout") {
          if (stdout.length < maxCapture) stdout += chunk.slice(0, maxCapture - stdout.length);
        } else {
          if (stderr.length < maxCapture) stderr += chunk.slice(0, maxCapture - stderr.length);
        }
      };

      child.stdout?.on("data", onData("stdout"));
      child.stderr?.on("data", onData("stderr"));

      const timeoutHandle = setTimeout(() => {
        killed = true;
        child.kill("SIGKILL");
      }, timeoutMs);

      const abortHandler = () => {
        killed = true;
        child.kill("SIGKILL");
      };

      if (context.signal) {
        if (context.signal.aborted) abortHandler();
        context.signal.addEventListener("abort", abortHandler, { once: true });
      }

      child.on("close", (code, signal) => {
        clearTimeout(timeoutHandle);
        context.signal?.removeEventListener?.("abort", abortHandler as any);

        const exitCode = typeof code === "number" ? code : signal ? 1 : 0;

        try {
          context.onExit?.({
            exitCode,
            signal: signal ? String(signal) : null,
            wasKilled: killed,
            durationMs: Date.now() - startTime,
          });
        } catch {
          // ignore
        }

        if (killed) {
          return resolve({
            success: false,
            output: { command: cmd, stdout, stderr, exitCode },
            error: createError("COMMAND_TIMEOUT", `Command exceeded timeout of ${timeoutMs}ms`, false),
            artifacts: [],
            previews: [{ type: "text", content: (stdout || stderr).slice(0, 100000), title: "Command Output (partial)" }],
            logs: [],
            metrics: { durationMs: Date.now() - startTime },
          });
        }

        const ok = exitCode === 0;
        const previewText = (stdout || stderr).slice(0, 100000);

        return resolve({
          success: ok,
          output: { command: cmd, stdout, stderr, exitCode },
          artifacts: [],
          previews: [{ type: "text", content: previewText, title: ok ? "Command Output" : "Error Output" }],
          logs: [],
          error: ok ? undefined : createError("COMMAND_ERROR", stderr || `Exit code ${exitCode}`, true),
          metrics: { durationMs: Date.now() - startTime },
        });
      });

      child.on("error", (err) => {
        clearTimeout(timeoutHandle);
        context.signal?.removeEventListener?.("abort", abortHandler as any);

        return resolve({
          success: false,
          output: { command: cmd, stdout, stderr, exitCode: 1 },
          error: createError("COMMAND_ERROR", err.message, true),
          artifacts: [],
          previews: [{ type: "text", content: err.message, title: "Error Output" }],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        });
      });
    });
  },
};

const listFilesSchema = z.object({
  directory: z.string().default(".").describe("Directory path in workspace"),
});

const listFilesTool: ToolDefinition = {
  name: "list_files",
  description: "List files and directories in the agent's workspace.",
  inputSchema: listFilesSchema,
  capabilities: ["reads_files"],
  execute: async (input, context): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const workspaceDir = getRunWorkspaceDir(context.runId);
      await fs.mkdir(workspaceDir, { recursive: true });
      const targetDir = path.resolve(workspaceDir, input.directory);
      if (!targetDir.startsWith(workspaceDir)) {
        throw new Error('Access denied: path outside workspace');
      }
      const entries = await fs.readdir(targetDir, { withFileTypes: true });
      const files = entries.map(e => ({ name: e.name, type: e.isDirectory() ? 'directory' : 'file' }));
      return {
        success: true,
        output: { directory: input.directory, files, count: files.length },
        artifacts: [],
        previews: [{ type: "text", content: files.map(f => `${f.type === 'directory' ? '[D]' : '[F]'} ${f.name}`).join('\n'), title: "Files" }],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("LIST_FILES_ERROR", error.message, false),
        artifacts: [],
        previews: [],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

export const toolRegistry = new ToolRegistry();

toolRegistry.register(analyzeSpreadsheetTool);
toolRegistry.register(webSearchTool);
toolRegistry.register(generateImageTool);
toolRegistry.register(browseUrlTool);
toolRegistry.register(generateDocumentTool);
toolRegistry.register(readFileTool);
toolRegistry.register(writeFileTool);
toolRegistry.register(shellCommandTool);
toolRegistry.register(listFilesTool);

// Register extended tools
import { extendedTools } from "./extendedTools";
for (const tool of extendedTools) {
  toolRegistry.register(tool);
}

export {
  analyzeSpreadsheetSchema,
  webSearchSchema,
  generateImageSchema,
  browseUrlSchema,
  generateDocumentSchema,
};
