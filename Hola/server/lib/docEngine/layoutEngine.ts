/**
 * LAYOUT ENGINE — Resolves overflow, density, and fit before rendering.
 *
 * Problems solved:
 * - Tables too wide for page → auto-fit columns, truncate with ellipsis
 * - Tables too long → split across pages/slides
 * - Text too long for cell → truncate with ellipsis
 * - Too many components → reflow to additional pages/slides
 * - Image too large → scale down preserving aspect ratio
 * - Slide too dense → split into multiple slides
 * - Content exceeds context → enforce guardrails
 */

import type {
  DocumentModel,
  DocumentSection,
  DocumentComponent,
  TableComponent,
  TableColumn,
  TableRow,
  OutputFormat,
  COMPONENT_LIMITS,
  SECTION_LIMITS,
  DOCUMENT_LIMITS,
} from "./documentModel";
import type { DesignTheme } from "./designTokens";

// ===== Layout Configuration =====

export interface LayoutConfig {
  /** Available content width in inches */
  contentWidth: number;
  /** Available content height in inches */
  contentHeight: number;
  /** Maximum characters per table cell */
  maxCellChars: number;
  /** Maximum table columns that fit the page */
  maxTableColumnsForWidth: number;
  /** Maximum visible rows per page/slide */
  maxVisibleRows: number;
  /** Enable table splitting across pages */
  enableTableSplit: boolean;
  /** Enable component reflow to new pages */
  enableReflow: boolean;
  /** Maximum total components after layout */
  maxTotalComponents: number;
  /** Maximum density score per section (for slides) */
  maxDensityPerSection: number;
}

const DEFAULT_LAYOUT: Record<OutputFormat, LayoutConfig> = {
  docx: {
    contentWidth: 6.5, // letter with 1" margins
    contentHeight: 9.0,
    maxCellChars: 500,
    maxTableColumnsForWidth: 12,
    maxVisibleRows: 100,
    enableTableSplit: true,
    enableReflow: true,
    maxTotalComponents: 2000,
    maxDensityPerSection: Infinity,
  },
  xlsx: {
    contentWidth: 10,
    contentHeight: Infinity,
    maxCellChars: 10000,
    maxTableColumnsForWidth: 26,
    maxVisibleRows: 100000,
    enableTableSplit: false,
    enableReflow: false,
    maxTotalComponents: 500,
    maxDensityPerSection: Infinity,
  },
  pptx: {
    contentWidth: 9.0, // widescreen 16:9 with margins
    contentHeight: 5.5,
    maxCellChars: 100,
    maxTableColumnsForWidth: 8,
    maxVisibleRows: 12,
    enableTableSplit: true,
    enableReflow: true,
    maxTotalComponents: 500,
    maxDensityPerSection: 15,
  },
};

// ===== Layout Result =====

export interface LayoutResult {
  /** The modified document model after layout resolution */
  model: DocumentModel;
  /** Layout actions taken */
  actions: LayoutAction[];
  /** Guardrail violations detected */
  violations: LayoutViolation[];
}

export interface LayoutAction {
  type: "truncate" | "split" | "reflow" | "scale" | "drop" | "autofit";
  target: string; // section/component path
  description: string;
}

export interface LayoutViolation {
  severity: "error" | "warning";
  code: string;
  message: string;
  path: string;
}

// ===== Density Calculator =====

function componentDensity(comp: DocumentComponent): number {
  switch (comp.type) {
    case "heading": return 1;
    case "paragraph": return 1 + Math.ceil((comp as any).text?.length / 500);
    case "bulletList": return Math.ceil(((comp as any).items?.length || 0) / 3);
    case "numberedList": return Math.ceil(((comp as any).items?.length || 0) / 3);
    case "table": {
      const t = comp as TableComponent;
      return 2 + Math.min(t.rows.length, 10) + Math.ceil(t.columns.length / 4);
    }
    case "chart": return 5;
    case "image": return 3;
    case "codeBlock": return 2 + Math.ceil(((comp as any).code?.length || 0) / 1000);
    case "kpi": return 2;
    case "card": return 3;
    default: return 1;
  }
}

function sectionDensity(section: DocumentSection): number {
  return section.components.reduce((sum, c) => sum + componentDensity(c), 0);
}

// ===== Table Layout =====

function resolveTableLayout(
  table: TableComponent,
  config: LayoutConfig,
  actions: LayoutAction[],
  path: string,
): TableComponent[] {
  let resolved = { ...table, columns: [...table.columns], rows: [...table.rows] };

  // 1. Limit column count
  if (resolved.columns.length > config.maxTableColumnsForWidth) {
    const kept = resolved.columns.slice(0, config.maxTableColumnsForWidth);
    const dropped = resolved.columns.length - kept.length;
    resolved.columns = kept;
    resolved.rows = resolved.rows.map(r => r.slice(0, kept.length));
    actions.push({ type: "truncate", target: path, description: `Dropped ${dropped} columns (max ${config.maxTableColumnsForWidth})` });
  }

  // 2. Auto-fit column widths (distribute evenly if not specified)
  const totalWidth = config.contentWidth;
  const colsWithWidth = resolved.columns.filter(c => c.widthPercent);
  if (colsWithWidth.length < resolved.columns.length) {
    const usedPercent = colsWithWidth.reduce((s, c) => s + (c.widthPercent || 0), 0);
    const remainingPercent = Math.max(100 - usedPercent, 0);
    const colsWithoutWidth = resolved.columns.length - colsWithWidth.length;
    const evenShare = colsWithoutWidth > 0 ? remainingPercent / colsWithoutWidth : 0;

    resolved.columns = resolved.columns.map(c => ({
      ...c,
      widthPercent: c.widthPercent || evenShare,
    }));
    actions.push({ type: "autofit", target: path, description: "Auto-distributed column widths" });
  }

  // 3. Truncate cell contents
  for (let ri = 0; ri < resolved.rows.length; ri++) {
    for (let ci = 0; ci < resolved.rows[ri].length; ci++) {
      const val = resolved.rows[ri][ci];
      if (typeof val === "string" && val.length > config.maxCellChars) {
        resolved.rows[ri] = [...resolved.rows[ri]];
        resolved.rows[ri][ci] = val.slice(0, config.maxCellChars - 3) + "...";
      }
    }
  }

  // 4. Split table if too many rows
  if (config.enableTableSplit && resolved.rows.length > config.maxVisibleRows) {
    const tables: TableComponent[] = [];
    for (let i = 0; i < resolved.rows.length; i += config.maxVisibleRows) {
      const chunk = resolved.rows.slice(i, i + config.maxVisibleRows);
      const partNum = Math.floor(i / config.maxVisibleRows) + 1;
      tables.push({
        ...resolved,
        id: `${resolved.id || "table"}-part${partNum}`,
        rows: chunk,
        // Only show summary on the last part
        summaryRow: i + config.maxVisibleRows >= resolved.rows.length ? resolved.summaryRow : undefined,
      });
    }
    actions.push({ type: "split", target: path, description: `Split table into ${tables.length} parts (${resolved.rows.length} rows)` });
    return tables;
  }

  return [resolved];
}

// ===== Section Splitting (for Slides) =====

function splitDenseSection(
  section: DocumentSection,
  maxDensity: number,
  actions: LayoutAction[],
): DocumentSection[] {
  const density = sectionDensity(section);
  if (density <= maxDensity) return [section];

  // Split components into chunks that fit within density budget
  const chunks: DocumentComponent[][] = [[]];
  let currentDensity = 0;

  for (const comp of section.components) {
    const d = componentDensity(comp);
    if (currentDensity + d > maxDensity && chunks[chunks.length - 1].length > 0) {
      chunks.push([]);
      currentDensity = 0;
    }
    chunks[chunks.length - 1].push(comp);
    currentDensity += d;
  }

  if (chunks.length <= 1) return [section];

  actions.push({
    type: "reflow",
    target: `section:${section.id}`,
    description: `Split section into ${chunks.length} parts (density ${density} > ${maxDensity})`,
  });

  return chunks.map((comps, i) => ({
    ...section,
    id: `${section.id}-part${i + 1}`,
    title: i === 0 ? section.title : `${section.title || "Section"} (cont.)`,
    components: comps,
  }));
}

// ===== Image Scaling =====

function resolveImageLayout(
  comp: DocumentComponent,
  config: LayoutConfig,
  actions: LayoutAction[],
  path: string,
): DocumentComponent {
  if (comp.type !== "image") return comp;

  const img = comp as any;
  const maxW = config.contentWidth;
  const maxH = config.contentHeight * 0.6; // Images shouldn't take more than 60% of height

  let w = img.width ?? 5;
  let h = img.height ?? 3;

  if (w > maxW || h > maxH) {
    const scaleW = maxW / w;
    const scaleH = maxH / h;
    const scale = Math.min(scaleW, scaleH);
    w = Math.round(w * scale * 100) / 100;
    h = Math.round(h * scale * 100) / 100;
    actions.push({ type: "scale", target: path, description: `Scaled image to ${w}x${h} inches` });
  }

  return { ...comp, width: w, height: h } as any;
}

// ===== Main Layout Resolution =====

/**
 * Resolve layout for a document model.
 * Modifies components to fit within format constraints:
 * - Truncates oversized content
 * - Splits large tables
 * - Reflows dense sections (slides)
 * - Scales images
 * - Enforces guardrails
 */
export function resolveLayout(
  model: DocumentModel,
  theme: DesignTheme,
  configOverrides?: Partial<LayoutConfig>,
): LayoutResult {
  const config: LayoutConfig = {
    ...DEFAULT_LAYOUT[model.format],
    ...configOverrides,
  };

  const actions: LayoutAction[] = [];
  const violations: LayoutViolation[] = [];

  // Clone model to avoid mutation
  let sections = model.sections.map(s => ({
    ...s,
    components: [...s.components],
  }));

  // 1. Enforce document-level limits
  if (sections.length > 100) {
    violations.push({
      severity: "warning",
      code: "DOC_TOO_MANY_SECTIONS",
      message: `${sections.length} sections exceeds limit of 100`,
      path: "document",
    });
    sections = sections.slice(0, 100);
    actions.push({ type: "truncate", target: "document", description: "Truncated to 100 sections" });
  }

  // 2. Process each section
  const resolvedSections: DocumentSection[] = [];

  for (let si = 0; si < sections.length; si++) {
    const section = sections[si];
    const resolvedComponents: DocumentComponent[] = [];

    // Enforce component limit per section
    const maxComps = Math.min(section.components.length, 200);

    for (let ci = 0; ci < maxComps; ci++) {
      let comp = section.components[ci];
      const path = `section[${si}].component[${ci}]`;

      // Resolve images
      comp = resolveImageLayout(comp, config, actions, path);

      // Resolve tables (may split into multiple)
      if (comp.type === "table") {
        const tables = resolveTableLayout(comp as TableComponent, config, actions, path);
        resolvedComponents.push(...tables);
      } else {
        resolvedComponents.push(comp);
      }
    }

    if (section.components.length > maxComps) {
      actions.push({
        type: "truncate",
        target: `section[${si}]`,
        description: `Truncated from ${section.components.length} to ${maxComps} components`,
      });
    }

    // Split dense sections (for slides)
    const sectionWithComps = { ...section, components: resolvedComponents };
    if (model.format === "pptx" && config.maxDensityPerSection < Infinity) {
      const parts = splitDenseSection(sectionWithComps, config.maxDensityPerSection, actions);
      resolvedSections.push(...parts);
    } else {
      resolvedSections.push(sectionWithComps);
    }
  }

  // 3. Enforce total component count
  let totalComponents = resolvedSections.reduce((s, sec) => s + sec.components.length, 0);
  if (totalComponents > config.maxTotalComponents) {
    violations.push({
      severity: "warning",
      code: "DOC_TOO_MANY_COMPONENTS",
      message: `${totalComponents} total components exceeds limit of ${config.maxTotalComponents}`,
      path: "document",
    });
  }

  return {
    model: { ...model, sections: resolvedSections },
    actions,
    violations,
  };
}

export { DEFAULT_LAYOUT, componentDensity, sectionDensity };
