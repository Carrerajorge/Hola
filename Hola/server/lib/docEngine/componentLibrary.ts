/**
 * COMPONENT LIBRARY — Translates document model components to format-specific output.
 *
 * Each component has:
 * - A strict contract (inputs, size limits, required/optional fields)
 * - A render function per output format
 * - A safe fallback (if rendering fails, substitute a degraded version)
 *
 * Components don't "draw" directly — they return intermediate render nodes
 * that the format compiler assembles into the final document.
 */

import type {
  DocumentComponent,
  HeadingComponent,
  ParagraphComponent,
  BulletListComponent,
  NumberedListComponent,
  TableComponent,
  TableColumn,
  TableRow,
  ChartComponent,
  ImageComponent,
  CodeBlockComponent,
  QuoteComponent,
  CardComponent,
  BadgeComponent,
  KpiComponent,
  DividerComponent,
  SpacerComponent,
  PageBreakComponent,
  COMPONENT_LIMITS,
} from "./documentModel";
import type { DesignTheme, FontSpec } from "./designTokens";

// ===== Render Nodes =====
// These are format-neutral intermediate nodes that compilers consume.

export type RenderNode =
  | TextRun
  | ParagraphNode
  | TableNode
  | ImageNode
  | ChartNode
  | PageBreakNode
  | SpacerNode
  | DividerNode
  | RawNode;

export interface TextRun {
  type: "textRun";
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
  hyperlink?: string;
  code?: boolean;
}

export interface ParagraphNode {
  type: "paragraph";
  runs: TextRun[];
  alignment?: "left" | "center" | "right" | "justify";
  indent?: number;
  spaceBefore?: number;
  spaceAfter?: number;
  bulletLevel?: number;
  numberedLevel?: number;
  numberedStart?: number;
  style?: string;
}

export interface TableNode {
  type: "table";
  columns: Array<{
    header: string;
    width?: number;
    align?: "left" | "center" | "right";
    dataType?: string;
    format?: string;
    formula?: string;
  }>;
  headerRow: TextRun[][];
  bodyRows: Array<TextRun[][]>;
  summaryRow?: TextRun[][];
  variant?: string;
}

export interface ImageNode {
  type: "image";
  src: string;
  alt: string;
  width: number;
  height: number;
  caption?: string;
}

export interface ChartNode {
  type: "chart";
  chartType: string;
  title?: string;
  categories: string[];
  series: Array<{ name: string; values: number[]; color?: string }>;
  width: number;
  height: number;
  showLegend?: boolean;
}

export interface PageBreakNode {
  type: "pageBreak";
}

export interface SpacerNode {
  type: "spacer";
  height: number;
}

export interface DividerNode {
  type: "divider";
  color?: string;
  width?: number;
}

export interface RawNode {
  type: "raw";
  content: string;
  format: string;
}

// ===== Render Context =====

export interface RenderContext {
  theme: DesignTheme;
  format: "docx" | "xlsx" | "pptx";
  sectionIndex: number;
  componentIndex: number;
  errors: RenderError[];
}

export interface RenderError {
  componentId?: string;
  componentType: string;
  message: string;
  fallbackUsed: boolean;
}

// ===== Parse Inline Markdown =====

function parseInlineMarkdown(text: string, defaultFont?: FontSpec): TextRun[] {
  if (!text) return [{ type: "textRun", text: "" }];

  const runs: TextRun[] = [];
  // Regex for: **bold**, *italic*, `code`, [text](url)
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[(.+?)\]\((.+?)\))/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Text before this match
    if (match.index > lastIndex) {
      runs.push({ type: "textRun", text: text.slice(lastIndex, match.index) });
    }

    if (match[2]) {
      // **bold**
      runs.push({ type: "textRun", text: match[2], bold: true });
    } else if (match[3]) {
      // *italic*
      runs.push({ type: "textRun", text: match[3], italic: true });
    } else if (match[4]) {
      // `code`
      runs.push({ type: "textRun", text: match[4], code: true, fontFamily: "Consolas" });
    } else if (match[5] && match[6]) {
      // [text](url)
      runs.push({ type: "textRun", text: match[5], hyperlink: match[6], underline: true, color: "2B6CB0" });
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    runs.push({ type: "textRun", text: text.slice(lastIndex) });
  }

  if (runs.length === 0) {
    runs.push({ type: "textRun", text });
  }

  return runs;
}

// ===== Truncation Helpers =====

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 3) + "...";
}

function truncateList(items: string[], maxItems: number): { items: string[]; truncated: number } {
  if (items.length <= maxItems) return { items, truncated: 0 };
  const kept = items.slice(0, maxItems - 1);
  const remaining = items.length - kept.length;
  kept.push(`... and ${remaining} more items`);
  return { items: kept, truncated: remaining };
}

function truncateTableRows(rows: TableRow[], maxRows: number): { rows: TableRow[]; truncated: number } {
  if (rows.length <= maxRows) return { rows, truncated: 0 };
  const kept = rows.slice(0, maxRows);
  return { rows: kept, truncated: rows.length - maxRows };
}

// ===== Component Renderers =====

function renderHeading(comp: HeadingComponent, ctx: RenderContext): RenderNode[] {
  const theme = ctx.theme;
  const fontKey = comp.level === 1 ? "heading1" : comp.level === 2 ? "heading2" : "heading3";
  const font = theme.typography[fontKey] || theme.typography.heading3;

  const text = truncateText(comp.text, comp.maxChars ?? 500);

  return [{
    type: "paragraph",
    runs: [{ type: "textRun", text, bold: font.bold, color: font.color, fontSize: font.size, fontFamily: font.family }],
    alignment: "left",
    spaceBefore: theme.spacing.headingSpaceBefore,
    spaceAfter: theme.spacing.headingSpaceAfter,
    style: `Heading${comp.level}`,
  }];
}

function renderParagraph(comp: ParagraphComponent, ctx: RenderContext): RenderNode[] {
  const text = truncateText(comp.text, 50_000);
  return [{
    type: "paragraph",
    runs: parseInlineMarkdown(text),
    alignment: comp.align || "left",
    spaceAfter: ctx.theme.spacing.paragraphGap,
  }];
}

function renderBulletList(comp: BulletListComponent, ctx: RenderContext): RenderNode[] {
  const { items } = truncateList(comp.items, comp.maxItems ?? 200);
  return items.map((item) => ({
    type: "paragraph" as const,
    runs: parseInlineMarkdown(truncateText(item, 5_000)),
    bulletLevel: 0,
    spaceAfter: 2,
  }));
}

function renderNumberedList(comp: NumberedListComponent, ctx: RenderContext): RenderNode[] {
  const { items } = truncateList(comp.items, comp.maxItems ?? 200);
  return items.map((item, i) => ({
    type: "paragraph" as const,
    runs: parseInlineMarkdown(truncateText(item, 5_000)),
    numberedLevel: 0,
    numberedStart: i === 0 ? (comp.startAt ?? 1) : undefined,
    spaceAfter: 2,
  }));
}

function renderTable(comp: TableComponent, ctx: RenderContext): RenderNode[] {
  const { rows, truncated } = truncateTableRows(comp.rows, comp.maxRows ?? 5_000);

  const headerRow: TextRun[][] = comp.columns.map((col) => [
    { type: "textRun", text: truncateText(col.header, 200), bold: true },
  ]);

  const bodyRows: TextRun[][][] = rows.map((row) =>
    comp.columns.map((col, ci) => {
      const cellVal = ci < row.length ? row[ci] : null;
      const text = cellVal === null || cellVal === undefined ? "" : String(cellVal);
      return [{ type: "textRun" as const, text: truncateText(text, 10_000) }];
    })
  );

  let summaryRowNodes: TextRun[][] | undefined;
  if (comp.summaryRow) {
    summaryRowNodes = comp.columns.map((col, ci) => {
      const cellVal = ci < comp.summaryRow!.length ? comp.summaryRow![ci] : null;
      const text = cellVal === null || cellVal === undefined ? "" : String(cellVal);
      return [{ type: "textRun" as const, text, bold: true }];
    });
  }

  const nodes: RenderNode[] = [{
    type: "table",
    columns: comp.columns.map((c) => ({
      header: c.header,
      width: c.widthPercent,
      align: c.align,
      dataType: c.dataType,
      format: c.format,
      formula: c.formula,
    })),
    headerRow,
    bodyRows,
    summaryRow: summaryRowNodes,
    variant: comp.variant || "default",
  }];

  if (truncated > 0) {
    nodes.push({
      type: "paragraph",
      runs: [{ type: "textRun", text: `(${truncated} additional rows not shown)`, italic: true, color: ctx.theme.colors.textMuted }],
      alignment: "right",
      spaceAfter: ctx.theme.spacing.paragraphGap,
    });
  }

  return nodes;
}

function renderChart(comp: ChartComponent, ctx: RenderContext): RenderNode[] {
  return [{
    type: "chart",
    chartType: comp.chartType,
    title: comp.title,
    categories: comp.categories.slice(0, 500),
    series: comp.series.slice(0, 20).map((s, i) => ({
      ...s,
      values: s.values.slice(0, 500),
      color: s.color || ctx.theme.colors.chartSeries[i % ctx.theme.colors.chartSeries.length],
    })),
    width: comp.width ?? 6,
    height: comp.height ?? 4,
    showLegend: comp.showLegend,
  }];
}

function renderImage(comp: ImageComponent, ctx: RenderContext): RenderNode[] {
  const nodes: RenderNode[] = [{
    type: "image",
    src: comp.src,
    alt: comp.alt,
    width: Math.min(comp.width ?? 5, 10),
    height: Math.min(comp.height ?? 3, 10),
    caption: comp.caption,
  }];

  if (comp.caption) {
    nodes.push({
      type: "paragraph",
      runs: [{ type: "textRun", text: comp.caption, italic: true, color: ctx.theme.colors.textSecondary, fontSize: ctx.theme.typography.caption.size }],
      alignment: "center",
      spaceAfter: ctx.theme.spacing.paragraphGap,
    });
  }

  return nodes;
}

function renderCodeBlock(comp: CodeBlockComponent, ctx: RenderContext): RenderNode[] {
  let code = comp.code;
  if (comp.maxLines) {
    const lines = code.split("\n");
    if (lines.length > comp.maxLines) {
      code = lines.slice(0, comp.maxLines).join("\n") + `\n... (${lines.length - comp.maxLines} more lines)`;
    }
  }
  if (code.length > 100_000) {
    code = code.slice(0, 100_000) + "\n... (truncated)";
  }

  return [{
    type: "paragraph",
    runs: [{ type: "textRun", text: code, fontFamily: ctx.theme.typography.code.family, fontSize: ctx.theme.typography.code.size, code: true }],
    spaceAfter: ctx.theme.spacing.paragraphGap,
  }];
}

function renderQuote(comp: QuoteComponent, ctx: RenderContext): RenderNode[] {
  const nodes: RenderNode[] = [{
    type: "paragraph",
    runs: parseInlineMarkdown(truncateText(comp.text, 5_000)),
    indent: 0.5,
    spaceAfter: comp.attribution ? 2 : ctx.theme.spacing.paragraphGap,
    style: "Quote",
  }];

  if (comp.attribution) {
    nodes.push({
      type: "paragraph",
      runs: [{ type: "textRun", text: `— ${comp.attribution}`, italic: true, color: ctx.theme.colors.textSecondary }],
      indent: 0.5,
      alignment: "right",
      spaceAfter: ctx.theme.spacing.paragraphGap,
    });
  }

  return nodes;
}

function renderCard(comp: CardComponent, ctx: RenderContext): RenderNode[] {
  // Cards are rendered as bordered text blocks (tables with 1 cell in Word, shapes in PPT)
  return [
    {
      type: "paragraph",
      runs: [
        { type: "textRun", text: comp.icon ? `${comp.icon} ` : "", fontSize: 14 },
        { type: "textRun", text: truncateText(comp.title, 200), bold: true, fontSize: ctx.theme.typography.heading3.size },
      ],
      spaceBefore: 8,
      spaceAfter: 4,
    },
    {
      type: "paragraph",
      runs: parseInlineMarkdown(truncateText(comp.body, 2_000)),
      spaceAfter: 8,
    },
  ];
}

function renderBadge(comp: BadgeComponent, ctx: RenderContext): RenderNode[] {
  const colorMap: Record<string, string> = {
    primary: ctx.theme.colors.primary,
    secondary: ctx.theme.colors.secondary,
    success: ctx.theme.colors.success,
    warning: ctx.theme.colors.warning,
    danger: ctx.theme.colors.danger,
    info: ctx.theme.colors.info,
  };
  const color = colorMap[comp.color ?? "primary"] ?? ctx.theme.colors.primary;

  return [{
    type: "paragraph",
    runs: [{ type: "textRun", text: `[${truncateText(comp.text, 50)}]`, bold: true, color }],
    spaceAfter: 2,
  }];
}

function renderKpi(comp: KpiComponent, ctx: RenderContext): RenderNode[] {
  const trendIcon = comp.trend === "up" ? "+" : comp.trend === "down" ? "-" : "~";
  const trendColor = comp.trend === "up" ? ctx.theme.colors.success : comp.trend === "down" ? ctx.theme.colors.danger : ctx.theme.colors.textMuted;

  return [
    {
      type: "paragraph",
      runs: [{ type: "textRun", text: truncateText(comp.label, 100), color: ctx.theme.colors.textSecondary, fontSize: ctx.theme.typography.caption.size }],
      spaceAfter: 0,
    },
    {
      type: "paragraph",
      runs: [
        { type: "textRun", text: `${comp.value}${comp.unit ? " " + comp.unit : ""}`, bold: true, fontSize: 18, color: ctx.theme.colors.textPrimary },
        ...(comp.trendValue ? [{ type: "textRun" as const, text: ` ${trendIcon}${comp.trendValue}`, color: trendColor, fontSize: 12 }] : []),
      ],
      spaceAfter: ctx.theme.spacing.paragraphGap,
    },
  ];
}

function renderDivider(comp: DividerComponent, ctx: RenderContext): RenderNode[] {
  return [{ type: "divider", color: ctx.theme.colors.borderLight, width: 0.5 }];
}

function renderSpacer(comp: SpacerComponent, ctx: RenderContext): RenderNode[] {
  return [{ type: "spacer", height: comp.height ?? ctx.theme.spacing.sectionGap }];
}

function renderPageBreak(_comp: PageBreakComponent, _ctx: RenderContext): RenderNode[] {
  return [{ type: "pageBreak" }];
}

// ===== Safe Fallback =====

function renderSafeFallback(comp: DocumentComponent, ctx: RenderContext, error: Error): RenderNode[] {
  ctx.errors.push({
    componentId: comp.id,
    componentType: comp.type,
    message: error.message,
    fallbackUsed: true,
  });

  // Degrade to simple text representation
  const text = `[${comp.type}${comp.id ? `: ${comp.id}` : ""}]`;
  return [{
    type: "paragraph",
    runs: [{ type: "textRun", text, italic: true, color: ctx.theme.colors.textMuted }],
    spaceAfter: ctx.theme.spacing.paragraphGap,
  }];
}

// ===== Main Render Dispatcher =====

const RENDERERS: Record<string, (comp: any, ctx: RenderContext) => RenderNode[]> = {
  heading: renderHeading,
  paragraph: renderParagraph,
  bulletList: renderBulletList,
  numberedList: renderNumberedList,
  table: renderTable,
  chart: renderChart,
  image: renderImage,
  codeBlock: renderCodeBlock,
  quote: renderQuote,
  card: renderCard,
  badge: renderBadge,
  kpi: renderKpi,
  divider: renderDivider,
  spacer: renderSpacer,
  pageBreak: renderPageBreak,
};

/**
 * Render a component to format-neutral render nodes.
 * Uses graceful degradation: if a renderer fails, substitutes a safe fallback.
 */
export function renderComponent(comp: DocumentComponent, ctx: RenderContext): RenderNode[] {
  const renderer = RENDERERS[comp.type];
  if (!renderer) {
    return renderSafeFallback(comp, ctx, new Error(`Unknown component type: ${comp.type}`));
  }

  try {
    return renderer(comp, ctx);
  } catch (error: any) {
    return renderSafeFallback(comp, ctx, error);
  }
}

/**
 * Render all components in a section.
 */
export function renderSection(
  components: DocumentComponent[],
  ctx: RenderContext,
): RenderNode[] {
  const nodes: RenderNode[] = [];
  for (let i = 0; i < components.length; i++) {
    ctx.componentIndex = i;
    nodes.push(...renderComponent(components[i], ctx));
  }
  return nodes;
}

export { parseInlineMarkdown, truncateText, truncateList, truncateTableRows };
