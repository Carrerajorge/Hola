/**
 * Excel Compiler — translates DocumentIR → XLSX buffer using ExcelJS.
 *
 * Each IR section becomes a worksheet.  Tables are rendered with full styling,
 * autofilter, freeze-panes, and formula-injection protection.
 */
import ExcelJS from "exceljs";
import {
  DocumentIR, ContentNode, Section, CompilationResult, CompilationDiagnostic,
  richTextToPlain, cellToString, isRichText,
} from "@shared/documentIR";
import { DesignTokenSet, normalizeHex } from "@shared/documentDesignTokens";
import { safeCompile, nodeSummary, truncateWithEllipsis } from "./safeRenderer";

// ─── Constants ─────────────────────────────────────────────────────

const FORMULA_INJECTION_PREFIXES = ["=", "+", "-", "@", "\t", "\r", "|", "\\"];
const MAX_SHEET_NAME_LENGTH = 31;

// ─── Public Entry Point ────────────────────────────────────────────

export async function compileExcel(
  ir: DocumentIR,
  tokens: DesignTokenSet,
): Promise<CompilationResult> {
  const start = Date.now();
  const diagnostics: CompilationDiagnostic[] = [];

  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = ir.metadata.author || "Hola";
    workbook.created = new Date();

    for (let si = 0; si < ir.sections.length; si++) {
      const section = ir.sections[si];
      const sheetName = sanitizeSheetName(section.title || `Hoja ${si + 1}`, si);
      const worksheet = workbook.addWorksheet(sheetName);
      compileSection(worksheet, section, si, tokens, diagnostics);
    }

    const arrayBuf = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(arrayBuf);

    return {
      success: true,
      buffer,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename: `${sanitizeFilename(ir.metadata.title)}.xlsx`,
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
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename: "error.xlsx",
      sizeBytes: 0,
      diagnostics,
      durationMs: Date.now() - start,
      themeId: tokens.id,
    };
  }
}

// ─── Section → Worksheet ───────────────────────────────────────────

function compileSection(
  ws: ExcelJS.Worksheet,
  section: Section,
  sectionIdx: number,
  tokens: DesignTokenSet,
  diag: CompilationDiagnostic[],
): void {
  let currentRow = 1;

  // Section title
  if (section.title) {
    const titleCell = ws.getCell(currentRow, 1);
    titleCell.value = section.title;
    titleCell.font = { bold: true, size: 14, color: { argb: `FF${normalizeHex(tokens.colors.primary)}` }, name: tokens.typography.headingFont };
    ws.getRow(currentRow).height = 24;
    currentRow += 2; // leave a gap
  }

  for (let ni = 0; ni < section.nodes.length; ni++) {
    const node = section.nodes[ni];
    const path = `sections[${sectionIdx}].nodes[${ni}]`;

    const rowsUsed = safeCompile(
      () => compileNodeToSheet(ws, node, currentRow, tokens, path, diag),
      () => {
        const cell = ws.getCell(currentRow, 1);
        cell.value = nodeSummary(node);
        cell.font = { italic: true, color: { argb: `FF${normalizeHex(tokens.colors.textMuted)}` } };
        return 1;
      },
      path,
      diag,
    );

    currentRow += (Array.isArray(rowsUsed) ? rowsUsed[0] : rowsUsed) as number;
  }
}

// ─── Node → Excel Rows ─────────────────────────────────────────────

function compileNodeToSheet(
  ws: ExcelJS.Worksheet,
  node: ContentNode,
  startRow: number,
  tokens: DesignTokenSet,
  path: string,
  diag: CompilationDiagnostic[],
): number {
  switch (node.type) {
    case "title": {
      const cell = ws.getCell(startRow, 1);
      cell.value = richTextToPlain(node.content);
      cell.font = { bold: true, size: 18, color: { argb: `FF${normalizeHex(tokens.colors.primary)}` }, name: tokens.typography.headingFont };
      ws.getRow(startRow).height = 30;
      return 2;
    }

    case "heading": {
      const sizes: Record<number, number> = { 1: 16, 2: 14, 3: 12, 4: 11, 5: 10, 6: 10 };
      const cell = ws.getCell(startRow, 1);
      cell.value = richTextToPlain(node.content);
      cell.font = { bold: true, size: sizes[node.level] || 12, color: { argb: `FF${normalizeHex(tokens.colors.primary)}` }, name: tokens.typography.headingFont };
      return 2;
    }

    case "paragraph": {
      const cell = ws.getCell(startRow, 1);
      cell.value = richTextToPlain(node.content);
      cell.font = { name: tokens.typography.bodyFont, size: 10 };
      cell.alignment = { wrapText: true };
      // Merge across a reasonable width
      ws.mergeCells(startRow, 1, startRow, 6);
      return 2;
    }

    case "bullet_list":
    case "numbered_list": {
      for (let i = 0; i < node.items.length; i++) {
        const prefix = node.type === "numbered_list" ? `${(node as any).startAt || 1 + i}. ` : "\u2022 ";
        const cell = ws.getCell(startRow + i, 1);
        cell.value = prefix + richTextToPlain(node.items[i]);
        cell.font = { name: tokens.typography.bodyFont, size: 10 };
      }
      return node.items.length + 1;
    }

    case "table":
      return compileTableToSheet(ws, node, startRow, tokens, path, diag);

    case "code_block": {
      const lines = node.code.split("\n").slice(0, 1_000);
      for (let i = 0; i < lines.length; i++) {
        const cell = ws.getCell(startRow + i, 1);
        cell.value = sanitizeFormulaInjection(lines[i]);
        cell.font = { name: tokens.typography.codeFont, size: 9 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } };
      }
      return lines.length + 1;
    }

    case "kpi_card": {
      const valueCell = ws.getCell(startRow, 1);
      valueCell.value = node.label;
      valueCell.font = { bold: true, name: tokens.typography.bodyFont, size: 10 };
      const dataCell = ws.getCell(startRow, 2);
      dataCell.value = node.value;
      dataCell.font = { bold: true, size: 14, color: { argb: `FF${normalizeHex(node.color || tokens.colors.accent)}` } };
      return 2;
    }

    case "divider": {
      const row = ws.getRow(startRow);
      for (let c = 1; c <= 6; c++) {
        ws.getCell(startRow, c).border = { bottom: { style: "thin", color: { argb: `FF${normalizeHex(tokens.colors.border)}` } } };
      }
      return 2;
    }

    case "spacer":
      return 2;

    case "quote": {
      const cell = ws.getCell(startRow, 1);
      cell.value = `"${richTextToPlain(node.content)}"${node.attribution ? ` — ${node.attribution}` : ""}`;
      cell.font = { italic: true, name: tokens.typography.bodyFont, size: 10 };
      ws.mergeCells(startRow, 1, startRow, 6);
      return 2;
    }

    default:
      return 1;
  }
}

// ─── Table → Sheet ─────────────────────────────────────────────────

function compileTableToSheet(
  ws: ExcelJS.Worksheet,
  node: Extract<ContentNode, { type: "table" }>,
  startRow: number,
  tokens: DesignTokenSet,
  _path: string,
  _diag: CompilationDiagnostic[],
): number {
  const colCount = node.columns.length;

  // Header row
  if (node.showHeader) {
    const headerRow = ws.getRow(startRow);
    node.columns.forEach((col, ci) => {
      const cell = headerRow.getCell(ci + 1);
      cell.value = richTextToPlain(col.header);
      cell.font = { bold: true, color: { argb: `FF${normalizeHex(tokens.colors.tableHeaderFg)}` }, name: tokens.typography.bodyFont, size: 10 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${normalizeHex(tokens.colors.tableHeaderBg)}` } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = { bottom: { style: "medium", color: { argb: `FF${normalizeHex(tokens.colors.border)}` } } };
    });
    headerRow.height = 22;
  }

  const dataStartRow = startRow + (node.showHeader ? 1 : 0);

  // Data rows
  for (let ri = 0; ri < node.rows.length; ri++) {
    const row = node.rows[ri];
    const excelRow = ws.getRow(dataStartRow + ri);

    for (let ci = 0; ci < colCount; ci++) {
      const rawValue = row[ci];
      const cell = excelRow.getCell(ci + 1);
      const colSpec = node.columns[ci];

      // Set value with formula injection protection
      if (typeof rawValue === "number") {
        cell.value = rawValue;
      } else if (typeof rawValue === "boolean") {
        cell.value = rawValue;
      } else {
        const text = cellToString(rawValue);
        cell.value = sanitizeFormulaInjection(text);
      }

      // Number format
      if (colSpec.format) {
        cell.numFmt = colSpec.format;
      }

      // Alignment
      cell.alignment = { horizontal: colSpec.align || "left", vertical: "top", wrapText: true };

      // Font
      cell.font = { name: tokens.typography.bodyFont, size: 10 };

      // Striped rows
      if (node.striped && ri % 2 === 1) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${normalizeHex(tokens.colors.tableStripeBg)}` } };
      }
    }
  }

  // Autofilter
  const lastDataRow = dataStartRow + node.rows.length - 1;
  if (node.showHeader && node.rows.length > 0) {
    ws.autoFilter = { from: { row: startRow, column: 1 }, to: { row: lastDataRow, column: colCount } };
  }

  // Freeze header
  if (node.showHeader) {
    ws.views = [{ state: "frozen" as const, ySplit: startRow, xSplit: 0 }];
  }

  // Auto-fit column widths
  for (let ci = 0; ci < colCount; ci++) {
    const headerLen = richTextToPlain(node.columns[ci].header).length;
    let maxLen = headerLen;
    for (const row of node.rows.slice(0, 200)) {
      const len = cellToString(row[ci]).length;
      if (len > maxLen) maxLen = len;
    }
    const width = Math.max(tokens.layout.excelColMinWidth, Math.min(maxLen + 2, tokens.layout.excelColMaxWidth));
    ws.getColumn(ci + 1).width = width;
  }

  // Caption
  let extraRows = 0;
  if (node.caption) {
    const captionRow = dataStartRow + node.rows.length;
    const cell = ws.getCell(captionRow, 1);
    cell.value = node.caption;
    cell.font = { italic: true, size: 9, color: { argb: `FF${normalizeHex(tokens.colors.textMuted)}` } };
    extraRows = 1;
  }

  return (node.showHeader ? 1 : 0) + node.rows.length + extraRows + 1;
}

// ─── Formula Injection Protection ──────────────────────────────────

function sanitizeFormulaInjection(value: string): string {
  const trimmed = value.trim();
  if (FORMULA_INJECTION_PREFIXES.some((p) => trimmed.startsWith(p))) {
    return `'${trimmed}`;
  }
  return value;
}

// ─── Helpers ───────────────────────────────────────────────────────

function sanitizeSheetName(name: string, idx: number): string {
  let safe = name
    .replace(/[\\/*?:\[\]]/g, "")
    .replace(/^'+|'+$/g, "")
    .trim()
    .slice(0, MAX_SHEET_NAME_LENGTH);
  if (!safe) safe = `Sheet${idx + 1}`;
  return safe;
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 100) || "workbook";
}
