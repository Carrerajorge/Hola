/**
 * PPTX Compiler — Translates DocumentIR to PowerPoint presentations.
 *
 * Uses pptxgenjs with proper Slide Master and Layout integration:
 *   - Master slide backgrounds from design tokens
 *   - Theme colors applied globally
 *   - Smart layout: auto-positioning, overflow splitting
 *   - Per-component graceful degradation
 *   - KPI cards, tables, charts, quotes, callouts
 */

import type { DocumentIR, BlockIR, SectionIR } from "../documentIR";
import type { DesignTokensV2 } from "../designTokens";
import { resolveTextStyleForBlock, resolveTableStyle } from "../componentRegistry";
import { DegradationEngine } from "../gracefulDegradation";
import { LayoutEngineV2, type SlideLayout, type LayoutResult } from "../layoutEngineV2";

/* ================================================================== */
/*  HELPERS                                                            */
/* ================================================================== */

function colorToHex(hex: string): string {
  return hex.replace("#", "");
}

/* ================================================================== */
/*  PPTX COMPILER                                                     */
/* ================================================================== */

export class PptxCompiler {
  private tokens: DesignTokensV2;
  private degradation: DegradationEngine;
  private layout: LayoutEngineV2;

  constructor(tokens: DesignTokensV2, degradation: DegradationEngine) {
    this.tokens = tokens;
    this.degradation = degradation;
    this.layout = new LayoutEngineV2(tokens);
  }

  async compile(ir: DocumentIR): Promise<Buffer> {
    const PptxGenJS = (await import("pptxgenjs")).default;
    const pptx = new PptxGenJS();
    const tokens = this.tokens;
    const pptxConfig = tokens.pptx;

    // Set presentation metadata
    pptx.title = ir.metadata.title;
    pptx.author = ir.metadata.author || "IliaGPT";
    pptx.subject = ir.metadata.subject || "";
    pptx.layout = "LAYOUT_WIDE";

    // Define slide master
    pptx.defineSlideMaster({
      title: "MASTER_SLIDE",
      background: { color: colorToHex(pptxConfig.masterBackground) },
      objects: [
        // Footer bar
        ...(pptxConfig.footerText ? [{
          text: {
            text: pptxConfig.footerText,
            options: {
              x: 0.5,
              y: pptxConfig.slideHeight - 0.4,
              w: pptxConfig.slideWidth - 1,
              h: 0.3,
              fontSize: 8,
              color: colorToHex(tokens.colors.textMuted),
              fontFace: tokens.textStyles.caption.fontFamily,
            },
          },
        }] : []),
        // Slide number
        ...(pptxConfig.showSlideNumbers ? [{
          text: {
            text: "",
            options: {
              x: pptxConfig.slideWidth - 1,
              y: pptxConfig.slideHeight - 0.4,
              w: 0.5,
              h: 0.3,
              fontSize: 8,
              color: colorToHex(tokens.colors.textMuted),
              fontFace: tokens.textStyles.caption.fontFamily,
              align: "right" as const,
            },
          },
        }] : []),
      ],
      slideNumber: pptxConfig.showSlideNumbers ? {
        x: pptxConfig.slideWidth - 0.8,
        y: pptxConfig.slideHeight - 0.4,
        fontSize: 8,
        color: colorToHex(tokens.colors.textMuted),
        fontFace: tokens.textStyles.caption.fontFamily,
      } : undefined,
    });

    // Compute slide layouts
    const slideLayouts = this.layout.computeSlideLayouts(ir.sections);

    // Render each slide
    for (let i = 0; i < slideLayouts.length; i++) {
      const slideLayout = slideLayouts[i];
      const slide = pptx.addSlide({ masterName: "MASTER_SLIDE" });

      // Set slide background based on type
      this.applySlideBackground(slide, slideLayout.slideType, pptxConfig);

      // Render components
      for (let c = 0; c < slideLayout.components.length; c++) {
        const { block, layout } = slideLayout.components[c];
        const path = `slide[${i}].component[${c}]`;

        await this.degradation.withDegradation(
          block,
          path,
          () => this.renderBlock(slide, block, layout, tokens),
          (fallbackBlock) => this.renderBlock(slide, fallbackBlock, layout, tokens),
        );
      }

      // Add notes
      if (slideLayout.notes) {
        slide.addNotes(slideLayout.notes);
      }
    }

    // If no slides were generated, add a title slide
    if (slideLayouts.length === 0) {
      const slide = pptx.addSlide();
      this.applySlideBackground(slide, "cover", pptxConfig);
      slide.addText(ir.metadata.title, {
        x: 0.5, y: 1.5, w: 9, h: 1.5,
        fontSize: 36, bold: true,
        color: "FFFFFF",
        align: "center",
        fontFace: tokens.textStyles.title.fontFamily,
      });
    }

    const data = await pptx.write({ outputType: "nodebuffer" });
    return Buffer.from(data as ArrayBuffer);
  }

  /* ---------------------------------------------------------------- */
  /*  SLIDE BACKGROUND                                                 */
  /* ---------------------------------------------------------------- */

  private applySlideBackground(slide: any, slideType: string, pptxConfig: any): void {
    switch (slideType) {
      case "cover":
      case "section_header": {
        const bg = pptxConfig.titleSlideBackground;
        if (typeof bg === "string") {
          slide.background = { color: colorToHex(bg) };
        } else if (bg && typeof bg === "object" && bg.gradient) {
          // pptxgenjs doesn't support gradient backgrounds directly,
          // use the first color as fallback
          slide.background = { color: colorToHex(bg.gradient[0]) };
          // Add a gradient rect covering the slide
          slide.addShape("rect", {
            x: 0, y: 0,
            w: pptxConfig.slideWidth,
            h: pptxConfig.slideHeight,
            fill: {
              type: "solid",
              color: colorToHex(bg.gradient[0]),
            },
          });
        }
        break;
      }

      case "closing":
        slide.background = { color: colorToHex(pptxConfig.sectionBackground) };
        break;

      default:
        slide.background = { color: colorToHex(pptxConfig.masterBackground) };
        break;
    }
  }

  /* ---------------------------------------------------------------- */
  /*  BLOCK RENDERING                                                  */
  /* ---------------------------------------------------------------- */

  private renderBlock(
    slide: any,
    block: BlockIR,
    layout: LayoutResult,
    tokens: DesignTokensV2,
  ): void {
    const box = layout.box;
    const any_b = block as any;

    switch (block.type) {
      case "heading":
        this.renderHeading(slide, any_b, box, layout, tokens);
        break;

      case "paragraph":
      case "richtext":
        this.renderParagraph(slide, any_b, box, layout, tokens);
        break;

      case "bullets":
      case "numbered":
        this.renderList(slide, any_b, box, layout, tokens);
        break;

      case "table":
        this.renderTable(slide, any_b, box, tokens);
        break;

      case "quote":
        this.renderQuote(slide, any_b, box, tokens);
        break;

      case "callout":
        this.renderCallout(slide, any_b, box, tokens);
        break;

      case "kpi_card":
        this.renderKpiCard(slide, any_b, box, tokens);
        break;

      case "badge":
        this.renderBadge(slide, any_b, box, tokens);
        break;

      case "code":
        this.renderCode(slide, any_b, box, tokens);
        break;

      case "chart":
        this.renderChartPlaceholder(slide, any_b, box, tokens);
        break;

      case "image":
        this.renderImagePlaceholder(slide, any_b, box, tokens);
        break;

      case "divider":
        this.renderDivider(slide, box, tokens);
        break;

      default:
        // Unknown component: skip
        break;
    }
  }

  private renderHeading(
    slide: any, block: any, box: any, layout: LayoutResult, tokens: DesignTokensV2,
  ): void {
    const style = resolveTextStyleForBlock(block, tokens);
    const isOnDarkBg = this.isOnDarkBackground(slide);
    const color = isOnDarkBg ? "FFFFFF" : colorToHex(style.color);

    slide.addText(layout.truncatedText || block.text || "", {
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      fontSize: layout.fontSize,
      bold: true,
      color,
      fontFace: style.fontFamily,
      valign: "top",
      shrinkText: true,
    });
  }

  private renderParagraph(
    slide: any, block: any, box: any, layout: LayoutResult, tokens: DesignTokensV2,
  ): void {
    const style = resolveTextStyleForBlock(block, tokens);
    const text = layout.truncatedText || block.text || block.markdown || "";
    const isOnDark = this.isOnDarkBackground(slide);
    const color = isOnDark ? "E2E8F0" : colorToHex(style.color);

    slide.addText(text, {
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      fontSize: layout.fontSize,
      color,
      fontFace: style.fontFamily,
      valign: "top",
      italic: style.fontStyle === "italic",
    });
  }

  private renderList(
    slide: any, block: any, box: any, layout: LayoutResult, tokens: DesignTokensV2,
  ): void {
    const items: string[] = block.items || [];
    if (items.length === 0) return;

    const style = tokens.textStyles.body;
    const isOnDark = this.isOnDarkBackground(slide);
    const color = isOnDark ? "E2E8F0" : colorToHex(style.color);

    const textRows = items.map((item: string, i: number) => ({
      text: item,
      options: {
        fontSize: layout.fontSize,
        color,
        fontFace: style.fontFamily,
        bullet: block.type === "numbered"
          ? { type: "number" as const, numberStartAt: block.startAt || 1 }
          : { type: "bullet" as const },
        paraSpaceBefore: 2,
        paraSpaceAfter: 2,
      },
    }));

    slide.addText(textRows, {
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      valign: "top",
    });
  }

  private renderTable(slide: any, block: any, box: any, tokens: DesignTokensV2): void {
    const columns = block.columns || [];
    const rows = (block.rows || []).slice(0, 30); // Max 30 rows per slide
    if (columns.length === 0) return;

    const tableStyle = resolveTableStyle(tokens);

    // Build table data
    const tableRows: any[][] = [];

    // Header row
    if (block.showHeader !== false) {
      tableRows.push(columns.map((col: any) => ({
        text: col.header || col.key || "",
        options: {
          bold: true,
          fontSize: Math.min(tableStyle.headerFontSize, 10),
          color: colorToHex(tableStyle.headerFg),
          fill: { color: colorToHex(tableStyle.headerBg) },
          align: tableStyle.headerAlign || "center",
          fontFace: tokens.textStyles.body.fontFamily,
        },
      })));
    }

    // Data rows
    for (let r = 0; r < rows.length; r++) {
      const rowData = rows[r];
      const bgColor = block.showStripes !== false && r % 2 === 0
        ? tableStyle.stripeOdd
        : tableStyle.stripeEven;

      tableRows.push(columns.map((col: any) => ({
        text: String(rowData[col.key] ?? "").substring(0, 200),
        options: {
          fontSize: Math.min(tableStyle.bodyFontSize, 9),
          color: colorToHex(tableStyle.bodyColor),
          fill: { color: colorToHex(bgColor) },
          align: col.align || "left",
          fontFace: tokens.textStyles.body.fontFamily,
        },
      })));
    }

    if (tableRows.length > 0) {
      slide.addTable(tableRows, {
        x: box.x,
        y: box.y,
        w: box.w,
        h: Math.min(box.h, 4.5),
        border: { type: "solid", pt: 0.5, color: colorToHex(tableStyle.borderColor) },
        colW: Array(columns.length).fill(box.w / columns.length),
        autoPage: false,
      });
    }
  }

  private renderQuote(slide: any, block: any, box: any, tokens: DesignTokensV2): void {
    const style = tokens.textStyles.quote;
    const isOnDark = this.isOnDarkBackground(slide);
    const color = isOnDark ? "A0AEC0" : colorToHex(style.color);

    // Quote accent line
    slide.addShape("rect", {
      x: box.x,
      y: box.y,
      w: 0.05,
      h: box.h,
      fill: { color: colorToHex(tokens.colors.primary) },
    });

    const attribution = block.attribution ? `\n— ${block.attribution}` : "";
    slide.addText(`"${block.text || ""}"${attribution}`, {
      x: box.x + 0.2,
      y: box.y,
      w: box.w - 0.2,
      h: box.h,
      fontSize: style.fontSize,
      italic: true,
      color,
      fontFace: style.fontFamily,
      valign: "middle",
    });
  }

  private renderCallout(slide: any, block: any, box: any, tokens: DesignTokensV2): void {
    const variantColors: Record<string, string> = {
      info: tokens.colors.info,
      warning: tokens.colors.warning,
      error: tokens.colors.error,
      success: tokens.colors.success,
      note: tokens.colors.secondary,
      tip: tokens.colors.success,
    };
    const accentColor = variantColors[block.variant] || tokens.colors.info;

    // Background rect
    slide.addShape("rect", {
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      fill: { color: colorToHex(tokens.colors.surface) },
      rectRadius: 0.1,
    });

    // Accent bar
    slide.addShape("rect", {
      x: box.x,
      y: box.y,
      w: 0.06,
      h: box.h,
      fill: { color: colorToHex(accentColor) },
    });

    const title = block.title ? `${(block.variant || "note").toUpperCase()}: ${block.title}\n` : "";
    slide.addText(`${title}${block.text || ""}`, {
      x: box.x + 0.2,
      y: box.y + 0.1,
      w: box.w - 0.3,
      h: box.h - 0.2,
      fontSize: tokens.textStyles.body.fontSize,
      color: colorToHex(tokens.colors.textPrimary),
      fontFace: tokens.textStyles.body.fontFamily,
      valign: "top",
    });
  }

  private renderKpiCard(slide: any, block: any, box: any, tokens: DesignTokensV2): void {
    const color = block.color || tokens.colors.primary;

    // Card background
    slide.addShape("rect", {
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      fill: { color: colorToHex(tokens.colors.surface) },
      rectRadius: 0.1,
      shadow: { type: "outer", blur: 3, offset: 2, color: "333333", opacity: 0.1 },
    });

    // Title
    slide.addText(block.title || "", {
      x: box.x + 0.15,
      y: box.y + 0.1,
      w: box.w - 0.3,
      h: 0.3,
      fontSize: 10,
      color: colorToHex(tokens.colors.textSecondary),
      fontFace: tokens.textStyles.body.fontFamily,
    });

    // Value
    slide.addText(`${block.value || ""}${block.unit ? ` ${block.unit}` : ""}`, {
      x: box.x + 0.15,
      y: box.y + 0.4,
      w: box.w - 0.3,
      h: 0.6,
      fontSize: 28,
      bold: true,
      color: colorToHex(color),
      fontFace: tokens.textStyles.h1.fontFamily,
    });

    // Change indicator
    if (block.change !== undefined && block.change !== null) {
      const arrow = block.changeDirection === "up" ? "↑" : block.changeDirection === "down" ? "↓" : "→";
      const changeColor = block.changeDirection === "up"
        ? tokens.colors.success
        : block.changeDirection === "down"
          ? tokens.colors.error
          : tokens.colors.textMuted;

      slide.addText(`${arrow} ${Math.abs(block.change)}%`, {
        x: box.x + 0.15,
        y: box.y + box.h - 0.35,
        w: box.w - 0.3,
        h: 0.25,
        fontSize: 10,
        color: colorToHex(changeColor),
        fontFace: tokens.textStyles.body.fontFamily,
      });
    }
  }

  private renderBadge(slide: any, block: any, box: any, tokens: DesignTokensV2): void {
    const variantColors: Record<string, string> = {
      default: tokens.colors.textSecondary,
      success: tokens.colors.success,
      warning: tokens.colors.warning,
      error: tokens.colors.error,
      info: tokens.colors.info,
      primary: tokens.colors.primary,
    };
    const color = variantColors[block.variant] || tokens.colors.textSecondary;

    slide.addShape("rect", {
      x: box.x,
      y: box.y,
      w: Math.min(box.w, 2),
      h: 0.3,
      fill: { color: colorToHex(color) },
      rectRadius: 0.15,
    });

    slide.addText(block.text || "", {
      x: box.x + 0.1,
      y: box.y,
      w: Math.min(box.w, 2) - 0.2,
      h: 0.3,
      fontSize: 8,
      bold: true,
      color: "FFFFFF",
      fontFace: tokens.textStyles.caption.fontFamily,
      align: "center",
      valign: "middle",
    });
  }

  private renderCode(slide: any, block: any, box: any, tokens: DesignTokensV2): void {
    // Code background
    slide.addShape("rect", {
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      fill: { color: colorToHex(tokens.colors.surface) },
      rectRadius: 0.05,
    });

    slide.addText(block.code || "", {
      x: box.x + 0.15,
      y: box.y + 0.1,
      w: box.w - 0.3,
      h: box.h - 0.2,
      fontSize: tokens.textStyles.code.fontSize,
      color: colorToHex(tokens.textStyles.code.color),
      fontFace: tokens.textStyles.code.fontFamily,
      valign: "top",
    });
  }

  private renderChartPlaceholder(slide: any, block: any, box: any, tokens: DesignTokensV2): void {
    slide.addShape("rect", {
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      fill: { color: colorToHex(tokens.colors.surface) },
      line: { color: colorToHex(tokens.colors.border), width: 1 },
    });

    slide.addText(`[Chart: ${block.title || block.chartType || "chart"}]`, {
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      fontSize: 12,
      italic: true,
      color: colorToHex(tokens.colors.textMuted),
      fontFace: tokens.textStyles.body.fontFamily,
      align: "center",
      valign: "middle",
    });
  }

  private renderImagePlaceholder(slide: any, block: any, box: any, tokens: DesignTokensV2): void {
    slide.addShape("rect", {
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      fill: { color: colorToHex(tokens.colors.surface) },
      line: { color: colorToHex(tokens.colors.border), width: 1 },
    });

    slide.addText(`[Image: ${block.alt || block.caption || "image"}]`, {
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      fontSize: 10,
      italic: true,
      color: colorToHex(tokens.colors.textMuted),
      fontFace: tokens.textStyles.body.fontFamily,
      align: "center",
      valign: "middle",
    });
  }

  private renderDivider(slide: any, box: any, tokens: DesignTokensV2): void {
    slide.addShape("line", {
      x: box.x,
      y: box.y + box.h / 2,
      w: box.w,
      h: 0,
      line: { color: colorToHex(tokens.colors.border), width: 1 },
    });
  }

  /* ---------------------------------------------------------------- */
  /*  UTILITIES                                                        */
  /* ---------------------------------------------------------------- */

  private isOnDarkBackground(slide: any): boolean {
    const bg = slide.background?.color || "";
    if (!bg) return false;
    // Simple heuristic: check if background is dark
    try {
      const r = parseInt(bg.substring(0, 2), 16);
      const g = parseInt(bg.substring(2, 4), 16);
      const b = parseInt(bg.substring(4, 6), 16);
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      return luminance < 0.5;
    } catch {
      return false;
    }
  }
}
