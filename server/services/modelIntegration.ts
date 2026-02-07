export type ChatRuntimeProvider = "xai" | "gemini";

export function normalizeModelProviderToRuntime(provider: string): ChatRuntimeProvider | null {
  const normalized = String(provider || "").toLowerCase().trim();
  if (!normalized) return null;

  // Storage uses "google" for Gemini models. Some code uses "gemini".
  if (normalized === "google" || normalized === "gemini") return "gemini";

  // Storage uses "xai" for Grok. Some code uses "grok".
  if (normalized === "xai" || normalized === "grok") return "xai";

  return null;
}

export function isModelProviderSupported(provider: string): boolean {
  return normalizeModelProviderToRuntime(provider) !== null;
}

export function hasApiKeyForRuntimeProvider(runtime: ChatRuntimeProvider): boolean {
  if (runtime === "xai") {
    // Legacy: some deployments still use GROK_API_KEY.
    return !!(process.env.XAI_API_KEY || process.env.GROK_API_KEY);
  }
  if (runtime === "gemini") {
    // Legacy/alternate: GOOGLE_API_KEY.
    return !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  }
  return false;
}

export function isModelProviderIntegrated(provider: string): boolean {
  const runtime = normalizeModelProviderToRuntime(provider);
  if (!runtime) return false;
  return hasApiKeyForRuntimeProvider(runtime);
}

// Provider ids as stored in ai_models.provider (plus known aliases).
export function getSupportedModelProviderIds(): string[] {
  return ["xai", "google", "grok", "gemini"];
}

export function getIntegratedModelProviderIds(): string[] {
  const out = new Set<string>();
  for (const provider of getSupportedModelProviderIds()) {
    if (isModelProviderIntegrated(provider)) out.add(provider);
  }
  return Array.from(out);
}

export function isModelEligibleForPublic(model: { provider: string; status?: string | null; isEnabled?: string | null }): boolean {
  if (model.isEnabled !== "true") return false;
  if (model.status !== "active") return false;
  return isModelProviderIntegrated(model.provider);
}

