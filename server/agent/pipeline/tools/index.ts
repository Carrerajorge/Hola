import { toolRegistry } from "../registry";
import { webNavigateTool } from "./web-navigate";
import { extractContentTool } from "./extract-content";
import { generateFileTool } from "./generate-file";
import { transformDataTool } from "./transform-data";
import { respondTool } from "./respond";
import { searchWebTool } from "./search-web";
import { analyzeDataTool } from "./analyze-data";

export function registerBuiltinTools(): void {
  toolRegistry.register(webNavigateTool);
  toolRegistry.register(extractContentTool);
  toolRegistry.register(generateFileTool);
  toolRegistry.register(transformDataTool);
  toolRegistry.register(respondTool);
  toolRegistry.register(searchWebTool);
  toolRegistry.register(analyzeDataTool);
  
  console.log(`Registered ${toolRegistry.getAll().length} built-in tools`);
}

export * from "./web-navigate";
export * from "./extract-content";
export * from "./generate-file";
export * from "./transform-data";
export * from "./respond";
export * from "./search-web";
export * from "./analyze-data";
