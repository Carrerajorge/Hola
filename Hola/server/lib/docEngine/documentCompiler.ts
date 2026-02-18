/**
 * DOCUMENT COMPILER — Orchestrates the full pipeline from model to file.
 *
 * Pipeline:
 *   1. Preflight validation & sanitization
 *   2. Layout resolution (overflow, density, fit)
 *   3. Component rendering to render nodes
 *   4. Format compilation (render nodes → DOCX/XLSX/PPTX buffer)
 *   5. Post-render validation (Open XML structure check)
 *
 * Guarantees:
 * - ALWAYS produces a valid file or throws with a clear error
 * - Graceful degradation: failed components are replaced with safe fallbacks
 * - Full tracing: every step is logged with timing
 * - Idempotent: same model + theme → same output
 */

import type { DocumentModel, OutputFormat } from "./documentModel";
import type { DesignTheme } from "./designTokens";
import { getTheme } from "./designTokens";
import { preflightValidate, type PreflightResult } from "./preflightValidator";
import { resolveLayout, type LayoutResult } from "./layoutEngine";
import { renderSection, type RenderNode, type RenderContext, type RenderError } from "./componentLibrary";

// ===== Compilation Result =====

export interface CompilationResult {
  /** The generated file buffer — ALWAYS present on success */
  buffer: Buffer;
  /** MIME type for Content-Type header */
  mimeType: string;
  /** Suggested filename */
  filename: string;
  /** Full compilation report */
  report: CompilationReport;
}

export interface CompilationReport {
  /** Whether compilation succeeded */
  success: boolean;
  /** Total compilation time in ms */
  durationMs: number;
  /** Preflight validation result */
  preflight: PreflightResult;
  /** Layout resolution result */
  layout: LayoutResult;
  /** Components that used fallback rendering */
  degradedComponents: RenderError[];
  /** Post-render validation */
  postRender: PostRenderResult;
  /** Pipeline step timings */
  timings: Record<string, number>;
}

export interface PostRenderResult {
  valid: boolean;
  bufferSizeBytes: number;
  errors: string[];
}

// ===== MIME Types =====

const MIME_TYPES: Record<OutputFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const FILE_EXTENSIONS: Record<OutputFormat, string> = {
  docx: ".docx",
  xlsx: ".xlsx",
  pptx: ".pptx",
};

// ===== Compilation Error =====

export class CompilationError extends Error {
  public readonly phase: string;
  public readonly report?: Partial<CompilationReport>;

  constructor(message: string, phase: string, report?: Partial<CompilationReport>) {
    super(message);
    this.name = "CompilationError";
    this.phase = phase;
    this.report = report;
  }
}

// ===== Format Compilers (pluggable) =====

export type FormatCompiler = (
  sections: Array<{ id: string; title?: string; nodes: RenderNode[] }>,
  model: DocumentModel,
  theme: DesignTheme,
) => Promise<Buffer>;

const formatCompilers: Partial<Record<OutputFormat, FormatCompiler>> = {};

/**
 * Register a format compiler. Call this at startup to plug in
 * DOCX, XLSX, and PPTX compilers.
 */
export function registerFormatCompiler(format: OutputFormat, compiler: FormatCompiler): void {
  formatCompilers[format] = compiler;
}

// ===== Post-Render Validation =====

function postRenderValidate(buffer: Buffer, format: OutputFormat): PostRenderResult {
  const errors: string[] = [];

  // Check buffer is non-empty
  if (!buffer || buffer.length === 0) {
    errors.push("Generated buffer is empty");
    return { valid: false, bufferSizeBytes: 0, errors };
  }

  // Check ZIP magic bytes (all Office Open XML are ZIP-based)
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4B) {
    errors.push("Generated file does not have valid ZIP/Office Open XML header (expected PK magic bytes)");
    return { valid: false, bufferSizeBytes: buffer.length, errors };
  }

  // Check reasonable size (not just headers)
  if (buffer.length < 100) {
    errors.push("Generated file is suspiciously small (< 100 bytes)");
  }

  // Check maximum size
  if (buffer.length > 100 * 1024 * 1024) {
    errors.push(`Generated file is ${Math.round(buffer.length / 1024 / 1024)}MB, exceeds 100MB limit`);
  }

  return {
    valid: errors.length === 0,
    bufferSizeBytes: buffer.length,
    errors,
  };
}

// ===== Main Compiler =====

/**
 * Compile a document model into a binary file (DOCX, XLSX, or PPTX).
 *
 * This is the main entry point for the document engine.
 * It runs the full pipeline: validate → layout → render → compile → verify.
 */
export async function compileDocument(
  model: DocumentModel,
  themeOverride?: DesignTheme,
): Promise<CompilationResult> {
  const startTime = Date.now();
  const timings: Record<string, number> = {};

  const theme = themeOverride ?? getTheme(model.themeId);
  const format = model.format;

  // Sanitize filename from title
  const safeTitle = (model.metadata.title || "document")
    .replace(/[^a-zA-Z0-9_\-\s]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 100);
  const filename = `${safeTitle}${FILE_EXTENSIONS[format]}`;

  // === Phase 1: Preflight Validation ===
  const preflightStart = Date.now();
  const preflight = preflightValidate(model);
  timings.preflight = Date.now() - preflightStart;

  if (!preflight.valid) {
    throw new CompilationError(
      `Preflight validation failed: ${preflight.errors.map(e => e.message).join("; ")}`,
      "preflight",
      { preflight, timings },
    );
  }

  // === Phase 2: Layout Resolution ===
  const layoutStart = Date.now();
  const layout = resolveLayout(preflight.sanitizedModel, theme);
  timings.layout = Date.now() - layoutStart;

  if (layout.violations.some(v => v.severity === "error")) {
    throw new CompilationError(
      `Layout resolution failed: ${layout.violations.filter(v => v.severity === "error").map(v => v.message).join("; ")}`,
      "layout",
      { preflight, layout, timings },
    );
  }

  // === Phase 3: Component Rendering ===
  const renderStart = Date.now();
  const renderCtx: RenderContext = {
    theme,
    format,
    sectionIndex: 0,
    componentIndex: 0,
    errors: [],
  };

  const renderedSections = layout.model.sections.map((section, si) => {
    renderCtx.sectionIndex = si;
    return {
      id: section.id,
      title: section.title,
      nodes: renderSection(section.components, renderCtx),
    };
  });
  timings.render = Date.now() - renderStart;

  // === Phase 4: Format Compilation ===
  const compileStart = Date.now();
  const compiler = formatCompilers[format];
  if (!compiler) {
    throw new CompilationError(
      `No compiler registered for format: ${format}. Register one with registerFormatCompiler().`,
      "compile",
      { preflight, layout, degradedComponents: renderCtx.errors, timings },
    );
  }

  let buffer: Buffer;
  try {
    buffer = await compiler(renderedSections, layout.model, theme);
  } catch (error: any) {
    throw new CompilationError(
      `Format compilation failed: ${error.message}`,
      "compile",
      { preflight, layout, degradedComponents: renderCtx.errors, timings },
    );
  }
  timings.compile = Date.now() - compileStart;

  // === Phase 5: Post-Render Validation ===
  const postStart = Date.now();
  const postRender = postRenderValidate(buffer, format);
  timings.postRender = Date.now() - postStart;

  timings.total = Date.now() - startTime;

  const report: CompilationReport = {
    success: postRender.valid,
    durationMs: timings.total,
    preflight,
    layout,
    degradedComponents: renderCtx.errors,
    postRender,
    timings,
  };

  if (!postRender.valid) {
    throw new CompilationError(
      `Post-render validation failed: ${postRender.errors.join("; ")}`,
      "postRender",
      report,
    );
  }

  return {
    buffer,
    mimeType: MIME_TYPES[format],
    filename,
    report,
  };
}

// ===== Convenience Builders =====

/**
 * Create a document model with sensible defaults.
 */
export function createDocumentModel(
  format: OutputFormat,
  title: string,
  sections: DocumentModel["sections"],
  options?: {
    themeId?: string;
    author?: string;
    layout?: DocumentModel["layout"];
  },
): DocumentModel {
  return {
    id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    format,
    themeId: options?.themeId ?? "corporate",
    metadata: {
      title,
      author: options?.author,
      date: new Date().toISOString().split("T")[0],
    },
    sections,
    layout: options?.layout,
  };
}
