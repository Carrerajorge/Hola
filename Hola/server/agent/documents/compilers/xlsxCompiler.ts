/**
 * XLSX Compiler — Translates DocumentIR to Excel workbooks.
 *
 * Each section in the IR becomes a worksheet.
 * Blocks within a section are rendered sequentially into the sheet.
 *
 * Features:
 *   - Table blocks: styled tables with headers, striping, auto-filter, freeze
 *   - KPI cards: rendered as styled cell groups
 *   - Charts: rendered as placeholders (ExcelJS doesn't support charts natively)
 *   - Formula injection prevention
 *   - Auto-column-width heuristic
 *   - Design token integration for all styling
 *   - Per-component graceful degradation
 */

import type { DocumentIR, BlockIR, SectionIR } from "../documentIR";
import type { DesignTokensV2 } from "../designTokens";
import { resolveTableStyle } from "../componentRegistry";
import { DegradationEngine } from "../gracefulDegradation";

/* ================================================================== */
/*  SECURITY                                                           */
/* ================================================================== */

const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r", "|", "\\"];

function escapeFormulaInjection(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trimStart();
  if (trimmed.length > 0 && FORMULA_PREFIXES.some(p => trimmed.startsWith(p))) {
    return `'${value}`;
  }
  return value;
}

function sanitizeSheetName(name: string): string {
  if (!name || typeof name !== "string") return "Sheet1";
  return name
    .replace(/[*?:/\\[\]]/g, "_")
    .substring(0, 31)
    .trim() || "Sheet1";
}

function isValidHexColor(color: string): boolean {
  return /^[0-9A-Fa-f]{6}$/.test(color.replace(/^#/, ""));
}

function colorToArgb(hex: string): string {
  const clean = hex.replace("#", "");
  if (!isValidHexColor(clean)) return "FF000000";
  return `FF${clean}`;
}

/* ================================================================== */
/*  LIMITS                                                             */
/* ================================================================== */

const LIMITS = {
  maxSheets: 100,
  maxRowsPerTable: 100_000,
  maxColumnsPerTable: 500,
  maxCellLength: 32_767,
  maxStyledCells: 100_000,
  maxColumnWidth: 60,
  minColumnWidth: 8,
} as const;

/* ================================================================== */
/*  XLSX COMPILER                                                     */
/* ================================================================== */

export class XlsxCompiler {
  private tokens: DesignTokensV2;
  private degradation: DegradationEngine;

  constructor(tokens: DesignTokensV2, degradation: DegradationEngine) {
    this.tokens = tokens;
    this.degradation = degradation;
  }

  async compile(ir: DocumentIR): Promise<Buffer> {
    const excelMod = await import("exceljs");
    const ExcelJS = (excelMod as any).default || excelMod;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = ir.metadata.author || "IliaGPT";
    workbook.created = new Date();
    if (ir.metadata.title) workbook.title = ir.metadata.title.substring(0, 500);

    const tokens = this.tokens;
    const xlsxConfig = tokens.xlsx;
    const tableStyle = resolveTableStyle(tokens);

    // Ensure unique sheet names
    const usedNames = new Set<string>();
    const sheets = ir.sections.slice(0, LIMITS.maxSheets);

    for (let s = 0; s < sheets.length; s++) {
      const section = sheets[s];
      let sheetName = sanitizeSheetName(section.title || `Sheet${s + 1}`);

      // Deduplicate
      let suffix = 1;
      const baseName = sheetName;
      while (usedNames.has(sheetName) && suffix < 1000) {
        sheetName = `${baseName.substring(0, 28)}_${suffix++}`;
      }
      usedNames.add(sheetName);

      const worksheet = workbook.addWorksheet(sheetName);
      let currentRow = 1;

      for (let b = 0; b < section.blocks.length; b++) {
        const block = section.blocks[b];
        const path = `sections[${s}].blocks[${b}]`;

        const rowsUsed = await this.degradation.withDegradation(
          block,
          path,
          () => this.renderBlock(worksheet, block, currentRow, tokens, tableStyle, xlsxConfig),
          (fallbackBlock) => this.renderBlock(worksheet, fallbackBlock, currentRow, tokens, tableStyle, xlsxConfig),
        );

        currentRow += rowsUsed + 1; // +1 for spacing between blocks
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /* ---------------------------------------------------------------- */
  /*  BLOCK RENDERING                                                  */
  /* ---------------------------------------------------------------- */

  private renderBlock(
    ws: any,
    block: BlockIR,
    startRow: number,
    tokens: DesignTokensV2,
    tableStyle: any,
    xlsxConfig: any,
  ): number {
    const any_block = block as any;

    switch (block.type) {
      case "heading":
        return this.renderHeading(ws, any_block, startRow, tokens);

      case "paragraph":
      case "richtext":
        return this.renderText(ws, any_block, startRow, tokens);

      case "table":
        return this.renderTable(ws, any_block, startRow, tokens, tableStyle, xlsxConfig);

      case "bullets":
      case "numbered":
        return this.renderList(ws, any_block, startRow, tokens);

      case "kpi_card":
        return this.renderKpiCard(ws, any_block, startRow, tokens);

      case "chart":
        return this.renderChartPlaceholder(ws, any_block, startRow, tokens);

      case "quote":
      case "callout":
        return this.renderQuoteOrCallout(ws, any_block, startRow, tokens);

      case "code":
        return this.renderCode(ws, any_block, startRow, tokens);

      case "divider":
        return this.renderDivider(ws, startRow, tokens);

      default:
        return 0;
    }
  }

  private renderHeading(ws: any, block: any, row: number, tokens: DesignTokensV2): number {
    const level = block.level || 1;
    const styleMap: Record<number, { fontSize: number; color: string }> = {
      1: { fontSize: 18, color: tokens.colors.primary },
      2: { fontSize: 16, color: tokens.colors.primary },
      3: { fontSize: 14, color: tokens.colors.secondary },
      4: { fontSize: 12, color: tokens.colors.textPrimary },
    };
    const style = styleMap[level] || styleMap[4];

    ws.mergeCells(row, 1, row, 6);
    const cell = ws.getCell(row, 1);
    cell.value = block.text || "";
    cell.font = {
      name: tokens.textStyles.h1.fontFamily,
      size: style.fontSize,
      bold: true,
      color: { argb: colorToArgb(style.color) },
    };
    cell.alignment = { vertical: "middle" };
    ws.getRow(row).height = style.fontSize * 2;

    return 1;
  }

  private renderText(ws: any, block: any, row: number, tokens: DesignTokensV2): number {
    const text = block.text || block.markdown || "";
    if (!text) return 0;

    ws.mergeCells(row, 1, row, 8);
    const cell = ws.getCell(row, 1);
    cell.value = text.substring(0, LIMITS.maxCellLength);
    cell.font = {
      name: tokens.textStyles.body.fontFamily,
      size: tokens.textStyles.body.fontSize,
      color: { argb: colorToArgb(tokens.colors.textPrimary) },
    };
    cell.alignment = { wrapText: true, vertical: "top" };

    return 1;
  }

  private renderTable(
    ws: any,
    block: any,
    startRow: number,
    tokens: DesignTokensV2,
    tableStyle: any,
    xlsxConfig: any,
  ): number {
    const columns = (block.columns || []).slice(0, LIMITS.maxColumnsPerTable);
    const rows = (block.rows || []).slice(0, LIMITS.maxRowsPerTable);
    if (columns.length === 0) return 0;

    let currentRow = startRow;

    // Caption
    if (block.caption) {
      ws.mergeCells(currentRow, 1, currentRow, columns.length);
      const captionCell = ws.getCell(currentRow, 1);
      captionCell.value = block.caption;
      captionCell.font = {
        name: tokens.textStyles.caption.fontFamily,
        size: tokens.textStyles.caption.fontSize,
        italic: true,
        color: { argb: colorToArgb(tokens.colors.textSecondary) },
      };
      currentRow++;
    }

    // Header row
    if (block.showHeader !== false) {
      for (let c = 0; c < columns.length; c++) {
        const cell = ws.getCell(currentRow, c + 1);
        cell.value = columns[c].header || columns[c].key || "";
        cell.font = {
          name: tokens.textStyles.body.fontFamily,
          size: tableStyle.headerFontSize,
          bold: true,
          color: { argb: colorToArgb(tableStyle.headerFg) },
        };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: colorToArgb(tableStyle.headerBg) },
        };
        cell.alignment = {
          horizontal: tableStyle.headerAlign || "center",
          vertical: "middle",
          wrapText: true,
        };
        cell.border = {
          top: { style: "thin", color: { argb: colorToArgb(tableStyle.borderColor) } },
          bottom: { style: "thin", color: { argb: colorToArgb(tableStyle.borderColor) } },
          left: { style: "thin", color: { argb: colorToArgb(tableStyle.borderColor) } },
          right: { style: "thin", color: { argb: colorToArgb(tableStyle.borderColor) } },
        };
      }
      ws.getRow(currentRow).height = 25;
      currentRow++;
    }

    // Data rows
    const borderStyle = {
      top: { style: "thin" as const, color: { argb: colorToArgb(tableStyle.borderColor) } },
      bottom: { style: "thin" as const, color: { argb: colorToArgb(tableStyle.borderColor) } },
      left: { style: "thin" as const, color: { argb: colorToArgb(tableStyle.borderColor) } },
      right: { style: "thin" as const, color: { argb: colorToArgb(tableStyle.borderColor) } },
    };

    for (let r = 0; r < rows.length; r++) {
      const rowData = rows[r];
      const isOdd = r % 2 === 0;
      const bgColor = block.showStripes !== false
        ? (isOdd ? tableStyle.stripeOdd : tableStyle.stripeEven)
        : tableStyle.stripeEven;

      for (let c = 0; c < columns.length; c++) {
        const col = columns[c];
        const cell = ws.getCell(currentRow, c + 1);
        const rawValue = rowData[col.key];
        cell.value = escapeFormulaInjection(rawValue);
        cell.font = {
          name: tokens.textStyles.body.fontFamily,
          size: tableStyle.bodyFontSize,
          color: { argb: colorToArgb(tableStyle.bodyColor) },
        };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: colorToArgb(bgColor) },
        };
        cell.alignment = {
          horizontal: col.align || "left",
          vertical: "middle",
          wrapText: true,
        };
        cell.border = borderStyle;

        if (col.format) {
          cell.numFmt = col.format;
        }
      }
      currentRow++;
    }

    // Auto-filter
    if (xlsxConfig.autoFilter && rows.length > 0) {
      const headerRow = block.caption ? startRow + 1 : startRow;
      ws.autoFilter = {
        from: { row: headerRow, column: 1 },
        to: { row: currentRow - 1, column: columns.length },
      };
    }

    // Freeze header
    if (xlsxConfig.freezeHeader) {
      const headerRow = block.caption ? startRow + 1 : startRow;
      ws.views = [{ state: "frozen", xSplit: 0, ySplit: headerRow }];
    }

    // Auto-fit columns
    for (let c = 0; c < columns.length; c++) {
      const col = columns[c];
      if (col.width) {
        ws.getColumn(c + 1).width = Math.min(col.width, LIMITS.maxColumnWidth);
      } else {
        // Heuristic width
        let maxLen = (col.header || col.key || "").length;
        for (const row of rows.slice(0, 100)) {
          const val = row[col.key];
          const strVal = val === null || val === undefined ? "" : String(val);
          maxLen = Math.max(maxLen, strVal.length);
        }
        ws.getColumn(c + 1).width = Math.min(Math.max(maxLen + 2, LIMITS.minColumnWidth), LIMITS.maxColumnWidth);
      }
    }

    return currentRow - startRow;
  }

  private renderList(ws: any, block: any, startRow: number, tokens: DesignTokensV2): number {
    const items: string[] = (block.items || []).slice(0, 1000);
    let row = startRow;

    for (let i = 0; i < items.length; i++) {
      const cell = ws.getCell(row, 1);
      const prefix = block.type === "numbered" ? `${i + 1}. ` : "• ";
      cell.value = `${prefix}${items[i]}`;
      cell.font = {
        name: tokens.textStyles.body.fontFamily,
        size: tokens.textStyles.body.fontSize,
        color: { argb: colorToArgb(tokens.colors.textPrimary) },
      };
      cell.alignment = { wrapText: true };
      row++;
    }

    return items.length;
  }

  private renderKpiCard(ws: any, block: any, startRow: number, tokens: DesignTokensV2): number {
    const color = block.color || tokens.colors.primary;

    // Title cell
    ws.mergeCells(startRow, 1, startRow, 2);
    const titleCell = ws.getCell(startRow, 1);
    titleCell.value = block.title || "Metric";
    titleCell.font = {
      name: tokens.textStyles.body.fontFamily,
      size: 10,
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    titleCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: colorToArgb(color) },
    };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };

    // Value cell
    ws.mergeCells(startRow + 1, 1, startRow + 2, 2);
    const valueCell = ws.getCell(startRow + 1, 1);
    valueCell.value = `${block.value || ""}${block.unit ? ` ${block.unit}` : ""}`;
    valueCell.font = {
      name: tokens.textStyles.body.fontFamily,
      size: 24,
      bold: true,
      color: { argb: colorToArgb(color) },
    };
    valueCell.alignment = { horizontal: "center", vertical: "middle" };

    return 3;
  }

  private renderChartPlaceholder(ws: any, block: any, startRow: number, tokens: DesignTokensV2): number {
    const cell = ws.getCell(startRow, 1);
    cell.value = `[Chart: ${block.title || block.chartType || "chart"}]`;
    cell.font = {
      italic: true,
      color: { argb: colorToArgb(tokens.colors.textMuted) },
    };

    // Also render data as a mini-table
    if (block.labels && block.datasets) {
      let row = startRow + 1;

      // Header
      ws.getCell(row, 1).value = "Label";
      ws.getCell(row, 1).font = { bold: true };
      for (let d = 0; d < block.datasets.length; d++) {
        ws.getCell(row, d + 2).value = block.datasets[d].label || `Series ${d + 1}`;
        ws.getCell(row, d + 2).font = { bold: true };
      }
      row++;

      // Data
      for (let i = 0; i < block.labels.length; i++) {
        ws.getCell(row, 1).value = block.labels[i];
        for (let d = 0; d < block.datasets.length; d++) {
          ws.getCell(row, d + 2).value = block.datasets[d].values?.[i] ?? "";
        }
        row++;
      }

      return row - startRow;
    }

    return 1;
  }

  private renderQuoteOrCallout(ws: any, block: any, startRow: number, tokens: DesignTokensV2): number {
    const prefix = block.type === "callout"
      ? `[${(block.variant || "note").toUpperCase()}] ${block.title ? block.title + ": " : ""}`
      : `"`;
    const suffix = block.type === "quote" ? `"${block.attribution ? ` — ${block.attribution}` : ""}` : "";

    ws.mergeCells(startRow, 1, startRow, 8);
    const cell = ws.getCell(startRow, 1);
    cell.value = `${prefix}${block.text || ""}${suffix}`;
    cell.font = {
      name: tokens.textStyles.quote.fontFamily,
      size: tokens.textStyles.quote.fontSize,
      italic: true,
      color: { argb: colorToArgb(tokens.colors.textSecondary) },
    };
    cell.alignment = { wrapText: true };

    return 1;
  }

  private renderCode(ws: any, block: any, startRow: number, tokens: DesignTokensV2): number {
    const lines = (block.code || "").split("\n").slice(0, 500);
    let row = startRow;

    for (const line of lines) {
      ws.mergeCells(row, 1, row, 10);
      const cell = ws.getCell(row, 1);
      cell.value = line;
      cell.font = {
        name: tokens.textStyles.code.fontFamily,
        size: tokens.textStyles.code.fontSize,
        color: { argb: colorToArgb(tokens.textStyles.code.color) },
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: colorToArgb(tokens.colors.surface) },
      };
      row++;
    }

    return lines.length;
  }

  private renderDivider(ws: any, startRow: number, tokens: DesignTokensV2): number {
    ws.mergeCells(startRow, 1, startRow, 10);
    const cell = ws.getCell(startRow, 1);
    cell.border = {
      bottom: { style: "thin" as const, color: { argb: colorToArgb(tokens.colors.border) } },
    };
    return 1;
  }
}
