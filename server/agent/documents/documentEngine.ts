/**
 * Document Generation Engine — Spec-driven "perfect" document generation.
 *
 * Uses JSON specs + design tokens + layout engine + validators to produce
 * deterministic, high-quality PPT/DOCX/XLSX documents.
 *
 * Architecture:
 *   1. Spec (JSON) → describes content, structure, styling
 *   2. Design Tokens → theme (fonts, colors, spacing)
 *   3. Layout Engine → deterministic positioning with anti-overflow
 *   4. Renderer → PptxGenJS / docx / ExcelJS
 *   5. Validator → verify output quality
 */

import { z } from "zod";

/* ================================================================== */
/*  DESIGN TOKENS                                                     */
/* ================================================================== */

export const DesignTokensSchema = z.object({
  font: z.object({
    heading: z.string().default("Calibri"),
    body: z.string().default("Calibri"),
    mono: z.string().default("Consolas"),
    sizeH1: z.number().default(28),
    sizeH2: z.number().default(22),
    sizeH3: z.number().default(18),
    sizeBody: z.number().default(12),
    sizeCaption: z.number().default(10),
    sizeMin: z.number().default(8),
  }).default({}),
  color: z.object({
    primary: z.string().default("#1a73e8"),
    secondary: z.string().default("#34a853"),
    accent: z.string().default("#ea4335"),
    warning: z.string().default("#fbbc04"),
    background: z.string().default("#ffffff"),
    surface: z.string().default("#f8f9fa"),
    textPrimary: z.string().default("#202124"),
    textSecondary: z.string().default("#5f6368"),
    border: z.string().default("#dadce0"),
    headerBg: z.string().default("#1a73e8"),
    headerFg: z.string().default("#ffffff"),
    zebraOdd: z.string().default("#f8f9fa"),
    zebraEven: z.string().default("#ffffff"),
  }).default({}),
  spacing: z.object({
    xs: z.number().default(4),
    sm: z.number().default(8),
    md: z.number().default(16),
    lg: z.number().default(24),
    xl: z.number().default(32),
    xxl: z.number().default(48),
  }).default({}),
  layout: z.object({
    slideWidth: z.number().default(10),   // inches
    slideHeight: z.number().default(7.5), // inches
    marginTop: z.number().default(0.5),
    marginBottom: z.number().default(0.5),
    marginLeft: z.number().default(0.5),
    marginRight: z.number().default(0.5),
    gridColumns: z.number().default(12),
  }).default({}),
});
export type DesignTokens = z.infer<typeof DesignTokensSchema>;

/* ================================================================== */
/*  SLIDE SPEC (PPT)                                                  */
/* ================================================================== */

export const SlideComponentSchema = z.object({
  type: z.enum(["title", "subtitle", "body", "bullets", "image", "chart", "table", "shape", "footer", "pageNumber"]),
  content: z.any(),
  style: z.record(z.any()).optional(),
  position: z.object({
    x: z.number().optional(),
    y: z.number().optional(),
    w: z.number().optional(),
    h: z.number().optional(),
  }).optional(),
});

export const SlideSpecSchema = z.object({
  type: z.enum(["cover", "agenda", "content", "section_header", "chart", "table", "comparison", "closing", "blank"]),
  components: z.array(SlideComponentSchema),
  notes: z.string().optional(),
  transition: z.string().optional(),
});

export const PresentationSpecSchema = z.object({
  format: z.literal("pptx"),
  title: z.string(),
  author: z.string().optional(),
  subject: z.string().optional(),
  theme: DesignTokensSchema.default({}),
  slides: z.array(SlideSpecSchema),
  metadata: z.record(z.any()).optional(),
});
export type PresentationSpec = z.infer<typeof PresentationSpecSchema>;

/* ================================================================== */
/*  DOCUMENT SPEC (DOCX)                                              */
/* ================================================================== */

export const DocSectionSchema = z.object({
  type: z.enum(["heading", "paragraph", "bullets", "numberedList", "table", "image", "pageBreak", "toc", "quote", "code"]),
  level: z.number().int().min(1).max(6).optional(),
  content: z.any(),
  style: z.record(z.any()).optional(),
});

export const DocumentSpecSchema = z.object({
  format: z.literal("docx"),
  title: z.string(),
  author: z.string().optional(),
  subject: z.string().optional(),
  theme: DesignTokensSchema.default({}),
  sections: z.array(DocSectionSchema),
  header: z.string().optional(),
  footer: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});
export type DocumentSpec = z.infer<typeof DocumentSpecSchema>;

/* ================================================================== */
/*  WORKBOOK SPEC (XLSX)                                              */
/* ================================================================== */

export const ColumnDefSchema = z.object({
  key: z.string(),
  header: z.string(),
  type: z.enum(["string", "number", "date", "currency", "percentage", "boolean", "formula"]).default("string"),
  width: z.number().positive().optional(),
  format: z.string().optional(),
  validation: z.object({
    type: z.enum(["list", "range", "length", "custom"]).optional(),
    values: z.array(z.string()).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    formula: z.string().optional(),
  }).optional(),
});

export const SheetSpecSchema = z.object({
  name: z.string(),
  columns: z.array(ColumnDefSchema),
  rows: z.array(z.record(z.any())),
  formulas: z.array(z.object({
    cell: z.string(),
    formula: z.string(),
  })).default([]),
  filters: z.boolean().default(true),
  freezeRow: z.number().int().min(0).default(1),
  freezeCol: z.number().int().min(0).default(0),
  protection: z.boolean().default(false),
});

export const WorkbookSpecSchema = z.object({
  format: z.literal("xlsx"),
  title: z.string(),
  author: z.string().optional(),
  theme: DesignTokensSchema.default({}),
  sheets: z.array(SheetSpecSchema),
  metadata: z.record(z.any()).optional(),
});
export type WorkbookSpec = z.infer<typeof WorkbookSpecSchema>;

/* ================================================================== */
/*  LAYOUT ENGINE                                                     */
/* ================================================================== */

export interface LayoutBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class LayoutEngine {
  private tokens: DesignTokens;

  constructor(tokens: DesignTokens) {
    this.tokens = tokens;
  }

  /**
   * Calculate bounding boxes for slide components.
   * Anti-overflow: ensures nothing exceeds slide boundaries.
   */
  calculateSlideLayout(components: z.infer<typeof SlideComponentSchema>[]): LayoutBox[] {
    const { layout } = this.tokens;
    const usableW = layout.slideWidth - layout.marginLeft - layout.marginRight;
    const usableH = layout.slideHeight - layout.marginTop - layout.marginBottom;

    let currentY = layout.marginTop;
    const boxes: LayoutBox[] = [];

    for (const comp of components) {
      // Use explicit position if provided
      if (comp.position?.x !== undefined && comp.position?.y !== undefined) {
        const box: LayoutBox = {
          x: Math.min(comp.position.x, layout.slideWidth - 0.5),
          y: Math.min(comp.position.y, layout.slideHeight - 0.5),
          w: Math.min(comp.position.w || usableW, layout.slideWidth - (comp.position.x || layout.marginLeft)),
          h: Math.min(comp.position.h || 1, layout.slideHeight - (comp.position.y || currentY)),
        };
        boxes.push(box);
        continue;
      }

      // Auto-layout
      const estimatedH = this.estimateComponentHeight(comp, usableW);
      const remainingH = layout.slideHeight - layout.marginBottom - currentY;

      // Anti-overflow: if component doesn't fit, cap it
      const actualH = Math.min(estimatedH, remainingH, usableH * 0.6);

      const box: LayoutBox = {
        x: layout.marginLeft,
        y: currentY,
        w: usableW,
        h: actualH,
      };

      boxes.push(box);
      currentY += actualH + this.tokens.spacing.sm / 72; // convert pt to inches
    }

    return boxes;
  }

  private estimateComponentHeight(comp: z.infer<typeof SlideComponentSchema>, width: number): number {
    switch (comp.type) {
      case "title":
        return 1.2;
      case "subtitle":
        return 0.8;
      case "body":
        return this.estimateTextHeight(String(comp.content || ""), width);
      case "bullets": {
        const items = Array.isArray(comp.content) ? comp.content.length : 1;
        return Math.min(items * 0.4 + 0.2, 4.0);
      }
      case "image":
        return 3.0;
      case "chart":
        return 3.5;
      case "table": {
        const rows = Array.isArray(comp.content) ? comp.content.length : 3;
        return Math.min(rows * 0.35 + 0.5, 4.5);
      }
      case "footer":
      case "pageNumber":
        return 0.3;
      default:
        return 1.0;
    }
  }

  private estimateTextHeight(text: string, width: number): number {
    // Rough heuristic: ~10 chars per inch at body size
    const charsPerLine = width * 10;
    const lines = Math.ceil(text.length / charsPerLine);
    return Math.max(0.5, lines * 0.3);
  }

  /**
   * Check if text needs to be truncated to fit a box.
   * Returns { fits, truncated, overflow }.
   */
  checkTextFit(text: string, box: LayoutBox, fontSize: number): {
    fits: boolean;
    truncated: string;
    overflow: boolean;
  } {
    const charsPerInch = 72 / fontSize * 1.5; // rough estimate
    const maxCharsPerLine = box.w * charsPerInch;
    const maxLines = Math.floor(box.h / (fontSize / 72 * 1.5));
    const maxChars = maxCharsPerLine * maxLines;

    if (text.length <= maxChars) {
      return { fits: true, truncated: text, overflow: false };
    }

    return {
      fits: false,
      truncated: text.slice(0, Math.max(0, maxChars - 3)) + "…",
      overflow: true,
    };
  }
}

/* ================================================================== */
/*  DOCUMENT GENERATOR                                                */
/* ================================================================== */

export class DocumentEngine {
  private layoutEngine: LayoutEngine;

  constructor(tokens?: DesignTokens) {
    const parsedTokens = DesignTokensSchema.parse(tokens || {});
    this.layoutEngine = new LayoutEngine(parsedTokens);
  }

  /**
   * Generate a presentation from a spec.
   */
  async generatePresentation(spec: PresentationSpec): Promise<Buffer> {
    const parsed = PresentationSpecSchema.parse(spec);
    const PptxGenJS = (await import("pptxgenjs")).default;

    const pptx = new PptxGenJS();
    pptx.title = parsed.title;
    if (parsed.author) pptx.author = parsed.author;
    if (parsed.subject) pptx.subject = parsed.subject;

    const tokens = DesignTokensSchema.parse(parsed.theme);
    const layout = new LayoutEngine(tokens);

    for (const slideSpec of parsed.slides) {
      const slide = pptx.addSlide();
      const boxes = layout.calculateSlideLayout(slideSpec.components);

      for (let i = 0; i < slideSpec.components.length; i++) {
        const comp = slideSpec.components[i];
        const box = boxes[i];
        this.renderSlideComponent(slide, comp, box, tokens);
      }

      if (slideSpec.notes) {
        slide.addNotes(slideSpec.notes);
      }
    }

    const data = await pptx.write({ outputType: "nodebuffer" });
    return Buffer.from(data as ArrayBuffer);
  }

  /**
   * Generate a Word document from a spec.
   */
  async generateDocument(spec: DocumentSpec): Promise<Buffer> {
    const parsed = DocumentSpecSchema.parse(spec);
    const { generateWordFromMarkdown } = await import("../../services/markdownToDocx");

    // Convert spec sections to markdown for the existing renderer
    let markdown = `# ${parsed.title}\n\n`;

    for (const section of parsed.sections) {
      switch (section.type) {
        case "heading": {
          const level = section.level || 1;
          markdown += `${"#".repeat(level)} ${section.content}\n\n`;
          break;
        }
        case "paragraph":
          markdown += `${section.content}\n\n`;
          break;
        case "bullets": {
          const items = Array.isArray(section.content) ? section.content : [section.content];
          items.forEach((item: string) => { markdown += `- ${item}\n`; });
          markdown += "\n";
          break;
        }
        case "numberedList": {
          const items = Array.isArray(section.content) ? section.content : [section.content];
          items.forEach((item: string, i: number) => { markdown += `${i + 1}. ${item}\n`; });
          markdown += "\n";
          break;
        }
        case "table": {
          if (Array.isArray(section.content) && section.content.length > 0) {
            const headers = section.content[0] as string[];
            markdown += `| ${headers.join(" | ")} |\n`;
            markdown += `| ${headers.map(() => "---").join(" | ")} |\n`;
            for (let r = 1; r < section.content.length; r++) {
              markdown += `| ${(section.content[r] as string[]).join(" | ")} |\n`;
            }
            markdown += "\n";
          }
          break;
        }
        case "pageBreak":
          markdown += "\n---\n\n";
          break;
        case "quote":
          markdown += `> ${section.content}\n\n`;
          break;
        case "code":
          markdown += `\`\`\`\n${section.content}\n\`\`\`\n\n`;
          break;
      }
    }

    const buffer = await generateWordFromMarkdown(markdown, parsed.title);
    return buffer;
  }

  /**
   * Generate an Excel workbook from a spec.
   */
  async generateWorkbook(spec: WorkbookSpec): Promise<Buffer> {
    const parsed = WorkbookSpecSchema.parse(spec);
    const ExcelJS = (await import("exceljs")).default;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = parsed.author || "ILIA Agent";
    workbook.created = new Date();

    const tokens = DesignTokensSchema.parse(parsed.theme);

    for (const sheetSpec of parsed.sheets) {
      const sheet = workbook.addWorksheet(sheetSpec.name);

      // Setup columns
      sheet.columns = sheetSpec.columns.map((col) => ({
        header: col.header,
        key: col.key,
        width: col.width || 15,
      }));

      // Style header row
      const headerRow = sheet.getRow(1);
      headerRow.font = { bold: true, color: { argb: tokens.color.headerFg.replace("#", "FF") }, size: 11 };
      headerRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: tokens.color.headerBg.replace("#", "FF") },
      };
      headerRow.alignment = { vertical: "middle", horizontal: "center" };
      headerRow.height = 25;

      // Add data rows
      for (let r = 0; r < sheetSpec.rows.length; r++) {
        const row = sheet.addRow(sheetSpec.rows[r]);

        // Zebra striping
        if (r % 2 === 0) {
          row.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: tokens.color.zebraOdd.replace("#", "FF") },
          };
        }

        // Apply column formats
        for (let c = 0; c < sheetSpec.columns.length; c++) {
          const colDef = sheetSpec.columns[c];
          const cell = row.getCell(c + 1);

          if (colDef.format) {
            cell.numFmt = colDef.format;
          }

          // Data validation
          if (colDef.validation?.type === "list" && colDef.validation.values) {
            cell.dataValidation = {
              type: "list",
              allowBlank: true,
              formulae: [`"${colDef.validation.values.join(",")}"`],
            };
          }
        }
      }

      // Apply formulas
      for (const formula of sheetSpec.formulas) {
        const cell = sheet.getCell(formula.cell);
        cell.value = { formula: formula.formula } as any;
      }

      // Auto-filter
      if (sheetSpec.filters && sheetSpec.columns.length > 0) {
        sheet.autoFilter = {
          from: { row: 1, column: 1 },
          to: { row: sheetSpec.rows.length + 1, column: sheetSpec.columns.length },
        };
      }

      // Freeze panes
      if (sheetSpec.freezeRow > 0 || sheetSpec.freezeCol > 0) {
        sheet.views = [{
          state: "frozen",
          xSplit: sheetSpec.freezeCol,
          ySplit: sheetSpec.freezeRow,
        }];
      }

      // Sheet protection
      if (sheetSpec.protection) {
        sheet.protect("", { selectLockedCells: true, selectUnlockedCells: true });
      }

      // Add borders to all cells
      const lastRow = sheetSpec.rows.length + 1;
      const lastCol = sheetSpec.columns.length;
      for (let r = 1; r <= lastRow; r++) {
        for (let c = 1; c <= lastCol; c++) {
          const cell = sheet.getCell(r, c);
          cell.border = {
            top: { style: "thin", color: { argb: tokens.color.border.replace("#", "FF") } },
            left: { style: "thin", color: { argb: tokens.color.border.replace("#", "FF") } },
            bottom: { style: "thin", color: { argb: tokens.color.border.replace("#", "FF") } },
            right: { style: "thin", color: { argb: tokens.color.border.replace("#", "FF") } },
          };
        }
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /* -- Slide Component Renderer ------------------------------------ */

  private renderSlideComponent(
    slide: any,
    comp: z.infer<typeof SlideComponentSchema>,
    box: LayoutBox,
    tokens: DesignTokens
  ): void {
    const baseTextOpts = {
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      fontFace: tokens.font.body,
      color: tokens.color.textPrimary,
      fontSize: tokens.font.sizeBody,
      valign: "top" as const,
    };

    switch (comp.type) {
      case "title":
        slide.addText(String(comp.content || ""), {
          ...baseTextOpts,
          fontSize: tokens.font.sizeH1,
          fontFace: tokens.font.heading,
          bold: true,
          valign: "middle" as const,
        });
        break;

      case "subtitle":
        slide.addText(String(comp.content || ""), {
          ...baseTextOpts,
          fontSize: tokens.font.sizeH2,
          color: tokens.color.textSecondary,
          valign: "middle" as const,
        });
        break;

      case "body": {
        const text = String(comp.content || "");
        const fit = this.layoutEngine.checkTextFit(text, box, tokens.font.sizeBody);
        slide.addText(fit.truncated, baseTextOpts);
        break;
      }

      case "bullets": {
        const items = Array.isArray(comp.content) ? comp.content : [comp.content];
        const textItems = items.map((item: string) => ({
          text: String(item),
          options: { bullet: true, fontSize: tokens.font.sizeBody },
        }));
        slide.addText(textItems, baseTextOpts);
        break;
      }

      case "table": {
        if (Array.isArray(comp.content) && comp.content.length > 0) {
          const tableRows = comp.content.map((row: any[], rowIdx: number) =>
            row.map((cell: any) => ({
              text: String(cell),
              options: {
                fontSize: tokens.font.sizeBody - 1,
                bold: rowIdx === 0,
                fill: rowIdx === 0
                  ? tokens.color.headerBg
                  : rowIdx % 2 === 0
                    ? tokens.color.zebraOdd
                    : tokens.color.zebraEven,
                color: rowIdx === 0 ? tokens.color.headerFg : tokens.color.textPrimary,
              },
            }))
          );

          slide.addTable(tableRows, {
            x: box.x,
            y: box.y,
            w: box.w,
            colW: Array(comp.content[0]?.length || 1).fill(box.w / (comp.content[0]?.length || 1)),
            border: { pt: 0.5, color: tokens.color.border },
            autoPage: false,
          });
        }
        break;
      }

      case "image":
        if (typeof comp.content === "string") {
          slide.addImage({
            path: comp.content,
            x: box.x,
            y: box.y,
            w: box.w,
            h: box.h,
          });
        }
        break;

      case "chart":
        // Charts would need specific PptxGenJS chart config
        slide.addText("[Chart Placeholder]", {
          ...baseTextOpts,
          align: "center",
          valign: "middle" as const,
          color: tokens.color.textSecondary,
          italic: true,
        });
        break;

      case "footer":
        slide.addText(String(comp.content || ""), {
          ...baseTextOpts,
          fontSize: tokens.font.sizeCaption,
          color: tokens.color.textSecondary,
          align: "center",
        });
        break;

      case "pageNumber":
        slide.addText("Slide {{slideNumber}}", {
          ...baseTextOpts,
          fontSize: tokens.font.sizeCaption,
          color: tokens.color.textSecondary,
          align: "right",
        });
        break;
    }
  }
}
