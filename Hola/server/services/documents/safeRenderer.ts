/**
 * Safe Renderer — wraps each component compilation in a try-catch so that
 * individual node failures never crash the entire document.
 *
 * When a node fails to compile, the SafeRenderer:
 * 1. Records a diagnostic with the original error.
 * 2. Substitutes a deterministic fallback (plain-text paragraph, simple table).
 * 3. Returns the fallback so the document is always deliverable.
 */
import { ContentNode, RichText, richTextToPlain, CompilationDiagnostic } from "@shared/documentIR";
import { createLogger } from "../../utils/logger";

const logger = createLogger("safe-renderer");

export type NodeCompiler<TOutput> = (node: ContentNode) => TOutput | TOutput[];

/**
 * Wrap a compiler function with safe-render semantics.
 *
 * @param compile  The actual compiler function for a node type.
 * @param fallback A function that produces a safe fallback element.
 * @param diagnostics  Mutable array to push warnings into.
 */
export function safeCompile<TOutput>(
  compile: () => TOutput | TOutput[],
  fallback: () => TOutput,
  path: string,
  diagnostics: CompilationDiagnostic[],
): TOutput | TOutput[] {
  try {
    return compile();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("Component compilation failed, using fallback", { path, error: message });
    diagnostics.push({
      severity: "warning",
      code: "COMPONENT_FALLBACK",
      message: `${path}: compilation failed (${message}); fallback used.`,
      path,
      fallbackUsed: true,
    });
    return fallback();
  }
}

/**
 * Extract a human-readable summary from any ContentNode for use in fallback text.
 */
export function nodeSummary(node: ContentNode): string {
  switch (node.type) {
    case "title":
      return `[Title: ${richTextToPlain(node.content).slice(0, 80)}]`;
    case "heading":
      return `[H${node.level}: ${richTextToPlain(node.content).slice(0, 80)}]`;
    case "paragraph":
      return richTextToPlain(node.content).slice(0, 200);
    case "bullet_list":
    case "numbered_list":
      return `[List: ${node.items.length} items]`;
    case "table":
      return `[Table: ${node.columns.length} cols × ${node.rows.length} rows]`;
    case "image":
      return `[Image: ${node.alt || node.src.slice(0, 50)}]`;
    case "chart":
      return `[Chart: ${node.chartType} — ${node.title || "untitled"}]`;
    case "code_block":
      return `[Code: ${node.language || "text"}, ${node.code.length} chars]`;
    case "quote":
      return `[Quote: ${richTextToPlain(node.content).slice(0, 80)}]`;
    case "kpi_card":
      return `[KPI: ${node.label} = ${node.value}]`;
    default:
      return `[${node.type}]`;
  }
}

/**
 * Layout guard: split a list of items into chunks that respect a per-page limit.
 * Used by PPTX to split a long bullet list across multiple slides, and by Word
 * to insert page breaks for extremely long tables.
 */
export function chunkItems<T>(items: T[], maxPerChunk: number): T[][] {
  if (maxPerChunk <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += maxPerChunk) {
    chunks.push(items.slice(i, i + maxPerChunk));
  }
  return chunks;
}

/**
 * Text overflow guard: truncate a string with an ellipsis if it exceeds `max`.
 */
export function truncateWithEllipsis(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "\u2026";
}

/**
 * Rich-text overflow guard: truncate total character count across spans.
 */
export function truncateRichText(spans: RichText, maxChars: number): RichText {
  let remaining = maxChars;
  const result: RichText = [];
  for (const span of spans) {
    if (remaining <= 0) break;
    if (span.text.length <= remaining) {
      result.push(span);
      remaining -= span.text.length;
    } else {
      result.push({ ...span, text: span.text.slice(0, remaining - 1) + "\u2026" });
      remaining = 0;
    }
  }
  return result.length > 0 ? result : [{ text: "" }];
}
