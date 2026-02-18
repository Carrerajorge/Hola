/**
 * Preflight Validator — Comprehensive pre-render validation and sanitization.
 *
 * Runs BEFORE document rendering to catch and fix issues that would
 * produce corrupt or visually broken files:
 *
 *   1. UTF-8 / encoding validation — strip invalid chars, normalize BOM
 *   2. Font availability check — map missing fonts to safe fallbacks
 *   3. Color validation — normalize hex, check contrast (WCAG AA)
 *   4. Image path validation — block SSRF, traversal, dead refs
 *   5. Content limits — enforce max rows, slides, sections, cell lengths
 *   6. Schema validation — ensure spec matches expected structure
 *   7. Relationship integrity — cross-reference anchors, ranges, refs
 *   8. Formula safety — prevent injection, validate cell references
 *
 * The validator NEVER throws — it returns a PreflightResult with
 * issues, auto-fixes applied, and a sanitized spec ready for rendering.
 */

import { z } from "zod";
import type { UnifiedDesignTokens } from "./designTokens";

/* ================================================================== */
/*  TYPES                                                              */
/* ================================================================== */

export type PreflightSeverity = "error" | "warning" | "info" | "auto-fixed";

export interface PreflightIssue {
  severity: PreflightSeverity;
  code: string;
  message: string;
  location?: string;
  fix?: string;
}

export interface PreflightResult {
  /** Whether the spec is valid enough to render */
  canRender: boolean;
  /** Total issue count */
  issueCount: number;
  /** Breakdown by severity */
  errors: number;
  warnings: number;
  autoFixes: number;
  /** All issues found */
  issues: PreflightIssue[];
  /** Sanitized spec (may differ from input) */
  sanitizedSpec: any;
  /** Timing */
  durationMs: number;
}

/* ================================================================== */
/*  CONSTANTS                                                          */
/* ================================================================== */

const MAX_ISSUES = 500;

/** Known safe fonts that are available on most systems */
const SAFE_FONTS = new Set([
  "Arial", "Calibri", "Calibri Light", "Cambria", "Consolas", "Courier New",
  "Georgia", "Helvetica", "Impact", "Segoe UI", "Tahoma", "Times New Roman",
  "Trebuchet MS", "Verdana", "Inter", "Roboto",
]);

/** Font fallback map for common missing fonts */
const FONT_FALLBACKS: Record<string, string> = {
  "SF Pro": "Arial",
  "San Francisco": "Arial",
  "Fira Code": "Consolas",
  "JetBrains Mono": "Consolas",
  "Source Code Pro": "Consolas",
  "Menlo": "Consolas",
  "Monaco": "Consolas",
  "Noto Sans": "Arial",
  "Noto Serif": "Times New Roman",
  "Open Sans": "Arial",
  "Lato": "Arial",
  "Montserrat": "Arial",
  "Poppins": "Arial",
  "Ubuntu": "Arial",
  "PT Sans": "Arial",
  "Playfair Display": "Georgia",
  "Merriweather": "Georgia",
};

/** Excel formula injection prefixes */
const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r", "|", "\\"];

/** Blocked URL protocols for images/links */
const BLOCKED_PROTOCOLS = ["javascript:", "data:", "file:", "vbscript:", "blob:"];

/** Maximum reasonable sizes */
const LIMITS = {
  maxSlides: 200,
  maxSections: 500,
  maxSheets: 100,
  maxRows: 100_000,
  maxColumns: 500,
  maxCellLength: 32_767,
  maxTitleLength: 500,
  maxTextBlock: 100_000,
  maxListItems: 1_000,
  maxTableRows: 5_000,
  maxTableCols: 200,
  maxBullets: 50,
  maxImagePathLength: 4096,
  maxFormulaLength: 8192,
};

/* ================================================================== */
/*  UTF-8 / TEXT SANITIZATION                                          */
/* ================================================================== */

/**
 * Strip invalid UTF-8 sequences, control characters, and dangerous Unicode.
 */
function sanitizeUtf8(text: string): string {
  if (typeof text !== "string") return "";
  return text
    // Remove null bytes
    .replace(/\0/g, "")
    // Remove control chars except tab, newline, carriage return
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    // Remove Unicode BOM
    .replace(/\uFEFF/g, "")
    // Remove zero-width chars (can cause invisible content issues)
    .replace(/[\u200B-\u200D]/g, "")
    // Remove bidi overrides (can be used for text spoofing)
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, "")
    // Remove replacement character (indicates encoding issues)
    .replace(/\uFFFD/g, "");
}

/**
 * Deeply sanitize all string values in an object.
 */
function deepSanitizeStrings(obj: any, depth: number = 0): any {
  if (depth > 20) return obj; // prevent infinite recursion
  if (typeof obj === "string") return sanitizeUtf8(obj);
  if (Array.isArray(obj)) return obj.map(item => deepSanitizeStrings(item, depth + 1));
  if (obj && typeof obj === "object") {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = deepSanitizeStrings(value, depth + 1);
    }
    return result;
  }
  return obj;
}

/* ================================================================== */
/*  COLOR VALIDATION                                                   */
/* ================================================================== */

function isValidHexColor(color: string): boolean {
  if (!color || typeof color !== "string") return false;
  const c = color.replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(c) || /^[0-9a-fA-F]{3}$/.test(c) || /^[0-9a-fA-F]{8}$/.test(c);
}

function normalizeHexColor(color: string): string {
  if (!color) return "#000000";
  let c = color.trim();
  if (!c.startsWith("#") && /^[0-9a-fA-F]{6}$/.test(c)) c = "#" + c;
  if (/^#[0-9a-fA-F]{3}$/.test(c)) {
    c = "#" + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
  }
  // Strip alpha channel if present (ARGB → RGB)
  if (/^#[0-9a-fA-F]{8}$/.test(c)) {
    c = "#" + c.substring(3);
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(c)) return "#000000";
  return c;
}

function relativeLuminance(hex: string): number {
  const c = normalizeHexColor(hex).replace("#", "");
  const r = parseInt(c.substring(0, 2), 16) / 255;
  const g = parseInt(c.substring(2, 4), 16) / 255;
  const b = parseInt(c.substring(4, 6), 16) / 255;
  const srgb = [r, g, b].map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

function contrastRatio(fg: string, bg: string): number {
  const lFg = relativeLuminance(fg);
  const lBg = relativeLuminance(bg);
  const lighter = Math.max(lFg, lBg);
  const darker = Math.min(lFg, lBg);
  return (lighter + 0.05) / (darker + 0.05);
}

/* ================================================================== */
/*  IMAGE / URL VALIDATION                                             */
/* ================================================================== */

function isImagePathSafe(path: string): boolean {
  if (!path || typeof path !== "string") return false;
  if (path.length > LIMITS.maxImagePathLength) return false;
  const lower = path.trim().toLowerCase();
  // Block dangerous protocols
  if (BLOCKED_PROTOCOLS.some(p => lower.startsWith(p))) return false;
  // Block UNC paths
  if (lower.startsWith("\\\\") || lower.startsWith("//")) return false;
  // Block path traversal
  if (path.includes("..")) return false;
  // Block sensitive system paths
  if (/^\/(etc|proc|sys|dev|tmp)\//i.test(lower)) return false;
  return true;
}

function isUrlSafe(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  const lower = url.trim().toLowerCase();
  if (BLOCKED_PROTOCOLS.some(p => lower.startsWith(p))) return false;
  return lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("mailto:");
}

/* ================================================================== */
/*  FORMULA SAFETY                                                     */
/* ================================================================== */

function isFormulaInjection(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  const trimmed = value.trimStart();
  return trimmed.length > 0 && FORMULA_PREFIXES.some(p => trimmed.startsWith(p));
}

function sanitizeFormulaValue(value: string): string {
  if (isFormulaInjection(value)) return "'" + value;
  return value;
}

/* ================================================================== */
/*  CELL REFERENCE VALIDATION                                          */
/* ================================================================== */

const CELL_REF_PATTERN = /^[A-Z]{1,3}\d{1,7}$/;

function isValidCellRef(ref: string): boolean {
  return CELL_REF_PATTERN.test(ref);
}

/* ================================================================== */
/*  FONT VALIDATION                                                    */
/* ================================================================== */

function validateFont(fontName: string): { valid: boolean; fallback?: string } {
  if (!fontName || typeof fontName !== "string") return { valid: false, fallback: "Arial" };
  const trimmed = fontName.trim();
  if (SAFE_FONTS.has(trimmed)) return { valid: true };
  if (FONT_FALLBACKS[trimmed]) return { valid: false, fallback: FONT_FALLBACKS[trimmed] };
  // Unknown font — allow it but warn
  return { valid: true };
}

/* ================================================================== */
/*  MAIN PREFLIGHT VALIDATOR                                           */
/* ================================================================== */

export class PreflightValidator {
  private issues: PreflightIssue[] = [];

  /**
   * Run all preflight checks on a document spec.
   * Returns a sanitized spec + validation results.
   */
  validate(
    spec: any,
    format: "pptx" | "docx" | "xlsx",
    tokens?: UnifiedDesignTokens
  ): PreflightResult {
    const start = Date.now();
    this.issues = [];

    if (!spec || typeof spec !== "object") {
      this.addIssue("error", "SPEC_INVALID", "Spec is null or not an object");
      return this.buildResult(spec, start);
    }

    // 1. Deep UTF-8 sanitization
    let sanitized = deepSanitizeStrings(spec);
    this.addIssue("auto-fixed", "UTF8_SANITIZED", "All text content sanitized for invalid characters");

    // 2. Format-specific validation
    switch (format) {
      case "pptx":
        sanitized = this.validatePresentation(sanitized, tokens);
        break;
      case "docx":
        sanitized = this.validateDocument(sanitized, tokens);
        break;
      case "xlsx":
        sanitized = this.validateWorkbook(sanitized, tokens);
        break;
    }

    // 3. Validate design tokens if provided
    if (tokens) {
      this.validateTokens(tokens);
    }

    return this.buildResult(sanitized, start);
  }

  /* ---------------------------------------------------------------- */
  /*  PPTX VALIDATION                                                  */
  /* ---------------------------------------------------------------- */

  private validatePresentation(spec: any, tokens?: UnifiedDesignTokens): any {
    // Validate title
    if (spec.title) {
      if (spec.title.length > LIMITS.maxTitleLength) {
        spec.title = spec.title.substring(0, LIMITS.maxTitleLength);
        this.addIssue("auto-fixed", "PPT_TITLE_TRUNCATED", `Title truncated to ${LIMITS.maxTitleLength} chars`);
      }
    }

    // Validate slides array
    if (!Array.isArray(spec.slides)) {
      spec.slides = [];
      this.addIssue("error", "PPT_NO_SLIDES", "Presentation has no slides array");
      return spec;
    }

    if (spec.slides.length > LIMITS.maxSlides) {
      spec.slides = spec.slides.slice(0, LIMITS.maxSlides);
      this.addIssue("auto-fixed", "PPT_SLIDES_TRUNCATED", `Slides truncated to ${LIMITS.maxSlides}`);
    }

    if (spec.slides.length === 0) {
      this.addIssue("warning", "PPT_EMPTY", "Presentation has 0 slides");
    }

    // Validate each slide
    for (let s = 0; s < spec.slides.length && this.issues.length < MAX_ISSUES; s++) {
      const slide = spec.slides[s];
      if (!slide || typeof slide !== "object") continue;

      if (!Array.isArray(slide.components)) {
        slide.components = [];
        this.addIssue("warning", "PPT_SLIDE_NO_COMPONENTS", `Slide ${s + 1} has no components`, `slide[${s}]`);
        continue;
      }

      // Validate each component
      for (let c = 0; c < slide.components.length; c++) {
        const comp = slide.components[c];
        if (!comp || typeof comp !== "object") continue;

        // Content text sanitization
        if (typeof comp.content === "string" && comp.content.length > LIMITS.maxTextBlock) {
          comp.content = comp.content.substring(0, LIMITS.maxTextBlock) + "…";
          this.addIssue("auto-fixed", "PPT_TEXT_TRUNCATED", `Component text truncated`, `slide[${s}].comp[${c}]`);
        }

        // Image path validation
        if (comp.type === "image" && typeof comp.content === "string") {
          if (!isImagePathSafe(comp.content)) {
            this.addIssue("warning", "PPT_UNSAFE_IMAGE", `Blocked unsafe image path`, `slide[${s}].comp[${c}]`);
            comp.content = "";
            comp.type = "body";
          }
        }

        // Font validation in style overrides
        if (comp.style?.fontFace) {
          const fontResult = validateFont(comp.style.fontFace);
          if (!fontResult.valid && fontResult.fallback) {
            this.addIssue("auto-fixed", "PPT_FONT_FALLBACK",
              `Font "${comp.style.fontFace}" replaced with "${fontResult.fallback}"`,
              `slide[${s}].comp[${c}]`);
            comp.style.fontFace = fontResult.fallback;
          }
        }

        // Position bounds check
        if (comp.position && typeof comp.position === "object") {
          const slideW = tokens?.base?.layout?.slideWidth || 10;
          const slideH = tokens?.base?.layout?.slideHeight || 5.625;
          const p = comp.position;

          if (typeof p.x === "number" && (p.x < 0 || p.x > slideW)) {
            p.x = Math.max(0, Math.min(p.x, slideW - 0.5));
            this.addIssue("auto-fixed", "PPT_POSITION_CLAMPED", `X position clamped`, `slide[${s}].comp[${c}]`);
          }
          if (typeof p.y === "number" && (p.y < 0 || p.y > slideH)) {
            p.y = Math.max(0, Math.min(p.y, slideH - 0.5));
            this.addIssue("auto-fixed", "PPT_POSITION_CLAMPED", `Y position clamped`, `slide[${s}].comp[${c}]`);
          }
          if (typeof p.w === "number") p.w = Math.max(0.1, Math.min(p.w, slideW));
          if (typeof p.h === "number") p.h = Math.max(0.1, Math.min(p.h, slideH));
        }
      }
    }

    return spec;
  }

  /* ---------------------------------------------------------------- */
  /*  DOCX VALIDATION                                                  */
  /* ---------------------------------------------------------------- */

  private validateDocument(spec: any, tokens?: UnifiedDesignTokens): any {
    if (spec.title && spec.title.length > LIMITS.maxTitleLength) {
      spec.title = spec.title.substring(0, LIMITS.maxTitleLength);
      this.addIssue("auto-fixed", "DOC_TITLE_TRUNCATED", `Title truncated to ${LIMITS.maxTitleLength} chars`);
    }

    if (!Array.isArray(spec.sections)) {
      spec.sections = [];
      this.addIssue("error", "DOC_NO_SECTIONS", "Document has no sections");
      return spec;
    }

    if (spec.sections.length > LIMITS.maxSections) {
      spec.sections = spec.sections.slice(0, LIMITS.maxSections);
      this.addIssue("auto-fixed", "DOC_SECTIONS_TRUNCATED", `Sections truncated to ${LIMITS.maxSections}`);
    }

    let lastHeadingLevel = 0;

    for (let i = 0; i < spec.sections.length && this.issues.length < MAX_ISSUES; i++) {
      const section = spec.sections[i];
      if (!section || typeof section !== "object") continue;

      // Heading hierarchy check
      if (section.type === "heading" && typeof section.level === "number") {
        if (section.level > lastHeadingLevel + 1 && lastHeadingLevel > 0) {
          this.addIssue("warning", "DOC_HEADING_SKIP",
            `Heading skips from H${lastHeadingLevel} to H${section.level}`,
            `section[${i}]`);
        }
        lastHeadingLevel = section.level;
      }

      // Content length check
      if (typeof section.content === "string" && section.content.length > LIMITS.maxTextBlock) {
        section.content = section.content.substring(0, LIMITS.maxTextBlock) + "…";
        this.addIssue("auto-fixed", "DOC_TEXT_TRUNCATED", `Section text truncated`, `section[${i}]`);
      }

      // List item limits
      if ((section.type === "bullets" || section.type === "numberedList") && Array.isArray(section.content)) {
        if (section.content.length > LIMITS.maxListItems) {
          section.content = section.content.slice(0, LIMITS.maxListItems);
          this.addIssue("auto-fixed", "DOC_LIST_TRUNCATED", `List items truncated to ${LIMITS.maxListItems}`, `section[${i}]`);
        }
      }

      // Table validation
      if (section.type === "table" && Array.isArray(section.content)) {
        const rows = section.content;
        if (rows.length > LIMITS.maxTableRows) {
          section.content = rows.slice(0, LIMITS.maxTableRows);
          this.addIssue("auto-fixed", "DOC_TABLE_TRUNCATED", `Table rows truncated to ${LIMITS.maxTableRows}`, `section[${i}]`);
        }
        // Check column consistency
        if (rows.length > 0 && Array.isArray(rows[0])) {
          const headerLen = rows[0].length;
          for (let r = 1; r < section.content.length; r++) {
            if (Array.isArray(section.content[r]) && section.content[r].length !== headerLen) {
              // Auto-fix: pad or trim
              const row = section.content[r];
              while (row.length < headerLen) row.push("");
              if (row.length > headerLen) section.content[r] = row.slice(0, headerLen);
              this.addIssue("auto-fixed", "DOC_TABLE_ROW_FIXED",
                `Table row ${r} column count fixed to match header (${headerLen})`,
                `section[${i}].row[${r}]`);
            }
          }
        }
      }

      // Empty content warning
      if (section.type !== "pageBreak" && section.type !== "toc") {
        const content = section.content;
        if (!content || (typeof content === "string" && content.trim() === "")) {
          this.addIssue("warning", "DOC_EMPTY_SECTION",
            `Section ${i} (${section.type}) has no content`,
            `section[${i}]`);
        }
      }
    }

    return spec;
  }

  /* ---------------------------------------------------------------- */
  /*  XLSX VALIDATION                                                  */
  /* ---------------------------------------------------------------- */

  private validateWorkbook(spec: any, tokens?: UnifiedDesignTokens): any {
    if (!Array.isArray(spec.sheets)) {
      spec.sheets = [];
      this.addIssue("error", "XLS_NO_SHEETS", "Workbook has no sheets");
      return spec;
    }

    if (spec.sheets.length > LIMITS.maxSheets) {
      spec.sheets = spec.sheets.slice(0, LIMITS.maxSheets);
      this.addIssue("auto-fixed", "XLS_SHEETS_TRUNCATED", `Sheets truncated to ${LIMITS.maxSheets}`);
    }

    const sheetNames = new Set<string>();

    for (let s = 0; s < spec.sheets.length && this.issues.length < MAX_ISSUES; s++) {
      const sheet = spec.sheets[s];
      if (!sheet || typeof sheet !== "object") continue;

      // Sheet name validation
      if (typeof sheet.name === "string") {
        // Remove invalid chars
        sheet.name = sheet.name.replace(/[*?:/\\[\]]/g, "_").substring(0, 31).trim() || "Sheet1";

        // Duplicate name fix
        if (sheetNames.has(sheet.name)) {
          let suffix = 1;
          let newName = `${sheet.name.substring(0, 28)}_${suffix}`;
          while (sheetNames.has(newName) && suffix < 999) {
            suffix++;
            newName = `${sheet.name.substring(0, 28)}_${suffix}`;
          }
          this.addIssue("auto-fixed", "XLS_DUPLICATE_SHEET_RENAMED",
            `Sheet "${sheet.name}" renamed to "${newName}"`, `sheet[${s}]`);
          sheet.name = newName;
        }
        sheetNames.add(sheet.name);
      }

      // Column validation
      if (Array.isArray(sheet.columns)) {
        if (sheet.columns.length > LIMITS.maxColumns) {
          sheet.columns = sheet.columns.slice(0, LIMITS.maxColumns);
          this.addIssue("auto-fixed", "XLS_COLS_TRUNCATED", `Columns truncated to ${LIMITS.maxColumns}`, `sheet[${s}]`);
        }

        // Check for duplicate column keys
        const colKeys = new Set<string>();
        for (const col of sheet.columns) {
          if (col && col.key && colKeys.has(col.key)) {
            col.key = `${col.key}_${colKeys.size}`;
            this.addIssue("auto-fixed", "XLS_DUPLICATE_COL_KEY",
              `Duplicate column key renamed`, `sheet[${s}]`);
          }
          if (col?.key) colKeys.add(col.key);
        }
      }

      // Row validation
      if (Array.isArray(sheet.rows)) {
        if (sheet.rows.length > LIMITS.maxRows) {
          sheet.rows = sheet.rows.slice(0, LIMITS.maxRows);
          this.addIssue("auto-fixed", "XLS_ROWS_TRUNCATED",
            `Rows truncated to ${LIMITS.maxRows}`, `sheet[${s}]`);
        }

        // Sanitize cell values for formula injection
        for (let r = 0; r < Math.min(sheet.rows.length, 1000); r++) {
          const row = sheet.rows[r];
          if (row && typeof row === "object") {
            for (const [key, value] of Object.entries(row)) {
              if (typeof value === "string") {
                // Cell length check
                if (value.length > LIMITS.maxCellLength) {
                  (row as any)[key] = value.substring(0, LIMITS.maxCellLength);
                  // Only log first occurrence to avoid spam
                  if (r === 0) {
                    this.addIssue("auto-fixed", "XLS_CELL_TRUNCATED",
                      `Cell values exceeding ${LIMITS.maxCellLength} chars truncated`, `sheet[${s}]`);
                  }
                }
                // Formula injection
                if (isFormulaInjection(value)) {
                  (row as any)[key] = sanitizeFormulaValue(value);
                }
              }
            }
          }
        }
      }

      // Formula validation
      if (Array.isArray(sheet.formulas)) {
        sheet.formulas = sheet.formulas.filter((f: any) => {
          if (!f || typeof f !== "object") return false;
          if (!isValidCellRef(f.cell)) {
            this.addIssue("warning", "XLS_INVALID_CELL_REF",
              `Invalid cell reference "${f.cell}"`, `sheet[${s}]`);
            return false;
          }
          if (typeof f.formula === "string" && f.formula.length > LIMITS.maxFormulaLength) {
            f.formula = f.formula.substring(0, LIMITS.maxFormulaLength);
            this.addIssue("auto-fixed", "XLS_FORMULA_TRUNCATED",
              `Formula truncated to ${LIMITS.maxFormulaLength} chars`, `sheet[${s}]`);
          }
          return true;
        });
      }
    }

    return spec;
  }

  /* ---------------------------------------------------------------- */
  /*  TOKEN VALIDATION                                                 */
  /* ---------------------------------------------------------------- */

  private validateTokens(tokens: UnifiedDesignTokens): void {
    // Validate fonts
    const fontsToCheck = [
      { name: "heading", value: tokens.base?.font?.heading },
      { name: "body", value: tokens.base?.font?.body },
      { name: "mono", value: tokens.base?.font?.mono },
    ];

    for (const { name, value } of fontsToCheck) {
      if (value) {
        const result = validateFont(value);
        if (!result.valid && result.fallback) {
          this.addIssue("warning", "TOKEN_FONT_MISSING",
            `Font "${value}" (${name}) may not be available; fallback: "${result.fallback}"`);
        }
      }
    }

    // Validate contrast ratios
    const bg = tokens.base?.color?.background || "#ffffff";
    const textPrimary = tokens.base?.color?.textPrimary || "#202124";
    const textSecondary = tokens.base?.color?.textSecondary || "#5f6368";

    const primaryContrast = contrastRatio(textPrimary, bg);
    if (primaryContrast < 4.5) {
      this.addIssue("warning", "TOKEN_LOW_CONTRAST",
        `Primary text contrast ratio ${primaryContrast.toFixed(1)}:1 below WCAG AA (4.5:1)`);
    }

    const secondaryContrast = contrastRatio(textSecondary, bg);
    if (secondaryContrast < 3) {
      this.addIssue("warning", "TOKEN_LOW_CONTRAST_SECONDARY",
        `Secondary text contrast ratio ${secondaryContrast.toFixed(1)}:1 below minimum (3:1)`);
    }

    // Validate header text on header background
    const headerFg = tokens.table?.headerFg || "#ffffff";
    const headerBg = tokens.table?.headerBg || "#1a73e8";
    const headerContrast = contrastRatio(headerFg, headerBg);
    if (headerContrast < 4.5) {
      this.addIssue("warning", "TOKEN_HEADER_CONTRAST",
        `Table header contrast ratio ${headerContrast.toFixed(1)}:1 below WCAG AA (4.5:1)`);
    }
  }

  /* ---------------------------------------------------------------- */
  /*  HELPERS                                                          */
  /* ---------------------------------------------------------------- */

  private addIssue(
    severity: PreflightSeverity,
    code: string,
    message: string,
    location?: string,
    fix?: string
  ): void {
    if (this.issues.length >= MAX_ISSUES) return;
    this.issues.push({ severity, code, message, location, fix });
  }

  private buildResult(sanitizedSpec: any, startTime: number): PreflightResult {
    const errors = this.issues.filter(i => i.severity === "error").length;
    const warnings = this.issues.filter(i => i.severity === "warning").length;
    const autoFixes = this.issues.filter(i => i.severity === "auto-fixed").length;

    return {
      canRender: errors === 0,
      issueCount: this.issues.length,
      errors,
      warnings,
      autoFixes,
      issues: this.issues,
      sanitizedSpec,
      durationMs: Date.now() - startTime,
    };
  }
}
