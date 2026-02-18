/**
 * Layout Guardrails — Deterministic overflow resolution for all formats.
 *
 * Extends the existing LayoutEngine with:
 *   - Density detection (too many items in a region)
 *   - Auto-fit font sizing with minimum bounds
 *   - Controlled table splitting with header repetition
 *   - Bullet reflow across slides/pages
 *   - Text truncation with ellipsis
 *   - Character-per-line and line-per-region calculations
 *
 * This module does NOT render anything — it produces layout decisions
 * (font sizes, truncation points, split indices) that renderers consume.
 */

import type { ComponentDescriptor, ComponentConstraints } from "./componentRegistry";
import type { UnifiedDesignTokens } from "./designTokens";

/* ================================================================== */
/*  TYPES                                                              */
/* ================================================================== */

export interface LayoutBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextFitResult {
  /** The text to render (may be truncated) */
  text: string;
  /** Computed font size */
  fontSize: number;
  /** Whether text was truncated */
  truncated: boolean;
  /** Whether font was shrunk */
  shrunk: boolean;
  /** Lines the text would occupy */
  estimatedLines: number;
}

export interface SplitResult<T> {
  /** Items for the current page/slide */
  current: T;
  /** Overflow items for continuation pages */
  overflow: T[];
  /** Number of splits performed */
  splitCount: number;
}

export interface LayoutDecision {
  /** The component descriptor */
  component: ComponentDescriptor;
  /** Computed bounding box */
  box: LayoutBox;
  /** Text fit result (if applicable) */
  textFit?: TextFitResult;
  /** Whether this component uses a fallback representation */
  degraded: boolean;
  /** Warnings from layout computation */
  warnings: string[];
}

export interface SlideLayoutResult {
  /** Decisions for components on this slide */
  decisions: LayoutDecision[];
  /** Components that overflow to next slide */
  overflowComponents: ComponentDescriptor[];
  /** Slide density score (0-1, higher = more crowded) */
  density: number;
}

/* ================================================================== */
/*  CONSTANTS                                                          */
/* ================================================================== */

/** Maximum density before we start warning (0-1 scale) */
const MAX_COMFORTABLE_DENSITY = 0.85;

/** Maximum iterations for auto-fit to prevent CPU exhaustion */
const MAX_AUTOFIT_ITERATIONS = 30;

/** Maximum number of overflow splits to prevent infinite loops */
const MAX_OVERFLOW_SPLITS = 50;

/* ================================================================== */
/*  TEXT MEASUREMENT HEURISTICS                                        */
/* ================================================================== */

/**
 * Estimate characters per line for a given width and font size.
 * This is a heuristic — actual rendering varies by font.
 */
function estimateCharsPerLine(widthInches: number, fontSizePt: number): number {
  // Average char width ≈ 0.6 * fontSize in points
  // 72 points per inch
  const charWidthInches = (fontSizePt * 0.55) / 72;
  return Math.max(1, Math.floor(widthInches / charWidthInches));
}

/**
 * Estimate the number of lines a text block will occupy.
 */
function estimateLineCount(text: string, widthInches: number, fontSizePt: number): number {
  const charsPerLine = estimateCharsPerLine(widthInches, fontSizePt);
  // Split by explicit newlines first, then wrap
  const paragraphs = text.split("\n");
  let totalLines = 0;
  for (const para of paragraphs) {
    totalLines += Math.max(1, Math.ceil(para.length / charsPerLine));
  }
  return totalLines;
}

/**
 * Estimate the height in inches a text block would occupy.
 */
function estimateTextHeight(text: string, widthInches: number, fontSizePt: number, lineHeight: number = 1.2): number {
  const lines = estimateLineCount(text, widthInches, fontSizePt);
  const lineHeightInches = (fontSizePt / 72) * lineHeight;
  return lines * lineHeightInches;
}

/**
 * Estimate the maximum characters that fit in a box.
 */
function estimateMaxChars(box: LayoutBox, fontSizePt: number, lineHeight: number = 1.2): number {
  const charsPerLine = estimateCharsPerLine(box.w, fontSizePt);
  const lineHeightInches = (fontSizePt / 72) * lineHeight;
  const maxLines = Math.max(1, Math.floor(box.h / lineHeightInches));
  return charsPerLine * maxLines;
}

/* ================================================================== */
/*  AUTO-FIT TEXT                                                       */
/* ================================================================== */

/**
 * Auto-fit text into a box by shrinking font size or truncating.
 * Returns the optimal font size and possibly truncated text.
 */
export function autoFitText(
  text: string,
  box: LayoutBox,
  startFontSize: number,
  minFontSize: number,
  ellipsis: string = "…"
): TextFitResult {
  if (!text || box.w <= 0 || box.h <= 0) {
    return { text: text || "", fontSize: startFontSize, truncated: false, shrunk: false, estimatedLines: 0 };
  }

  let fontSize = startFontSize;
  let iterations = 0;

  // Try shrinking font first
  while (fontSize > minFontSize && iterations < MAX_AUTOFIT_ITERATIONS) {
    const height = estimateTextHeight(text, box.w, fontSize);
    if (height <= box.h) {
      return {
        text,
        fontSize,
        truncated: false,
        shrunk: fontSize < startFontSize,
        estimatedLines: estimateLineCount(text, box.w, fontSize),
      };
    }
    // Adaptive step: larger steps for big fonts
    fontSize -= fontSize > 24 ? 2 : 1;
    iterations++;
  }

  // At minimum font size, truncate if still doesn't fit
  fontSize = Math.max(fontSize, minFontSize);
  const maxChars = estimateMaxChars(box, fontSize);

  if (text.length > maxChars) {
    const cutoff = Math.max(0, maxChars - ellipsis.length);
    return {
      text: text.substring(0, cutoff) + ellipsis,
      fontSize,
      truncated: true,
      shrunk: fontSize < startFontSize,
      estimatedLines: estimateLineCount(text.substring(0, cutoff), box.w, fontSize),
    };
  }

  return {
    text,
    fontSize,
    truncated: false,
    shrunk: fontSize < startFontSize,
    estimatedLines: estimateLineCount(text, box.w, fontSize),
  };
}

/* ================================================================== */
/*  BULLET/LIST SPLITTING                                              */
/* ================================================================== */

/**
 * Split a list of bullet items into groups that fit within the given height.
 * Each group represents one slide/page worth of bullets.
 */
export function splitBullets(
  items: string[],
  box: LayoutBox,
  fontSizePt: number,
  lineHeight: number = 1.3
): SplitResult<string[]> {
  const lineHeightInches = (fontSizePt / 72) * lineHeight;
  const bulletPadding = 0.05; // extra padding per bullet
  const maxItemsPerPage = Math.max(1, Math.floor(box.h / (lineHeightInches + bulletPadding)));

  if (items.length <= maxItemsPerPage) {
    return { current: items, overflow: [], splitCount: 0 };
  }

  const groups: string[][] = [];
  for (let i = 0; i < items.length && groups.length < MAX_OVERFLOW_SPLITS; i += maxItemsPerPage) {
    groups.push(items.slice(i, i + maxItemsPerPage));
  }

  return {
    current: groups[0] || items,
    overflow: groups.slice(1),
    splitCount: groups.length - 1,
  };
}

/* ================================================================== */
/*  TABLE SPLITTING                                                    */
/* ================================================================== */

/**
 * Split a table into groups that fit within the given height.
 * Each group includes the header row for consistency.
 */
export function splitTable(
  headers: string[],
  rows: any[][],
  maxRowsPerPage: number
): SplitResult<{ headers: string[]; rows: any[][] }> {
  if (rows.length <= maxRowsPerPage) {
    return { current: { headers, rows }, overflow: [], splitCount: 0 };
  }

  const groups: { headers: string[]; rows: any[][] }[] = [];
  for (let i = 0; i < rows.length && groups.length < MAX_OVERFLOW_SPLITS; i += maxRowsPerPage) {
    groups.push({
      headers, // repeat headers in every group
      rows: rows.slice(i, i + maxRowsPerPage),
    });
  }

  return {
    current: groups[0] || { headers, rows },
    overflow: groups.slice(1),
    splitCount: groups.length - 1,
  };
}

/* ================================================================== */
/*  SLIDE LAYOUT ENGINE                                                */
/* ================================================================== */

/**
 * Compute layout for a set of components on a slide.
 * Handles auto-positioning, overflow detection, and density calculation.
 */
export function computeSlideLayout(
  components: ComponentDescriptor[],
  tokens: UnifiedDesignTokens
): SlideLayoutResult {
  const layout = tokens.base?.layout || { slideWidth: 10, slideHeight: 5.625, marginTop: 0.5, marginBottom: 0.5, marginLeft: 0.5, marginRight: 0.5 };
  const usableW = (layout.slideWidth || 10) - (layout.marginLeft || 0.5) - (layout.marginRight || 0.5);
  const usableH = (layout.slideHeight || 5.625) - (layout.marginTop || 0.5) - (layout.marginBottom || 0.5);
  const totalArea = usableW * usableH;

  const decisions: LayoutDecision[] = [];
  const overflowComponents: ComponentDescriptor[] = [];
  let currentY = layout.marginTop || 0.5;
  let usedArea = 0;

  for (const comp of components) {
    const warnings: string[] = [];

    // Use explicit position if provided
    if (comp.position) {
      const box: LayoutBox = {
        x: comp.position.x,
        y: comp.position.y,
        w: Math.min(comp.position.w, usableW),
        h: Math.min(comp.position.h, usableH),
      };

      const textFit = computeTextFit(comp, box, tokens);
      usedArea += box.w * box.h;

      decisions.push({ component: comp, box, textFit, degraded: false, warnings });
      continue;
    }

    // Auto-layout: stack vertically
    const estimatedH = estimateComponentHeight(comp, usableW, tokens);
    const remainingH = (layout.slideHeight || 5.625) - (layout.marginBottom || 0.5) - currentY;

    if (estimatedH > remainingH && decisions.length > 0) {
      // Overflow: this component doesn't fit on current slide
      overflowComponents.push(comp);
      warnings.push(`Component "${comp.type}" overflows to next slide`);
      continue;
    }

    const actualH = Math.min(estimatedH, remainingH);
    const box: LayoutBox = {
      x: layout.marginLeft || 0.5,
      y: currentY,
      w: usableW,
      h: actualH,
    };

    const textFit = computeTextFit(comp, box, tokens);
    usedArea += box.w * actualH;

    decisions.push({ component: comp, box, textFit, degraded: false, warnings });
    currentY += actualH + (tokens.base?.spacing?.sm || 8) / 72;
  }

  const density = totalArea > 0 ? usedArea / totalArea : 0;

  return {
    decisions,
    overflowComponents,
    density,
  };
}

/* ================================================================== */
/*  HELPERS                                                            */
/* ================================================================== */

function estimateComponentHeight(comp: ComponentDescriptor, width: number, tokens: UnifiedDesignTokens): number {
  const bodySize = tokens.base?.font?.sizeBody || 12;
  const h1Size = tokens.base?.font?.sizeH1 || 28;

  switch (comp.type) {
    case "title":
      return 1.2;
    case "subtitle":
      return 0.8;
    case "heading":
      return 0.6;
    case "paragraph": {
      const text = String(comp.content || "");
      return Math.max(0.4, estimateTextHeight(text, width, bodySize));
    }
    case "bullets":
    case "numbered-list": {
      const items = Array.isArray(comp.content) ? comp.content : [comp.content];
      return Math.min(items.length * 0.35 + 0.2, 5.0);
    }
    case "table": {
      const data = comp.content as { headers?: string[]; rows?: any[][] } | undefined;
      const rowCount = data?.rows?.length || 0;
      return Math.min(rowCount * 0.3 + 0.5, 5.0);
    }
    case "chart":
      return 3.5;
    case "image":
      return 3.0;
    case "kpi":
      return 1.5;
    case "card":
      return 2.0;
    case "code-block": {
      const code = String(comp.content || "");
      const lines = code.split("\n").length;
      return Math.min(lines * 0.2 + 0.3, 4.0);
    }
    case "divider":
      return 0.1;
    case "spacer":
      return 0.3;
    case "footer":
    case "page-number":
      return 0.25;
    case "badge":
    case "button":
      return 0.4;
    default:
      return 1.0;
  }
}

function computeTextFit(comp: ComponentDescriptor, box: LayoutBox, tokens: UnifiedDesignTokens): TextFitResult | undefined {
  const minFontSize = tokens.base?.font?.sizeMin || 8;

  switch (comp.type) {
    case "title":
      return autoFitText(String(comp.content || ""), box, tokens.base?.font?.sizeH1 || 28, minFontSize);
    case "subtitle":
      return autoFitText(String(comp.content || ""), box, tokens.base?.font?.sizeH2 || 22, minFontSize);
    case "heading":
      return autoFitText(String(comp.content || ""), box, tokens.base?.font?.sizeH3 || 18, minFontSize);
    case "paragraph":
    case "quote":
      return autoFitText(String(comp.content || ""), box, tokens.base?.font?.sizeBody || 12, minFontSize);
    default:
      return undefined;
  }
}

/**
 * Compute page layout for DOCX content.
 * Returns split points for page breaks based on content size.
 */
export function computePageBreaks(
  sections: Array<{ type: string; content: any; level?: number }>,
  tokens: UnifiedDesignTokens
): number[] {
  const pageWidth = tokens.base?.layout?.pageWidth || 8.5;
  const pageHeight = tokens.base?.layout?.pageHeight || 11;
  const margins = tokens.wordStyle?.pageMarginInches || 1;
  const usableH = pageHeight - (margins * 2);
  const bodySize = tokens.base?.font?.sizeBody || 12;

  const breakPoints: number[] = [];
  let currentPageH = 0;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    let sectionH: number;

    switch (section.type) {
      case "heading":
        sectionH = 0.5;
        break;
      case "paragraph":
        sectionH = estimateTextHeight(String(section.content || ""), pageWidth - margins * 2, bodySize);
        break;
      case "table": {
        const rows = Array.isArray(section.content) ? section.content.length : 0;
        sectionH = rows * 0.25 + 0.3;
        break;
      }
      case "pageBreak":
        breakPoints.push(i);
        currentPageH = 0;
        continue;
      default:
        sectionH = 0.5;
    }

    if (currentPageH + sectionH > usableH && currentPageH > 0) {
      breakPoints.push(i);
      currentPageH = sectionH;
    } else {
      currentPageH += sectionH;
    }
  }

  return breakPoints;
}
