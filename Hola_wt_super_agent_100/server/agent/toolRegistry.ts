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
import { getUserPrivacySettings } from "../services/privacyService";

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
  channel?: string;
  correlationId?: string;
  stepIndex?: number;
  userPlan?: "free" | "pro" | "admin";
  isConfirmed?: boolean;
  onStream?: (evt: { stream: "stdout" | "stderr"; chunk: string }) => void;
  onExit?: (evt: { exitCode: number | null; signal: string | null; wasKilled: boolean; durationMs: number }) => void;
  signal?: AbortSignal;
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

      const privacy = await getUserPrivacySettings(context.userId);
      if (!privacy.remoteBrowserDataAccess) {
        // Privacy-preserving fallback: do a stateless HTTP fetch without cookies/session,
        // and never capture screenshots.
        const fetchStart = Date.now();

        const extractTitle = (html: string): string => {
          const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
          return (match?.[1] || "").replace(/\s+/g, " ").trim().slice(0, 200);
        };

        const response = await fetch(input.url, {
          signal: context.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
        });

        if (!response.ok) {
          return {
            success: false,
            output: null,
            error: createError(
              "BROWSE_ERROR",
              `Remote browser data access is disabled. HTTP fetch failed: ${response.status} ${response.statusText}`,
              response.status >= 500
            ),
            artifacts: [],
            previews: [],
            logs: [
              {
                level: "warn",
                message: "Remote browser disabled by privacy settings; browse_url used HTTP fetch fallback.",
                timestamp: new Date(),
                data: { url: input.url, status: response.status },
              },
            ],
            metrics: { durationMs: Date.now() - startTime },
          };
        }

        const htmlText = await response.text();
        const html = htmlText.slice(0, 50000);

        return {
          success: true,
          output: {
            url: response.url || input.url,
            title: extractTitle(html),
            html,
            timing: {
              navigationMs: Date.now() - fetchStart,
              renderMs: 0,
            },
            sessionId: undefined,
            privacyFallback: true,
          },
          artifacts: [],
          previews: [],
          logs: [
            {
              level: "info",
              message: "Remote browser disabled by privacy settings; browse_url used HTTP fetch fallback (no cookies/session, no screenshots).",
              timestamp: new Date(),
              data: { url: input.url },
            },
          ],
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
      const safePath = path.resolve('/tmp/agent-workspace', context.runId, input.filepath);
      if (!safePath.startsWith(path.resolve('/tmp/agent-workspace', context.runId))) {
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
      const workspaceDir = path.resolve('/tmp/agent-workspace', context.runId);
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

type ShellStreamEvent = { stream: "stdout" | "stderr"; chunk: string };
type ShellExitEvent = { exitCode: number | null; signal: string | null; wasKilled: boolean; durationMs: number };

function assessShellCommandRisk(commandRaw: string): { hardBlocked: boolean; needsConfirmation: boolean; reason?: string } {
  const command = commandRaw.trim();
  const normalized = command.toLowerCase();

  const hardBlocked: Array<{ pattern: RegExp; reason: string }> = [
    { pattern: /\bsudo\b/i, reason: "sudo is not allowed" },
    { pattern: /\bmkfs\b/i, reason: "mkfs is not allowed" },
    { pattern: /\bdd\s+if=/i, reason: "dd is not allowed" },
    { pattern: />\s*\/dev\b/i, reason: "writing to /dev is not allowed" },
    { pattern: /\bcurl\b[^|]*\|\s*(?:sh|bash)\b/i, reason: "piping curl into a shell is not allowed" },
    { pattern: /\bwget\b[^|]*\|\s*(?:sh|bash)\b/i, reason: "piping wget into a shell is not allowed" },
  ];

  for (const rule of hardBlocked) {
    if (rule.pattern.test(command)) {
      return { hardBlocked: true, needsConfirmation: false, reason: rule.reason };
    }
  }

  // Destructive operations: require explicit confirmation.
  const needsConfirmation =
    /\brm\b/.test(normalized) && (
      /\s-\S*r\S*f(\s|$)/.test(normalized) || // rm -rf / rm -fr / rm -r -f ...
      /\s--recursive(\s|$)/.test(normalized) ||
      /\s--force(\s|$)/.test(normalized)
    );

  if (needsConfirmation) {
    return { hardBlocked: false, needsConfirmation: true, reason: "Potentially destructive command" };
  }

  return { hardBlocked: false, needsConfirmation: false };
}

async function runShellCommandLocally(args: {
  command: string;
  timeoutMs: number;
  context: ToolContext;
  onStream?: (evt: ShellStreamEvent) => void;
  onExit?: (evt: ShellExitEvent) => void;
}): Promise<{ stdout: string; stderr: string; exit: ShellExitEvent }> {
  const { command, timeoutMs, context, onStream, onExit } = args;
  const { spawn } = await import("child_process");

  const workspaceDir = path.resolve("/tmp/agent-workspace", context.runId);
  await fs.mkdir(workspaceDir, { recursive: true });

  const MAX_OUTPUT_CHARS = 2_000_000;
  const truncateAppend = (existing: string, chunk: string): string => {
    if (existing.length >= MAX_OUTPUT_CHARS) return existing;
    const next = existing + chunk;
    if (next.length <= MAX_OUTPUT_CHARS) return next;
    return next.slice(0, MAX_OUTPUT_CHARS);
  };

  return await new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let wasKilled = false;
    let emittedAnyChunk = false;

    const child = spawn(command, {
      shell: true,
      cwd: workspaceDir,
      env: { ...process.env, HOME: workspaceDir },
    });

    const kill = () => {
      if (wasKilled) return;
      wasKilled = true;
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
    };

    const timeoutId = setTimeout(kill, timeoutMs);

    const abortHandler = () => {
      kill();
    };
    if (context.signal) {
      if (context.signal.aborted) abortHandler();
      else context.signal.addEventListener("abort", abortHandler, { once: true });
    }

    child.stdout?.on("data", (data: Buffer) => {
      const chunk = data.toString("utf8");
      stdout = truncateAppend(stdout, chunk);
      emittedAnyChunk = true;
      onStream?.({ stream: "stdout", chunk });
    });

    child.stderr?.on("data", (data: Buffer) => {
      const chunk = data.toString("utf8");
      stderr = truncateAppend(stderr, chunk);
      emittedAnyChunk = true;
      onStream?.({ stream: "stderr", chunk });
    });

    const finish = (exitCode: number | null, signal: string | null) => {
      clearTimeout(timeoutId);
      const exit: ShellExitEvent = {
        exitCode,
        signal,
        wasKilled,
        durationMs: Math.max(0, Date.now() - startedAt),
      };

      // Some commands may buffer output so tightly that we don't see "data" events before close.
      // Ensure at least one streaming callback for small outputs when possible (tests rely on this).
      if (!emittedAnyChunk) {
        if (stdout) onStream?.({ stream: "stdout", chunk: stdout });
        if (stderr) onStream?.({ stream: "stderr", chunk: stderr });
      }

      onExit?.(exit);
      resolve({ stdout, stderr, exit });
    };

    child.on("close", (code, sig) => finish(typeof code === "number" ? code : null, sig ? String(sig) : null));
    child.on("error", (err: any) => {
      stderr = truncateAppend(stderr, String(err?.message || err || "Command failed"));
      finish(1, null);
    });
  });
}

function parseSseFrame(frame: string): { event: string; data: string } {
  const lines = frame.split("\n").filter(Boolean);
  let event = "message";
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) event = line.slice("event:".length).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trim());
  }
  return { event, data: dataLines.join("\n") };
}

async function runShellCommandViaRunner(args: {
  command: string;
  timeoutMs: number;
  context: ToolContext;
  onStream?: (evt: ShellStreamEvent) => void;
  onExit?: (evt: ShellExitEvent) => void;
}): Promise<{ stdout: string; stderr: string; exit: ShellExitEvent }> {
  const { command, timeoutMs, context, onStream, onExit } = args;

  const baseUrl = String(process.env.SHELL_COMMAND_RUNNER_URL || "").trim();
  const token = String(process.env.SHELL_COMMAND_RUNNER_TOKEN || "").trim();
  if (!baseUrl || !token) {
    throw new Error("Shell command runner is not configured (SHELL_COMMAND_RUNNER_URL / SHELL_COMMAND_RUNNER_TOKEN)");
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  if (context.signal) {
    if (context.signal.aborted) controller.abort();
    else context.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  const runRes = await fetch(new URL("/v1/shell/run", baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ runId: context.runId, command, timeoutMs }),
    signal: controller.signal,
  });
  if (!runRes.ok) {
    clearTimeout(timeoutId);
    const text = await runRes.text().catch(() => "");
    throw new Error(`Runner refused request (${runRes.status}): ${text || runRes.statusText}`);
  }

  const runJson = await runRes.json().catch(() => ({} as any));
  const streamUrl = typeof runJson?.streamUrl === "string" ? runJson.streamUrl : "";
  if (!streamUrl) {
    clearTimeout(timeoutId);
    throw new Error("Runner did not return streamUrl");
  }

  const streamAbs = new URL(streamUrl, baseUrl).toString();
  const streamRes = await fetch(streamAbs, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    signal: controller.signal,
  });
  if (!streamRes.ok || !streamRes.body) {
    clearTimeout(timeoutId);
    const text = await streamRes.text().catch(() => "");
    throw new Error(`Runner stream failed (${streamRes.status}): ${text || streamRes.statusText}`);
  }

  const reader = streamRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  let stdout = "";
  let stderr = "";
  let exit: ShellExitEvent | null = null;
  let emittedAnyChunk = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n");

    // Consume complete SSE frames separated by blank lines.
    while (true) {
      const idx = buffer.indexOf("\n\n");
      if (idx === -1) break;
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      const parsed = parseSseFrame(frame);
      if (parsed.event === "shell") {
        let payload: any = null;
        try { payload = JSON.parse(parsed.data || "{}"); } catch { payload = null; }
        if (!payload || typeof payload !== "object") continue;

        if (payload.type === "stdout" || payload.type === "stderr") {
          const chunk = String(payload.chunk ?? "");
          emittedAnyChunk = true;
          if (payload.type === "stdout") stdout += chunk;
          else stderr += chunk;
          onStream?.({ stream: payload.type, chunk });
          continue;
        }

        if (payload.type === "exit") {
          exit = {
            exitCode: typeof payload.exitCode === "number" ? payload.exitCode : null,
            signal: payload.signal ? String(payload.signal) : null,
            wasKilled: Boolean(payload.wasKilled),
            durationMs: typeof payload.durationMs === "number" ? payload.durationMs : Math.max(0, Date.now() - startedAt),
          };
          onExit?.(exit);
          continue;
        }
      }
    }
  }

  clearTimeout(timeoutId);

  if (!exit) {
    exit = { exitCode: null, signal: null, wasKilled: false, durationMs: Math.max(0, Date.now() - startedAt) };
    onExit?.(exit);
  }

  if (!emittedAnyChunk) {
    if (stdout) onStream?.({ stream: "stdout", chunk: stdout });
    if (stderr) onStream?.({ stream: "stderr", chunk: stderr });
  }

  return { stdout, stderr, exit };
}

const shellCommandTool: ToolDefinition = {
  name: "shell_command",
  description: "Execute a shell command in the agent's sandbox. Limited to safe operations.",
  inputSchema: shellCommandSchema,
  capabilities: ["executes_code", "long_running"],
  execute: async (input, context): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const risk = assessShellCommandRisk(String(input.command || ""));

      if (risk.hardBlocked) {
        return {
          success: false,
          output: null,
          error: createError("COMMAND_BLOCKED", risk.reason || "This command is not allowed for security reasons", false),
          artifacts: [],
          previews: [],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      if (risk.needsConfirmation && !context.isConfirmed) {
        return {
          success: false,
          output: null,
          error: createError(
            "REQUIRES_CONFIRMATION",
            "This command is potentially destructive and requires explicit confirmation",
            false,
            { command: input.command }
          ),
          artifacts: [],
          previews: [],
          logs: [],
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      const mode = String(process.env.SHELL_COMMAND_SANDBOX_MODE || "").toLowerCase();
      const onStream = context.onStream;
      const onExit = context.onExit;

      const runnerEnabled = mode === "runner";

      const result = runnerEnabled
        ? await runShellCommandViaRunner({
          command: input.command,
          timeoutMs: input.timeout,
          context,
          onStream,
          onExit,
        })
        : await runShellCommandLocally({
          command: input.command,
          timeoutMs: input.timeout,
          context,
          onStream,
          onExit,
        });

      const exitCode = result.exit.exitCode ?? 0;
      return {
        success: exitCode === 0,
        output: { command: input.command, stdout: result.stdout, stderr: result.stderr, exitCode },
        artifacts: [],
        previews: [{ type: "text", content: result.stdout || result.stderr, title: "Command Output" }],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    } catch (error: any) {
      return {
        success: false,
        output: { command: input.command, stdout: "", stderr: error?.message || String(error || ""), exitCode: 1 },
        error: createError("COMMAND_ERROR", error?.message || String(error || "Command failed"), true),
        artifacts: [],
        previews: [{ type: "text", content: error?.message || String(error || ""), title: "Error Output" }],
        logs: [],
        metrics: { durationMs: Date.now() - startTime },
      };
    }
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
      const workspaceDir = path.resolve('/tmp/agent-workspace', context.runId);
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
