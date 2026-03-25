import type { UnifiedExecutionRequest } from "../types";

export function chooseAgentRuntime(request: UnifiedExecutionRequest): "openclaw" | "sandbox" | "legacy" {
  if (request.enableTools) return "openclaw";
  if (request.mode === "tool") return "sandbox";
  return "openclaw";
}
