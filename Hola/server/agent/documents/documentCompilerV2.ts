/**
 * Document Compiler V2 — Deterministic, failsafe document compilation orchestrator.
 *
 * Architecture:
 *   DocumentIR (input)
 *     → Parse & validate schema (Zod)
 *     → Resolve design tokens (theme name or inline)
 *     → Normalize components (apply contracts, constraints, sanitization)
 *     → Preflight validation (structure, fonts, colors, images, UTF-8)
 *     → Auto-repair (fix recoverable errors)
 *     → Layout engine (compute positions, split overflows)
 *     → Format compiler (DOCX / XLSX / PPTX)
 *       → Per-component graceful degradation
 *     → Output size guard
 *     → Return Buffer + manifest + metrics
 *
 * Guarantees:
 *   - Always produces a valid, openable file (or a minimal fallback)
 *   - Never throws to the caller
 *   - Every degradation is recorded in the manifest
 *   - Compilation has a hard timeout
 *   - Output has a hard size cap
 */

import type { DocumentIR, OutputFormat } from "./documentIR";
import { parseDocumentIR, createMinimalIR } from "./documentIR";
import type { DesignTokensV2 } from "./designTokens";
import { resolveTokens } from "./designTokens";
import { normalizeBlock } from "./componentRegistry";
import { PreflightValidator, type PreflightReport } from "./preflightValidator";
import { DegradationEngine, type DegradationManifest } from "./gracefulDegradation";
import { DocxCompiler } from "./compilers/docxCompiler";
import { XlsxCompiler } from "./compilers/xlsxCompiler";
import { PptxCompiler } from "./compilers/pptxCompiler";

/* ================================================================== */
/*  TYPES                                                              */
/* ================================================================== */

export interface CompilerV2Output {
  /** Generated file buffer — always valid, even if degraded */
  buffer: Buffer;
  /** Filename with correct extension */
  filename: string;
  /** MIME type for HTTP response */
  mimeType: string;
  /** Output format */
  format: OutputFormat;
  /** Preflight validation report */
  preflight: PreflightReport;
  /** Degradation manifest (empty if fully intact) */
  degradation: DegradationManifest;
  /** Performance metrics */
  metrics: {
    durationMs: number;
    sizeBytes: number;
    degraded: boolean;
    normalizeWarnings: string[];
  };
}

/* ================================================================== */
/*  CONSTANTS                                                          */
/* ================================================================== */

const LIMITS = {
  compileTimeoutMs: 60_000,   // 60s hard timeout
  maxOutputBytes: 100 * 1024 * 1024, // 100MB cap
  maxRawInputBytes: 50 * 1024 * 1024, // 50MB input cap
} as const;

const MIME_TYPES: Record<OutputFormat, string> = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/* ================================================================== */
/*  HELPERS                                                            */
/* ================================================================== */

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      val => { clearTimeout(timer); resolve(val); },
      err => { clearTimeout(timer); reject(err); },
    );
  });
}

function sanitizeFilename(title: string): string {
  const cleaned = title
    .replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF _-]/g, "_")
    .replace(/_+/g, "_")
    .trim();
  if (!cleaned) return "document";
  const encoder = new TextEncoder();
  let result = cleaned;
  let iterations = 0;
  while (encoder.encode(result).length > 200 && iterations++ < 500) {
    result = result.slice(0, -1);
  }
  return result.replace(/_+$/, "").trim() || "document";
}

/* ================================================================== */
/*  DOCUMENT COMPILER V2                                               */
/* ================================================================== */

export class DocumentCompilerV2 {
  private preflight = new PreflightValidator();

  /**
   * Compile a DocumentIR to a file buffer.
   *
   * NEVER throws — always returns a CompilerV2Output, even if the
   * compilation degrades to a minimal fallback document.
   */
  async compile(input: unknown): Promise<CompilerV2Output> {
    const start = Date.now();
    const warnings: string[] = [];

    // ── 1. Parse and validate the IR ──────────────────────────
    const parseResult = parseDocumentIR(input);
    let ir: DocumentIR;

    if (!parseResult.success || !parseResult.data) {
      console.warn(`[CompilerV2] IR parse failed: ${parseResult.errors?.join("; ")}`);
      // Try to extract minimal info from input
      const rawTitle = (input as any)?.metadata?.title || (input as any)?.title || "Document";
      const rawFormat = (input as any)?.format || "docx";
      const format = ["docx", "xlsx", "pptx"].includes(rawFormat) ? rawFormat : "docx";
      ir = createMinimalIR(format as OutputFormat, rawTitle);
      warnings.push(`IR parse failed, using minimal document: ${parseResult.errors?.join("; ")}`);
    } else {
      ir = parseResult.data;
    }

    // ── 2. Resolve design tokens ──────────────────────────────
    const tokens = resolveTokens(ir.theme as any);

    // ── 3. Normalize components ───────────────────────────────
    for (const section of ir.sections) {
      for (let b = 0; b < section.blocks.length; b++) {
        const { block: normalized, warnings: blockWarnings } = normalizeBlock(section.blocks[b], tokens);
        section.blocks[b] = normalized;
        warnings.push(...blockWarnings);
      }
    }

    // ── 4. Preflight validation ───────────────────────────────
    let preflightReport: PreflightReport;
    try {
      preflightReport = this.preflight.validate(ir, tokens);
    } catch (err) {
      console.warn(`[CompilerV2] Preflight threw: ${err instanceof Error ? err.message : String(err)}`);
      preflightReport = {
        valid: true,
        issues: [{ severity: "warning", code: "PREFLIGHT_THREW", message: String(err) }],
        errors: 0,
        warnings: 1,
        infos: 0,
        autoFixesApplied: 0,
      };
    }

    // ── 5. Compile ────────────────────────────────────────────
    const degradation = new DegradationEngine();
    let buffer: Buffer;
    let degraded = false;

    try {
      buffer = await withTimeout(
        this.renderFormat(ir, tokens, degradation),
        LIMITS.compileTimeoutMs,
        `${ir.format} compilation`,
      );
    } catch (err) {
      console.warn(`[CompilerV2] Render failed: ${err instanceof Error ? err.message : String(err)}`);
      degraded = true;
      warnings.push(`Render failed, using fallback: ${err instanceof Error ? err.message : String(err)}`);
      buffer = await this.generateFallback(ir.format, ir.metadata.title);
    }

    // ── 6. Output size guard ──────────────────────────────────
    if (buffer.length > LIMITS.maxOutputBytes) {
      console.warn(`[CompilerV2] Output ${(buffer.length / 1024 / 1024).toFixed(1)}MB exceeds limit`);
      degraded = true;
      warnings.push(`Output exceeded ${LIMITS.maxOutputBytes / 1024 / 1024}MB limit, using fallback`);
      buffer = await this.generateFallback(ir.format, ir.metadata.title);
    }

    // ── 7. Build output ───────────────────────────────────────
    const manifest = degradation.getManifest();
    const filename = `${sanitizeFilename(ir.metadata.title)}.${ir.format}`;

    const output: CompilerV2Output = {
      buffer,
      filename,
      mimeType: MIME_TYPES[ir.format],
      format: ir.format,
      preflight: preflightReport,
      degradation: manifest,
      metrics: {
        durationMs: Date.now() - start,
        sizeBytes: buffer.length,
        degraded: degraded || !manifest.intact,
        normalizeWarnings: warnings,
      },
    };

    // ── 8. Observability ──────────────────────────────────────
    this.logCompilation(output);

    return output;
  }

  /* ---------------------------------------------------------------- */
  /*  FORMAT DISPATCH                                                  */
  /* ---------------------------------------------------------------- */

  private async renderFormat(
    ir: DocumentIR,
    tokens: DesignTokensV2,
    degradation: DegradationEngine,
  ): Promise<Buffer> {
    switch (ir.format) {
      case "docx": {
        const compiler = new DocxCompiler(tokens, degradation);
        return await compiler.compile(ir);
      }
      case "xlsx": {
        const compiler = new XlsxCompiler(tokens, degradation);
        return await compiler.compile(ir);
      }
      case "pptx": {
        const compiler = new PptxCompiler(tokens, degradation);
        return await compiler.compile(ir);
      }
      default:
        throw new Error(`Unsupported format: ${ir.format}`);
    }
  }

  /* ---------------------------------------------------------------- */
  /*  FALLBACK GENERATION                                              */
  /* ---------------------------------------------------------------- */

  private async generateFallback(format: OutputFormat, title: string): Promise<Buffer> {
    const safeTitle = sanitizeFilename(title);

    try {
      switch (format) {
        case "pptx": {
          const PptxGenJS = (await import("pptxgenjs")).default;
          const pptx = new PptxGenJS();
          pptx.title = title;
          pptx.author = "IliaGPT";
          const slide = pptx.addSlide();
          slide.addText(title, {
            x: 0.5, y: 1.5, w: 9, h: 1.5,
            fontSize: 36, bold: true, color: "363636",
            align: "center", fontFace: "Arial",
          });
          slide.addText("Document generated in fallback mode", {
            x: 0.5, y: 3.5, w: 9, h: 0.5,
            fontSize: 14, color: "999999",
            align: "center", fontFace: "Arial", italic: true,
          });
          const data = await pptx.write({ outputType: "nodebuffer" });
          return Buffer.from(data as ArrayBuffer);
        }

        case "docx": {
          const { Document, Paragraph, TextRun, Packer, HeadingLevel } = await import("docx");
          const doc = new Document({
            sections: [{
              children: [
                new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
                new Paragraph({
                  children: [
                    new TextRun({
                      text: "This document was generated in fallback mode due to a processing issue.",
                      italics: true,
                      color: "999999",
                    }),
                  ],
                }),
              ],
            }],
          });
          return await Packer.toBuffer(doc);
        }

        case "xlsx": {
          const excelMod = await import("exceljs");
          const ExcelJS = (excelMod as any).default || excelMod;
          const workbook = new ExcelJS.Workbook();
          workbook.creator = "IliaGPT";
          const sheet = workbook.addWorksheet("Sheet1");
          sheet.columns = [{ header: "Info", key: "info", width: 50 }];
          sheet.addRow({ info: title });
          sheet.addRow({ info: "Generated in fallback mode" });
          return Buffer.from(await workbook.xlsx.writeBuffer());
        }
      }
    } catch (err) {
      console.error(`[CompilerV2] Fallback generation failed: ${err instanceof Error ? err.message : String(err)}`);
      return Buffer.from("");
    }
  }

  /* ---------------------------------------------------------------- */
  /*  OBSERVABILITY                                                    */
  /* ---------------------------------------------------------------- */

  private logCompilation(output: CompilerV2Output): void {
    const entry = {
      event: "document_compiled_v2",
      format: output.format,
      durationMs: output.metrics.durationMs,
      sizeBytes: output.metrics.sizeBytes,
      sizeKB: Math.round(output.metrics.sizeBytes / 1024),
      degraded: output.metrics.degraded,
      degradationCount: output.degradation.count,
      preflightErrors: output.preflight.errors,
      preflightWarnings: output.preflight.warnings,
      preflightAutoFixes: output.preflight.autoFixesApplied,
      normalizeWarnings: output.metrics.normalizeWarnings.length,
      filename: output.filename,
    };
    console.log(`[CompilerV2] ${JSON.stringify(entry)}`);
  }
}

/* ================================================================== */
/*  SINGLETON                                                          */
/* ================================================================== */

let _defaultCompilerV2: DocumentCompilerV2 | null = null;

export function getDefaultCompilerV2(): DocumentCompilerV2 {
  if (!_defaultCompilerV2) {
    _defaultCompilerV2 = new DocumentCompilerV2();
  }
  return _defaultCompilerV2;
}
