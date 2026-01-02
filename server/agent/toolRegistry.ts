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

export interface ToolContext {
  userId: string;
  chatId: string;
  runId: string;
}

export interface ToolArtifact {
  type: string;
  name: string;
  data: any;
}

export interface ToolResult {
  success: boolean;
  output: any;
  artifacts?: ToolArtifact[];
  error?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodSchema;
  execute: (input: any, context: ToolContext) => Promise<ToolResult>;
}

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      console.warn(`[ToolRegistry] Overwriting existing tool: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  async execute(name: string, input: any, context: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    
    if (!tool) {
      return {
        success: false,
        output: null,
        error: `Tool "${name}" not found`,
      };
    }

    try {
      const parseResult = tool.inputSchema.safeParse(input);
      if (!parseResult.success) {
        return {
          success: false,
          output: null,
          error: `Invalid input: ${parseResult.error.message}`,
        };
      }

      return await tool.execute(parseResult.data, context);
    } catch (error: any) {
      console.error(`[ToolRegistry] Error executing tool "${name}":`, error);
      return {
        success: false,
        output: null,
        error: error.message || "Unknown error",
      };
    }
  }
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
        error: error.message,
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
        error: error.message,
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
          {
            type: "image",
            name: "generated_image",
            data: {
              base64: result.imageBase64,
              mimeType: result.mimeType,
            },
          },
        ],
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: error.message,
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
        artifacts.push({
          type: "screenshot",
          name: "page_screenshot",
          data: {
            base64: result.screenshot.toString("base64"),
            mimeType: "image/png",
          },
        });
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
        error: result.error,
      };
    } catch (error: any) {
      if (createdSession && sessionId) {
        await browserWorker.destroySession(sessionId).catch(() => {});
      }
      return {
        success: false,
        output: null,
        error: error.message,
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
          {
            type: "document",
            name: filename,
            data: {
              base64: buffer.toString("base64"),
              mimeType,
              filename,
            },
          },
        ],
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: error.message,
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
