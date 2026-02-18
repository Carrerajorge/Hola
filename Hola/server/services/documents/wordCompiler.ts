/**
 * Word Compiler — translates DocumentIR → DOCX buffer using the `docx` library.
 *
 * All styles flow from DesignTokens.  Every node is wrapped in safeCompile for
 * graceful degradation.
 */
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ExternalHyperlink,
  TableOfContents, PageBreak, Header, Footer, PageNumber,
  type IParagraphOptions, type IRunOptions, type ISectionOptions,
  LevelFormat,
  ShadingType,
  convertInchesToTwip,
} from "docx";
import {
  DocumentIR, ContentNode, RichText, RichTextSpan,
  Section, CompilationResult, CompilationDiagnostic,
  richTextToPlain, cellToString, isRichText,
} from "@shared/documentIR";
import { DesignTokenSet, normalizeHex } from "@shared/documentDesignTokens";
import { safeCompile, nodeSummary, chunkItems, truncateWithEllipsis } from "./safeRenderer";

// ─── Heading Level Map ─────────────────────────────────────────────

const HEADING_MAP: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

const ALIGNMENT_MAP: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

// ─── Public Entry Point ────────────────────────────────────────────

export async function compileWord(
  ir: DocumentIR,
  tokens: DesignTokenSet,
): Promise<CompilationResult> {
  const start = Date.now();
  const diagnostics: CompilationDiagnostic[] = [];

  try {
    const sections: ISectionOptions[] = [];

    for (let si = 0; si < ir.sections.length; si++) {
      const section = ir.sections[si];
      const children = compileSectionChildren(section, si, tokens, diagnostics);

      const sectionOpts: ISectionOptions = {
        properties: {
          page: {
            margin: {
              top: tokens.spacing.marginTop,
              bottom: tokens.spacing.marginBottom,
              left: tokens.spacing.marginLeft,
              right: tokens.spacing.marginRight,
            },
          },
        },
        children,
      };

      // Header/Footer on first section
      if (si === 0) {
        if (ir.header) {
          sectionOpts.headers = {
            default: new Header({
              children: [new Paragraph({
                children: [
                  new TextRun({ text: ir.header.left || "", font: tokens.typography.bodyFont, size: tokens.typography.sizeSmall }),
                  new TextRun({ text: "\t" }),
                  new TextRun({ text: ir.header.center || "", font: tokens.typography.bodyFont, size: tokens.typography.sizeSmall }),
                  new TextRun({ text: "\t" }),
                  new TextRun({ text: ir.header.right || "", font: tokens.typography.bodyFont, size: tokens.typography.sizeSmall }),
                ],
              })],
            }),
          };
        }
        if (ir.footer) {
          const footerChildren: (TextRun | PageNumber)[] = [
            new TextRun({ text: ir.footer.left || "", font: tokens.typography.bodyFont, size: tokens.typography.sizeCaption }),
            new TextRun({ text: "\t" }),
          ];
          if (ir.footer.pageNumbers) {
            footerChildren.push(new TextRun({ text: "\t", font: tokens.typography.bodyFont }));
            footerChildren.push(new TextRun({ children: [PageNumber.CURRENT], font: tokens.typography.bodyFont, size: tokens.typography.sizeCaption }));
          }
          sectionOpts.footers = {
            default: new Footer({
              children: [new Paragraph({ children: footerChildren })],
            }),
          };
        }
      }

      sections.push(sectionOpts);
    }

    const doc = new Document({
      creator: ir.metadata.author || "Hola",
      title: ir.metadata.title,
      subject: ir.metadata.subject,
      styles: buildStyles(tokens),
      numbering: {
        config: [{
          reference: "default-numbering",
          levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
        }, {
          reference: "bullet-numbering",
          levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
        }],
      },
      sections,
    });

    const buffer = Buffer.from(await Packer.toBuffer(doc));

    return {
      success: true,
      buffer,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      filename: `${sanitizeFilename(ir.metadata.title)}.docx`,
      sizeBytes: buffer.length,
      diagnostics,
      durationMs: Date.now() - start,
      themeId: tokens.id,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    diagnostics.push({ severity: "error", code: "COMPILE_FATAL", message: msg });
    return {
      success: false,
      buffer: null,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      filename: "error.docx",
      sizeBytes: 0,
      diagnostics,
      durationMs: Date.now() - start,
      themeId: tokens.id,
    };
  }
}

// ─── Section → Children ────────────────────────────────────────────

function compileSectionChildren(
  section: Section,
  sectionIdx: number,
  tokens: DesignTokenSet,
  diag: CompilationDiagnostic[],
): (Paragraph | Table | TableOfContents)[] {
  const children: (Paragraph | Table | TableOfContents)[] = [];

  for (let ni = 0; ni < section.nodes.length; ni++) {
    const node = section.nodes[ni];
    const path = `sections[${sectionIdx}].nodes[${ni}]`;

    const result = safeCompile(
      () => compileNode(node, tokens, path, diag),
      () => new Paragraph({
        children: [new TextRun({ text: nodeSummary(node), italics: true, color: tokens.colors.textMuted, font: tokens.typography.bodyFont, size: tokens.typography.sizeBody })],
        spacing: { after: tokens.typography.paragraphAfter },
      }),
      path,
      diag,
    );

    if (Array.isArray(result)) children.push(...result);
    else children.push(result);
  }

  return children;
}

// ─── Node → Docx Elements ──────────────────────────────────────────

function compileNode(
  node: ContentNode,
  tokens: DesignTokenSet,
  path: string,
  diag: CompilationDiagnostic[],
): (Paragraph | Table | TableOfContents) | (Paragraph | Table | TableOfContents)[] {
  switch (node.type) {
    case "title":
      return new Paragraph({
        children: compileRichText(node.content, tokens, { bold: true, size: tokens.typography.sizeH1, color: tokens.colors.primary, font: tokens.typography.headingFont }),
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
      });

    case "heading":
      return new Paragraph({
        children: compileRichText(node.content, tokens, { bold: true, color: tokens.colors.primary, font: tokens.typography.headingFont }),
        heading: HEADING_MAP[node.level] || HeadingLevel.HEADING_1,
        spacing: { before: 240, after: 120 },
      });

    case "paragraph":
      return new Paragraph({
        children: compileRichText(node.content, tokens),
        alignment: ALIGNMENT_MAP[node.alignment || "left"],
        spacing: { after: tokens.typography.paragraphAfter },
      });

    case "bullet_list":
      return node.items.map((item) =>
        new Paragraph({
          children: compileRichText(item, tokens),
          numbering: { reference: "bullet-numbering", level: node.level ?? 0 },
          spacing: { after: 60 },
        }),
      );

    case "numbered_list":
      return node.items.map((item) =>
        new Paragraph({
          children: compileRichText(item, tokens),
          numbering: { reference: "default-numbering", level: 0 },
          spacing: { after: 60 },
        }),
      );

    case "table":
      return compileTable(node, tokens, path, diag);

    case "image":
      // Images require async fetching; degrade to alt-text in sync compilation
      return new Paragraph({
        children: [new TextRun({ text: `[Image: ${node.alt || node.caption || ""}]`, italics: true, color: tokens.colors.textMuted, font: tokens.typography.bodyFont, size: tokens.typography.sizeBody })],
        spacing: { after: tokens.typography.paragraphAfter },
      });

    case "chart":
      return new Paragraph({
        children: [new TextRun({ text: `[Chart: ${node.chartType} — ${node.title || ""}]`, italics: true, color: tokens.colors.textMuted, font: tokens.typography.bodyFont, size: tokens.typography.sizeBody })],
        spacing: { after: tokens.typography.paragraphAfter },
      });

    case "code_block":
      return new Paragraph({
        children: [new TextRun({
          text: node.code.slice(0, 50_000),
          font: tokens.typography.codeFont,
          size: tokens.typography.sizeSmall,
        })],
        spacing: { after: tokens.typography.paragraphAfter },
        shading: { type: ShadingType.SOLID, color: "F5F5F5" },
      });

    case "quote":
      return new Paragraph({
        children: [
          ...compileRichText(node.content, tokens, { italics: true }),
          ...(node.attribution ? [new TextRun({ text: ` — ${node.attribution}`, italics: true, color: tokens.colors.textMuted, font: tokens.typography.bodyFont, size: tokens.typography.sizeSmall })] : []),
        ],
        indent: { left: 720 },
        spacing: { after: tokens.typography.paragraphAfter },
      });

    case "divider":
      return new Paragraph({
        children: [],
        border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: tokens.colors.border } },
        spacing: { before: 120, after: 120 },
      });

    case "page_break":
      return new Paragraph({ children: [new PageBreak()] });

    case "toc":
      return new TableOfContents("Tabla de Contenidos", {
        hyperlink: true,
        headingStyleRange: `1-${node.maxLevel}`,
      });

    case "spacer":
      return new Paragraph({ children: [], spacing: { after: node.height } });

    case "kpi_card":
      return new Paragraph({
        children: [
          new TextRun({ text: node.value, bold: true, size: tokens.typography.sizeH2, color: node.color ? normalizeHex(node.color) : tokens.colors.accent, font: tokens.typography.headingFont }),
          new TextRun({ text: `  ${node.label}`, size: tokens.typography.sizeBody, color: tokens.colors.textMuted, font: tokens.typography.bodyFont }),
        ],
        spacing: { after: tokens.typography.paragraphAfter },
      });

    default:
      diag.push({ severity: "info", code: "UNKNOWN_NODE", message: `${path}: unknown node type "${(node as any).type}"; skipped.`, path });
      return new Paragraph({ children: [] });
  }
}

// ─── Table Compilation ─────────────────────────────────────────────

function compileTable(
  node: Extract<ContentNode, { type: "table" }>,
  tokens: DesignTokenSet,
  path: string,
  diag: CompilationDiagnostic[],
): (Table | Paragraph)[] {
  const results: (Table | Paragraph)[] = [];

  // Split very long tables into chunks
  const maxRows = tokens.layout.maxTableRowsPerPage;
  const chunks = chunkItems(node.rows, maxRows);

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    const tableRows: TableRow[] = [];

    // Header row
    if (node.showHeader) {
      tableRows.push(new TableRow({
        tableHeader: true,
        children: node.columns.map((col) =>
          new TableCell({
            children: [new Paragraph({
              children: compileRichText(col.header, tokens, { bold: true, color: tokens.colors.tableHeaderFg, font: tokens.typography.bodyFont, size: tokens.typography.sizeBody }),
              alignment: AlignmentType.CENTER,
            })],
            shading: { type: ShadingType.SOLID, color: tokens.colors.tableHeaderBg },
            width: col.width ? { size: col.width, type: WidthType.PERCENTAGE } : undefined,
          }),
        ),
      }));
    }

    // Data rows
    for (let ri = 0; ri < chunk.length; ri++) {
      const row = chunk[ri];
      tableRows.push(new TableRow({
        children: node.columns.map((col, colIdx) => {
          const cellVal = row[colIdx];
          const text = cellToString(cellVal);
          return new TableCell({
            children: [new Paragraph({
              children: [new TextRun({ text: truncateWithEllipsis(text, 5000), font: tokens.typography.bodyFont, size: tokens.typography.sizeBody })],
              alignment: ALIGNMENT_MAP[col.align || "left"],
            })],
            shading: node.striped && ri % 2 === 1
              ? { type: ShadingType.SOLID, color: tokens.colors.tableStripeBg }
              : undefined,
          });
        }),
      }));
    }

    results.push(new Table({
      rows: tableRows,
      width: { size: 100, type: WidthType.PERCENTAGE },
    }));

    // Caption
    if (ci === 0 && node.caption) {
      results.push(new Paragraph({
        children: [new TextRun({ text: node.caption, italics: true, color: tokens.colors.textMuted, font: tokens.typography.bodyFont, size: tokens.typography.sizeSmall })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 60, after: tokens.typography.paragraphAfter },
      }));
    }

    // Page break between chunks
    if (ci < chunks.length - 1) {
      results.push(new Paragraph({ children: [new PageBreak()] }));
    }
  }

  return results;
}

// ─── Rich Text → TextRun[] ─────────────────────────────────────────

function compileRichText(
  spans: RichText,
  tokens: DesignTokenSet,
  defaults?: Partial<IRunOptions>,
): (TextRun | ExternalHyperlink)[] {
  const results: (TextRun | ExternalHyperlink)[] = [];

  for (const span of spans) {
    const opts: IRunOptions = {
      text: span.text,
      font: span.fontFamily || defaults?.font || tokens.typography.bodyFont,
      size: span.fontSize || defaults?.size || tokens.typography.sizeBody,
      bold: span.bold ?? defaults?.bold,
      italics: span.italic ?? defaults?.italics,
      underline: span.underline ? {} : undefined,
      strike: span.strikethrough,
      superScript: span.superscript,
      subScript: span.subscript,
      color: span.color ? normalizeHex(span.color) : (defaults?.color ? normalizeHex(defaults.color as string) : undefined),
    };

    if (span.code) {
      opts.font = tokens.typography.codeFont;
      opts.size = tokens.typography.sizeSmall;
      opts.shading = { type: ShadingType.SOLID, color: "F0F0F0", fill: "F0F0F0" };
    }

    if (span.link) {
      results.push(new ExternalHyperlink({
        children: [new TextRun({ ...opts, style: "Hyperlink" })],
        link: span.link,
      }));
    } else {
      results.push(new TextRun(opts));
    }
  }

  return results;
}

// ─── Styles from Tokens ────────────────────────────────────────────

function buildStyles(tokens: DesignTokenSet) {
  return {
    default: {
      document: {
        run: { font: tokens.typography.bodyFont, size: tokens.typography.sizeBody },
        paragraph: { spacing: { line: tokens.typography.lineSpacing, after: tokens.typography.paragraphAfter } },
      },
    },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", run: { font: tokens.typography.headingFont, size: tokens.typography.sizeH1, bold: true, color: tokens.colors.primary }, paragraph: { spacing: { before: 240, after: 120 } } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", run: { font: tokens.typography.headingFont, size: tokens.typography.sizeH2, bold: true, color: tokens.colors.primary }, paragraph: { spacing: { before: 200, after: 100 } } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", run: { font: tokens.typography.headingFont, size: tokens.typography.sizeH3, bold: true, color: tokens.colors.secondary }, paragraph: { spacing: { before: 160, after: 80 } } },
      { id: "Heading4", name: "Heading 4", basedOn: "Normal", next: "Normal", run: { font: tokens.typography.headingFont, size: tokens.typography.sizeH4, bold: true, color: tokens.colors.secondary }, paragraph: { spacing: { before: 120, after: 60 } } },
    ],
  };
}

// ─── Helpers ───────────────────────────────────────────────────────

function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 100) || "document";
}

function truncateWithEllipsis(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "\u2026";
}
