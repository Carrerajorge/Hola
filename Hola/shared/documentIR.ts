/**
 * Document Intermediate Representation (IR)
 *
 * A single, format-agnostic semantic model that describes the CONTENT and
 * STRUCTURE of any document.  Compilers translate this IR into Word (DOCX),
 * Excel (XLSX), or PowerPoint (PPTX).
 *
 * ── Design Goals ──
 * 1. Deterministic: identical IR always produces identical output.
 * 2. Validated: Zod schemas enforce contracts at the boundary.
 * 3. Extensible: new node types can be added without changing compilers
 *    (unknown types are rendered via graceful degradation).
 * 4. Format-agnostic: no Open-XML, no PptxGenJS, no ExcelJS specifics.
 */
import { z } from "zod";

// ─── Shared Primitives ──────────────────────────────────────────────

export const richTextSpanSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strikethrough: z.boolean().optional(),
  code: z.boolean().optional(),
  superscript: z.boolean().optional(),
  subscript: z.boolean().optional(),
  color: z.string().optional().describe("Hex color override"),
  fontSize: z.number().optional().describe("Half-points override"),
  fontFamily: z.string().optional(),
  link: z.string().optional().describe("URL for hyperlink"),
});
export type RichTextSpan = z.infer<typeof richTextSpanSchema>;

export const richTextSchema = z.array(richTextSpanSchema).min(1);
export type RichText = z.infer<typeof richTextSchema>;

/** Convenience: convert a plain string to RichText */
export function plainText(text: string): RichText {
  return [{ text }];
}

// ─── Content Nodes ──────────────────────────────────────────────────

export const titleNodeSchema = z.object({
  type: z.literal("title"),
  content: richTextSchema,
  subtitle: richTextSchema.optional(),
});

export const headingNodeSchema = z.object({
  type: z.literal("heading"),
  level: z.number().int().min(1).max(6),
  content: richTextSchema,
});

export const paragraphNodeSchema = z.object({
  type: z.literal("paragraph"),
  content: richTextSchema,
  alignment: z.enum(["left", "center", "right", "justify"]).optional(),
  indent: z.number().int().min(0).max(10).optional(),
});

export const bulletListNodeSchema = z.object({
  type: z.literal("bullet_list"),
  items: z.array(richTextSchema).min(1),
  level: z.number().int().min(0).max(8).optional(),
});

export const numberedListNodeSchema = z.object({
  type: z.literal("numbered_list"),
  items: z.array(richTextSchema).min(1),
  startAt: z.number().int().min(1).optional(),
});

export const tableNodeSchema = z.object({
  type: z.literal("table"),
  columns: z.array(z.object({
    header: richTextSchema,
    width: z.number().optional().describe("Percentage width 0-100"),
    align: z.enum(["left", "center", "right"]).optional(),
    format: z.string().optional().describe("Number format for Excel, e.g. '#,##0.00'"),
  })).min(1),
  rows: z.array(z.array(z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    richTextSchema,
  ]))).default([]),
  caption: z.string().optional(),
  showHeader: z.boolean().default(true),
  striped: z.boolean().default(true),
});

export const imageNodeSchema = z.object({
  type: z.literal("image"),
  /** data: URI, https: URL, or a buffer reference id */
  src: z.string(),
  alt: z.string().optional(),
  caption: z.string().optional(),
  width: z.number().optional().describe("Width in inches"),
  height: z.number().optional().describe("Height in inches"),
});

export const chartNodeSchema = z.object({
  type: z.literal("chart"),
  chartType: z.enum(["bar", "line", "pie", "doughnut", "area", "scatter"]),
  title: z.string().optional(),
  categories: z.array(z.string()),
  series: z.array(z.object({
    name: z.string(),
    values: z.array(z.number()),
    color: z.string().optional(),
  })).min(1),
});

export const codeBlockNodeSchema = z.object({
  type: z.literal("code_block"),
  language: z.string().optional(),
  code: z.string(),
});

export const quoteNodeSchema = z.object({
  type: z.literal("quote"),
  content: richTextSchema,
  attribution: z.string().optional(),
});

export const dividerNodeSchema = z.object({
  type: z.literal("divider"),
});

export const pageBreakNodeSchema = z.object({
  type: z.literal("page_break"),
});

export const tocNodeSchema = z.object({
  type: z.literal("toc"),
  maxLevel: z.number().int().min(1).max(6).default(3),
});

export const spacerNodeSchema = z.object({
  type: z.literal("spacer"),
  height: z.number().describe("Height in twips (Word) or points (PPT)"),
});

export const kpiCardNodeSchema = z.object({
  type: z.literal("kpi_card"),
  label: z.string(),
  value: z.string(),
  trend: z.enum(["up", "down", "flat"]).optional(),
  color: z.string().optional(),
});

// ─── Discriminated Union of All Node Types ─────────────────────────

export const contentNodeSchema = z.discriminatedUnion("type", [
  titleNodeSchema,
  headingNodeSchema,
  paragraphNodeSchema,
  bulletListNodeSchema,
  numberedListNodeSchema,
  tableNodeSchema,
  imageNodeSchema,
  chartNodeSchema,
  codeBlockNodeSchema,
  quoteNodeSchema,
  dividerNodeSchema,
  pageBreakNodeSchema,
  tocNodeSchema,
  spacerNodeSchema,
  kpiCardNodeSchema,
]);

export type ContentNode = z.infer<typeof contentNodeSchema>;

// ─── Section (groups nodes, maps to pages/slides/sheets) ───────────

export const sectionSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  /** Nodes inside this section */
  nodes: z.array(contentNodeSchema).default([]),
  /** Layout hint for PPTX slide type */
  layout: z.enum([
    "default", "title", "section", "two-column", "blank", "comparison",
  ]).default("default"),
  /** Background override */
  background: z.object({
    color: z.string().optional(),
    image: z.string().optional(),
  }).optional(),
  /** Speaker notes (PPTX only) */
  notes: z.string().optional(),
});

export type Section = z.infer<typeof sectionSchema>;

// ─── Top-Level Document IR ─────────────────────────────────────────

export const documentMetadataSchema = z.object({
  title: z.string().default("Document"),
  author: z.string().optional(),
  subject: z.string().optional(),
  company: z.string().optional(),
  language: z.string().default("es"),
  createdAt: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export type DocumentMetadata = z.infer<typeof documentMetadataSchema>;

export const documentIRSchema = z.object({
  /** Schema version for forward-compat */
  version: z.literal("1.0"),
  /** Target format(s) — compilers check this */
  format: z.enum(["docx", "xlsx", "pptx", "auto"]).default("auto"),
  /** Theme id from design tokens */
  themeId: z.string().default("corporate"),
  /** Optional partial design-token overrides */
  themeOverrides: z.record(z.any()).optional(),
  /** Document metadata */
  metadata: documentMetadataSchema.default({}),
  /** Ordered sections — each becomes page(s)/slide(s)/sheet(s) */
  sections: z.array(sectionSchema).min(1),
  /** Optional header/footer for Word */
  header: z.object({
    left: z.string().optional(),
    center: z.string().optional(),
    right: z.string().optional(),
  }).optional(),
  footer: z.object({
    left: z.string().optional(),
    center: z.string().optional(),
    right: z.string().optional(),
    pageNumbers: z.boolean().default(true),
  }).optional(),
});

export type DocumentIR = z.infer<typeof documentIRSchema>;

// ─── Compilation Result ────────────────────────────────────────────

export interface CompilationDiagnostic {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  /** Path to the offending node, e.g. "sections[2].nodes[4]" */
  path?: string;
  /** If a fallback was used, what the original component was */
  fallbackUsed?: boolean;
}

export interface CompilationResult {
  /** Was the compilation successful (may still have warnings) */
  success: boolean;
  /** The generated file buffer (null on hard failure) */
  buffer: Buffer | null;
  /** MIME type */
  mimeType: string;
  /** Suggested filename */
  filename: string;
  /** Size in bytes */
  sizeBytes: number;
  /** Diagnostics collected during compilation */
  diagnostics: CompilationDiagnostic[];
  /** How long compilation took in ms */
  durationMs: number;
  /** Theme used */
  themeId: string;
}

// ─── Helpers ───────────────────────────────────────────────────────

/** Type-guard for checking if a value is RichText */
export function isRichText(val: unknown): val is RichText {
  return Array.isArray(val) && val.length > 0 && typeof val[0]?.text === "string";
}

/** Flatten RichText to plain string */
export function richTextToPlain(rt: RichText): string {
  return rt.map((s) => s.text).join("");
}

/** Cell value to display string */
export function cellToString(cell: string | number | boolean | null | RichText): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "string") return cell;
  if (typeof cell === "number" || typeof cell === "boolean") return String(cell);
  if (isRichText(cell)) return richTextToPlain(cell);
  return String(cell);
}
