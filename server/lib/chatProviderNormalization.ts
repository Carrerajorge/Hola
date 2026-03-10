import { normalizeModelProviderToRuntime, type ChatRuntimeProvider } from "../services/modelIntegration";

export type ChatRequestProvider = ChatRuntimeProvider | "auto";

export function normalizeChatRequestProvider(provider: unknown): ChatRequestProvider | undefined {
  const raw = typeof provider === "string" ? provider.trim().toLowerCase() : "";
  if (!raw) return undefined;
  if (raw === "auto") return "auto";
  return normalizeModelProviderToRuntime(raw) ?? undefined;
}
