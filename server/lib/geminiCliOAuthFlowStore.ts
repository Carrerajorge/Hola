export type GeminiCliOAuthFlowRecord = {
  verifier: string;
  createdAt: number;
  userId: string;
  oauthState: string;
  redirectUri: string;
};

const GEMINI_CLI_STATE_PREFIX = "gemini-cli:";
const FLOW_TTL_MS = 45 * 60 * 1000;
const globalGeminiCliFlowStore = new Map<string, GeminiCliOAuthFlowRecord>();

export function clearExpiredGeminiCliOAuthFlows(now = Date.now()): void {
  for (const [flowId, flow] of globalGeminiCliFlowStore.entries()) {
    if (now - flow.createdAt > FLOW_TTL_MS) {
      globalGeminiCliFlowStore.delete(flowId);
    }
  }
}

export function saveGeminiCliOAuthFlow(
  flowId: string,
  flow: GeminiCliOAuthFlowRecord,
): GeminiCliOAuthFlowRecord {
  clearExpiredGeminiCliOAuthFlows();
  globalGeminiCliFlowStore.set(flowId, flow);
  return flow;
}

export function getGeminiCliOAuthFlow(flowId: string): GeminiCliOAuthFlowRecord | null {
  clearExpiredGeminiCliOAuthFlows();
  return globalGeminiCliFlowStore.get(flowId) ?? null;
}

export function deleteGeminiCliOAuthFlow(flowId: string): void {
  globalGeminiCliFlowStore.delete(flowId);
}

export function extractGeminiCliFlowIdFromState(state: string | null | undefined): string | null {
  const trimmed = typeof state === "string" ? state.trim() : "";
  if (!trimmed.startsWith(GEMINI_CLI_STATE_PREFIX)) {
    return null;
  }
  const flowId = trimmed.slice(GEMINI_CLI_STATE_PREFIX.length).trim();
  return flowId || null;
}

export function extractGeminiCliFlowIdFromCallbackInput(
  callbackInput: string | null | undefined,
): string | null {
  const trimmed = typeof callbackInput === "string" ? callbackInput.trim() : "";
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    return extractGeminiCliFlowIdFromState(url.searchParams.get("state"));
  } catch {
    const normalized = trimmed.startsWith("?") ? trimmed.slice(1) : trimmed;
    const params = new URLSearchParams(normalized);
    return extractGeminiCliFlowIdFromState(params.get("state"));
  }
}
