/**
 * DOCX Compiler — Translates DocumentIR to Word documents.
 *
 * Uses the `docx` npm library with proper styles.xml integration:
 *   - Paragraph styles mapped from DesignTokensV2 text presets
 *   - Numbering definitions for ordered lists
 *   - Table styles with header, stripe, borders from tokens
 *   - Page setup (margins, size, columns, headers/footers)
 *   - TOC via built-in Word field codes
 *   - Per-component graceful degradation
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  PageBreak,
  TableOfContents,
  convertInchesToTwip,
  AlignmentType,
  ShadingType,
  Footer,
  Header,
  PageNumber,
  NumberFormat,
  Tab,
  TabStopType,
  TabStopPosition,
} from "docx";

import type { DocumentIR, BlockIR, SectionIR } from "../documentIR";
import type { DesignTokensV2, TextStyle } from "../designTokens";
import { resolveTextStyleForBlock, resolveTableStyle } from "../componentRegistry";
import { DegradationEngine } from "../gracefulDegradation";

/* ================================================================== */
/*  HELPERS                                                            */
/* ================================================================== */

const HEADING_LEVEL_MAP: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

function alignmentFromString(align?: string): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  switch (align) {
    case "left": return AlignmentType.LEFT;
    case "center": return AlignmentType.CENTER;
    case "right": return AlignmentType.RIGHT;
    case "justify": return AlignmentType.JUSTIFIED;
    default: return undefined;
  }
}

function colorToArgb(hex: string): string {
  return hex.replace("#", "");
}

/** Page sizes in twips */
const PAGE_SIZES: Record<string, { width: number; height: number }> = {
  LETTER: { width: convertInchesToTwip(8.5), height: convertInchesToTwip(11) },
  A4: { width: convertInchesToTwip(8.27), height: convertInchesToTwip(11.69) },
  LEGAL: { width: convertInchesToTwip(8.5), height: convertInchesToTwip(14) },
  A3: { width: convertInchesToTwip(11.69), height: convertInchesToTwip(16.54) },
  A5: { width: convertInchesToTwip(5.83), height: convertInchesToTwip(8.27) },
};

/* ================================================================== */
/*  DOCX COMPILER                                                     */
/* ================================================================== */

export class DocxCompiler {
  private tokens: DesignTokensV2;
  private degradation: DegradationEngine;

  constructor(tokens: DesignTokensV2, degradation: DegradationEngine) {
    this.tokens = tokens;
    this.degradation = degradation;
  }

  async compile(ir: DocumentIR): Promise<Buffer> {
    const tokens = this.tokens;
    const docxConfig = tokens.docx;
    const margins = docxConfig.margins;
    const pageSize = PAGE_SIZES[docxConfig.pageSize] || PAGE_SIZES.LETTER;

    // Build body elements from all sections
    const bodyElements: (Paragraph | Table | TableOfContents)[] = [];

    for (let s = 0; s < ir.sections.length; s++) {
      const section = ir.sections[s];

      for (let b = 0; b < section.blocks.length; b++) {
        const block = section.blocks[b];
        const path = `sections[${s}].blocks[${b}]`;

        const elements = await this.degradation.withDegradation(
          block,
          path,
          () => this.renderBlock(block, path),
          (fallbackBlock) => this.renderBlock(fallbackBlock, path),
        );

        bodyElements.push(...elements);
      }

      // Add section break between sections (except last)
      if (s < ir.sections.length - 1 && section.blocks.length > 0) {
        // Only add spacer, not page break (docx handles flow naturally)
        bodyElements.push(new Paragraph({ spacing: { after: 200 } }));
      }
    }

    // Build the document
    const doc = new Document({
      title: ir.metadata.title,
      creator: ir.metadata.author || "IliaGPT",
      subject: ir.metadata.subject,
      description: ir.metadata.description,
      numbering: {
        config: [
          {
            reference: "default-numbering",
            levels: [
              {
                level: 0,
                format: "decimal" as any,
                text: "%1.",
                alignment: "start" as any,
                style: {
                  paragraph: {
                    indent: { left: 720, hanging: 360 },
                  },
                },
              },
            ],
          },
        ],
      },
      styles: {
        paragraphStyles: this.buildParagraphStyles(),
      },
      sections: [
        {
          properties: {
            page: {
              size: pageSize,
              margin: {
                top: convertInchesToTwip(margins.top),
                right: convertInchesToTwip(margins.right),
                bottom: convertInchesToTwip(margins.bottom),
                left: convertInchesToTwip(margins.left),
              },
            },
          },
          headers: docxConfig.headerText ? {
            default: new Header({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: docxConfig.headerText,
                      font: tokens.textStyles.caption.fontFamily,
                      size: tokens.textStyles.caption.fontSize * 2,
                      color: colorToArgb(tokens.colors.textMuted),
                    }),
                  ],
                  alignment: AlignmentType.RIGHT,
                }),
              ],
            }),
          } : undefined,
          footers: (docxConfig.footerText || docxConfig.showPageNumbers) ? {
            default: new Footer({
              children: [
                new Paragraph({
                  children: [
                    ...(docxConfig.footerText ? [
                      new TextRun({
                        text: docxConfig.footerText,
                        font: tokens.textStyles.caption.fontFamily,
                        size: tokens.textStyles.caption.fontSize * 2,
                        color: colorToArgb(tokens.colors.textMuted),
                      }),
                    ] : []),
                    ...(docxConfig.showPageNumbers ? [
                      new TextRun({
                        children: [new Tab(), PageNumber.CURRENT],
                        font: tokens.textStyles.caption.fontFamily,
                        size: tokens.textStyles.caption.fontSize * 2,
                        color: colorToArgb(tokens.colors.textMuted),
                      }),
                    ] : []),
                  ],
                  tabStops: [
                    { type: TabStopType.RIGHT, position: TabStopPosition.MAX },
                  ],
                }),
              ],
            }),
          } : undefined,
          children: bodyElements,
        },
      ],
    });

    return await Packer.toBuffer(doc);
  }

  /* ---------------------------------------------------------------- */
  /*  BLOCK RENDERING                                                  */
  /* ---------------------------------------------------------------- */

  private async renderBlock(
    block: BlockIR,
    path: string,
  ): Promise<(Paragraph | Table | TableOfContents)[]> {
    const any = block as any;

    switch (block.type) {
      case "heading":
        return [this.renderHeading(any)];

      case "paragraph":
        return [this.renderParagraph(any)];

      case "richtext":
        return [this.renderParagraph({ type: "paragraph", text: any.markdown, constraints: any.constraints })];

      case "bullets":
        return this.renderBullets(any);

      case "numbered":
        return this.renderNumbered(any);

      case "table":
        return [this.renderTable(any), new Paragraph({ spacing: { after: 200 } })];

      case "quote":
        return [this.renderQuote(any)];

      case "callout":
        return this.renderCallout(any);

      case "code":
        return [this.renderCode(any)];

      case "page_break":
        return [new Paragraph({ children: [new PageBreak()] })];

      case "toc":
        return [
          new TableOfContents("Table of Contents", {
            hyperlink: true,
            headingStyleRange: `1-${any.maxLevel || 3}`,
          }),
          new Paragraph({ spacing: { after: 400 } }),
        ];

      case "divider":
        return [new Paragraph({
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 1, color: colorToArgb(this.tokens.colors.border) },
          },
          spacing: { before: 200, after: 200 },
        })];

      case "spacer":
        return [new Paragraph({ spacing: { after: Math.round((any.height || 0.5) * 720) } })];

      case "kpi_card":
        return [this.renderKpiAsText(any)];

      case "badge":
        return [this.renderBadge(any)];

      case "image":
        // Images rendered as placeholder text (actual image embedding would require file access)
        return [new Paragraph({
          children: [
            new TextRun({
              text: `[Image: ${any.alt || any.caption || "image"}]`,
              italics: true,
              color: colorToArgb(this.tokens.colors.textMuted),
              font: this.tokens.textStyles.body.fontFamily,
              size: this.tokens.textStyles.body.fontSize * 2,
            }),
          ],
          spacing: { after: 200 },
        })];

      case "chart":
        return [new Paragraph({
          children: [
            new TextRun({
              text: `[Chart: ${any.title || any.chartType || "chart"}]`,
              italics: true,
              color: colorToArgb(this.tokens.colors.textMuted),
              font: this.tokens.textStyles.body.fontFamily,
              size: this.tokens.textStyles.body.fontSize * 2,
            }),
          ],
          spacing: { after: 200 },
        })];

      default:
        return [];
    }
  }

  private renderHeading(block: any): Paragraph {
    const style = resolveTextStyleForBlock(block, this.tokens);
    return new Paragraph({
      children: [
        new TextRun({
          text: block.text || "",
          font: style.fontFamily,
          size: style.fontSize * 2,
          bold: style.fontWeight === "bold",
          color: colorToArgb(style.color),
        }),
      ],
      heading: HEADING_LEVEL_MAP[block.level || 1] || HeadingLevel.HEADING_1,
      spacing: { before: 240, after: 120 },
    });
  }

  private renderParagraph(block: any): Paragraph {
    const style = resolveTextStyleForBlock(block, this.tokens);
    return new Paragraph({
      children: [
        new TextRun({
          text: block.text || "",
          font: style.fontFamily,
          size: style.fontSize * 2,
          bold: style.fontWeight === "bold",
          italics: style.fontStyle === "italic",
          color: colorToArgb(style.color),
        }),
      ],
      alignment: alignmentFromString(style.textAlign),
      spacing: { after: 200, line: Math.round(style.lineHeight * 240) },
    });
  }

  private renderBullets(block: any): Paragraph[] {
    const style = this.tokens.textStyles.body;
    return (block.items || []).slice(0, 1000).map((item: string) =>
      new Paragraph({
        children: [
          new TextRun({
            text: item,
            font: style.fontFamily,
            size: style.fontSize * 2,
            color: colorToArgb(style.color),
          }),
        ],
        bullet: { level: block.level || 0 },
        spacing: { after: 80 },
      })
    );
  }

  private renderNumbered(block: any): Paragraph[] {
    const style = this.tokens.textStyles.body;
    return (block.items || []).slice(0, 1000).map((item: string) =>
      new Paragraph({
        children: [
          new TextRun({
            text: item,
            font: style.fontFamily,
            size: style.fontSize * 2,
            color: colorToArgb(style.color),
          }),
        ],
        numbering: { reference: "default-numbering", level: 0 },
        spacing: { after: 80 },
      })
    );
  }

  private renderTable(block: any): Table {
    const tableStyle = resolveTableStyle(this.tokens);
    const columns = block.columns || [];
    const rows: TableRow[] = [];

    // Header row
    if (block.showHeader !== false && columns.length > 0) {
      const headerCells = columns.map((col: any) =>
        new TableCell({
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: col.header || col.key || "",
                  bold: true,
                  font: this.tokens.textStyles.body.fontFamily,
                  size: tableStyle.headerFontSize * 2,
                  color: colorToArgb(tableStyle.headerFg),
                }),
              ],
              alignment: alignmentFromString(tableStyle.headerAlign),
            }),
          ],
          shading: {
            fill: colorToArgb(tableStyle.headerBg),
            type: ShadingType.CLEAR,
            color: "auto",
          },
          width: col.width
            ? { size: col.width * 1440, type: WidthType.DXA }
            : undefined,
        })
      );
      rows.push(new TableRow({ children: headerCells }));
    }

    // Data rows
    const dataRows = (block.rows || []).slice(0, 5000);
    for (let r = 0; r < dataRows.length; r++) {
      const rowData = dataRows[r];
      const isOddRow = r % 2 === 0;
      const bgColor = block.showStripes
        ? (isOddRow ? tableStyle.stripeOdd : tableStyle.stripeEven)
        : tableStyle.stripeEven;

      const dataCells = columns.map((col: any) =>
        new TableCell({
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: String(rowData[col.key] ?? ""),
                  font: this.tokens.textStyles.body.fontFamily,
                  size: tableStyle.bodyFontSize * 2,
                  color: colorToArgb(tableStyle.bodyColor),
                }),
              ],
              alignment: alignmentFromString(col.align),
            }),
          ],
          shading: {
            fill: colorToArgb(bgColor),
            type: ShadingType.CLEAR,
            color: "auto",
          },
        })
      );
      rows.push(new TableRow({ children: dataCells }));
    }

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows,
    });
  }

  private renderQuote(block: any): Paragraph {
    const style = this.tokens.textStyles.quote;
    const attribution = block.attribution ? ` — ${block.attribution}` : "";
    return new Paragraph({
      children: [
        new TextRun({
          text: `"${block.text || ""}"${attribution}`,
          font: style.fontFamily,
          size: style.fontSize * 2,
          italics: true,
          color: colorToArgb(style.color),
        }),
      ],
      indent: { left: 720, right: 720 },
      border: {
        left: { style: BorderStyle.SINGLE, size: 6, color: colorToArgb(this.tokens.colors.primary) },
      },
      spacing: { before: 200, after: 200 },
    });
  }

  private renderCallout(block: any): Paragraph[] {
    const variantColors: Record<string, string> = {
      info: this.tokens.colors.info,
      warning: this.tokens.colors.warning,
      error: this.tokens.colors.error,
      success: this.tokens.colors.success,
      note: this.tokens.colors.secondary,
      tip: this.tokens.colors.success,
    };

    const borderColor = variantColors[block.variant] || this.tokens.colors.info;
    const style = this.tokens.textStyles.body;
    const result: Paragraph[] = [];

    if (block.title) {
      result.push(new Paragraph({
        children: [
          new TextRun({
            text: `${block.variant?.toUpperCase() || "NOTE"}: ${block.title}`,
            font: style.fontFamily,
            size: style.fontSize * 2,
            bold: true,
            color: colorToArgb(borderColor),
          }),
        ],
        border: {
          left: { style: BorderStyle.SINGLE, size: 6, color: colorToArgb(borderColor) },
        },
        indent: { left: 360 },
        spacing: { before: 200 },
      }));
    }

    result.push(new Paragraph({
      children: [
        new TextRun({
          text: block.text || "",
          font: style.fontFamily,
          size: style.fontSize * 2,
          color: colorToArgb(style.color),
        }),
      ],
      border: {
        left: { style: BorderStyle.SINGLE, size: 6, color: colorToArgb(borderColor) },
      },
      indent: { left: 360 },
      spacing: { after: 200 },
    }));

    return result;
  }

  private renderCode(block: any): Paragraph {
    const style = this.tokens.textStyles.code;
    return new Paragraph({
      children: [
        new TextRun({
          text: block.code || "",
          font: style.fontFamily,
          size: style.fontSize * 2,
          color: colorToArgb(style.color),
        }),
      ],
      shading: {
        fill: colorToArgb(this.tokens.colors.surface),
        type: ShadingType.CLEAR,
        color: "auto",
      },
      spacing: { before: 120, after: 120 },
      indent: { left: 360 },
    });
  }

  private renderKpiAsText(block: any): Paragraph {
    return new Paragraph({
      children: [
        new TextRun({
          text: `${block.title || "Metric"}: `,
          font: this.tokens.textStyles.body.fontFamily,
          size: this.tokens.textStyles.body.fontSize * 2,
          bold: true,
          color: colorToArgb(this.tokens.colors.textPrimary),
        }),
        new TextRun({
          text: `${block.value || ""}${block.unit ? ` ${block.unit}` : ""}`,
          font: this.tokens.textStyles.body.fontFamily,
          size: this.tokens.textStyles.h3.fontSize * 2,
          bold: true,
          color: colorToArgb(block.color || this.tokens.colors.primary),
        }),
      ],
      spacing: { after: 120 },
    });
  }

  private renderBadge(block: any): Paragraph {
    const variantColors: Record<string, string> = {
      default: this.tokens.colors.textSecondary,
      success: this.tokens.colors.success,
      warning: this.tokens.colors.warning,
      error: this.tokens.colors.error,
      info: this.tokens.colors.info,
      primary: this.tokens.colors.primary,
    };
    const color = variantColors[block.variant] || this.tokens.colors.textSecondary;
    return new Paragraph({
      children: [
        new TextRun({
          text: `[${block.text || ""}]`,
          font: this.tokens.textStyles.caption.fontFamily,
          size: this.tokens.textStyles.caption.fontSize * 2,
          bold: true,
          color: colorToArgb(color),
        }),
      ],
      spacing: { after: 80 },
    });
  }

  /* ---------------------------------------------------------------- */
  /*  STYLES                                                           */
  /* ---------------------------------------------------------------- */

  private buildParagraphStyles(): any[] {
    const styles = this.tokens.textStyles;
    return [
      {
        id: "Normal",
        name: "Normal",
        basedOn: "Normal",
        next: "Normal",
        run: {
          font: styles.body.fontFamily,
          size: styles.body.fontSize * 2,
          color: colorToArgb(styles.body.color),
        },
        paragraph: { spacing: { line: Math.round(styles.body.lineHeight * 240) } },
      },
      {
        id: "Title",
        name: "Title",
        basedOn: "Normal",
        next: "Normal",
        run: {
          font: styles.title.fontFamily,
          size: styles.title.fontSize * 2,
          bold: true,
          color: colorToArgb(styles.title.color),
        },
        paragraph: { spacing: { after: 400 }, alignment: AlignmentType.CENTER },
      },
    ];
  }
}
