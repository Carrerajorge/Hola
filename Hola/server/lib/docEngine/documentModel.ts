/**
 * UNIFIED DOCUMENT MODEL (DSL) — Format-agnostic intermediate representation.
 *
 * Every document (Word, Excel, PowerPoint) is first described in this semantic
 * model, then "compiled" to the target format. This ensures:
 * - Consistent structure validation before rendering
 * - Design system enforcement (all styling via tokens)
 * - Layout engine can resolve overflow before rendering
 * - Graceful degradation can substitute safe components
 *
 * The model is hierarchical:
 *   Document → Sections → Components → Elements
 */

import type { DesignTheme } from "./designTokens";

// ===== Output Formats =====
export type OutputFormat = "docx" | "xlsx" | "pptx";

// ===== Document Container =====

export interface DocumentModel {
  /** Unique document ID for tracing */
  id: string;
  /** Target output format */
  format: OutputFormat;
  /** Design theme to apply */
  themeId: string;
  /** Document metadata */
  metadata: DocumentMetadata;
  /** Ordered sections */
  sections: DocumentSection[];
  /** Layout overrides */
  layout?: DocumentLayout;
}

export interface DocumentMetadata {
  title: string;
  subtitle?: string;
  author?: string;
  organization?: string;
  date?: string;
  version?: string;
  language?: string;
  subject?: string;
  keywords?: string[];
  /** Custom key-value pairs preserved in document properties */
  custom?: Record<string, string>;
}

export interface DocumentLayout {
  /** Page size: letter, A4, legal, widescreen16x9, widescreen16x10 */
  pageSize?: "letter" | "A4" | "legal" | "widescreen16x9" | "widescreen16x10";
  /** Page orientation */
  orientation?: "portrait" | "landscape";
  /** Override margin tokens (inches) */
  margins?: { top?: number; bottom?: number; left?: number; right?: number };
  /** Column count (1-3) for Word */
  columns?: number;
  /** Header/footer config */
  headerText?: string;
  footerText?: string;
  showPageNumbers?: boolean;
  showDate?: boolean;
}

// ===== Sections =====

export interface DocumentSection {
  /** Section ID for referencing */
  id: string;
  /** Section title (shown in TOC) */
  title?: string;
  /** Section type hint */
  type: SectionType;
  /** Ordered components in this section */
  components: DocumentComponent[];
  /** Section-level layout hints */
  layout?: SectionLayout;
}

export type SectionType =
  | "cover"
  | "toc"
  | "content"
  | "data"
  | "chart"
  | "summary"
  | "appendix"
  | "references"
  | "custom";

export interface SectionLayout {
  /** Force page/slide break before this section */
  breakBefore?: boolean;
  /** Column layout within section */
  columns?: number;
  /** Background color override (hex) */
  backgroundColor?: string;
  /** Maximum height in points (for slide fitting) */
  maxHeight?: number;
}

// ===== Components =====
// Components are the building blocks: headings, paragraphs, tables, charts, etc.
// Each has a strict contract (required/optional fields, size limits).

export type DocumentComponent =
  | HeadingComponent
  | ParagraphComponent
  | BulletListComponent
  | NumberedListComponent
  | TableComponent
  | ChartComponent
  | ImageComponent
  | CodeBlockComponent
  | QuoteComponent
  | CardComponent
  | BadgeComponent
  | KpiComponent
  | DividerComponent
  | SpacerComponent
  | PageBreakComponent;

// ===== Component Base =====

interface ComponentBase {
  /** Component type discriminator */
  type: string;
  /** Optional component ID for cross-referencing */
  id?: string;
  /** Style variant override */
  variant?: string;
}

// ===== Text Components =====

export interface HeadingComponent extends ComponentBase {
  type: "heading";
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  /** Maximum characters before truncation with ellipsis */
  maxChars?: number;
}

export interface ParagraphComponent extends ComponentBase {
  type: "paragraph";
  /** Supports inline markdown: **bold**, *italic*, `code`, [links](url) */
  text: string;
  /** Alignment override */
  align?: "left" | "center" | "right" | "justify";
}

export interface BulletListComponent extends ComponentBase {
  type: "bulletList";
  items: string[];
  /** Max items before truncation with "... and N more" */
  maxItems?: number;
}

export interface NumberedListComponent extends ComponentBase {
  type: "numberedList";
  items: string[];
  startAt?: number;
  maxItems?: number;
}

// ===== Data Components =====

export interface TableComponent extends ComponentBase {
  type: "table";
  columns: TableColumn[];
  rows: TableRow[];
  /** Max rows before splitting/pagination */
  maxRows?: number;
  /** Whether to show header row */
  showHeader?: boolean;
  /** Whether to show row numbers */
  showRowNumbers?: boolean;
  /** Summary row (totals, averages) */
  summaryRow?: TableRow;
  /** Table style variant */
  variant?: "default" | "striped" | "bordered" | "minimal" | "grid";
}

export interface TableColumn {
  header: string;
  /** Data type for formatting */
  dataType?: "text" | "number" | "currency" | "percentage" | "date" | "boolean";
  /** Alignment */
  align?: "left" | "center" | "right";
  /** Width hint (percentage of total width, 0-100) */
  widthPercent?: number;
  /** Minimum width in characters */
  minChars?: number;
  /** Maximum width in characters */
  maxChars?: number;
  /** Excel number format string */
  format?: string;
  /** Formula template with {row} placeholder */
  formula?: string;
}

export type TableRow = Array<string | number | boolean | null>;

export interface ChartComponent extends ComponentBase {
  type: "chart";
  chartType: "bar" | "line" | "pie" | "doughnut" | "area" | "radar" | "column";
  title?: string;
  categories: string[];
  series: ChartSeries[];
  /** Width/height in inches (for PowerPoint/Word) */
  width?: number;
  height?: number;
  showLegend?: boolean;
  showDataLabels?: boolean;
}

export interface ChartSeries {
  name: string;
  values: number[];
  color?: string;
}

// ===== Media Components =====

export interface ImageComponent extends ComponentBase {
  type: "image";
  /** Base64 data URI or URL */
  src: string;
  alt: string;
  width?: number; // inches
  height?: number;
  caption?: string;
}

export interface CodeBlockComponent extends ComponentBase {
  type: "codeBlock";
  code: string;
  language?: string;
  /** Max lines before truncation */
  maxLines?: number;
  showLineNumbers?: boolean;
}

export interface QuoteComponent extends ComponentBase {
  type: "quote";
  text: string;
  attribution?: string;
}

// ===== Visual Components =====

export interface CardComponent extends ComponentBase {
  type: "card";
  title: string;
  body: string;
  /** Icon name or emoji */
  icon?: string;
  /** Background color override */
  backgroundColor?: string;
}

export interface BadgeComponent extends ComponentBase {
  type: "badge";
  text: string;
  /** Color variant */
  color?: "primary" | "secondary" | "success" | "warning" | "danger" | "info";
}

export interface KpiComponent extends ComponentBase {
  type: "kpi";
  label: string;
  value: string;
  unit?: string;
  trend?: "up" | "down" | "flat";
  trendValue?: string;
}

// ===== Layout Components =====

export interface DividerComponent extends ComponentBase {
  type: "divider";
}

export interface SpacerComponent extends ComponentBase {
  type: "spacer";
  /** Height in points */
  height?: number;
}

export interface PageBreakComponent extends ComponentBase {
  type: "pageBreak";
}

// ===== Component Contracts (Limits) =====

export const COMPONENT_LIMITS = {
  heading: { maxTextChars: 500 },
  paragraph: { maxTextChars: 50_000 },
  bulletList: { maxItems: 200, maxItemChars: 5_000 },
  numberedList: { maxItems: 200, maxItemChars: 5_000 },
  table: { maxColumns: 26, maxRows: 5_000, maxCellChars: 10_000 },
  chart: { maxCategories: 500, maxSeries: 20, maxDataPoints: 10_000 },
  image: { maxSrcBytes: 10 * 1024 * 1024, maxWidthInches: 10, maxHeightInches: 10 },
  codeBlock: { maxLines: 2_000, maxChars: 100_000 },
  quote: { maxTextChars: 5_000 },
  card: { maxTitleChars: 200, maxBodyChars: 2_000 },
  badge: { maxTextChars: 50 },
  kpi: { maxLabelChars: 100, maxValueChars: 50 },
} as const;

// ===== Section Limits =====

export const SECTION_LIMITS = {
  maxComponents: 200,
  maxTotalSections: 100,
} as const;

export const DOCUMENT_LIMITS = {
  maxSections: 100,
  maxTotalComponents: 2_000,
  maxTotalCellCount: 500_000,
  maxDocumentSizeBytes: 100 * 1024 * 1024, // 100MB
} as const;
