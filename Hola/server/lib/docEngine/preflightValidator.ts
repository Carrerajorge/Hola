/**
 * PREFLIGHT VALIDATOR — Pre-render validation and sanitization.
 *
 * Runs BEFORE the format compiler to ensure:
 * - All data is valid UTF-8 with no control characters
 * - Image sources are valid (base64 data URIs or safe URLs)
 * - Text doesn't contain characters that break Open XML
 * - Color values are valid hex codes
 * - Section/component structures are well-formed
 * - Limits are respected (DoS protection)
 *
 * Returns a list of errors (blocking) and warnings (non-blocking).
 * On error, the document compiler should NOT proceed.
 */

import type {
  DocumentModel,
  DocumentSection,
  DocumentComponent,
  TableComponent,
  ChartComponent,
  ImageComponent,
  COMPONENT_LIMITS,
  SECTION_LIMITS,
  DOCUMENT_LIMITS,
} from "./documentModel";

// ===== Preflight Result =====

export interface PreflightResult {
  valid: boolean;
  errors: PreflightIssue[];
  warnings: PreflightIssue[];
  /** The sanitized model (with invalid chars removed, etc.) */
  sanitizedModel: DocumentModel;
  /** Total data size estimate in bytes */
  estimatedSizeBytes: number;
}

export interface PreflightIssue {
  code: string;
  message: string;
  path: string;
  severity: "error" | "warning";
}

// ===== Constants =====

/** Characters that are invalid in XML 1.0 and will corrupt Open XML */
const XML_INVALID_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/** Valid hex color pattern */
const HEX_COLOR_REGEX = /^[0-9A-Fa-f]{6}$/;

/** Safe URL protocols for hyperlinks */
const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** Maximum base64 data URI size (10MB) */
const MAX_DATA_URI_SIZE = 10 * 1024 * 1024;

/** Maximum total estimated size (100MB) */
const MAX_TOTAL_SIZE = 100 * 1024 * 1024;

// ===== Sanitization Helpers =====

/** Remove XML-invalid control characters from text */
function sanitizeText(text: string): string {
  if (!text) return "";
  // Remove XML-invalid chars but keep newlines (\n), tabs (\t), carriage returns (\r)
  return text.replace(XML_INVALID_CHARS, "");
}

/** Validate and sanitize a hex color */
function sanitizeColor(color: string | undefined): string | undefined {
  if (!color) return undefined;
  const clean = color.replace(/^#/, "");
  if (HEX_COLOR_REGEX.test(clean)) return clean;
  return undefined;
}

/** Validate a URL is safe for embedding */
function isSafeUrl(url: string): boolean {
  if (url.startsWith("data:")) return true; // data URIs are checked separately
  try {
    const parsed = new URL(url);
    return SAFE_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

/** Estimate string size in bytes (UTF-8) */
function estimateBytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

// ===== Component Validators =====

function validateTable(
  comp: TableComponent,
  path: string,
  issues: PreflightIssue[],
): number {
  let size = 0;

  if (comp.columns.length === 0) {
    issues.push({ code: "PF_EMPTY_TABLE_COLUMNS", message: "Table has no columns", path, severity: "error" });
  }

  if (comp.columns.length > 26) {
    issues.push({ code: "PF_TOO_MANY_COLUMNS", message: `Table has ${comp.columns.length} columns (max 26)`, path, severity: "error" });
  }

  if (comp.rows.length > 5000) {
    issues.push({ code: "PF_TOO_MANY_ROWS", message: `Table has ${comp.rows.length} rows (max 5000)`, path, severity: "warning" });
  }

  // Check row/column consistency
  for (let ri = 0; ri < Math.min(comp.rows.length, 100); ri++) {
    const row = comp.rows[ri];
    if (row.length !== comp.columns.length) {
      issues.push({
        code: "PF_ROW_LENGTH_MISMATCH",
        message: `Row ${ri} has ${row.length} cells but table has ${comp.columns.length} columns`,
        path: `${path}.rows[${ri}]`,
        severity: "warning",
      });
    }

    for (let ci = 0; ci < row.length; ci++) {
      const val = row[ci];
      if (typeof val === "string") {
        size += estimateBytes(val);
        if (val.length > 10_000) {
          issues.push({
            code: "PF_CELL_TOO_LONG",
            message: `Cell [${ri}][${ci}] has ${val.length} chars (max 10000)`,
            path: `${path}.rows[${ri}][${ci}]`,
            severity: "warning",
          });
        }
      }
    }
  }

  // Validate formulas
  for (const col of comp.columns) {
    if (col.formula && !col.formula.includes("{row}")) {
      issues.push({
        code: "PF_FORMULA_MISSING_ROW",
        message: `Formula for column "${col.header}" should contain {row} placeholder`,
        path: `${path}.columns`,
        severity: "warning",
      });
    }
  }

  return size;
}

function validateChart(comp: ChartComponent, path: string, issues: PreflightIssue[]): void {
  if (comp.categories.length === 0) {
    issues.push({ code: "PF_EMPTY_CHART_CATEGORIES", message: "Chart has no categories", path, severity: "error" });
  }

  if (comp.series.length === 0) {
    issues.push({ code: "PF_EMPTY_CHART_SERIES", message: "Chart has no series", path, severity: "error" });
  }

  for (const series of comp.series) {
    if (series.values.length !== comp.categories.length) {
      issues.push({
        code: "PF_CHART_SERIES_MISMATCH",
        message: `Series "${series.name}" has ${series.values.length} values but ${comp.categories.length} categories`,
        path,
        severity: "warning",
      });
    }

    if (series.color && !HEX_COLOR_REGEX.test(series.color.replace(/^#/, ""))) {
      issues.push({
        code: "PF_INVALID_COLOR",
        message: `Series "${series.name}" has invalid color: ${series.color}`,
        path,
        severity: "warning",
      });
    }
  }

  if (comp.categories.length > 500) {
    issues.push({ code: "PF_TOO_MANY_CATEGORIES", message: `Chart has ${comp.categories.length} categories (max 500)`, path, severity: "warning" });
  }
}

function validateImage(comp: ImageComponent, path: string, issues: PreflightIssue[]): number {
  if (!comp.src) {
    issues.push({ code: "PF_MISSING_IMAGE_SRC", message: "Image has no source", path, severity: "error" });
    return 0;
  }

  if (comp.src.startsWith("data:")) {
    const commaIdx = comp.src.indexOf(",");
    if (commaIdx === -1) {
      issues.push({ code: "PF_INVALID_DATA_URI", message: "Malformed data URI", path, severity: "error" });
      return 0;
    }

    const base64Part = comp.src.slice(commaIdx + 1);
    const estimatedSize = Math.ceil(base64Part.length * 3 / 4);

    if (estimatedSize > MAX_DATA_URI_SIZE) {
      issues.push({
        code: "PF_IMAGE_TOO_LARGE",
        message: `Image is ~${Math.round(estimatedSize / 1024 / 1024)}MB (max ${MAX_DATA_URI_SIZE / 1024 / 1024}MB)`,
        path,
        severity: "error",
      });
    }

    return estimatedSize;
  }

  if (!isSafeUrl(comp.src)) {
    issues.push({ code: "PF_UNSAFE_IMAGE_URL", message: `Unsafe image URL protocol: ${comp.src.slice(0, 50)}`, path, severity: "error" });
  }

  return 0; // URL images don't add to local size
}

// ===== Sanitize Component Text =====

function sanitizeValue(val: any): any {
  if (typeof val === "string") return sanitizeText(val);
  if (Array.isArray(val)) return val.map(sanitizeValue);
  if (val !== null && typeof val === "object") {
    const out: any = {};
    for (const key of Object.keys(val)) {
      out[key] = sanitizeValue(val[key]);
    }
    return out;
  }
  return val;
}

function sanitizeComponent(comp: DocumentComponent): DocumentComponent {
  return sanitizeValue(comp) as DocumentComponent;
}

// ===== Main Preflight =====

/**
 * Validate and sanitize a document model before rendering.
 * Returns errors (must fix) and warnings (can proceed).
 */
export function preflightValidate(model: DocumentModel): PreflightResult {
  const issues: PreflightIssue[] = [];
  let totalSizeBytes = 0;

  // 1. Document-level validation
  if (!model.id) {
    issues.push({ code: "PF_MISSING_ID", message: "Document has no ID", path: "document", severity: "error" });
  }

  if (!model.format) {
    issues.push({ code: "PF_MISSING_FORMAT", message: "Document has no target format", path: "document", severity: "error" });
  }

  if (!model.sections || model.sections.length === 0) {
    issues.push({ code: "PF_NO_SECTIONS", message: "Document has no sections", path: "document", severity: "error" });
  }

  if (model.sections && model.sections.length > 100) {
    issues.push({ code: "PF_TOO_MANY_SECTIONS", message: `${model.sections.length} sections (max 100)`, path: "document", severity: "error" });
  }

  // 2. Metadata validation
  if (model.metadata.title) {
    totalSizeBytes += estimateBytes(model.metadata.title);
  }

  // 3. Section and component validation
  const sanitizedSections: typeof model.sections = [];
  let totalComponents = 0;

  for (let si = 0; si < (model.sections?.length ?? 0); si++) {
    const section = model.sections[si];
    const sectionPath = `sections[${si}]`;

    if (!section.id) {
      issues.push({ code: "PF_SECTION_NO_ID", message: `Section ${si} has no ID`, path: sectionPath, severity: "warning" });
    }

    if (section.components.length > 200) {
      issues.push({
        code: "PF_SECTION_TOO_MANY_COMPONENTS",
        message: `Section "${section.id}" has ${section.components.length} components (max 200)`,
        path: sectionPath,
        severity: "warning",
      });
    }

    const sanitizedComponents: DocumentComponent[] = [];

    for (let ci = 0; ci < section.components.length; ci++) {
      const comp = section.components[ci];
      const compPath = `${sectionPath}.components[${ci}]`;
      totalComponents++;

      // Sanitize the component (remove invalid XML chars)
      const sanitized = sanitizeComponent(comp);

      // Type-specific validation
      if (comp.type === "table") {
        totalSizeBytes += validateTable(comp as TableComponent, compPath, issues);
      } else if (comp.type === "chart") {
        validateChart(comp as ChartComponent, compPath, issues);
      } else if (comp.type === "image") {
        totalSizeBytes += validateImage(comp as ImageComponent, compPath, issues);
      }

      // Estimate text size for text components
      if ("text" in comp && typeof (comp as any).text === "string") {
        totalSizeBytes += estimateBytes((comp as any).text);
      }
      if ("items" in comp && Array.isArray((comp as any).items)) {
        for (const item of (comp as any).items) {
          if (typeof item === "string") totalSizeBytes += estimateBytes(item);
        }
      }

      sanitizedComponents.push(sanitized);
    }

    sanitizedSections.push({ ...section, components: sanitizedComponents });
  }

  // 4. Total size check
  if (totalSizeBytes > MAX_TOTAL_SIZE) {
    issues.push({
      code: "PF_DOCUMENT_TOO_LARGE",
      message: `Estimated document data ~${Math.round(totalSizeBytes / 1024 / 1024)}MB exceeds ${MAX_TOTAL_SIZE / 1024 / 1024}MB limit`,
      path: "document",
      severity: "error",
    });
  }

  // 5. Total component count
  if (totalComponents > 2000) {
    issues.push({
      code: "PF_TOO_MANY_TOTAL_COMPONENTS",
      message: `${totalComponents} total components exceeds limit of 2000`,
      path: "document",
      severity: "warning",
    });
  }

  const errors = issues.filter(i => i.severity === "error");
  const warnings = issues.filter(i => i.severity === "warning");

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    sanitizedModel: { ...model, sections: sanitizedSections },
    estimatedSizeBytes: totalSizeBytes,
  };
}
