import type { ToolDefinition, ToolResult } from "./toolRegistry";
import { COMPUTER_USE_TOOLS } from "./langgraph/computerUseTools";
import { nativeControlTool } from "./tools/macosNativeTools";

type LangChainStyleTool = {
  name: string;
  description: string;
  schema?: unknown;
  invoke: (input: Record<string, unknown>) => Promise<unknown>;
};

function parseLangChainOutput(output: unknown): { success: boolean; value: unknown; error?: string } {
  if (typeof output === "string") {
    try {
      const parsed = JSON.parse(output) as Record<string, unknown>;
      const success = parsed.success !== false;
      return {
        success,
        value: parsed,
        error: success ? undefined : String(parsed.error || "Tool execution failed"),
      };
    } catch {
      return { success: true, value: { result: output } };
    }
  }

  if (output && typeof output === "object") {
    const record = output as Record<string, unknown>;
    const success = record.success !== false;
    return {
      success,
      value: record,
      error: success ? undefined : String(record.error || "Tool execution failed"),
    };
  }

  return { success: true, value: output };
}

function toToolDefinition(
  tool: LangChainStyleTool,
  capabilities: ToolDefinition["capabilities"] = [],
): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: (tool.schema as ToolDefinition["inputSchema"]) || undefined,
    capabilities,
    execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
      try {
        const raw = await tool.invoke(input);
        const parsed = parseLangChainOutput(raw);
        return {
          success: parsed.success,
          output: parsed.value,
          artifacts: [],
          previews: [],
          logs: [],
          error: parsed.success
            ? undefined
            : {
                code: "LANGCHAIN_TOOL_FAILED",
                message: parsed.error || "Tool execution failed",
                retryable: true,
              },
        };
      } catch (error: any) {
        return {
          success: false,
          output: null,
          artifacts: [],
          previews: [],
          logs: [],
          error: {
            code: "LANGCHAIN_TOOL_ERROR",
            message: error?.message || "Tool execution failed",
            retryable: true,
          },
        };
      }
    },
  };
}

export function createBridgedComputerUseToolDefinitions(): ToolDefinition[] {
  const capabilityMap = new Map<string, ToolDefinition["capabilities"]>([
    ["computer_use_session", ["long_running"]],
    ["computer_use_navigate", ["requires_network", "accesses_external_api", "long_running"]],
    ["computer_use_interact", ["high_risk", "long_running"]],
    ["computer_use_screenshot", ["reads_files"]],
    ["computer_use_extract", ["reads_files"]],
    ["computer_use_agentic", ["requires_network", "accesses_external_api", "high_risk", "long_running"]],
    ["terminal_execute", ["executes_code", "high_risk", "long_running"]],
    ["terminal_system_info", ["reads_files"]],
    ["terminal_file_op", ["reads_files", "writes_files", "high_risk"]],
    ["vision_analyze", ["reads_files"]],
    ["physical_desktop_control", ["high_risk", "long_running"]],
  ]);

  const bridged = COMPUTER_USE_TOOLS.map((tool) =>
    toToolDefinition(tool as unknown as LangChainStyleTool, capabilityMap.get(tool.name) || []),
  );

  bridged.push(
    toToolDefinition(
      nativeControlTool as unknown as LangChainStyleTool,
      capabilityMap.get(nativeControlTool.name) || [],
    ),
  );

  return bridged;
}
