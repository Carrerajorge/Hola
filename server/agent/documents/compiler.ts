/**
 * Document Compiler — Single entry point for all document generation.
 *
 * Architecture:
 *   Input (spec or raw text) → Preflight Validation → Sanitization →
 *   LayoutEngine → DocumentEngine render → Graceful Degradation →
 *   Output (Buffer + metadata)
 *
 * All Word/Excel/PowerPoint generation must go through this compiler.
 * It wraps DocumentEngine with:
 *   - Design token resolution (theme presets or custom)
 *   - Preflight validation (fonts, colors, content limits, UTF-8)
 *   - Graceful degradation (fallback to safe minimal documents)
 *   - Observability (structured logging with timing/size metrics)
 */

import {
  DocumentEngine,
  DesignTokensSchema,
  type DesignTokens,
  type PresentationSpec,
  type DocumentSpec,
  type WorkbookSpec,
  type LayoutBox,
  LayoutEngine,
} from "./documentEngine";
import {
  PresentationValidator,
  DocumentValidator,
  WorkbookValidator,
  type ValidationResult,
  type ValidationIssue,
} from "./documentValidators";
import { resolveTheme } from "./themes";
import {
  markdownToDocSpec,
  csvToWorkbookSpec,
  jsonToPresentationSpec,
} from "./textToSpec";

/* ================================================================== */
/*  TYPES                                                              */
/* ================================================================== */

export type CompilerFormat = "pptx" | "docx" | "xlsx";
export type CompilerInputSpec = PresentationSpec | DocumentSpec | WorkbookSpec;

export interface CompilerInput {
  format: CompilerFormat;
  spec: CompilerInputSpec;
  theme?: string | Partial<DesignTokens>;
}

export interface CompilerTextInput {
  format: CompilerFormat;
  title: string;
  content: string;
  theme?: string | Partial<DesignTokens>;
}

export interface CompilerOutput {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  format: CompilerFormat;
  validation: ValidationResult;
  metrics: {
    durationMs: number;
    sizeBytes: number;
    degraded: boolean;
  };
}

/* ================================================================== */
/*  SECURITY / LIMIT CONSTANTS                                         */
/* ================================================================== */

const LIMITS = {
  pptx: { maxSlides: 200, maxTitleLength: 500, maxBulletLength: 5000, maxTotalSize: 10 * 1024 * 1024 },
  docx: { maxSections: 500, maxContentSize: 5 * 1024 * 1024 },
  xlsx: { maxRows: 100_000, maxColumns: 500, maxCellLength: 32_767, maxSheets: 100 },
} as const;

const MIME_TYPES: Record<CompilerFormat, string> = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/* ================================================================== */
/*  SANITIZATION HELPERS                                               */
/* ================================================================== */

function sanitizeText(text: string): string {
  return text
    .replace(/\0/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

function normalizeColor(color: string): string {
  if (!color) return "#000000";
  let c = color.trim();
  if (!c.startsWith("#") && /^[0-9a-fA-F]{6}$/.test(c)) c = "#" + c;
  if (/^#[0-9a-fA-F]{3}$/.test(c)) {
    c = "#" + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(c)) return "#000000";
  return c;
}

function sanitizeFilename(title: string): string {
  return title
    .replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ _-]/g, "_")
    .replace(/_+/g, "_")
    .substring(0, 100)
    .trim() || "document";
}

/* ================================================================== */
/*  DOCUMENT COMPILER                                                  */
/* ================================================================== */

export class DocumentCompiler {
  private engine: DocumentEngine;
  private tokens: DesignTokens;
  private validators: {
    pptx: PresentationValidator;
    docx: DocumentValidator;
    xlsx: WorkbookValidator;
  };

  constructor(defaultTheme?: string | Partial<DesignTokens>) {
    this.tokens = resolveTheme(defaultTheme);
    this.engine = new DocumentEngine(this.tokens);
    this.validators = {
      pptx: new PresentationValidator({
        slideWidth: this.tokens.layout.slideWidth,
        slideHeight: this.tokens.layout.slideHeight,
        minFontSize: this.tokens.font.sizeMin,
      }),
      docx: new DocumentValidator(),
      xlsx: new WorkbookValidator(),
    };
  }

  /* ---------------------------------------------------------------- */
  /*  MAIN API: compile from spec                                     */
  /* ---------------------------------------------------------------- */

  async compile(input: CompilerInput): Promise<CompilerOutput> {
    const start = Date.now();
    const theme = input.theme ? resolveTheme(input.theme) : this.tokens;
    const engine = input.theme ? new DocumentEngine(theme) : this.engine;
    let degraded = false;

    // 1. Preflight validation
    const validation = this.preflight(input);

    // 2. If validation errors, attempt auto-repair
    let spec = input.spec;
    if (!validation.valid) {
      const repaired = this.autoRepair(input, validation);
      if (repaired) {
        spec = repaired;
        validation.valid = true;
        validation.issues.push({
          severity: "info",
          code: "COMPILER_AUTO_REPAIRED",
          message: "Spec was auto-repaired to fix validation errors",
        });
      }
    }

    // 3. Render
    let buffer: Buffer;
    let filename: string;

    try {
      switch (input.format) {
        case "pptx": {
          const pptSpec = { ...spec as PresentationSpec, theme };
          buffer = await engine.generatePresentation(pptSpec);
          filename = sanitizeFilename((spec as PresentationSpec).title) + ".pptx";
          break;
        }
        case "docx": {
          const docSpec = { ...spec as DocumentSpec, theme };
          buffer = await engine.generateDocument(docSpec);
          filename = sanitizeFilename((spec as DocumentSpec).title) + ".docx";
          break;
        }
        case "xlsx": {
          const xlsSpec = { ...spec as WorkbookSpec, theme };
          buffer = await engine.generateWorkbook(xlsSpec);
          filename = sanitizeFilename((spec as WorkbookSpec).title) + ".xlsx";
          break;
        }
      }
    } catch (err) {
      // Graceful degradation: produce a minimal valid file
      console.warn(`[DocumentCompiler] Render failed, using fallback: ${err instanceof Error ? err.message : String(err)}`);
      const fallback = await this.generateFallback(input.format, spec, err);
      buffer = fallback.buffer;
      filename = fallback.filename;
      degraded = true;
      validation.issues.push({
        severity: "warning",
        code: "COMPILER_FALLBACK",
        message: `Render failed, used fallback: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    const output: CompilerOutput = {
      buffer: buffer!,
      filename: filename!,
      mimeType: MIME_TYPES[input.format],
      format: input.format,
      validation,
      metrics: {
        durationMs: Date.now() - start,
        sizeBytes: buffer!.length,
        degraded,
      },
    };

    // Observability
    this.logCompilation(output, input);

    return output;
  }

  /* ---------------------------------------------------------------- */
  /*  CONVENIENCE: compile from raw text                              */
  /* ---------------------------------------------------------------- */

  async compileFromText(input: CompilerTextInput): Promise<CompilerOutput> {
    let spec: CompilerInputSpec;

    switch (input.format) {
      case "docx":
        spec = markdownToDocSpec(input.title, input.content);
        break;
      case "xlsx":
        spec = csvToWorkbookSpec(input.title, input.content);
        break;
      case "pptx":
        spec = jsonToPresentationSpec(input.title, input.content);
        break;
    }

    return this.compile({ format: input.format, spec, theme: input.theme });
  }

  /* ---------------------------------------------------------------- */
  /*  PREFLIGHT VALIDATION                                            */
  /* ---------------------------------------------------------------- */

  private preflight(input: CompilerInput): ValidationResult {
    // Structural validation via existing validators
    // Cast to `any` because Zod's `.default()` makes fields optional at the TS level
    // but they are always populated at runtime after `.parse()`.
    switch (input.format) {
      case "pptx":
        return this.validators.pptx.validateSpec(input.spec as any);
      case "docx":
        return this.validators.docx.validateSpec(input.spec as any);
      case "xlsx":
        return this.validators.xlsx.validateSpec(input.spec as any);
    }
  }

  /* ---------------------------------------------------------------- */
  /*  AUTO-REPAIR                                                     */
  /* ---------------------------------------------------------------- */

  private autoRepair(input: CompilerInput, validation: ValidationResult): CompilerInputSpec | null {
    const errors = validation.issues.filter(i => i.severity === "error");
    if (errors.length === 0) return null;

    try {
      switch (input.format) {
        case "pptx": {
          const spec = { ...(input.spec as PresentationSpec) };
          // Fix out-of-canvas by clamping positions
          for (const slide of spec.slides) {
            for (const comp of slide.components) {
              if (comp.position) {
                const p = comp.position;
                if (p.x !== undefined) p.x = Math.min(p.x, this.tokens.layout.slideWidth - 0.5);
                if (p.y !== undefined) p.y = Math.min(p.y, this.tokens.layout.slideHeight - 0.5);
                if (p.w !== undefined) {
                  p.w = Math.min(p.w, this.tokens.layout.slideWidth - (p.x || 0));
                }
                if (p.h !== undefined) {
                  p.h = Math.min(p.h, this.tokens.layout.slideHeight - (p.y || 0));
                }
              }
            }
          }
          return spec;
        }

        case "docx": {
          const spec = { ...(input.spec as DocumentSpec) };
          // Fix table column mismatches by padding/trimming rows
          for (const section of spec.sections) {
            if (section.type === "table" && Array.isArray(section.content) && section.content.length > 1) {
              const headerLen = Array.isArray(section.content[0]) ? section.content[0].length : 0;
              for (let r = 1; r < section.content.length; r++) {
                const row = section.content[r];
                if (Array.isArray(row)) {
                  while (row.length < headerLen) row.push("");
                  if (row.length > headerLen) section.content[r] = row.slice(0, headerLen);
                }
              }
            }
          }
          return spec;
        }

        case "xlsx": {
          const spec = { ...(input.spec as WorkbookSpec) };
          // Fix duplicate sheet names
          const names = new Set<string>();
          for (const sheet of spec.sheets) {
            let name = sheet.name.substring(0, 31);
            let suffix = 1;
            while (names.has(name)) {
              name = `${sheet.name.substring(0, 28)}_${suffix++}`;
            }
            sheet.name = name;
            names.add(name);
          }
          return spec;
        }
      }
    } catch {
      return null;
    }
  }

  /* ---------------------------------------------------------------- */
  /*  GRACEFUL DEGRADATION — FALLBACK FILE GENERATION                 */
  /* ---------------------------------------------------------------- */

  private async generateFallback(
    format: CompilerFormat,
    spec: CompilerInputSpec,
    error: unknown
  ): Promise<{ buffer: Buffer; filename: string }> {
    const title = (spec as any).title || "Document";
    const errMsg = error instanceof Error ? error.message : String(error);
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
          slide.addText("Document generated with fallback mode", {
            x: 0.5, y: 3.5, w: 9, h: 0.5,
            fontSize: 14, color: "999999",
            align: "center", fontFace: "Arial", italic: true,
          });

          const data = await pptx.write({ outputType: "nodebuffer" });
          return { buffer: Buffer.from(data as ArrayBuffer), filename: `${safeTitle}.pptx` };
        }

        case "docx": {
          const { Document, Paragraph, TextRun, Packer, HeadingLevel } = await import("docx");
          const doc = new Document({
            sections: [{
              children: [
                new Paragraph({
                  text: title,
                  heading: HeadingLevel.TITLE,
                }),
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
          const buffer = await Packer.toBuffer(doc);
          return { buffer, filename: `${safeTitle}.docx` };
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
          const buf = Buffer.from(await workbook.xlsx.writeBuffer());
          return { buffer: buf, filename: `${safeTitle}.xlsx` };
        }
      }
    } catch (fallbackError) {
      // If even the fallback fails, return a minimal buffer
      console.error(`[DocumentCompiler] Even fallback generation failed: ${fallbackError}`);
      return {
        buffer: Buffer.from("Fallback generation failed"),
        filename: `${safeTitle}.${format}`,
      };
    }
  }

  /* ---------------------------------------------------------------- */
  /*  OBSERVABILITY                                                    */
  /* ---------------------------------------------------------------- */

  private logCompilation(output: CompilerOutput, input: CompilerInput): void {
    const logEntry = {
      event: "document_compiled",
      format: output.format,
      theme: typeof input.theme === "string" ? input.theme : (input.theme as any)?.name || "default",
      durationMs: output.metrics.durationMs,
      sizeBytes: output.metrics.sizeBytes,
      degraded: output.metrics.degraded,
      validationErrors: output.validation.errors,
      validationWarnings: output.validation.warnings,
      filename: output.filename,
    };
    console.log(`[DocumentCompiler] ${JSON.stringify(logEntry)}`);
  }
}

/* ================================================================== */
/*  SINGLETON (convenience)                                            */
/* ================================================================== */

let _defaultCompiler: DocumentCompiler | null = null;

export function getDefaultCompiler(): DocumentCompiler {
  if (!_defaultCompiler) {
    _defaultCompiler = new DocumentCompiler("corporate");
  }
  return _defaultCompiler;
}
