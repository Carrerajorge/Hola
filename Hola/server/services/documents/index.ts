/**
 * Unified Document Compilation Pipeline
 *
 * Usage:
 *   import { compileDocument } from "./services/documents";
 *
 *   const result = await compileDocument(irData);
 *   if (result.success) {
 *     res.setHeader("Content-Type", result.mimeType);
 *     res.send(result.buffer);
 *   }
 *
 * The pipeline:
 *   1. Parse & validate the IR (Zod schema).
 *   2. Resolve design tokens from themeId + overrides.
 *   3. Run preflight checks (limits, sanitization, encoding).
 *   4. Route to the correct compiler (Word / Excel / PPTX).
 *   5. Return CompilationResult with buffer + diagnostics.
 */
import { DocumentIR, CompilationResult, CompilationDiagnostic } from "@shared/documentIR";
import { resolveDesignTokens, DesignTokenSet } from "@shared/documentDesignTokens";
import { preflightValidate, PreflightResult } from "./preflightValidator";
import { compileWord } from "./wordCompiler";
import { compileExcel } from "./excelCompiler";
import { compilePptx } from "./pptxCompiler";
import { createLogger } from "../../utils/logger";

const logger = createLogger("document-compiler");

// ─── Format Detection ──────────────────────────────────────────────

function detectFormat(ir: DocumentIR): "docx" | "xlsx" | "pptx" {
  if (ir.format !== "auto") return ir.format as "docx" | "xlsx" | "pptx";

  // Heuristic: if all sections contain a single table node → likely Excel
  const allTables = ir.sections.every(
    (s) => s.nodes.length === 1 && s.nodes[0].type === "table",
  );
  if (allTables) return "xlsx";

  // Heuristic: if sections have layout hints (title/section/two-column) → PPTX
  const hasSlideLayouts = ir.sections.some(
    (s) => s.layout && s.layout !== "default",
  );
  if (hasSlideLayouts) return "pptx";

  // Default to Word
  return "docx";
}

// ─── Public API ─────────────────────────────────────────────────────

export interface CompileOptions {
  /** Override the format detected from the IR */
  format?: "docx" | "xlsx" | "pptx";
  /** Override theme id */
  themeId?: string;
  /** Partial design-token overrides */
  themeOverrides?: Partial<DesignTokenSet>;
  /** Skip preflight validation (not recommended) */
  skipPreflight?: boolean;
}

export async function compileDocument(
  rawIR: unknown,
  options?: CompileOptions,
): Promise<CompilationResult> {
  const allDiagnostics: CompilationDiagnostic[] = [];
  const start = Date.now();

  // 1. Resolve tokens
  const tokens = resolveDesignTokens(
    options?.themeId,
    options?.themeOverrides as any,
  );

  // 2. Preflight validate
  let ir: DocumentIR;
  if (options?.skipPreflight) {
    // Trust the caller (used internally after manual validation)
    ir = rawIR as DocumentIR;
  } else {
    const preflight: PreflightResult = preflightValidate(rawIR, tokens);
    allDiagnostics.push(...preflight.diagnostics);
    ir = preflight.ir;

    if (preflight.hasFatalErrors) {
      logger.warn("Preflight found fatal errors; attempting degraded compilation", {
        errors: preflight.diagnostics.filter((d) => d.severity === "error").length,
      });
    }
  }

  // Override theme from IR if not explicitly set
  const effectiveTokens = resolveDesignTokens(
    options?.themeId || ir.themeId,
    options?.themeOverrides as any ?? ir.themeOverrides as any,
  );

  // 3. Detect format
  const format = options?.format || detectFormat(ir);

  logger.info("Compiling document", {
    format,
    theme: effectiveTokens.id,
    sections: ir.sections.length,
    nodeCount: ir.sections.reduce((acc, s) => acc + s.nodes.length, 0),
  });

  // 4. Compile
  let result: CompilationResult;
  switch (format) {
    case "docx":
      result = await compileWord(ir, effectiveTokens);
      break;
    case "xlsx":
      result = await compileExcel(ir, effectiveTokens);
      break;
    case "pptx":
      result = await compilePptx(ir, effectiveTokens);
      break;
    default:
      result = {
        success: false,
        buffer: null,
        mimeType: "application/octet-stream",
        filename: "error",
        sizeBytes: 0,
        diagnostics: [{ severity: "error", code: "UNKNOWN_FORMAT", message: `Unknown format: ${format}` }],
        durationMs: Date.now() - start,
        themeId: effectiveTokens.id,
      };
  }

  // Merge preflight diagnostics
  result.diagnostics = [...allDiagnostics, ...result.diagnostics];

  logger.info("Document compilation complete", {
    success: result.success,
    format,
    sizeBytes: result.sizeBytes,
    durationMs: result.durationMs,
    warnings: result.diagnostics.filter((d) => d.severity === "warning").length,
    errors: result.diagnostics.filter((d) => d.severity === "error").length,
  });

  return result;
}

// Re-export for direct access
export { compileWord } from "./wordCompiler";
export { compileExcel } from "./excelCompiler";
export { compilePptx } from "./pptxCompiler";
export { preflightValidate } from "./preflightValidator";
export { resolveDesignTokens } from "@shared/documentDesignTokens";
export type { DocumentIR, CompilationResult, CompilationDiagnostic } from "@shared/documentIR";
export type { DesignTokenSet } from "@shared/documentDesignTokens";
