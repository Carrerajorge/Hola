/**
 * Document Intermediate Representation (IR) — Unified semantic model.
 *
 * This is the single canonical representation that describes any document
 * (Word, Excel, PowerPoint) in a format-agnostic, semantic way.
 *
 * Architecture:
 *   DocumentIR
 *   ├── metadata (title, author, subject, keywords, language)
 *   ├── theme (DesignTokensV2 name or inline)
 *   ├── sections[]
 *   │   ├── id, title, variant
 *   │   └── blocks[]
 *   │       ├── type (heading, paragraph, bullets, table, chart, image, ...)
 *   │       ├── content (semantic payload)
 *   │       ├── constraints (maxChars, minWidth, overflow behavior)
 *   │       └── fallback (degradation chain)
 *   └── output (format, filename)
 *
 * Components describe WHAT to render, never HOW (no raw XML, no positions).
 * The layout engine and format compilers handle the HOW.
 */

import { z } from "zod";

/* ================================================================== */
/*  OVERFLOW BEHAVIOR                                                  */
/* ================================================================== */

export const OverflowBehaviorSchema = z.enum([
  "truncate",       // Cut text with ellipsis
  "autofit",        // Reduce font size to fit
  "wrap",           // Wrap to next line (default for text)
  "split",          // Split across pages/slides
  "scroll",         // Only for Excel: allow scrolling
  "hide",           // Hide overflow content
]).default("wrap");

/* ================================================================== */
/*  COMPONENT CONSTRAINTS                                              */
/* ================================================================== */

export const ComponentConstraintsSchema = z.object({
  maxChars: z.number().int().positive().optional(),
  minChars: z.number().int().nonnegative().optional(),
  maxWidth: z.number().positive().optional(),    // inches
  minWidth: z.number().nonnegative().optional(),  // inches
  maxHeight: z.number().positive().optional(),   // inches
  minHeight: z.number().nonnegative().optional(), // inches
  maxItems: z.number().int().positive().optional(), // for lists/tables
  maxRows: z.number().int().positive().optional(),  // for tables
  maxColumns: z.number().int().positive().optional(),
  overflowX: OverflowBehaviorSchema,
  overflowY: OverflowBehaviorSchema,
  density: z.enum(["compact", "normal", "relaxed"]).default("normal"),
}).default({});

export type ComponentConstraints = z.infer<typeof ComponentConstraintsSchema>;

/* ================================================================== */
/*  BLOCK TYPES — Semantic content components                          */
/* ================================================================== */

// --- Text blocks ---

export const HeadingBlockIRSchema = z.object({
  type: z.literal("heading"),
  level: z.number().int().min(1).max(6).default(1),
  text: z.string(),
  id: z.string().optional(), // anchor ID for cross-references
  constraints: ComponentConstraintsSchema,
});

export const ParagraphBlockIRSchema = z.object({
  type: z.literal("paragraph"),
  text: z.string(),
  style: z.string().optional(), // text style preset name from tokens
  constraints: ComponentConstraintsSchema,
});

export const RichTextBlockIRSchema = z.object({
  type: z.literal("richtext"),
  /** Markdown-formatted text with inline formatting */
  markdown: z.string(),
  constraints: ComponentConstraintsSchema,
});

// --- List blocks ---

export const BulletListBlockIRSchema = z.object({
  type: z.literal("bullets"),
  items: z.array(z.string()).min(1),
  level: z.number().int().min(0).max(4).default(0),
  constraints: ComponentConstraintsSchema,
});

export const NumberedListBlockIRSchema = z.object({
  type: z.literal("numbered"),
  items: z.array(z.string()).min(1),
  startAt: z.number().int().min(1).default(1),
  constraints: ComponentConstraintsSchema,
});

// --- Table block ---

export const TableCellIRSchema = z.object({
  value: z.any(),
  type: z.enum(["string", "number", "date", "currency", "percentage", "boolean", "formula"]).default("string"),
  format: z.string().optional(), // number format
  colspan: z.number().int().min(1).default(1),
  rowspan: z.number().int().min(1).default(1),
  align: z.enum(["left", "center", "right"]).optional(),
  bold: z.boolean().optional(),
});

export const TableColumnIRSchema = z.object({
  key: z.string(),
  header: z.string(),
  type: z.enum(["string", "number", "date", "currency", "percentage", "boolean", "formula"]).default("string"),
  width: z.number().positive().optional(),
  format: z.string().optional(),
  align: z.enum(["left", "center", "right"]).optional(),
});

export const TableBlockIRSchema = z.object({
  type: z.literal("table"),
  columns: z.array(TableColumnIRSchema).min(1),
  rows: z.array(z.record(z.any())).default([]),
  caption: z.string().optional(),
  showHeader: z.boolean().default(true),
  showStripes: z.boolean().default(true),
  constraints: ComponentConstraintsSchema,
});

// --- Chart block ---

export const ChartDatasetIRSchema = z.object({
  label: z.string(),
  values: z.array(z.number()),
  color: z.string().optional(),
});

export const ChartBlockIRSchema = z.object({
  type: z.literal("chart"),
  chartType: z.enum(["bar", "line", "pie", "doughnut", "area", "scatter", "radar"]),
  title: z.string().optional(),
  labels: z.array(z.string()),
  datasets: z.array(ChartDatasetIRSchema).min(1),
  showLegend: z.boolean().default(true),
  showValues: z.boolean().default(false),
  constraints: ComponentConstraintsSchema,
});

// --- Image block ---

export const ImageBlockIRSchema = z.object({
  type: z.literal("image"),
  src: z.string(), // file path, base64, or validated URL
  alt: z.string().default(""),
  caption: z.string().optional(),
  width: z.number().positive().optional(),  // inches
  height: z.number().positive().optional(), // inches
  fit: z.enum(["contain", "cover", "fill", "none"]).default("contain"),
  constraints: ComponentConstraintsSchema,
});

// --- KPI / Metric Card ---

export const KpiCardBlockIRSchema = z.object({
  type: z.literal("kpi_card"),
  title: z.string(),
  value: z.union([z.string(), z.number()]),
  unit: z.string().optional(),
  change: z.number().optional(), // percentage change
  changeDirection: z.enum(["up", "down", "neutral"]).optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
  constraints: ComponentConstraintsSchema,
});

// --- Badge ---

export const BadgeBlockIRSchema = z.object({
  type: z.literal("badge"),
  text: z.string(),
  variant: z.enum(["default", "success", "warning", "error", "info", "primary"]).default("default"),
  constraints: ComponentConstraintsSchema,
});

// --- Callout / Alert ---

export const CalloutBlockIRSchema = z.object({
  type: z.literal("callout"),
  variant: z.enum(["info", "warning", "error", "success", "note", "tip"]).default("info"),
  title: z.string().optional(),
  text: z.string(),
  constraints: ComponentConstraintsSchema,
});

// --- Quote ---

export const QuoteBlockIRSchema = z.object({
  type: z.literal("quote"),
  text: z.string(),
  attribution: z.string().optional(),
  constraints: ComponentConstraintsSchema,
});

// --- Code ---

export const CodeBlockIRSchema = z.object({
  type: z.literal("code"),
  code: z.string(),
  language: z.string().optional(),
  showLineNumbers: z.boolean().default(false),
  constraints: ComponentConstraintsSchema,
});

// --- Layout blocks ---

export const DividerBlockIRSchema = z.object({
  type: z.literal("divider"),
  style: z.enum(["solid", "dashed", "dotted", "double"]).default("solid"),
  color: z.string().optional(),
});

export const SpacerBlockIRSchema = z.object({
  type: z.literal("spacer"),
  height: z.number().positive().default(0.5), // inches
});

export const PageBreakBlockIRSchema = z.object({
  type: z.literal("page_break"),
});

export const TocBlockIRSchema = z.object({
  type: z.literal("toc"),
  maxLevel: z.number().int().min(1).max(6).default(3),
});

// --- Column Layout ---

export const ColumnBlockIRSchema: z.ZodType<any> = z.object({
  type: z.literal("columns"),
  columns: z.array(z.object({
    width: z.number().positive().optional(), // fraction (0-1) or absolute inches
    blocks: z.array(z.lazy(() => BlockIRSchema)),
  })).min(2).max(4),
  gap: z.number().nonnegative().default(0.25), // inches
  constraints: ComponentConstraintsSchema,
});

/* ================================================================== */
/*  DISCRIMINATED UNION OF ALL BLOCKS                                  */
/* ================================================================== */

export const BlockIRSchema: z.ZodType<any> = z.discriminatedUnion("type", [
  HeadingBlockIRSchema,
  ParagraphBlockIRSchema,
  RichTextBlockIRSchema,
  BulletListBlockIRSchema,
  NumberedListBlockIRSchema,
  TableBlockIRSchema,
  ChartBlockIRSchema,
  ImageBlockIRSchema,
  KpiCardBlockIRSchema,
  BadgeBlockIRSchema,
  CalloutBlockIRSchema,
  QuoteBlockIRSchema,
  CodeBlockIRSchema,
  DividerBlockIRSchema,
  SpacerBlockIRSchema,
  PageBreakBlockIRSchema,
  TocBlockIRSchema,
  ColumnBlockIRSchema as any,
]);

export type BlockIR = z.infer<typeof BlockIRSchema>;

/* ================================================================== */
/*  SECTION                                                            */
/* ================================================================== */

export const SectionIRSchema = z.object({
  /** Unique section ID (auto-generated if not provided) */
  id: z.string().optional(),
  /** Section title (used in TOC, slide headers) */
  title: z.string().optional(),
  /** Theme variant override for this section */
  variant: z.string().optional(),
  /** Content blocks */
  blocks: z.array(BlockIRSchema).default([]),
  /** For PPT: slide type hint */
  slideType: z.enum(["cover", "content", "section_header", "closing", "blank"]).optional(),
  /** Slide notes (PPT only) */
  notes: z.string().optional(),
});

export type SectionIR = z.infer<typeof SectionIRSchema>;

/* ================================================================== */
/*  DOCUMENT METADATA                                                  */
/* ================================================================== */

export const DocumentMetadataIRSchema = z.object({
  title: z.string().default("Document"),
  author: z.string().optional(),
  subject: z.string().optional(),
  description: z.string().optional(),
  keywords: z.array(z.string()).default([]),
  language: z.string().default("en"),
  createdAt: z.string().optional(), // ISO date
  category: z.string().optional(),
  /** Custom metadata (limited to prevent abuse) */
  custom: z.record(z.union([z.string().max(1000), z.number(), z.boolean(), z.null()])).default({}),
});

export type DocumentMetadataIR = z.infer<typeof DocumentMetadataIRSchema>;

/* ================================================================== */
/*  OUTPUT FORMAT                                                      */
/* ================================================================== */

export const OutputFormatSchema = z.enum(["docx", "xlsx", "pptx"]);
export type OutputFormat = z.infer<typeof OutputFormatSchema>;

/* ================================================================== */
/*  DOCUMENT IR — TOP LEVEL                                            */
/* ================================================================== */

export const DocumentIRSchema = z.object({
  /** Schema version for forward compatibility */
  schemaVersion: z.string().default("2.0.0"),
  /** Output format */
  format: OutputFormatSchema,
  /** Document metadata */
  metadata: DocumentMetadataIRSchema.default({}),
  /** Theme: name string or inline DesignTokensV2 */
  theme: z.union([z.string(), z.record(z.any())]).default("default"),
  /** Sections (pages/slides/sheets) */
  sections: z.array(SectionIRSchema).min(1),
  /** Global constraints */
  constraints: ComponentConstraintsSchema,
});

export type DocumentIR = z.infer<typeof DocumentIRSchema>;

/* ================================================================== */
/*  HELPERS                                                            */
/* ================================================================== */

/**
 * Validate a DocumentIR and return parsed result with normalization.
 * Never throws — returns validation errors in the result.
 */
export function parseDocumentIR(input: unknown): {
  success: boolean;
  data?: DocumentIR;
  errors?: string[];
} {
  try {
    const parsed = DocumentIRSchema.parse(input);
    // Assign auto-IDs to sections missing them
    let sectionCounter = 0;
    for (const section of parsed.sections) {
      if (!section.id) {
        section.id = `section_${++sectionCounter}`;
      }
    }
    return { success: true, data: parsed };
  } catch (err) {
    if (err instanceof z.ZodError) {
      return {
        success: false,
        errors: err.errors.map(e => `${e.path.join(".")}: ${e.message}`),
      };
    }
    return {
      success: false,
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }
}

/**
 * Create a minimal valid DocumentIR from title and format.
 */
export function createMinimalIR(format: OutputFormat, title: string): DocumentIR {
  return {
    schemaVersion: "2.0.0",
    format,
    metadata: { title, keywords: [], language: "en", custom: {} },
    theme: "default",
    sections: [{
      blocks: [{
        type: "heading",
        level: 1,
        text: title,
        constraints: {},
      }],
    }],
    constraints: {},
  };
}
