import { z } from "zod";

// -------------------------
// Excel (XLSX) specification
// -------------------------

export const tableSpecSchema = z.object({
  anchor: z.string().describe("Top-left cell, e.g. 'A1'"),
  headers: z.array(z.string()).min(1),
  rows: z.array(z.array(z.any())).default([]),
  table_style: z.string().default("TableStyleMedium9").describe("Excel table style name (OpenXML)"),
  column_formats: z.record(z.string(), z.string()).default({}).describe("Map header -> Excel number format"),
  autofilter: z.boolean().default(true),
  freeze_header: z.boolean().default(true),
});

export type TableSpec = z.infer<typeof tableSpecSchema>;

export const chartSpecSchema = z.object({
  type: z.enum(["bar", "line", "pie"]).default("bar"),
  title: z.string().default(""),
  categories_range: z.string().describe("Excel A1 range for categories, e.g. 'A2:A10'"),
  values_range: z.string().describe("Excel A1 range for values, e.g. 'B2:B10'"),
  position: z.string().default("H2").describe("Top-left position of the chart"),
});

export type ChartSpec = z.infer<typeof chartSpecSchema>;

export const sheetLayoutSpecSchema = z.object({
  freeze_panes: z.string().nullable().optional().describe("Cell reference for freeze panes, e.g. 'A2'"),
  auto_fit_columns: z.boolean().default(true),
  column_widths: z.record(z.string(), z.number()).default({}).describe("Map column letter -> width"),
  show_gridlines: z.boolean().default(true),
});

export type SheetLayoutSpec = z.infer<typeof sheetLayoutSpecSchema>;

export const sheetSpecSchema = z.object({
  name: z.string().min(1).max(31),
  tables: z.array(tableSpecSchema).default([]),
  charts: z.array(chartSpecSchema).default([]),
  layout: sheetLayoutSpecSchema.default({}),
});

export type SheetSpec = z.infer<typeof sheetSpecSchema>;

export const excelSpecSchema = z.object({
  workbook_title: z.string().default("Report"),
  sheets: z.array(sheetSpecSchema).min(1),
});

export type ExcelSpec = z.infer<typeof excelSpecSchema>;

// ------------------------
// Word (DOCX) specification
// ------------------------

export const headingBlockSchema = z.object({
  type: z.literal("heading"),
  level: z.number().int().min(1).max(6).default(1),
  text: z.string(),
});

export type HeadingBlock = z.infer<typeof headingBlockSchema>;

export const paragraphBlockSchema = z.object({
  type: z.literal("paragraph"),
  text: z.string(),
});

export type ParagraphBlock = z.infer<typeof paragraphBlockSchema>;

export const bulletsBlockSchema = z.object({
  type: z.literal("bullets"),
  items: z.array(z.string()).min(1),
});

export type BulletsBlock = z.infer<typeof bulletsBlockSchema>;

export const tableBlockSchema = z.object({
  type: z.literal("table"),
  columns: z.array(z.string()).min(1),
  rows: z.array(z.array(z.any())).default([]),
  style: z.string().default("Light Shading").describe("Word table style name"),
});

export type TableBlock = z.infer<typeof tableBlockSchema>;

export const pageBreakBlockSchema = z.object({
  type: z.literal("page_break"),
});

export type PageBreakBlock = z.infer<typeof pageBreakBlockSchema>;

export const docBlockSchema = z.discriminatedUnion("type", [
  headingBlockSchema,
  paragraphBlockSchema,
  bulletsBlockSchema,
  tableBlockSchema,
  pageBreakBlockSchema,
]);

export type DocBlock = z.infer<typeof docBlockSchema>;

export const docSpecSchema = z.object({
  title: z.string().default("Document"),
  author: z.string().nullable().optional(),
  add_toc: z.boolean().default(false),
  blocks: z.array(docBlockSchema).default([]).describe("Ordered content blocks"),
});

export type DocSpec = z.infer<typeof docSpecSchema>;

// JSON Schema exports for LLM prompts
export const excelSpecJsonSchema = {
  type: "object",
  properties: {
    workbook_title: { type: "string", default: "Report" },
    sheets: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1, maxLength: 31 },
          tables: {
            type: "array",
            items: {
              type: "object",
              properties: {
                anchor: { type: "string", description: "Top-left cell, e.g. 'A1'" },
                headers: { type: "array", items: { type: "string" }, minItems: 1 },
                rows: { type: "array", items: { type: "array" } },
                table_style: { type: "string", default: "TableStyleMedium9" },
                column_formats: { type: "object", additionalProperties: { type: "string" } },
                autofilter: { type: "boolean", default: true },
                freeze_header: { type: "boolean", default: true },
              },
              required: ["anchor", "headers"],
            },
          },
          charts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["bar", "line", "pie"], default: "bar" },
                title: { type: "string" },
                categories_range: { type: "string" },
                values_range: { type: "string" },
                position: { type: "string", default: "H2" },
              },
              required: ["categories_range", "values_range"],
            },
          },
          layout: {
            type: "object",
            properties: {
              freeze_panes: { type: "string", nullable: true },
              auto_fit_columns: { type: "boolean", default: true },
              column_widths: { type: "object", additionalProperties: { type: "number" } },
              show_gridlines: { type: "boolean", default: true },
            },
          },
        },
        required: ["name"],
      },
    },
  },
  required: ["sheets"],
};

export const docSpecJsonSchema = {
  type: "object",
  properties: {
    title: { type: "string", default: "Document" },
    author: { type: "string", nullable: true },
    add_toc: { type: "boolean", default: false },
    blocks: {
      type: "array",
      items: {
        oneOf: [
          {
            type: "object",
            properties: {
              type: { const: "heading" },
              level: { type: "integer", minimum: 1, maximum: 6 },
              text: { type: "string" },
            },
            required: ["type", "text"],
          },
          {
            type: "object",
            properties: {
              type: { const: "paragraph" },
              text: { type: "string" },
            },
            required: ["type", "text"],
          },
          {
            type: "object",
            properties: {
              type: { const: "bullets" },
              items: { type: "array", items: { type: "string" }, minItems: 1 },
            },
            required: ["type", "items"],
          },
          {
            type: "object",
            properties: {
              type: { const: "table" },
              columns: { type: "array", items: { type: "string" }, minItems: 1 },
              rows: { type: "array", items: { type: "array" } },
              style: { type: "string", default: "Light Shading" },
            },
            required: ["type", "columns"],
          },
          {
            type: "object",
            properties: {
              type: { const: "page_break" },
            },
            required: ["type"],
          },
        ],
      },
    },
  },
  required: [],
};
