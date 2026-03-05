import { toolRegistry } from "../registry";
import { webNavigateTool } from "./web-navigate";
import { extractContentTool } from "./extract-content";
import { generateFileTool } from "./generate-file";
import { transformDataTool } from "./transform-data";
import { respondTool } from "./respond";
import { searchWebTool } from "./search-web";
import { analyzeDataTool } from "./analyze-data";
import { shellExecuteTool } from "./shell-execute";
import { fileOperationsTool } from "./file-operations";
import { webdevScaffoldTool } from "./webdev-scaffold";

import { withHitlGating } from "../../tenaga/hitl/HitlInterceptor";
import { executeArbitraryCodeTool } from "../../tenaga/CodeAgentTool";
import { guiAutomationTool } from "../../sandbox/guiAutomationTool";
import { processMonitorTool } from "../../sandbox/processMonitorTool";

import { slidesGenerateTool } from "./slides-generate";
import { generateCodeTool } from "./generate-code";

import { ToolDefinition } from "../types";
export const fetchUrlTool: ToolDefinition = {
  id: "fetch_url",
  name: "Fetch URL",
  description: "Fetch content from a URL",
  category: "web",
  capabilities: ["fetch", "url", "read"],
  inputSchema: {
    url: { type: "string", required: true }
  },
  execute: async (context, params) => {
    return extractContentTool.execute(context, params);
  }
};

export function registerBuiltinTools(): void {
  toolRegistry.register(fetchUrlTool);
  toolRegistry.register(webNavigateTool);
  toolRegistry.register(extractContentTool);
  toolRegistry.register(generateFileTool);
  toolRegistry.register(transformDataTool);
  toolRegistry.register(respondTool);
  toolRegistry.register(searchWebTool);
  toolRegistry.register(analyzeDataTool);
    toolRegistry.register(fileOperationsTool);
  toolRegistry.register(generateCodeTool);
  toolRegistry.register(webdevScaffoldTool);
  toolRegistry.register(slidesGenerateTool);

  // Tenaga Protected Tools (Tier-2 HITL)
  toolRegistry.register(withHitlGating(executeArbitraryCodeTool, "Arbitrary code execution requires user confirmation"));
  toolRegistry.register(withHitlGating(guiAutomationTool, "GUI mouse/keyboard control requires user confirmation"));
  toolRegistry.register(withHitlGating(processMonitorTool, "Process termination requires user confirmation"));

  // Tenaga-OpenClaw Fusion Registration
  const workspaceRoot = process.env.AGENT_WORKSPACE_ROOT || "/tmp/agent-workspace";
  const openclawFsTools = createFsTools(workspaceRoot, false);
  for (const t of openclawFsTools) {
    toolRegistry.register(t as any); // Type assertion bypass for Pipeline Registry vs General Registry
  }
  
  for (const t of createAgenticTools()) {
    toolRegistry.register(t as any);
  }
  
  for (const t of createClawiRuntimeTools()) {
    toolRegistry.register(t as any);
  }

  
  // Wrap existing dangerous tools
  toolRegistry.register(withHitlGating(shellExecuteTool, "Arbitrary shell execution requires user confirmation"));




  console.log(`Registered ${toolRegistry.getAll().length} built-in tools`);
}

export * from "./web-navigate";
export * from "./extract-content";
export * from "./generate-file";
export * from "./transform-data";
export * from "./respond";
export * from "./search-web";
export * from "./analyze-data";
export * from "./shell-execute";
export * from "./file-operations";
export * from "./generate-code";
export * from "./webdev-scaffold";
export * from "./slides-generate";
