/**
 * GPT Tool Router
 *
 * Manages tool capabilities per GPT: each GPT declares which tools it can use
 * and the runtime enforces that permission matrix. Bridges between GPT capabilities
 * config and the global tool registry.
 */
import type { z } from "zod/v4";
import type { gptCapabilitiesSchema, gptToolPermissionsSchema } from "@shared/schema/gpt";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GptCapabilities = z.infer<typeof gptCapabilitiesSchema>;
export type GptToolPermissions = z.infer<typeof gptToolPermissionsSchema>;

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  category: ToolCategory;
  requiresCapability?: keyof GptCapabilities;
}

export type ToolCategory =
  | "web_search"
  | "code_interpreter"
  | "data_analysis"
  | "image_generation"
  | "image_input"
  | "file_search"
  | "file_upload"
  | "custom_action"
  | "system";

export interface ToolCallRequest {
  toolName: string;
  arguments: Record<string, unknown>;
  conversationId: string;
  gptId: string;
  requestId: string;
}

export interface ToolCallResult {
  toolName: string;
  success: boolean;
  output: unknown;
  error?: { code: string; message: string; retryable: boolean };
  executionTimeMs: number;
  sandboxed: boolean;
}

export interface ResolvedToolSet {
  tools: ToolSpec[];
  enabledCapabilities: GptCapabilities;
  permissionMode: "allowlist" | "denylist";
}

// ─── Capability → Tool Mapping ────────────────────────────────────────────────

const CAPABILITY_TOOL_MAP: Record<keyof GptCapabilities, ToolCategory[]> = {
  webBrowsing: ["web_search"],
  codeInterpreter: ["code_interpreter"],
  imageGeneration: ["image_generation", "image_input"],
  fileUpload: ["file_upload", "file_search"],
  dataAnalysis: ["data_analysis", "code_interpreter"],
};

// ─── Built-in Tool Definitions ────────────────────────────────────────────────

const BUILTIN_TOOLS: ToolSpec[] = [
  {
    name: "web_search",
    description: "Search the web for current information",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        maxResults: { type: "number", description: "Max results to return" },
      },
      required: ["query"],
    },
    category: "web_search",
    requiresCapability: "webBrowsing",
  },
  {
    name: "code_interpreter",
    description: "Execute code in a sandboxed environment for analysis, calculations, or data processing",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "Code to execute" },
        language: { type: "string", enum: ["python", "javascript", "typescript"], description: "Programming language" },
      },
      required: ["code"],
    },
    category: "code_interpreter",
    requiresCapability: "codeInterpreter",
  },
  {
    name: "data_analysis",
    description: "Analyze structured data (CSV, JSON, tables) with statistical operations",
    parameters: {
      type: "object",
      properties: {
        data: { type: "string", description: "Data to analyze or file reference" },
        operation: { type: "string", description: "Analysis operation to perform" },
      },
      required: ["data", "operation"],
    },
    category: "data_analysis",
    requiresCapability: "dataAnalysis",
  },
  {
    name: "image_generation",
    description: "Generate images from text descriptions",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Image description" },
        size: { type: "string", enum: ["256x256", "512x512", "1024x1024"], description: "Image dimensions" },
      },
      required: ["prompt"],
    },
    category: "image_generation",
    requiresCapability: "imageGeneration",
  },
  {
    name: "file_search",
    description: "Search through uploaded files using semantic or keyword matching",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        fileIds: { type: "array", items: { type: "string" }, description: "Specific file IDs to search" },
      },
      required: ["query"],
    },
    category: "file_search",
    requiresCapability: "fileUpload",
  },
];

// ─── Tool Router ──────────────────────────────────────────────────────────────

export class GptToolRouter {
  private customTools = new Map<string, ToolSpec[]>();

  /**
   * Resolve the complete tool set available for a GPT based on its capabilities
   * and permission matrix.
   */
  resolveToolSet(
    capabilities: GptCapabilities,
    permissions: GptToolPermissions
  ): ResolvedToolSet {
    // Determine which categories are enabled by capabilities
    const enabledCategories = new Set<ToolCategory>();
    for (const [cap, categories] of Object.entries(CAPABILITY_TOOL_MAP)) {
      if (capabilities[cap as keyof GptCapabilities]) {
        for (const cat of categories) {
          enabledCategories.add(cat);
        }
      }
    }

    // Filter built-in tools by enabled capabilities
    let tools = BUILTIN_TOOLS.filter((tool) => {
      if (!tool.requiresCapability) return true;
      return capabilities[tool.requiresCapability];
    });

    // Apply permission mode (allowlist/denylist)
    if (permissions.mode === "allowlist" && permissions.tools.length > 0) {
      const allowSet = new Set(permissions.tools);
      tools = tools.filter((t) => allowSet.has(t.name));
    } else if (permissions.mode === "denylist" && permissions.tools.length > 0) {
      const denySet = new Set(permissions.tools);
      tools = tools.filter((t) => !denySet.has(t.name));
    }

    return {
      tools,
      enabledCapabilities: capabilities,
      permissionMode: permissions.mode,
    };
  }

  /**
   * Check if a specific tool call is permitted for the given GPT config.
   */
  isToolPermitted(
    toolName: string,
    capabilities: GptCapabilities,
    permissions: GptToolPermissions
  ): { permitted: boolean; reason?: string } {
    // Check if it's an action tool
    if (toolName.startsWith("action:")) {
      if (!permissions.actionsEnabled) {
        return { permitted: false, reason: "Actions are disabled for this GPT" };
      }
      return { permitted: true };
    }

    const tool = BUILTIN_TOOLS.find((t) => t.name === toolName);
    if (!tool) {
      return { permitted: false, reason: `Unknown tool: ${toolName}` };
    }

    // Check capability
    if (tool.requiresCapability && !capabilities[tool.requiresCapability]) {
      return { permitted: false, reason: `Capability '${String(tool.requiresCapability)}' not enabled` };
    }

    // Check permission mode
    if (permissions.mode === "allowlist" && permissions.tools.length > 0) {
      if (!permissions.tools.includes(toolName)) {
        return { permitted: false, reason: `Tool '${toolName}' not in allowlist` };
      }
    }
    if (permissions.mode === "denylist" && permissions.tools.includes(toolName)) {
      return { permitted: false, reason: `Tool '${toolName}' is in denylist` };
    }

    return { permitted: true };
  }

  /**
   * Register a custom tool for a GPT (from Actions).
   */
  registerActionTool(gptId: string, tool: ToolSpec): void {
    const existing = this.customTools.get(gptId) ?? [];
    existing.push({ ...tool, category: "custom_action" });
    this.customTools.set(gptId, existing);
  }

  /**
   * Unregister all custom tools for a GPT.
   */
  clearActionTools(gptId: string): void {
    this.customTools.delete(gptId);
  }

  /**
   * Get all tools (built-in + custom actions) for a GPT.
   */
  getAllTools(
    gptId: string,
    capabilities: GptCapabilities,
    permissions: GptToolPermissions
  ): ToolSpec[] {
    const resolved = this.resolveToolSet(capabilities, permissions);
    const actionTools = this.customTools.get(gptId) ?? [];
    if (permissions.actionsEnabled) {
      return [...resolved.tools, ...actionTools];
    }
    return resolved.tools;
  }

  /**
   * Convert tool specs to the format expected by LLM function calling.
   */
  toFunctionCallingFormat(tools: ToolSpec[]): Array<{
    type: "function";
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }> {
    return tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  /**
   * Get built-in tool definitions.
   */
  getBuiltinTools(): ToolSpec[] {
    return [...BUILTIN_TOOLS];
  }
}

export const gptToolRouter = new GptToolRouter();
