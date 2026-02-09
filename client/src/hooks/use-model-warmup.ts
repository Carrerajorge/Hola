import { useRef, useCallback } from "react";

/**
 * Debounced model warmup triggered by user typing.
 * Sends a single warmup request per model per COOLDOWN period
 * so the LLM provider connection is hot when the user sends.
 */
const TYPING_WARMUP_COOLDOWN_MS = 30_000; // match server-side cooldown
const TYPING_MIN_LENGTH = 15; // only warmup after meaningful input

export function useModelWarmup(modelId: string | null) {
  const lastWarmupRef = useRef<{ model: string; at: number } | null>(null);

  const onTypingWarmup = useCallback(
    (inputLength: number) => {
      if (!modelId || inputLength < TYPING_MIN_LENGTH) return;

      const last = lastWarmupRef.current;
      if (last && last.model === modelId && Date.now() - last.at < TYPING_WARMUP_COOLDOWN_MS) {
        return; // still within cooldown
      }

      lastWarmupRef.current = { model: modelId, at: Date.now() };

      fetch("/api/models/warmup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelId }),
      }).catch(() => {
        // best-effort
      });
    },
    [modelId]
  );

  return { onTypingWarmup };
}
