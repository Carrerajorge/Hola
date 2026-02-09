export type ChatRuntimeProvider = "xai" | "gemini" | "openai";

export function normalizeModelProviderToRuntime(provider: string): ChatRuntimeProvider | null {
  const normalized = String(provider || "").toLowerCase().trim();
  if (!normalized) return null;

  // Storage uses "google" for Gemini models. Some code uses "gemini".
  if (normalized === "google" || normalized === "gemini") return "gemini";

  // Storage uses "xai" for Grok. Some code uses "grok".
  if (normalized === "xai" || normalized === "grok") return "xai";

  // OpenAI models
  if (normalized === "openai") return "openai";

  return null;
}

export function isModelProviderSupported(provider: string): boolean {
  return normalizeModelProviderToRuntime(provider) !== null;
}

export function hasApiKeyForRuntimeProvider(runtime: ChatRuntimeProvider): boolean {
  if (runtime === "xai") {
    // Legacy: some deployments still use GROK_API_KEY.
    // Legacy: ILIAGPT_API_KEY is also accepted by llmGateway deployments.
    return !!(process.env.XAI_API_KEY || process.env.GROK_API_KEY || process.env.ILIAGPT_API_KEY);
  }
  if (runtime === "gemini") {
    // Legacy/alternate: GOOGLE_API_KEY.
    return !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  }
  if (runtime === "openai") {
    return !!process.env.OPENAI_API_KEY;
  }
  return false;
}

export function isChatModelType(modelType?: string | null): boolean {
  // Keep permissive defaults: legacy rows may have null modelType.
  const t = String(modelType || "TEXT").toUpperCase();
  return t === "TEXT" || t === "MULTIMODAL";
}

export function isChatModelIdCompatible(runtime: ChatRuntimeProvider, modelId?: string | null): boolean {
  const id = String(modelId || "").toLowerCase().trim();
  if (!id) return false;
  if (runtime === "gemini") return id.includes("gemini");
  if (runtime === "xai") return id.includes("grok");
  if (runtime === "openai") {
    // All OpenAI chat models: GPT, O-series, ChatGPT, Codex (text)
    return /^(gpt|o\d|chatgpt|codex-mini|computer-use)/.test(id);
  }
  return false;
}

export function isModelChatCapable(model: { provider: string; modelId?: string | null; modelType?: string | null }): boolean {
  const runtime = normalizeModelProviderToRuntime(model.provider);
  if (!runtime) return false;
  if (!isChatModelType(model.modelType)) return false;
  return isChatModelIdCompatible(runtime, model.modelId);
}

export function isModelProviderIntegrated(provider: string): boolean {
  const runtime = normalizeModelProviderToRuntime(provider);
  if (!runtime) return false;
  return hasApiKeyForRuntimeProvider(runtime);
}

// Provider ids as stored in ai_models.provider (plus known aliases).
export function getSupportedModelProviderIds(): string[] {
  // Provider ids as stored in `ai_models.provider` plus known legacy aliases.
  return ["xai", "google", "openai", "grok", "gemini"];
}

export function getIntegratedModelProviderIds(): string[] {
  const out = new Set<string>();
  for (const provider of getSupportedModelProviderIds()) {
    if (isModelProviderIntegrated(provider)) out.add(provider);
  }
  return Array.from(out);
}

export function isModelEligibleForPublic(model: {
  provider: string;
  modelId?: string | null;
  modelType?: string | null;
  status?: string | null;
  isEnabled?: string | null;
}): boolean {
  if (model.isEnabled !== "true") return false;
  if (model.status !== "active") return false;
  if (!isModelProviderIntegrated(model.provider)) return false;
  return isModelChatCapable(model);
}
