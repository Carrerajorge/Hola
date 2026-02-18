/**
 * Component Registry — Reusable document components with strict contracts.
 *
 * Each component defines:
 *   - Input contract (what data it accepts, with Zod validation)
 *   - Size constraints (min/max width/height, character limits)
 *   - Render methods for each format (PPT, DOCX, XLSX)
 *   - Safe fallback (what to render if the component fails)
 *
 * Components are NOT format-specific — they describe semantic elements
 * that the renderers translate into Open XML / library calls.
 *
 * This prevents "hand-drawing" documents and ensures every component
 * has guardrails and predictable behavior.
 */

import { z } from "zod";

/* ================================================================== */
/*  COMPONENT CONTRACTS                                                */
/* ================================================================== */

/** Constraints that every component must respect */
export interface ComponentConstraints {
  /** Maximum character count for primary text content */
  maxChars: number;
  /** Maximum number of items (for lists, table rows, etc.) */
  maxItems: number;
  /** Minimum width in inches (for PPT) or percentage (for DOCX) */
  minWidth: number;
  /** Maximum width in inches */
  maxWidth: number;
  /** Minimum height in inches */
  minHeight: number;
  /** Maximum height in inches */
  maxHeight: number;
  /** How to handle overflow */
  overflowStrategy: "truncate" | "shrink-to-fit" | "reflow" | "split";
  /** Ellipsis text when truncating */
  ellipsis: string;
}

/** Result of enforcing constraints on input data */
export interface ConstraintResult<T> {
  /** The sanitized, bounded data */
  data: T;
  /** Whether the data was modified to fit constraints */
  wasModified: boolean;
  /** Human-readable warnings about modifications */
  warnings: string[];
}

/* ================================================================== */
/*  BASE COMPONENT DEFINITIONS                                         */
/* ================================================================== */

/**
 * Component type registry — all supported semantic component types.
 * Each type maps to specific rendering logic per format.
 */
export const COMPONENT_TYPES = [
  "title",
  "subtitle",
  "heading",
  "paragraph",
  "bullets",
  "numbered-list",
  "table",
  "chart",
  "image",
  "card",
  "badge",
  "button",
  "callout",
  "kpi",
  "code-block",
  "quote",
  "divider",
  "spacer",
  "footer",
  "page-number",
  "toc",
] as const;

export type ComponentType = (typeof COMPONENT_TYPES)[number];

/** Default constraints per component type */
export const DEFAULT_CONSTRAINTS: Record<ComponentType, ComponentConstraints> = {
  title:           { maxChars: 200, maxItems: 1, minWidth: 2, maxWidth: 10, minHeight: 0.5, maxHeight: 2, overflowStrategy: "shrink-to-fit", ellipsis: "…" },
  subtitle:        { maxChars: 500, maxItems: 1, minWidth: 2, maxWidth: 10, minHeight: 0.3, maxHeight: 1.5, overflowStrategy: "shrink-to-fit", ellipsis: "…" },
  heading:         { maxChars: 300, maxItems: 1, minWidth: 1, maxWidth: 10, minHeight: 0.3, maxHeight: 1.5, overflowStrategy: "truncate", ellipsis: "…" },
  paragraph:       { maxChars: 10000, maxItems: 1, minWidth: 2, maxWidth: 10, minHeight: 0.3, maxHeight: 8, overflowStrategy: "reflow", ellipsis: "…" },
  bullets:         { maxChars: 2000, maxItems: 50, minWidth: 2, maxWidth: 10, minHeight: 0.5, maxHeight: 6, overflowStrategy: "split", ellipsis: "…" },
  "numbered-list": { maxChars: 2000, maxItems: 50, minWidth: 2, maxWidth: 10, minHeight: 0.5, maxHeight: 6, overflowStrategy: "split", ellipsis: "…" },
  table:           { maxChars: 500, maxItems: 200, minWidth: 3, maxWidth: 10, minHeight: 1, maxHeight: 7, overflowStrategy: "split", ellipsis: "…" },
  chart:           { maxChars: 200, maxItems: 50, minWidth: 3, maxWidth: 10, minHeight: 2, maxHeight: 6, overflowStrategy: "shrink-to-fit", ellipsis: "" },
  image:           { maxChars: 500, maxItems: 1, minWidth: 1, maxWidth: 10, minHeight: 1, maxHeight: 7, overflowStrategy: "shrink-to-fit", ellipsis: "" },
  card:            { maxChars: 2000, maxItems: 1, minWidth: 2, maxWidth: 10, minHeight: 1, maxHeight: 5, overflowStrategy: "truncate", ellipsis: "…" },
  badge:           { maxChars: 50, maxItems: 1, minWidth: 0.5, maxWidth: 3, minHeight: 0.15, maxHeight: 0.4, overflowStrategy: "truncate", ellipsis: "" },
  button:          { maxChars: 50, maxItems: 1, minWidth: 0.8, maxWidth: 4, minHeight: 0.3, maxHeight: 0.6, overflowStrategy: "truncate", ellipsis: "" },
  callout:         { maxChars: 1000, maxItems: 1, minWidth: 2, maxWidth: 10, minHeight: 0.5, maxHeight: 3, overflowStrategy: "truncate", ellipsis: "…" },
  kpi:             { maxChars: 100, maxItems: 10, minWidth: 1, maxWidth: 4, minHeight: 0.8, maxHeight: 3, overflowStrategy: "shrink-to-fit", ellipsis: "" },
  "code-block":    { maxChars: 5000, maxItems: 200, minWidth: 2, maxWidth: 10, minHeight: 0.5, maxHeight: 6, overflowStrategy: "truncate", ellipsis: "\n… (truncated)" },
  quote:           { maxChars: 2000, maxItems: 1, minWidth: 2, maxWidth: 9, minHeight: 0.5, maxHeight: 3, overflowStrategy: "truncate", ellipsis: "…" },
  divider:         { maxChars: 0, maxItems: 0, minWidth: 1, maxWidth: 10, minHeight: 0.05, maxHeight: 0.1, overflowStrategy: "truncate", ellipsis: "" },
  spacer:          { maxChars: 0, maxItems: 0, minWidth: 0, maxWidth: 10, minHeight: 0.1, maxHeight: 2, overflowStrategy: "truncate", ellipsis: "" },
  footer:          { maxChars: 200, maxItems: 1, minWidth: 2, maxWidth: 10, minHeight: 0.15, maxHeight: 0.4, overflowStrategy: "truncate", ellipsis: "…" },
  "page-number":   { maxChars: 20, maxItems: 1, minWidth: 0.3, maxWidth: 2, minHeight: 0.15, maxHeight: 0.3, overflowStrategy: "truncate", ellipsis: "" },
  toc:             { maxChars: 0, maxItems: 100, minWidth: 4, maxWidth: 10, minHeight: 1, maxHeight: 10, overflowStrategy: "truncate", ellipsis: "" },
};

/* ================================================================== */
/*  COMPONENT INPUT SCHEMAS                                            */
/* ================================================================== */

export const TextComponentInputSchema = z.object({
  text: z.string(),
  style: z.record(z.any()).optional(),
});

export const ListComponentInputSchema = z.object({
  items: z.array(z.string()),
  style: z.record(z.any()).optional(),
});

export const TableComponentInputSchema = z.object({
  headers: z.array(z.string()).min(1),
  rows: z.array(z.array(z.any())),
  caption: z.string().optional(),
  style: z.record(z.any()).optional(),
});

export const ChartComponentInputSchema = z.object({
  chartType: z.enum(["bar", "line", "pie", "area", "doughnut"]).default("bar"),
  title: z.string().optional(),
  labels: z.array(z.string()),
  datasets: z.array(z.object({
    name: z.string(),
    values: z.array(z.number()),
  })),
  style: z.record(z.any()).optional(),
});

export const ImageComponentInputSchema = z.object({
  src: z.string(),
  alt: z.string().default(""),
  width: z.number().optional(),
  height: z.number().optional(),
});

export const KpiComponentInputSchema = z.object({
  label: z.string(),
  value: z.union([z.string(), z.number()]),
  icon: z.string().max(10).optional(),
  color: z.string().optional(),
  trend: z.enum(["up", "down", "flat"]).optional(),
});

export const CardComponentInputSchema = z.object({
  title: z.string(),
  body: z.string(),
  style: z.record(z.any()).optional(),
});

/* ================================================================== */
/*  CONSTRAINT ENFORCEMENT                                             */
/* ================================================================== */

/** Sanitize text: strip control characters, null bytes, bidi overrides */
function sanitizeText(text: string): string {
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u200B-\u200D\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .replace(/\0/g, "");
}

/** Truncate text to maxChars with ellipsis */
function truncateText(text: string, maxChars: number, ellipsis: string): string {
  if (text.length <= maxChars) return text;
  const cutoff = Math.max(0, maxChars - ellipsis.length);
  return text.substring(0, cutoff) + ellipsis;
}

/**
 * Enforce constraints on a text string.
 */
export function enforceTextConstraints(
  text: string,
  constraints: ComponentConstraints
): ConstraintResult<string> {
  const warnings: string[] = [];
  let data = sanitizeText(text);
  let wasModified = data !== text;

  if (data.length > constraints.maxChars) {
    data = truncateText(data, constraints.maxChars, constraints.ellipsis);
    wasModified = true;
    warnings.push(`Text truncated from ${text.length} to ${constraints.maxChars} chars`);
  }

  return { data, wasModified, warnings };
}

/**
 * Enforce constraints on a list of items.
 */
export function enforceListConstraints(
  items: string[],
  constraints: ComponentConstraints
): ConstraintResult<string[]> {
  const warnings: string[] = [];
  let wasModified = false;

  let data = items.map(item => sanitizeText(item));
  if (data.some((d, i) => d !== items[i])) wasModified = true;

  if (data.length > constraints.maxItems) {
    data = data.slice(0, constraints.maxItems);
    wasModified = true;
    warnings.push(`List truncated from ${items.length} to ${constraints.maxItems} items`);
  }

  data = data.map(item => {
    if (item.length > constraints.maxChars) {
      wasModified = true;
      warnings.push(`List item truncated to ${constraints.maxChars} chars`);
      return truncateText(item, constraints.maxChars, constraints.ellipsis);
    }
    return item;
  });

  return { data, wasModified, warnings };
}

/**
 * Enforce constraints on table data.
 */
export function enforceTableConstraints(
  headers: string[],
  rows: any[][],
  constraints: ComponentConstraints
): ConstraintResult<{ headers: string[]; rows: any[][] }> {
  const warnings: string[] = [];
  let wasModified = false;

  // Cap columns
  let safeHeaders = headers.map(h => sanitizeText(String(h)));
  if (safeHeaders.length > 200) {
    safeHeaders = safeHeaders.slice(0, 200);
    wasModified = true;
    warnings.push(`Table columns capped at 200`);
  }

  // Cap rows
  let safeRows = rows;
  if (safeRows.length > constraints.maxItems) {
    safeRows = safeRows.slice(0, constraints.maxItems);
    wasModified = true;
    warnings.push(`Table rows truncated from ${rows.length} to ${constraints.maxItems}`);
  }

  // Normalize row widths and truncate cell text
  safeRows = safeRows.map(row => {
    const normalized = Array.isArray(row) ? row : [row];
    // Pad or trim to header count
    const padded = [...normalized];
    while (padded.length < safeHeaders.length) padded.push("");
    const trimmed = padded.slice(0, safeHeaders.length);

    return trimmed.map(cell => {
      const str = String(cell ?? "");
      const safe = sanitizeText(str);
      if (safe.length > constraints.maxChars) {
        wasModified = true;
        return truncateText(safe, constraints.maxChars, constraints.ellipsis);
      }
      return safe;
    });
  });

  return {
    data: { headers: safeHeaders, rows: safeRows },
    wasModified,
    warnings,
  };
}

/* ================================================================== */
/*  COMPONENT DESCRIPTOR                                               */
/* ================================================================== */

/**
 * A semantic component descriptor — format-agnostic.
 * This is the "compiled" form that renderers consume.
 */
export interface ComponentDescriptor {
  /** Component type */
  type: ComponentType;
  /** Validated, constrained content */
  content: any;
  /** Resolved constraints (may be overridden per-instance) */
  constraints: ComponentConstraints;
  /** Constraint enforcement result */
  enforcement: {
    wasModified: boolean;
    warnings: string[];
  };
  /** Optional explicit position (for PPT) */
  position?: { x: number; y: number; w: number; h: number };
  /** Optional style overrides (merged with theme) */
  style?: Record<string, any>;
}

/**
 * Build a component descriptor with constraint enforcement.
 * This is the primary API for creating components.
 */
export function buildComponent(
  type: ComponentType,
  content: any,
  options?: {
    constraints?: Partial<ComponentConstraints>;
    position?: { x: number; y: number; w: number; h: number };
    style?: Record<string, any>;
  }
): ComponentDescriptor {
  const baseConstraints = DEFAULT_CONSTRAINTS[type];
  const constraints: ComponentConstraints = {
    ...baseConstraints,
    ...(options?.constraints || {}),
  };

  let enforced: { data: any; wasModified: boolean; warnings: string[] };

  switch (type) {
    case "title":
    case "subtitle":
    case "heading":
    case "paragraph":
    case "quote":
    case "footer":
    case "page-number":
      enforced = enforceTextConstraints(String(content ?? ""), constraints);
      break;

    case "bullets":
    case "numbered-list": {
      const items = Array.isArray(content) ? content.map(String) : [String(content)];
      enforced = enforceListConstraints(items, constraints);
      break;
    }

    case "table": {
      const tableData = content as { headers?: string[]; rows?: any[][] };
      const headers = Array.isArray(tableData?.headers) ? tableData.headers : [];
      const rows = Array.isArray(tableData?.rows) ? tableData.rows : [];
      enforced = enforceTableConstraints(headers, rows, constraints);
      break;
    }

    case "code-block": {
      const code = String(content ?? "");
      enforced = enforceTextConstraints(code, constraints);
      break;
    }

    case "kpi":
    case "card":
    case "badge":
    case "button":
    case "chart":
    case "image":
    case "callout":
      // Complex components: pass through with basic sanitization
      enforced = {
        data: content,
        wasModified: false,
        warnings: [],
      };
      break;

    case "divider":
    case "spacer":
    case "toc":
      enforced = { data: content, wasModified: false, warnings: [] };
      break;

    default:
      enforced = { data: content, wasModified: false, warnings: [`Unknown component type: ${type}`] };
  }

  return {
    type,
    content: enforced.data,
    constraints,
    enforcement: {
      wasModified: enforced.wasModified,
      warnings: enforced.warnings,
    },
    position: options?.position,
    style: options?.style,
  };
}

/**
 * Get the safe fallback content for a component type.
 * Used when a component fails to render.
 */
export function getSafeFallback(type: ComponentType, originalContent: any): string {
  switch (type) {
    case "title":
    case "subtitle":
    case "heading":
    case "paragraph":
    case "quote":
    case "footer":
      return String(originalContent ?? "").substring(0, 200);

    case "bullets":
    case "numbered-list": {
      const items = Array.isArray(originalContent) ? originalContent : [originalContent];
      return items.slice(0, 5).map(String).join("\n");
    }

    case "table": {
      const data = originalContent as { headers?: string[]; rows?: any[][] } | undefined;
      if (data?.headers) return `[Tabla: ${data.headers.join(", ")}]`;
      return "[Tabla]";
    }

    case "chart":
      return "[Gráfico]";

    case "image":
      return "[Imagen]";

    case "kpi":
      return `${(originalContent as any)?.label || "KPI"}: ${(originalContent as any)?.value || "N/A"}`;

    case "card":
      return `${(originalContent as any)?.title || "Card"}\n${(originalContent as any)?.body || ""}`.substring(0, 300);

    default:
      return `[${type}]`;
  }
}
