/**
 * Layout Engine V2 — Multi-format deterministic layout with guardrails.
 *
 * Handles:
 *   - PPTX: slide component positioning, overflow → split to new slides
 *   - DOCX: page flow, section breaks, column layout, page breaks
 *   - XLSX: sheet layout, cell positioning, dashboard grid
 *
 * Features:
 *   - Auto-fit text (reduce font size to fit bounding box)
 *   - Truncate with ellipsis when text exceeds bounds
 *   - Split large tables across pages/slides
 *   - Split bullet lists that exceed slide height
 *   - Density-aware spacing (compact / normal / relaxed)
 *   - Character limits per component type
 *   - Guardrails: max components per page, max depth, max iterations
 */

import type { DesignTokensV2 } from "./designTokens";
import type { BlockIR, SectionIR, DocumentIR } from "./documentIR";
import type { ComponentConstraints } from "./documentIR";

/* ================================================================== */
/*  TYPES                                                              */
/* ================================================================== */

export interface LayoutBox {
  x: number;  // inches from left
  y: number;  // inches from top
  w: number;  // width in inches
  h: number;  // height in inches
}

export interface LayoutResult {
  /** Computed bounding box */
  box: LayoutBox;
  /** Font size after auto-fit (may be reduced) */
  fontSize: number;
  /** Whether content was truncated */
  truncated: boolean;
  /** Truncated text (if applicable) */
  truncatedText?: string;
  /** Whether this component overflows and needs splitting */
  needsSplit: boolean;
}

export interface SlideLayout {
  /** Slide index in output */
  slideIndex: number;
  /** Components and their computed layout */
  components: Array<{
    block: BlockIR;
    layout: LayoutResult;
  }>;
  /** Slide type hint */
  slideType: string;
  /** Notes */
  notes?: string;
}

export interface PageLayout {
  /** Page number */
  pageIndex: number;
  /** Components with their layout info */
  components: Array<{
    block: BlockIR;
    estimatedHeight: number; // inches
  }>;
}

/* ================================================================== */
/*  GUARDRAILS                                                         */
/* ================================================================== */

const GUARDRAILS = {
  maxComponentsPerSlide: 20,
  maxComponentsPerPage: 100,
  maxSlidesFromSplit: 50,
  maxPagesFromSplit: 200,
  maxAutoFitIterations: 50,
  maxTableRowsPerSlide: 15,
  maxTableRowsPerPage: 50,
  maxBulletsPerSlide: 8,
  maxBulletsPerPage: 30,
  minFontSize: 6,
  maxCharsDensityPerInchSq: 200, // characters per square inch limit
} as const;

/* ================================================================== */
/*  DENSITY MULTIPLIERS                                                */
/* ================================================================== */

const DENSITY_MULTIPLIERS: Record<string, number> = {
  compact: 0.75,
  normal: 1.0,
  relaxed: 1.5,
};

/* ================================================================== */
/*  LAYOUT ENGINE V2                                                   */
/* ================================================================== */

export class LayoutEngineV2 {
  private tokens: DesignTokensV2;

  constructor(tokens: DesignTokensV2) {
    this.tokens = tokens;
  }

  /* ---------------------------------------------------------------- */
  /*  PPTX LAYOUT                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * Compute slide layouts for a presentation.
   * Automatically splits sections that overflow slide boundaries.
   */
  computeSlideLayouts(sections: SectionIR[]): SlideLayout[] {
    const slides: SlideLayout[] = [];
    const pptx = this.tokens.pptx;
    const usableW = pptx.slideWidth - pptx.margins.left - pptx.margins.right;
    const usableH = pptx.slideHeight - pptx.margins.top - pptx.margins.bottom;

    for (const section of sections) {
      const sectionSlides = this.layoutSection(
        section,
        usableW,
        usableH,
        pptx.margins.left,
        pptx.margins.top,
      );

      for (const slide of sectionSlides) {
        slide.slideIndex = slides.length;
        slides.push(slide);
      }

      if (slides.length >= GUARDRAILS.maxSlidesFromSplit) break;
    }

    return slides;
  }

  private layoutSection(
    section: SectionIR,
    usableW: number,
    usableH: number,
    offsetX: number,
    offsetY: number,
  ): SlideLayout[] {
    const slides: SlideLayout[] = [];
    let currentComponents: Array<{ block: BlockIR; layout: LayoutResult }> = [];
    let currentY = offsetY;

    const density = DENSITY_MULTIPLIERS.normal;
    const gapPt = this.tokens.spacing.sm;
    const gapInches = (gapPt / 72) * density;

    for (const block of section.blocks) {
      if (block.type === "page_break") {
        // Force new slide
        if (currentComponents.length > 0) {
          slides.push({
            slideIndex: 0,
            components: currentComponents,
            slideType: section.slideType || "content",
            notes: slides.length === 0 ? section.notes : undefined,
          });
          currentComponents = [];
          currentY = offsetY;
        }
        continue;
      }

      const estimatedH = this.estimateBlockHeight(block, usableW);
      const remainingH = (offsetY + usableH) - currentY;

      // Check if block fits in remaining space
      if (estimatedH > remainingH && currentComponents.length > 0) {
        // Push current slide and start new one
        slides.push({
          slideIndex: 0,
          components: currentComponents,
          slideType: section.slideType || "content",
          notes: slides.length === 0 ? section.notes : undefined,
        });
        currentComponents = [];
        currentY = offsetY;

        if (slides.length >= GUARDRAILS.maxSlidesFromSplit) break;
      }

      // Compute actual layout for this block
      const cappedH = Math.min(estimatedH, usableH * 0.9);
      const box: LayoutBox = {
        x: offsetX,
        y: currentY,
        w: usableW,
        h: cappedH,
      };

      const textStyle = this.getBlockFontSize(block);
      const layoutResult = this.computeTextFit(block, box, textStyle);

      currentComponents.push({ block, layout: layoutResult });
      currentY += cappedH + gapInches;

      if (currentComponents.length >= GUARDRAILS.maxComponentsPerSlide) {
        slides.push({
          slideIndex: 0,
          components: currentComponents,
          slideType: section.slideType || "content",
          notes: slides.length === 0 ? section.notes : undefined,
        });
        currentComponents = [];
        currentY = offsetY;
      }
    }

    // Push remaining components
    if (currentComponents.length > 0) {
      slides.push({
        slideIndex: 0,
        components: currentComponents,
        slideType: section.slideType || "content",
        notes: slides.length === 0 ? section.notes : undefined,
      });
    }

    // If section had no blocks, create an empty slide
    if (slides.length === 0) {
      slides.push({
        slideIndex: 0,
        components: [],
        slideType: section.slideType || "blank",
      });
    }

    return slides;
  }

  /* ---------------------------------------------------------------- */
  /*  DOCX LAYOUT                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * Compute page layouts for a document.
   * Groups blocks into pages based on estimated heights.
   */
  computePageLayouts(sections: SectionIR[]): PageLayout[] {
    const pages: PageLayout[] = [];
    const docx = this.tokens.docx;
    const margins = docx.margins;

    // Page sizes in inches
    const pageSizes: Record<string, { w: number; h: number }> = {
      LETTER: { w: 8.5, h: 11 },
      A4: { w: 8.27, h: 11.69 },
      LEGAL: { w: 8.5, h: 14 },
      A3: { w: 11.69, h: 16.54 },
      A5: { w: 5.83, h: 8.27 },
    };

    const pageSize = pageSizes[docx.pageSize] || pageSizes.LETTER;
    const usableW = pageSize.w - margins.left - margins.right;
    const usableH = pageSize.h - margins.top - margins.bottom;

    let currentPage: PageLayout = { pageIndex: 0, components: [] };
    let currentHeight = 0;

    for (const section of sections) {
      for (const block of section.blocks) {
        if (block.type === "page_break") {
          pages.push(currentPage);
          currentPage = { pageIndex: pages.length, components: [] };
          currentHeight = 0;
          continue;
        }

        const estimatedH = this.estimateBlockHeight(block, usableW);

        if (currentHeight + estimatedH > usableH && currentPage.components.length > 0) {
          pages.push(currentPage);
          currentPage = { pageIndex: pages.length, components: [] };
          currentHeight = 0;

          if (pages.length >= GUARDRAILS.maxPagesFromSplit) break;
        }

        currentPage.components.push({ block, estimatedHeight: estimatedH });
        currentHeight += estimatedH;
      }
    }

    if (currentPage.components.length > 0) {
      pages.push(currentPage);
    }

    return pages;
  }

  /* ---------------------------------------------------------------- */
  /*  COMMON UTILITIES                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Estimate the height of a block in inches.
   */
  estimateBlockHeight(block: BlockIR, availableWidth: number): number {
    const any = block as any;

    switch (block.type) {
      case "heading": {
        const level = any.level || 1;
        const sizes: Record<number, number> = { 1: 1.0, 2: 0.8, 3: 0.7, 4: 0.6, 5: 0.5, 6: 0.4 };
        return sizes[level] || 0.6;
      }

      case "paragraph":
      case "richtext": {
        const text = any.text || any.markdown || "";
        return this.estimateTextHeight(text, availableWidth, 12);
      }

      case "bullets":
      case "numbered": {
        const items: string[] = any.items || [];
        const itemHeight = 0.35; // per item
        return Math.min(items.length * itemHeight + 0.2, 5.0);
      }

      case "table": {
        const rows = any.rows || [];
        const headerH = 0.4;
        const rowH = 0.3;
        return Math.min(headerH + rows.length * rowH, 8.0);
      }

      case "chart":
        return 3.5;

      case "image":
        return any.height || 3.0;

      case "kpi_card":
        return 1.5;

      case "callout":
      case "quote": {
        const text = any.text || "";
        return Math.max(0.8, this.estimateTextHeight(text, availableWidth, 14) + 0.4);
      }

      case "code": {
        const code = any.code || "";
        const lines = code.split("\n").length;
        return Math.min(lines * 0.25 + 0.3, 6.0);
      }

      case "divider":
        return 0.3;

      case "spacer":
        return any.height || 0.5;

      case "toc":
        return 2.0;

      case "badge":
        return 0.4;

      default:
        return 0.5;
    }
  }

  /**
   * Estimate text height based on content length and available width.
   */
  private estimateTextHeight(text: string, width: number, fontSize: number): number {
    if (!text || width <= 0) return 0.3;
    const charsPerInch = (72 / fontSize) * 1.2;
    const charsPerLine = Math.max(1, width * charsPerInch);
    const lines = Math.ceil(text.length / charsPerLine);
    const lineHeight = (fontSize / 72) * 1.5;
    return Math.max(0.3, lines * lineHeight + 0.1);
  }

  /**
   * Compute text fit within a bounding box.
   * Returns layout result with auto-fitted font size and truncation info.
   */
  private computeTextFit(
    block: BlockIR,
    box: LayoutBox,
    initialFontSize: number,
  ): LayoutResult {
    const any = block as any;
    const text = any.text || any.markdown || any.code || "";

    if (!text || box.h <= 0 || box.w <= 0) {
      return { box, fontSize: initialFontSize, truncated: false, needsSplit: false };
    }

    let fontSize = initialFontSize;
    let iterations = 0;

    while (fontSize > GUARDRAILS.minFontSize && iterations < GUARDRAILS.maxAutoFitIterations) {
      const charsPerInch = (72 / fontSize) * 1.2;
      const charsPerLine = box.w * charsPerInch;
      const maxLines = Math.floor(box.h / ((fontSize / 72) * 1.5));
      const maxChars = charsPerLine * maxLines;

      if (text.length <= maxChars) {
        return { box, fontSize, truncated: false, needsSplit: false };
      }

      fontSize -= fontSize > 48 ? 4 : fontSize > 24 ? 2 : 1;
      iterations++;
    }

    // At minimum font size: truncate
    const charsPerInch = (72 / fontSize) * 1.2;
    const charsPerLine = box.w * charsPerInch;
    const maxLines = Math.max(1, Math.floor(box.h / ((fontSize / 72) * 1.5)));
    const maxChars = Math.max(10, charsPerLine * maxLines);

    if (text.length > maxChars) {
      return {
        box,
        fontSize,
        truncated: true,
        truncatedText: text.substring(0, maxChars - 1) + "…",
        needsSplit: text.length > maxChars * 3, // large overflow → split
      };
    }

    return { box, fontSize, truncated: false, needsSplit: false };
  }

  /**
   * Get initial font size for a block type from design tokens.
   */
  private getBlockFontSize(block: BlockIR): number {
    const any = block as any;
    const styles = this.tokens.textStyles;

    switch (block.type) {
      case "heading": {
        const level = any.level || 1;
        const map: Record<number, number> = {
          1: styles.h1.fontSize,
          2: styles.h2.fontSize,
          3: styles.h3.fontSize,
          4: styles.h4.fontSize,
          5: styles.bodySmall.fontSize,
          6: styles.caption.fontSize,
        };
        return map[level] || styles.h1.fontSize;
      }
      case "quote":
        return styles.quote.fontSize;
      case "code":
        return styles.code.fontSize;
      case "caption":
      case "badge":
        return styles.caption.fontSize;
      default:
        return styles.body.fontSize;
    }
  }

  /* ---------------------------------------------------------------- */
  /*  TABLE SPLITTING                                                   */
  /* ---------------------------------------------------------------- */

  /**
   * Split a table into chunks that fit within available height.
   * Each chunk includes a copy of the header row.
   */
  splitTableRows(
    columns: any[],
    rows: any[],
    maxRowsPerChunk: number,
  ): Array<{ columns: any[]; rows: any[]; isFirstChunk: boolean }> {
    if (rows.length <= maxRowsPerChunk) {
      return [{ columns, rows, isFirstChunk: true }];
    }

    const chunks: Array<{ columns: any[]; rows: any[]; isFirstChunk: boolean }> = [];
    const maxChunks = GUARDRAILS.maxPagesFromSplit;

    for (let i = 0; i < rows.length && chunks.length < maxChunks; i += maxRowsPerChunk) {
      chunks.push({
        columns,
        rows: rows.slice(i, i + maxRowsPerChunk),
        isFirstChunk: i === 0,
      });
    }

    return chunks;
  }

  /**
   * Split bullet items into groups that fit in available height.
   */
  splitBulletItems(
    items: string[],
    maxItemsPerGroup: number,
  ): string[][] {
    if (items.length <= maxItemsPerGroup) return [items];

    const groups: string[][] = [];
    const maxGroups = GUARDRAILS.maxSlidesFromSplit;

    for (let i = 0; i < items.length && groups.length < maxGroups; i += maxItemsPerGroup) {
      groups.push(items.slice(i, i + maxItemsPerGroup));
    }

    return groups;
  }

  /* ---------------------------------------------------------------- */
  /*  XLSX LAYOUT                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * Compute column widths for an Excel sheet based on content.
   */
  computeColumnWidths(
    columns: Array<{ header: string; type?: string }>,
    rows: Array<Record<string, any>>,
  ): number[] {
    const MIN_WIDTH = 8;
    const MAX_WIDTH = 60;

    return columns.map((col) => {
      let maxLen = col.header.length;
      for (const row of rows.slice(0, 100)) { // sample first 100 rows
        const val = row[col.header] ?? row[(col as any).key];
        const strVal = val === null || val === undefined ? "" : String(val);
        maxLen = Math.max(maxLen, strVal.length);
      }
      const width = maxLen + 2;
      return Math.min(Math.max(width, MIN_WIDTH), MAX_WIDTH);
    });
  }
}
