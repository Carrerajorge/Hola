/**
 * GPT Tool Router
 *
 * Enforces the capability matrix defined in each GPT's configuration.
 * Each GPT can enable/disable specific tools, and the router ensures:
 *  - Only allowed tools are exposed to the model
 *  - Tool execution respects the GPT's permission mode (allowlist/denylist)
 *  - Actions (custom APIs) are routed through the action runtime
 *  - Tool results are captured with full observability
 */

import crypto from "node:crypto";
import { createLogger } from "../lib/structuredLogger";
import { type GptSessionContract } from "./gptSessionService";
import {
  type ToolRouter,
  type ToolCallRequest,
  type ToolCallResult,
  type BuiltContext,
} from "./gptOrchestrator";

const logger = createLogger("gpt-tool-router");

// ─── Built-in Tool Definitions ───────────────────────────────────────────────

interface BuiltinToolSpec {
  name: string;
  description: string;
  capability: keyof GptSessionContract["capabilities"];
  parameters: Record<string, unknown>;
}

const BUILTIN_TOOLS: BuiltinToolSpec[] = [
  {
    name: "web_search",
    description: "Search the web for current information. Returns search results with titles, URLs, and snippets.",
    capability: "webBrowsing",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
        num_results: { type: "number", description: "Number of results (max 10)", default: 5 },
      },
      required: ["query"],
    },
  },
  {
    name: "code_interpreter",
    description: "Execute code in a sandboxed environment. Supports Python for data analysis, calculations, and transformations.",
    capability: "codeInterpreter",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "The code to execute" },
        language: { type: "string", enum: ["python", "javascript"], default: "python" },
      },
      required: ["code"],
    },
  },
  {
    name: "generate_image",
    description: "Generate an image from a text description.",
    capability: "imageGeneration",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Description of the image to generate" },
        size: { type: "string", enum: ["256x256", "512x512", "1024x1024"], default: "1024x1024" },
        style: { type: "string", enum: ["natural", "vivid"], default: "natural" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "file_search",
    description: "Search through uploaded files and knowledge base documents for relevant information.",
    capability: "fileUpload",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query for file contents" },
        file_types: {
          type: "array",
          items: { type: "string" },
          description: "Filter by file types (e.g., ['pdf', 'docx'])",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "data_analysis",
    description: "Analyze structured data (CSV, JSON, spreadsheets). Perform aggregations, statistics, and create visualizations.",
    capability: "dataAnalysis",
    parameters: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["summarize", "aggregate", "filter", "visualize", "statistics"],
          description: "The analysis operation to perform",
        },
        data_source: { type: "string", description: "Reference to the data source (file ID or inline data)" },
        query: { type: "string", description: "Natural language description of the analysis" },
      },
      required: ["operation", "query"],
    },
  },
];

// ─── Tool Executor Registry ──────────────────────────────────────────────────

export type ToolExecutor = (
  args: Record<string, unknown>,
  context: { conversationId: string; gptId: string; userId?: string }
) => Promise<{ success: boolean; output: unknown; error?: string }>;

/**
 * Registry for actual tool implementations.
 * Each tool name maps to an executor function.
 */
class ToolExecutorRegistry {
  private executors = new Map<string, ToolExecutor>();

  register(name: string, executor: ToolExecutor): void {
    this.executors.set(name, executor);
  }

  get(name: string): ToolExecutor | undefined {
    return this.executors.get(name);
  }

  has(name: string): boolean {
    return this.executors.has(name);
  }
}

export const toolExecutorRegistry = new ToolExecutorRegistry();

// Register built-in tool executors with stub implementations
// These would be connected to actual services in production
toolExecutorRegistry.register("web_search", async (args, ctx) => {
  logger.info("Executing web search", { tool: "web_search", query: args.query, conversationId: ctx.conversationId });
  // Delegate to actual web search service
  return { success: true, output: { message: "Web search executed", query: args.query } };
});

toolExecutorRegistry.register("code_interpreter", async (args, ctx) => {
  logger.info("Executing code", { tool: "code_interpreter", conversationId: ctx.conversationId });
  return { success: true, output: { message: "Code execution completed", language: args.language } };
});

toolExecutorRegistry.register("generate_image", async (args, ctx) => {
  logger.info("Generating image", { tool: "generate_image", conversationId: ctx.conversationId });
  return { success: true, output: { message: "Image generated", prompt: args.prompt } };
});

toolExecutorRegistry.register("file_search", async (args, ctx) => {
  logger.info("Searching files", { tool: "file_search", query: args.query, conversationId: ctx.conversationId });
  return { success: true, output: { message: "File search completed", query: args.query } };
});

toolExecutorRegistry.register("data_analysis", async (args, ctx) => {
  logger.info("Analyzing data", { tool: "data_analysis", operation: args.operation, conversationId: ctx.conversationId });
  return { success: true, output: { message: "Data analysis completed", operation: args.operation } };
});

// ─── GPT Tool Router Implementation ──────────────────────────────────────────

const MAX_TOOL_EXECUTION_TIMEOUT_MS = 120_000;

export class GptToolRouterImpl implements ToolRouter {
  /**
   * Action executors are registered externally (from gptActionRuntime).
   */
  private actionExecutors = new Map<string, ToolExecutor>();

  registerAction(actionId: string, executor: ToolExecutor): void {
    this.actionExecutors.set(`action_${actionId}`, executor);
  }

  /**
   * Check if a tool is allowed for this GPT session.
   */
  isAllowed(toolName: string, contract: GptSessionContract): boolean {
    const { mode, allowedTools, actionsEnabled } = contract.toolPermissions;

    // Check if it's a built-in tool — match against capabilities
    const builtinTool = BUILTIN_TOOLS.find((t) => t.name === toolName);
    if (builtinTool) {
      const capEnabled = contract.capabilities[builtinTool.capability];
      if (!capEnabled) return false;
    }

    // Check if it's an action
    if (toolName.startsWith("action_")) {
      if (!actionsEnabled) return false;
    }

    // Apply allowlist/denylist
    if (mode === "allowlist") {
      // Empty allowlist means "allow all enabled tools"
      if (allowedTools.length === 0) return true;
      return allowedTools.includes(toolName);
    }

    if (mode === "denylist") {
      return !allowedTools.includes(toolName);
    }

    return true;
  }

  /**
   * Execute a tool call within the GPT session context.
   */
  async execute(
    toolCall: ToolCallRequest,
    contract: GptSessionContract,
    conversationId: string
  ): Promise<ToolCallResult> {
    const start = Date.now();

    // Permission check
    if (!this.isAllowed(toolCall.name, contract)) {
      return {
        id: toolCall.id,
        name: toolCall.name,
        success: false,
        output: null,
        error: `Tool "${toolCall.name}" is not permitted for this GPT configuration`,
        durationMs: 0,
      };
    }

    // Find executor
    const executor =
      toolExecutorRegistry.get(toolCall.name) ||
      this.actionExecutors.get(toolCall.name);

    if (!executor) {
      return {
        id: toolCall.id,
        name: toolCall.name,
        success: false,
        output: null,
        error: `No executor registered for tool "${toolCall.name}"`,
        durationMs: 0,
      };
    }

    // Execute with timeout
    try {
      const result = await Promise.race([
        executor(toolCall.arguments, {
          conversationId,
          gptId: contract.gptId,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Tool execution timeout")),
            MAX_TOOL_EXECUTION_TIMEOUT_MS
          )
        ),
      ]);

      const durationMs = Date.now() - start;
      logger.info(
        `Tool execution completed: ${toolCall.name}`,
        {
          tool: toolCall.name,
          conversationId,
          gptId: contract.gptId,
          success: result.success,
          durationMs,
        }
      );

      return {
        id: toolCall.id,
        name: toolCall.name,
        success: result.success,
        output: result.output,
        error: result.error,
        durationMs,
      };
    } catch (err: any) {
      const durationMs = Date.now() - start;
      logger.error(
        `Tool execution failed: ${toolCall.name}`,
        { err, tool: toolCall.name, conversationId, gptId: contract.gptId }
      );

      return {
        id: toolCall.id,
        name: toolCall.name,
        success: false,
        output: null,
        error: err?.message ?? "Tool execution failed",
        durationMs,
      };
    }
  }

  /**
   * Get tool specifications for tools enabled in this GPT.
   * These are passed to the model as available functions.
   */
  getToolSpecs(contract: GptSessionContract): BuiltContext["toolSpecs"] {
    const specs: BuiltContext["toolSpecs"] = [];

    // Add built-in tools that are enabled
    for (const tool of BUILTIN_TOOLS) {
      const capEnabled = contract.capabilities[tool.capability];
      if (!capEnabled) continue;

      if (!this.isAllowed(tool.name, contract)) continue;

      specs.push({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      });
    }

    // Add registered actions
    if (contract.toolPermissions.actionsEnabled) {
      for (const [actionName] of this.actionExecutors) {
        if (!this.isAllowed(actionName, contract)) continue;

        specs.push({
          type: "function",
          function: {
            name: actionName,
            description: `Custom action: ${actionName.replace("action_", "")}`,
            parameters: { type: "object", properties: {} },
          },
        });
      }
    }

    return specs;
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const gptToolRouter = new GptToolRouterImpl();
