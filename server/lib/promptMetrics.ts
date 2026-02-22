/**
 * Prompt Integrity Metrics
 *
 * Tracks prompt processing events for observability:
 * - Integrity check pass/fail counts
 * - Context truncation events
 * - Token estimation histograms
 * - Compression ratios
 *
 * Uses the existing Prometheus metrics infrastructure from server/metrics/prometheus.ts.
 */

import {
  registerCounter,
  registerHistogram,
  incCounter,
  observeHistogram,
} from "../metrics/prometheus";

// Register metrics on module load
registerCounter({
  name: "prompt_integrity_checks_total",
  help: "Total prompt integrity checks performed",
  labelNames: ["result"], // "pass" | "fail" | "skipped"
});

registerCounter({
  name: "prompt_truncation_total",
  help: "Total context truncation events",
  labelNames: ["reason"], // "context_budget" | "message_drop"
});

registerCounter({
  name: "prompt_dropped_chars_total",
  help: "Total characters dropped from user prompts (invariant: should be 0)",
  labelNames: [],
});

registerHistogram({
  name: "prompt_tokens_estimated",
  help: "Estimated token count of incoming user prompts",
  labelNames: [],
  buckets: [50, 100, 250, 500, 1000, 2000, 4000, 8000, 16000, 32000],
});

registerHistogram({
  name: "prompt_compression_ratio",
  help: "Ratio of final tokens to original tokens after context management",
  labelNames: [],
  buckets: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
});

/** Record an integrity check result. */
export function recordIntegrityCheck(result: "pass" | "fail" | "skipped"): void {
  incCounter("prompt_integrity_checks_total", { result });
}

/** Record a context truncation event. */
export function recordTruncation(originalTokens: number, finalTokens: number, droppedMessages: number): void {
  incCounter("prompt_truncation_total", { reason: "context_budget" });
  if (droppedMessages > 0) {
    incCounter("prompt_truncation_total", { reason: "message_drop" });
  }
  const ratio = originalTokens > 0 ? finalTokens / originalTokens : 1;
  observeHistogram("prompt_compression_ratio", ratio);
}

/** Record the estimated token count of an incoming prompt. */
export function recordPromptTokens(estimatedTokens: number): void {
  observeHistogram("prompt_tokens_estimated", estimatedTokens);
}

/** Record dropped characters (invariant: should always be called with 0). */
export function recordDroppedChars(count: number): void {
  if (count > 0) {
    incCounter("prompt_dropped_chars_total", {}, count);
  }
}
