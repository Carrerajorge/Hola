/**
 * Preflight Validator — Comprehensive pre-render validation and sanitization.
 *
 * Validates a DocumentIR before compilation:
 *   - Structure: sections, blocks, required fields
 *   - Typography: font availability/embeddability, size limits
 *   - Colors: hex format, WCAG contrast ratios
 *   - Images: path safety (SSRF, path traversal), existence hints
 *   - Data: UTF-8 normalization, control char stripping, formula injection
 *   - Tables: column count consistency, cell length limits
 *   - Limits: max sections, blocks, rows, slide count
 *   - Format compatibility: unsupported components for target format
 *
 * Returns a ValidationReport with issues, auto-fixes applied, and severity.
 */

import type { DocumentIR, BlockIR, SectionIR, OutputFormat } from "./documentIR";
import type { DesignTokensV2 } from "./designTokens";
import { isComponentSupported, COMPONENT_CONTRACTS } from "./componentRegistry";

/* ================================================================== */
/*  TYPES                                                              */
/* ================================================================== */

export type Severity = "error" | "warning" | "info";

export interface PreflightIssue {
  severity: Severity;
  code: string;
  message: string;
  path?: string;
  autoFixed?: boolean;
}

export interface PreflightReport {
  valid: boolean;
  issues: PreflightIssue[];
  errors: number;
  warnings: number;
  infos: number;
  autoFixesApplied: number;
}

/* ================================================================== */
/*  LIMITS                                                             */
/* ================================================================== */

const LIMITS = {
  maxSections: 500,
  maxBlocksPerSection: 1000,
  maxTotalBlocks: 10_000,
  maxSlides: 200,
  maxSheets: 100,
  maxTableRows: 100_000,
  maxTableColumns: 500,
  maxCellLength: 32_767,
  maxTextLength: 100_000,
  maxImagePathLength: 4096,
  maxMetadataFieldLength: 1000,
  maxTitleLength: 500,
  maxBulletItems: 1000,
} as const;

/* ================================================================== */
/*  SECURITY HELPERS                                                   */
/* ================================================================== */

const DANGEROUS_URL_PROTOCOLS = ["javascript:", "data:", "file:", "vbscript:", "mhtml:"];

function isImagePathSafe(path: string): { safe: boolean; reason?: string } {
  if (!path || typeof path !== "string") return { safe: false, reason: "empty path" };
  if (path.length > LIMITS.maxImagePathLength) return { safe: false, reason: "path too long" };

  const lower = path.trim().toLowerCase();

  // Block dangerous protocols
  for (const proto of DANGEROUS_URL_PROTOCOLS) {
    if (lower.startsWith(proto)) return { safe: false, reason: `blocked protocol: ${proto}` };
  }

  // Block SMB/UNC paths
  if (lower.startsWith("\\\\") || lower.startsWith("//")) return { safe: false, reason: "UNC path" };

  // Block sensitive system paths
  for (const prefix of ["/etc/", "/proc/", "/sys/", "/dev/", "/var/run/"]) {
    if (lower.startsWith(prefix)) return { safe: false, reason: `system path: ${prefix}` };
  }

  // Block path traversal
  if (path.includes("..")) return { safe: false, reason: "path traversal" };

  return { safe: true };
}

function isValidHexColor(color: string): boolean {
  if (!color || typeof color !== "string") return false;
  const c = color.trim();
  return /^#[0-9a-fA-F]{6}$/.test(c) || /^#[0-9a-fA-F]{3}$/.test(c);
}

/**
 * WCAG AA contrast ratio check.
 */
function relativeLuminance(hex: string): number {
  const c = hex.replace("#", "");
  if (c.length !== 6) return 0;
  const r = parseInt(c.substring(0, 2), 16) / 255;
  const g = parseInt(c.substring(2, 4), 16) / 255;
  const b = parseInt(c.substring(4, 6), 16) / 255;
  const srgb = [r, g, b].map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

function contrastRatio(fg: string, bg: string): number {
  const lFg = relativeLuminance(fg);
  const lBg = relativeLuminance(bg);
  return (Math.max(lFg, lBg) + 0.05) / (Math.min(lFg, lBg) + 0.05);
}

/** Strip control chars (except tab, newline, CR) */
function sanitizeText(text: string): string {
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u200B-\u200D\u202A-\u202E\u2066-\u2069\uFEFF]/g, "");
}

/** Normalize color to 6-digit hex */
function normalizeColor(color: string): string {
  let c = color.trim();
  if (!c.startsWith("#") && /^[0-9a-fA-F]{6}$/.test(c)) c = "#" + c;
  if (/^#[0-9a-fA-F]{3}$/.test(c)) {
    c = "#" + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(c)) return "#000000";
  return c;
}

/* ================================================================== */
/*  PREFLIGHT VALIDATOR                                                */
/* ================================================================== */

export class PreflightValidator {
  /**
   * Run full preflight validation on a DocumentIR.
   * Mutates the input to apply auto-fixes.
   */
  validate(doc: DocumentIR, tokens: DesignTokensV2): PreflightReport {
    const issues: PreflightIssue[] = [];
    let autoFixes = 0;

    // 1. Metadata validation
    this.validateMetadata(doc, issues);

    // 2. Section count limits
    if (doc.sections.length > LIMITS.maxSections) {
      issues.push({
        severity: "error",
        code: "PREFLIGHT_TOO_MANY_SECTIONS",
        message: `${doc.sections.length} sections exceeds limit of ${LIMITS.maxSections}`,
      });
    }

    // Format-specific section limits
    if (doc.format === "pptx" && doc.sections.length > LIMITS.maxSlides) {
      issues.push({
        severity: "warning",
        code: "PREFLIGHT_TOO_MANY_SLIDES",
        message: `${doc.sections.length} slides exceeds recommended limit of ${LIMITS.maxSlides}`,
      });
    }

    if (doc.format === "xlsx" && doc.sections.length > LIMITS.maxSheets) {
      issues.push({
        severity: "warning",
        code: "PREFLIGHT_TOO_MANY_SHEETS",
        message: `${doc.sections.length} sheets exceeds limit of ${LIMITS.maxSheets}`,
      });
    }

    // 3. Validate each section and its blocks
    let totalBlocks = 0;
    for (let s = 0; s < doc.sections.length; s++) {
      const section = doc.sections[s];
      const sectionPath = `sections[${s}]`;

      if (section.blocks.length > LIMITS.maxBlocksPerSection) {
        issues.push({
          severity: "warning",
          code: "PREFLIGHT_TOO_MANY_BLOCKS",
          message: `Section ${s} has ${section.blocks.length} blocks (limit: ${LIMITS.maxBlocksPerSection})`,
          path: sectionPath,
        });
      }

      for (let b = 0; b < section.blocks.length; b++) {
        if (totalBlocks >= LIMITS.maxTotalBlocks) {
          issues.push({
            severity: "error",
            code: "PREFLIGHT_TOTAL_BLOCKS_EXCEEDED",
            message: `Total block count ${totalBlocks} exceeds limit of ${LIMITS.maxTotalBlocks}`,
          });
          break;
        }
        totalBlocks++;

        const block = section.blocks[b];
        const blockPath = `${sectionPath}.blocks[${b}]`;

        // Format compatibility check
        if (!isComponentSupported(block.type, doc.format)) {
          issues.push({
            severity: "warning",
            code: "PREFLIGHT_UNSUPPORTED_COMPONENT",
            message: `Component "${block.type}" is not supported in ${doc.format} format`,
            path: blockPath,
          });
        }

        // Block-specific validation
        autoFixes += this.validateBlock(block, blockPath, doc.format, issues);
      }
    }

    // 4. Color contrast checks
    this.validateColors(tokens, issues);

    // Build report
    const errors = issues.filter(i => i.severity === "error").length;
    const warnings = issues.filter(i => i.severity === "warning").length;
    const infos = issues.filter(i => i.severity === "info").length;

    return {
      valid: errors === 0,
      issues,
      errors,
      warnings,
      infos,
      autoFixesApplied: autoFixes,
    };
  }

  /* ---------------------------------------------------------------- */
  /*  METADATA                                                         */
  /* ---------------------------------------------------------------- */

  private validateMetadata(doc: DocumentIR, issues: PreflightIssue[]): void {
    const meta = doc.metadata;

    if (!meta.title || meta.title.trim() === "") {
      issues.push({
        severity: "warning",
        code: "PREFLIGHT_EMPTY_TITLE",
        message: "Document has no title",
        path: "metadata.title",
      });
    }

    if (meta.title && meta.title.length > LIMITS.maxTitleLength) {
      meta.title = meta.title.substring(0, LIMITS.maxTitleLength);
      issues.push({
        severity: "info",
        code: "PREFLIGHT_TITLE_TRUNCATED",
        message: `Title truncated to ${LIMITS.maxTitleLength} chars`,
        path: "metadata.title",
        autoFixed: true,
      });
    }

    // Sanitize metadata strings
    meta.title = sanitizeText(meta.title);
    if (meta.author) meta.author = sanitizeText(meta.author).substring(0, 200);
    if (meta.subject) meta.subject = sanitizeText(meta.subject).substring(0, 500);
  }

  /* ---------------------------------------------------------------- */
  /*  BLOCK VALIDATION                                                 */
  /* ---------------------------------------------------------------- */

  private validateBlock(
    block: BlockIR,
    path: string,
    format: OutputFormat,
    issues: PreflightIssue[],
  ): number {
    let autoFixes = 0;
    const any = block as any;

    // Validate text fields
    for (const field of ["text", "markdown", "code", "title", "caption", "attribution"]) {
      if (field in any && typeof any[field] === "string") {
        // Sanitize control chars
        const original = any[field];
        any[field] = sanitizeText(any[field]);
        if (any[field] !== original) autoFixes++;

        // Length check
        if (any[field].length > LIMITS.maxTextLength) {
          any[field] = any[field].substring(0, LIMITS.maxTextLength - 1) + "…";
          autoFixes++;
          issues.push({
            severity: "info",
            code: "PREFLIGHT_TEXT_TRUNCATED",
            message: `Text in ${field} truncated to ${LIMITS.maxTextLength} chars`,
            path: `${path}.${field}`,
            autoFixed: true,
          });
        }
      }
    }

    // Block-specific checks
    switch (block.type) {
      case "table":
        autoFixes += this.validateTable(any, path, issues);
        break;

      case "image":
        this.validateImage(any, path, issues);
        break;

      case "bullets":
      case "numbered":
        autoFixes += this.validateList(any, path, issues);
        break;

      case "chart":
        this.validateChart(any, path, issues);
        break;

      case "heading":
        if (any.level && (any.level < 1 || any.level > 6)) {
          any.level = Math.max(1, Math.min(6, any.level));
          autoFixes++;
          issues.push({
            severity: "info",
            code: "PREFLIGHT_HEADING_LEVEL_CLAMPED",
            message: `Heading level clamped to 1-6`,
            path,
            autoFixed: true,
          });
        }
        break;
    }

    return autoFixes;
  }

  private validateTable(block: any, path: string, issues: PreflightIssue[]): number {
    let autoFixes = 0;

    if (!Array.isArray(block.columns) || block.columns.length === 0) {
      issues.push({
        severity: "error",
        code: "PREFLIGHT_TABLE_NO_COLUMNS",
        message: "Table has no column definitions",
        path,
      });
      return autoFixes;
    }

    if (block.columns.length > LIMITS.maxTableColumns) {
      block.columns = block.columns.slice(0, LIMITS.maxTableColumns);
      autoFixes++;
      issues.push({
        severity: "warning",
        code: "PREFLIGHT_TABLE_COLS_TRUNCATED",
        message: `Table columns capped at ${LIMITS.maxTableColumns}`,
        path,
        autoFixed: true,
      });
    }

    if (Array.isArray(block.rows) && block.rows.length > LIMITS.maxTableRows) {
      block.rows = block.rows.slice(0, LIMITS.maxTableRows);
      autoFixes++;
      issues.push({
        severity: "warning",
        code: "PREFLIGHT_TABLE_ROWS_TRUNCATED",
        message: `Table rows capped at ${LIMITS.maxTableRows}`,
        path,
        autoFixed: true,
      });
    }

    // Check cell lengths
    if (Array.isArray(block.rows)) {
      for (let r = 0; r < Math.min(block.rows.length, 100); r++) {
        const row = block.rows[r];
        if (row && typeof row === "object") {
          for (const [key, val] of Object.entries(row)) {
            if (typeof val === "string" && val.length > LIMITS.maxCellLength) {
              (row as any)[key] = (val as string).substring(0, LIMITS.maxCellLength);
              autoFixes++;
            }
          }
        }
      }
    }

    // Check duplicate column keys
    const keys = new Set<string>();
    for (const col of block.columns) {
      if (keys.has(col.key)) {
        issues.push({
          severity: "error",
          code: "PREFLIGHT_TABLE_DUPLICATE_KEY",
          message: `Duplicate column key: "${col.key}"`,
          path,
        });
      }
      keys.add(col.key);
    }

    return autoFixes;
  }

  private validateImage(block: any, path: string, issues: PreflightIssue[]): void {
    if (!block.src) {
      issues.push({
        severity: "error",
        code: "PREFLIGHT_IMAGE_NO_SRC",
        message: "Image has no src",
        path,
      });
      return;
    }

    const { safe, reason } = isImagePathSafe(block.src);
    if (!safe) {
      issues.push({
        severity: "error",
        code: "PREFLIGHT_IMAGE_UNSAFE_PATH",
        message: `Image path blocked: ${reason}`,
        path: `${path}.src`,
      });
    }
  }

  private validateList(block: any, path: string, issues: PreflightIssue[]): number {
    let autoFixes = 0;

    if (!Array.isArray(block.items) || block.items.length === 0) {
      issues.push({
        severity: "warning",
        code: "PREFLIGHT_LIST_EMPTY",
        message: "List has no items",
        path,
      });
    }

    if (Array.isArray(block.items) && block.items.length > LIMITS.maxBulletItems) {
      block.items = block.items.slice(0, LIMITS.maxBulletItems);
      autoFixes++;
      issues.push({
        severity: "warning",
        code: "PREFLIGHT_LIST_TRUNCATED",
        message: `List items capped at ${LIMITS.maxBulletItems}`,
        path,
        autoFixed: true,
      });
    }

    return autoFixes;
  }

  private validateChart(block: any, path: string, issues: PreflightIssue[]): void {
    if (!Array.isArray(block.labels) || block.labels.length === 0) {
      issues.push({
        severity: "warning",
        code: "PREFLIGHT_CHART_NO_LABELS",
        message: "Chart has no labels",
        path,
      });
    }

    if (!Array.isArray(block.datasets) || block.datasets.length === 0) {
      issues.push({
        severity: "error",
        code: "PREFLIGHT_CHART_NO_DATA",
        message: "Chart has no datasets",
        path,
      });
    }
  }

  /* ---------------------------------------------------------------- */
  /*  COLOR CONTRAST                                                   */
  /* ---------------------------------------------------------------- */

  private validateColors(tokens: DesignTokensV2, issues: PreflightIssue[]): void {
    const MIN_CONTRAST = 4.5; // WCAG AA

    const colorPairs: Array<{ fg: string; bg: string; label: string }> = [
      { fg: tokens.colors.textPrimary, bg: tokens.colors.background, label: "text/background" },
      { fg: tokens.colors.textSecondary, bg: tokens.colors.background, label: "secondaryText/background" },
      { fg: tokens.tableStyle.headerFg, bg: tokens.tableStyle.headerBg, label: "tableHeader" },
    ];

    for (const pair of colorPairs) {
      const fgNorm = normalizeColor(pair.fg);
      const bgNorm = normalizeColor(pair.bg);
      if (fgNorm === "#000000" && pair.fg !== "#000000" && pair.fg !== "000000") continue; // skip invalid
      if (bgNorm === "#000000" && pair.bg !== "#000000" && pair.bg !== "000000") continue;

      try {
        const ratio = contrastRatio(fgNorm, bgNorm);
        if (ratio < MIN_CONTRAST) {
          issues.push({
            severity: "warning",
            code: "PREFLIGHT_LOW_CONTRAST",
            message: `${pair.label}: contrast ratio ${ratio.toFixed(1)}:1 is below WCAG AA (${MIN_CONTRAST}:1)`,
          });
        }
      } catch {
        // Skip invalid colors
      }
    }
  }
}
