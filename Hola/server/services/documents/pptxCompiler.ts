/**
 * PPTX Compiler — translates DocumentIR → PowerPoint buffer using PptxGenJS.
 *
 * Each IR section maps to a slide.  Styles derive from DesignTokens and are
 * applied via master slides.  The layout engine handles overflow by splitting
 * long lists/tables across multiple slides.
 */
import PptxGenJS from "pptxgenjs";
import {
  DocumentIR, ContentNode, Section, CompilationResult, CompilationDiagnostic,
  richTextToPlain, cellToString, isRichText, RichText, RichTextSpan,
} from "@shared/documentIR";
import { DesignTokenSet, normalizeHex } from "@shared/documentDesignTokens";
import { safeCompile, nodeSummary, chunkItems, truncateWithEllipsis, truncateRichText } from "./safeRenderer";

// ─── Constants ─────────────────────────────────────────────────────

const MASTER_CONTENT = "CONTENT_MASTER";
const MASTER_TITLE = "TITLE_MASTER";
const MASTER_SECTION = "SECTION_MASTER";

// ─── Public Entry Point ────────────────────────────────────────────

export async function compilePptx(
  ir: DocumentIR,
  tokens: DesignTokenSet,
): Promise<CompilationResult> {
  const start = Date.now();
  const diagnostics: CompilationDiagnostic[] = [];

  try {
    const pres = new PptxGenJS();
    pres.author = ir.metadata.author || "Hola";
    pres.company = ir.metadata.company || "";
    pres.title = ir.metadata.title;
    pres.subject = ir.metadata.subject || "";
    pres.layout = "LAYOUT_WIDE"; // 13.33 × 7.5

    defineMasters(pres, tokens);

    // Each section → 1+ slides
    for (let si = 0; si < ir.sections.length; si++) {
      const section = ir.sections[si];
      const path = `sections[${si}]`;
      compileSection(pres, section, si, tokens, path, diagnostics);
    }

    const arrayBuf = await pres.write({ outputType: "nodebuffer" }) as Buffer;
    const buffer = Buffer.from(arrayBuf);

    return {
      success: true,
      buffer,
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      filename: `${sanitizeFilename(ir.metadata.title)}.pptx`,
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
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      filename: "error.pptx",
      sizeBytes: 0,
      diagnostics,
      durationMs: Date.now() - start,
      themeId: tokens.id,
    };
  }
}

// ─── Master Slides ─────────────────────────────────────────────────

function defineMasters(pres: PptxGenJS, tokens: DesignTokenSet): void {
  // Content master — white bg with accent footer bar
  pres.defineSlideMaster({
    title: MASTER_CONTENT,
    background: { color: normalizeHex(tokens.colors.background) },
    objects: [
      { rect: { x: 0, y: 6.9, w: "100%", h: 0.06, fill: { color: normalizeHex(tokens.colors.primary) } } },
    ],
  });

  // Title master — accent bg
  pres.defineSlideMaster({
    title: MASTER_TITLE,
    background: { color: normalizeHex(tokens.colors.primary) },
    objects: [
      { rect: { x: 0, y: 5.0, w: "100%", h: 0.04, fill: { color: normalizeHex(tokens.colors.accent) } } },
    ],
  });

  // Section master — secondary bg
  pres.defineSlideMaster({
    title: MASTER_SECTION,
    background: { color: normalizeHex(tokens.colors.secondary) },
    objects: [],
  });
}

// ─── Section → Slide(s) ────────────────────────────────────────────

function compileSection(
  pres: PptxGenJS,
  section: Section,
  sectionIdx: number,
  tokens: DesignTokenSet,
  path: string,
  diag: CompilationDiagnostic[],
): void {
  const layout = section.layout || "default";

  // Title/section layout → dedicated slide style
  if (layout === "title") {
    compileTitleSlide(pres, section, tokens);
    return;
  }
  if (layout === "section") {
    compileSectionDivider(pres, section, tokens);
    return;
  }

  // Default/content layout: collect all node content into one or more slides
  const slide = pres.addSlide({ masterName: MASTER_CONTENT });

  // Apply background override
  if (section.background?.color) {
    slide.background = { color: normalizeHex(section.background.color) };
  }

  // Section title as slide title
  let yPos = tokens.spacing.slideMarginY;
  if (section.title) {
    slide.addText(section.title, {
      x: tokens.spacing.slideMarginX,
      y: yPos,
      w: tokens.layout.slideContentWidth,
      h: 0.6,
      fontSize: hpToPt(tokens.typography.sizeH2),
      fontFace: tokens.typography.headingFont,
      color: normalizeHex(tokens.colors.primary),
      bold: true,
    });
    yPos += 0.75;
  }

  // Compile nodes sequentially, tracking Y position
  for (let ni = 0; ni < section.nodes.length; ni++) {
    const node = section.nodes[ni];
    const nPath = `${path}.nodes[${ni}]`;

    const used = safeCompile(
      () => compileNodeToSlide(slide, pres, node, yPos, tokens, nPath, diag),
      () => {
        slide.addText(nodeSummary(node), {
          x: tokens.spacing.slideMarginX,
          y: yPos,
          w: tokens.layout.slideContentWidth,
          h: 0.4,
          fontSize: 10,
          fontFace: tokens.typography.bodyFont,
          color: normalizeHex(tokens.colors.textMuted),
          italic: true,
        });
        return 0.5;
      },
      nPath,
      diag,
    );

    const height = Array.isArray(used) ? (used[0] as number) : (used as number);
    yPos += height;
  }

  // Speaker notes
  if (section.notes) {
    slide.addNotes(section.notes);
  }
}

// ─── Title Slide ───────────────────────────────────────────────────

function compileTitleSlide(pres: PptxGenJS, section: Section, tokens: DesignTokenSet): void {
  const slide = pres.addSlide({ masterName: MASTER_TITLE });

  // Find title & subtitle nodes
  const titleNode = section.nodes.find((n) => n.type === "title");
  const titleText = titleNode && titleNode.type === "title" ? richTextToPlain(titleNode.content) : section.title || "";
  const subtitleText = titleNode && titleNode.type === "title" && titleNode.subtitle ? richTextToPlain(titleNode.subtitle) : "";

  slide.addText(titleText, {
    x: 0.8,
    y: 1.8,
    w: 8.5,
    h: 1.5,
    fontSize: hpToPt(tokens.typography.sizeH1),
    fontFace: tokens.typography.headingFont,
    color: "FFFFFF",
    bold: true,
    align: "center",
  });

  if (subtitleText) {
    slide.addText(subtitleText, {
      x: 1.5,
      y: 3.5,
      w: 7,
      h: 0.8,
      fontSize: hpToPt(tokens.typography.sizeH3),
      fontFace: tokens.typography.bodyFont,
      color: normalizeHex(tokens.colors.accent),
      align: "center",
    });
  }
}

// ─── Section Divider ───────────────────────────────────────────────

function compileSectionDivider(pres: PptxGenJS, section: Section, tokens: DesignTokenSet): void {
  const slide = pres.addSlide({ masterName: MASTER_SECTION });
  slide.addText(section.title || "", {
    x: 1,
    y: 2.5,
    w: 8,
    h: 1.5,
    fontSize: hpToPt(tokens.typography.sizeH1),
    fontFace: tokens.typography.headingFont,
    color: "FFFFFF",
    bold: true,
    align: "center",
  });
}

// ─── Node → Slide Elements ─────────────────────────────────────────

function compileNodeToSlide(
  slide: PptxGenJS.Slide,
  pres: PptxGenJS,
  node: ContentNode,
  yPos: number,
  tokens: DesignTokenSet,
  path: string,
  diag: CompilationDiagnostic[],
): number {
  const mx = tokens.spacing.slideMarginX;
  const cw = tokens.layout.slideContentWidth;

  switch (node.type) {
    case "title":
      slide.addText(richTextToPlain(node.content), {
        x: mx, y: yPos, w: cw, h: 0.8,
        fontSize: hpToPt(tokens.typography.sizeH1),
        fontFace: tokens.typography.headingFont,
        color: normalizeHex(tokens.colors.primary),
        bold: true,
        align: "center",
      });
      return 1.0;

    case "heading":
      slide.addText(richTextToPlain(node.content), {
        x: mx, y: yPos, w: cw, h: 0.5,
        fontSize: hpToPt(tokens.typography.sizeH3),
        fontFace: tokens.typography.headingFont,
        color: normalizeHex(tokens.colors.primary),
        bold: true,
      });
      return 0.65;

    case "paragraph": {
      const text = richTextToPlain(node.content);
      const lines = Math.ceil(text.length / 100);
      const h = Math.max(0.3, lines * 0.25);
      slide.addText(text, {
        x: mx, y: yPos, w: cw, h,
        fontSize: hpToPt(tokens.typography.sizeBody),
        fontFace: tokens.typography.bodyFont,
        color: normalizeHex(tokens.colors.text),
        valign: "top",
        wrap: true,
      });
      return h + 0.1;
    }

    case "bullet_list":
    case "numbered_list": {
      const maxPerSlide = tokens.layout.maxBulletsPerSlide;
      const chunks = chunkItems(node.items, maxPerSlide);

      // First chunk on current slide
      const firstChunk = chunks[0] || [];
      const textItems: PptxGenJS.TextProps[] = firstChunk.map((item) => ({
        text: truncateWithEllipsis(richTextToPlain(item), tokens.layout.maxCharsPerBullet),
        options: {
          fontSize: hpToPt(tokens.typography.sizeBody),
          fontFace: tokens.typography.bodyFont,
          color: normalizeHex(tokens.colors.text),
          bullet: node.type === "bullet_list" ? { type: "bullet" as const } : { type: "number" as const },
          paraSpaceAfter: 4,
        },
      }));

      const h = Math.max(0.5, firstChunk.length * 0.35);
      slide.addText(textItems, { x: mx, y: yPos, w: cw, h, valign: "top" });

      // Overflow chunks → new slides
      for (let ci = 1; ci < chunks.length; ci++) {
        diag.push({
          severity: "info",
          code: "LIST_OVERFLOW_SPLIT",
          message: `${path}: list overflow split to additional slide (chunk ${ci + 1}/${chunks.length})`,
          path,
        });
        const overflowSlide = pres.addSlide({ masterName: MASTER_CONTENT });
        const overflowItems: PptxGenJS.TextProps[] = chunks[ci].map((item) => ({
          text: truncateWithEllipsis(richTextToPlain(item), tokens.layout.maxCharsPerBullet),
          options: {
            fontSize: hpToPt(tokens.typography.sizeBody),
            fontFace: tokens.typography.bodyFont,
            color: normalizeHex(tokens.colors.text),
            bullet: node.type === "bullet_list" ? { type: "bullet" as const } : { type: "number" as const },
            paraSpaceAfter: 4,
          },
        }));
        const oh = Math.max(0.5, chunks[ci].length * 0.35);
        overflowSlide.addText(overflowItems, { x: mx, y: tokens.spacing.slideMarginY, w: cw, h: oh });
      }

      return h + 0.15;
    }

    case "table": {
      const maxCols = Math.min(node.columns.length, 8); // readable limit
      const cols = node.columns.slice(0, maxCols);
      const rows = node.rows.map((r) => r.slice(0, maxCols));

      // Build table data
      const headerRow = cols.map((c) => ({
        text: richTextToPlain(c.header),
        options: {
          bold: true,
          fontSize: 9,
          fontFace: tokens.typography.bodyFont,
          color: normalizeHex(tokens.colors.tableHeaderFg),
          fill: { color: normalizeHex(tokens.colors.tableHeaderBg) },
          align: "center" as const,
        },
      }));

      const maxRowsPerSlide = tokens.layout.maxTableRowsPerPage;
      const dataChunks = chunkItems(rows, maxRowsPerSlide);

      let totalHeight = 0;

      for (let ci = 0; ci < dataChunks.length; ci++) {
        const targetSlide = ci === 0 ? slide : pres.addSlide({ masterName: MASTER_CONTENT });
        const targetY = ci === 0 ? yPos : tokens.spacing.slideMarginY;

        const tableRows: PptxGenJS.TableRow[] = [headerRow as any];
        for (let ri = 0; ri < dataChunks[ci].length; ri++) {
          const dataRow = dataChunks[ci][ri];
          tableRows.push(
            cols.map((col, colIdx) => ({
              text: truncateWithEllipsis(cellToString(dataRow[colIdx]), 200),
              options: {
                fontSize: 8,
                fontFace: tokens.typography.bodyFont,
                color: normalizeHex(tokens.colors.text),
                fill: node.striped && ri % 2 === 1 ? { color: normalizeHex(tokens.colors.tableStripeBg) } : undefined,
                align: (col.align || "left") as "left" | "center" | "right",
              },
            })) as any,
          );
        }

        const tblHeight = Math.min(5.5, 0.3 + tableRows.length * 0.25);
        targetSlide.addTable(tableRows, {
          x: mx, y: targetY, w: cw, h: tblHeight,
          border: { type: "solid", pt: 0.5, color: normalizeHex(tokens.colors.border) },
          colW: cols.map(() => cw / cols.length),
          autoPage: false,
        });

        if (ci === 0) totalHeight = tblHeight + 0.15;
      }

      return totalHeight;
    }

    case "chart": {
      const chartTypeMap: Record<string, PptxGenJS.CHART_NAME> = {
        bar: pres.ChartType ? (pres as any).charts?.BAR : "bar" as any,
        line: "line" as any,
        pie: "pie" as any,
        doughnut: "doughnut" as any,
        area: "area" as any,
        scatter: "scatter" as any,
      };
      const chartType = chartTypeMap[node.chartType] || ("bar" as any);
      const chartData = node.series.map((s) => ({
        name: s.name,
        labels: node.categories,
        values: s.values,
      }));

      slide.addChart(chartType, chartData, {
        x: mx, y: yPos, w: cw, h: 3.5,
        showTitle: !!node.title,
        title: node.title || "",
        showLegend: node.series.length > 1,
      });
      return 3.7;
    }

    case "code_block": {
      const code = node.code.slice(0, 2000);
      slide.addText(code, {
        x: mx, y: yPos, w: cw, h: Math.min(4, 0.3 + code.split("\n").length * 0.18),
        fontSize: 8,
        fontFace: tokens.typography.codeFont,
        color: normalizeHex(tokens.colors.text),
        fill: { color: "F5F5F5" },
        valign: "top",
        wrap: true,
      });
      return Math.min(4, 0.3 + code.split("\n").length * 0.18) + 0.1;
    }

    case "quote": {
      const qt = richTextToPlain(node.content);
      slide.addText(`\u201C${qt}\u201D`, {
        x: mx + 0.5, y: yPos, w: cw - 1, h: 1,
        fontSize: hpToPt(tokens.typography.sizeH4),
        fontFace: tokens.typography.bodyFont,
        color: normalizeHex(tokens.colors.secondary),
        italic: true,
        align: "center",
      });
      if (node.attribution) {
        slide.addText(`\u2014 ${node.attribution}`, {
          x: mx + 0.5, y: yPos + 1, w: cw - 1, h: 0.3,
          fontSize: 10,
          fontFace: tokens.typography.bodyFont,
          color: normalizeHex(tokens.colors.textMuted),
          align: "center",
        });
      }
      return 1.5;
    }

    case "image": {
      if (node.src.startsWith("data:") || node.src.startsWith("http")) {
        const w = node.width || 5;
        const h = node.height || 3;
        slide.addImage({
          data: node.src.startsWith("data:") ? node.src : undefined,
          path: node.src.startsWith("http") ? node.src : undefined,
          x: mx, y: yPos, w, h,
        });
        return h + 0.2;
      }
      // Fallback: text placeholder
      slide.addText(`[Image: ${node.alt || ""}]`, {
        x: mx, y: yPos, w: cw, h: 0.4,
        fontSize: 10, fontFace: tokens.typography.bodyFont,
        color: normalizeHex(tokens.colors.textMuted), italic: true,
      });
      return 0.5;
    }

    case "kpi_card": {
      const cardW = 2.5;
      const cardH = 1.2;
      slide.addShape("rect" as any, {
        x: mx, y: yPos, w: cardW, h: cardH,
        fill: { color: normalizeHex(node.color || tokens.colors.accent) },
        rectRadius: 0.1,
      });
      slide.addText(node.value, {
        x: mx, y: yPos + 0.1, w: cardW, h: 0.6,
        fontSize: 24, fontFace: tokens.typography.headingFont,
        color: "FFFFFF", bold: true, align: "center",
      });
      slide.addText(node.label, {
        x: mx, y: yPos + 0.7, w: cardW, h: 0.4,
        fontSize: 10, fontFace: tokens.typography.bodyFont,
        color: "FFFFFF", align: "center",
      });
      return cardH + 0.2;
    }

    case "divider": {
      slide.addShape("rect" as any, {
        x: mx, y: yPos + 0.15, w: cw, h: 0.02,
        fill: { color: normalizeHex(tokens.colors.border) },
      });
      return 0.4;
    }

    case "spacer":
      return 0.4;

    case "page_break":
      // Force a new slide (handled by the section loop)
      return 0;

    default:
      return 0;
  }
}

// ─── Helpers ───────────────────────────────────────────────────────

function hpToPt(hp: number): number {
  return hp / 2;
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 100) || "presentation";
}
