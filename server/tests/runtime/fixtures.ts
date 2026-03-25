import type { UnifiedExecutionRequest } from "../../runtime/types";

export function createExecutionRequest(overrides: Partial<UnifiedExecutionRequest> = {}): UnifiedExecutionRequest {
  return {
    mode: "chat",
    prompt: "hello",
    ...overrides,
  };
}
