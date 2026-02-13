export type LLMProviderId = "xai" | "gemini" | "openai" | "anthropic" | "deepseek";
export type LLMProviderOrAuto = LLMProviderId | "auto";

/**
 * Normalize provider identifiers coming from UI/DB/user input.
 *
 * We keep the internal ids stable and map common aliases to them.
 */
export function normalizeProvider(input: unknown): LLMProviderOrAuto | null {
  if (typeof input !== "string") return null;
  const value = input.trim().toLowerCase();
  if (!value) return null;

  if (value === "auto") return "auto";

  if (value === "gemini" || value === "google") return "gemini";
  if (value === "xai" || value === "grok") return "xai";

  if (value === "openai") return "openai";
  if (value === "anthropic" || value === "claude") return "anthropic";

  if (value === "deepseek" || value === "deepsep") return "deepseek";

  return null;
}

export function detectProviderFromModel(model: unknown): LLMProviderId | null {
  if (typeof model !== "string") return null;
  const value = model.trim();
  if (!value) return null;

  const lower = value.toLowerCase();

  if (lower.includes("gemini")) return "gemini";
  if (lower.includes("grok") || lower.includes("xai")) return "xai";

  if (lower.includes("claude") || lower.startsWith("anthropic/")) return "anthropic";
  if (lower.includes("deepseek")) return "deepseek";

  // OpenAI: GPT-* and O* models.
  if (lower.startsWith("gpt-") || lower.startsWith("o1") || lower.startsWith("o3") || lower.startsWith("o4")) {
    return "openai";
  }

  return null;
}

