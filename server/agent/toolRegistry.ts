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
import { executionEngine, type ExecutionOptions } from "./executionEngine";
import { policyEngine, type PolicyContext } from "./policyEngine";
import type { ToolCapability } from "./contracts";
import { randomUUID } from "crypto";

export type ArtifactType = "file" | "image" | "document" | "chart" | "data" | "preview" | "link";

export interface ToolContext {
  userId: string;
  chatId: string;
  runId: string;
  correlationId?: string;
  stepIndex?: number;
  userPlan?: "free" | "pro" | "admin";
  isConfirmed?: boolean;
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
    if (this.tools.has(tool.name)) {
      console.warn(`[ToolRegistry] Overwriting existing tool: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
    console.log(`[ToolRegistry] Registered tool: ${tool.name}`);
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
    
    if (!tool) {
      return {
        success: false,
        output: null,
        error: {
          code: "TOOL_NOT_FOUND",
          message: `Tool "${name}" not found`,
          retryable: false,
        },
        logs,
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
        error: {
          code: policyCheck.requiresConfirmation ? "REQUIRES_CONFIRMATION" : "ACCESS_DENIED",
          message: policyCheck.reason || "Access denied",
          retryable: false,
        },
        logs,
        metrics: { durationMs: Date.now() - startTime },
      };
    }

    try {
      const parseResult = tool.inputSchema.safeParse(input);
      if (!parseResult.success) {
        addLog("error", "Input validation failed", parseResult.error.errors);
        return {
          success: false,
          output: null,
          error: {
            code: "INVALID_INPUT",
            message: `Invalid input: ${parseResult.error.message}`,
            retryable: false,
            details: parseResult.error.errors,
          },
          logs,
          metrics: { durationMs: Date.now() - startTime },
        };
      }

      addLog("info", `Executing tool: ${name}`);

      const executionResult = await executionEngine.execute(
        name,
        () => tool.execute(parseResult.data, context),
        {
          maxRetries: policyCheck.policy.maxRetries,
          timeoutMs: policyCheck.policy.maxExecutionTimeMs,
        },
        context.correlationId ? {
          runId: context.runId,
          correlationId: context.correlationId,
          stepIndex: context.stepIndex || 0,
        } : undefined
      );

      if (executionResult.success && executionResult.data) {
        const result = executionResult.data;
        addLog("info", `Tool completed successfully in ${executionResult.metrics.totalDurationMs}ms`);
        
        return {
          ...result,
          logs: [...(result.logs || []), ...logs],
          metrics: {
            durationMs: executionResult.metrics.totalDurationMs,
            ...result.metrics,
          },
        };
      } else {
        addLog("error", `Tool failed: ${executionResult.error?.message}`, executionResult.error);
        return {
          success: false,
          output: null,
          error: {
            code: executionResult.error?.code || "EXECUTION_ERROR",
            message: executionResult.error?.message || "Unknown error",
            retryable: executionResult.error?.retryable || false,
          },
          logs,
          metrics: {
            durationMs: executionResult.metrics.totalDurationMs,
          },
        };
      }
    } catch (error: any) {
      addLog("error", `Unexpected error: ${error.message}`, { stack: error.stack });
      return {
        success: false,
        output: null,
        error: {
          code: "UNEXPECTED_ERROR",
          message: error.message || "Unknown error",
          retryable: false,
        },
        logs,
        metrics: { durationMs: Date.now() - startTime },
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
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("ANALYSIS_ERROR", error.message, true),
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
    try {
      if (input.academic) {
        const results = await searchScholar(input.query, input.maxResults);
        return {
          success: true,
          output: {
            query: input.query,
            type: "academic",
            results,
          },
        };
      }

      const response = await searchWeb(input.query, input.maxResults);
      return {
        success: true,
        output: {
          query: response.query,
          type: "web",
          results: response.results,
          contents: response.contents,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("SEARCH_ERROR", error.message, true),
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
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("IMAGE_GENERATION_ERROR", error.message, true),
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
    let sessionId = input.sessionId;
    let createdSession = false;

    try {
      if (!sessionId) {
        sessionId = await browserWorker.createSession();
        createdSession = true;
      }

      const result = await browserWorker.navigate(sessionId, input.url, input.takeScreenshot);

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
        artifacts: artifacts.length > 0 ? artifacts : undefined,
        error: result.error ? createError("BROWSE_ERROR", result.error, true) : undefined,
      };
    } catch (error: any) {
      if (createdSession && sessionId) {
        await browserWorker.destroySession(sessionId).catch(() => {});
      }
      return {
        success: false,
        output: null,
        error: createError("BROWSE_ERROR", error.message, true),
      };
    }
  },
};

const generateDocumentSchema = z.object({
  type: z.enum(["word", "excel", "ppt"]).describe("Type of document to generate"),
  title: z.string().describe("Document title"),
  content: z.string().describe("Document content (text for Word, data for Excel, slide structure for PPT)"),
});

const generateDocumentTool: ToolDefinition = {
  name: "generate_document",
  description: "Generate Office documents (Word, Excel, PowerPoint). For Word: provide markdown/text content. For Excel: provide tabular data. For PowerPoint: provide slide content.",
  inputSchema: generateDocumentSchema,
  capabilities: ["produces_artifacts", "writes_files"],
  execute: async (input, context): Promise<ToolResult> => {
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

        case "excel":
          const excelData = parseExcelFromText(input.content);
          buffer = await generateExcelDocument(input.title, excelData);
          mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
          extension = "xlsx";
          break;

        case "ppt":
          const slides = parseSlidesFromText(input.content);
          buffer = await generatePptDocument(input.title, slides);
          mimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
          extension = "pptx";
          break;

        default:
          throw new Error(`Unsupported document type: ${input.type}`);
      }

      const filename = `${input.title.replace(/[^a-zA-Z0-9-_]/g, "_")}.${extension}`;

      return {
        success: true,
        output: {
          type: input.type,
          title: input.title,
          filename,
          size: buffer.length,
        },
        artifacts: [
          createArtifact(
            "document",
            filename,
            { base64: buffer.toString("base64"), mimeType, filename },
            mimeType
          ),
        ],
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: createError("DOCUMENT_GENERATION_ERROR", error.message, false),
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

export {
  analyzeSpreadsheetSchema,
  webSearchSchema,
  generateImageSchema,
  browseUrlSchema,
  generateDocumentSchema,
};
