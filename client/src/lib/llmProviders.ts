export function formatProviderLabel(provider: string): string {
  const value = String(provider || "").trim();
  if (!value) return "";

  const lower = value.toLowerCase();

  if (lower === "xai" || lower === "grok") return "xAI";
  if (lower === "gemini" || lower === "google") return "Gemini";

  if (lower === "openai") return "OpenAI";
  if (lower === "anthropic" || lower === "claude") return "Claude";
  if (lower === "deepseek" || lower === "deepsep") return "DeepSeek";

  // Fallback: preserve original string, but make it look decent in headings.
  return value;
}

