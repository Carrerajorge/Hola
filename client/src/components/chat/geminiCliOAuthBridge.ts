const GEMINI_CLI_BRIDGE_STORAGE_KEY = "iliagpt:gemini-cli-oauth-bridge-result";
const GEMINI_CLI_BRIDGE_TTL_MS = 30 * 60 * 1000;

export type GeminiCliBridgePayload = {
  type: "gemini-cli-oauth-callback" | "gemini-cli-oauth-result";
  flowId: string;
  callbackUrl?: string;
  status?: string;
  error?: string;
  errorDescription?: string;
  createdAt: number;
};

function isValidBridgeType(value: unknown): value is GeminiCliBridgePayload["type"] {
  return value === "gemini-cli-oauth-callback" || value === "gemini-cli-oauth-result";
}

export function parseGeminiCliBridgePayload(raw: string | null): GeminiCliBridgePayload | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<GeminiCliBridgePayload>;
    if (!parsed || !isValidBridgeType(parsed.type) || typeof parsed.flowId !== "string") {
      return null;
    }

    const createdAt = Number(parsed.createdAt || 0);
    if (!Number.isFinite(createdAt) || Date.now() - createdAt > GEMINI_CLI_BRIDGE_TTL_MS) {
      return null;
    }

    return {
      type: parsed.type,
      flowId: parsed.flowId,
      callbackUrl: typeof parsed.callbackUrl === "string" ? parsed.callbackUrl : undefined,
      status: typeof parsed.status === "string" ? parsed.status : undefined,
      error: typeof parsed.error === "string" ? parsed.error : undefined,
      errorDescription:
        typeof parsed.errorDescription === "string" ? parsed.errorDescription : undefined,
      createdAt,
    };
  } catch {
    return null;
  }
}

export function readGeminiCliBridgePayload(
  storage: Pick<Storage, "getItem" | "removeItem"> = window.localStorage,
): GeminiCliBridgePayload | null {
  const payload = parseGeminiCliBridgePayload(storage.getItem(GEMINI_CLI_BRIDGE_STORAGE_KEY));
  if (!payload) {
    storage.removeItem(GEMINI_CLI_BRIDGE_STORAGE_KEY);
  }
  return payload;
}

export function clearGeminiCliBridgePayload(
  storage: Pick<Storage, "removeItem"> = window.localStorage,
): void {
  storage.removeItem(GEMINI_CLI_BRIDGE_STORAGE_KEY);
}

export { GEMINI_CLI_BRIDGE_STORAGE_KEY };
