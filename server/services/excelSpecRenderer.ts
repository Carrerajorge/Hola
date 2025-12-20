import ExcelJS from "exceljs";
import type { ExcelSpec, TableSpec, ChartSpec, SheetLayoutSpec } from "../../shared/documentSpecs";

function parseCellReference(ref: string): { col: number; row: number } {
  const match = ref.match(/^([A-Z]+)(\d+)$/i);
  if (!match) {
    throw new Error(`Invalid cell reference: ${ref}`);
  }
  const colLetters = match[1].toUpperCase();
  const row = parseInt(match[2], 10);
  let col = 0;
  for (let i = 0; i < colLetters.length; i++) {
    col = col * 26 + (colLetters.charCodeAt(i) - 64);
  }
  return { col, row };
}

function columnIndexToLetter(index: number): string {
  let letter = "";
  while (index > 0) {
    const mod = (index - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    index = Math.floor((index - 1) / 26);
  }
  return letter || "A";
}

let tableCounter = 0;

export async function renderExcelFromSpec(spec: ExcelSpec): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Sira GPT";
  workbook.created = new Date();
  tableCounter = 0;

  if (spec.workbook_title) {
    workbook.title = spec.workbook_title;
  }

  for (const sheetSpec of spec.sheets) {
    const sheetName = sheetSpec.name.replace(/[\\/:*?\[\]]/g, "").slice(0, 31) || "Sheet";
    const worksheet = workbook.addWorksheet(sheetName);

    for (const tableSpec of sheetSpec.tables || []) {
      renderTable(worksheet, tableSpec);
    }

    for (const chartSpec of sheetSpec.charts || []) {
      renderChart(worksheet, chartSpec, sheetName);
    }

    applyLayout(worksheet, sheetSpec.layout || {});
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function renderTable(worksheet: ExcelJS.Worksheet, table: TableSpec): void {
  const anchor = parseCellReference(table.anchor);
  const startRow = anchor.row;
  const startCol = anchor.col;
  
  const endCol = startCol + table.headers.length - 1;
  const endRow = startRow + (table.rows?.length || 0);
  const endColLetter = columnIndexToLetter(endCol);
  const startColLetter = columnIndexToLetter(startCol);
  
  tableCounter++;
  const tableName = `Table${tableCounter}`;
  
  const tableStyle = table.table_style || "TableStyleMedium9";
  
  worksheet.addTable({
    name: tableName,
    ref: table.anchor,
    headerRow: true,
    totalsRow: false,
    style: {
      theme: tableStyle as any,
      showRowStripes: true,
      showColumnStripes: false,
    },
    columns: table.headers.map(header => ({
      name: header,
      filterButton: table.autofilter !== false,
    })),
    rows: table.rows || [],
  });
  
  if (table.column_formats) {
    for (let rowIdx = 0; rowIdx <= (table.rows?.length || 0); rowIdx++) {
      const excelRow = worksheet.getRow(startRow + rowIdx);
      table.headers.forEach((header, colIdx) => {
        if (table.column_formats![header]) {
          const cell = excelRow.getCell(startCol + colIdx);
          cell.numFmt = table.column_formats![header];
        }
      });
    }
  }

  if (table.freeze_header !== false) {
    worksheet.views = [
      { state: "frozen", xSplit: 0, ySplit: startRow },
    ];
  }
}

function renderChart(worksheet: ExcelJS.Worksheet, chart: ChartSpec, sheetName: string): void {
  // NOTE: ExcelJS has very limited chart support - the addChart method doesn't exist
  // in the standard ExcelJS API. Charts would require using a different library like
  // xlsx-chart or generating the chart XML manually.
  // 
  // For now, we skip chart creation and add a placeholder comment cell instead.
  // If charts are critical, consider:
  // 1. Using xlsx-chart library for chart generation
  // 2. Creating the data and letting users add charts manually in Excel
  // 3. Using a Python-based solution with openpyxl which has better chart support
  
  const position = parseCellReference(chart.position || "H2");
  const cell = worksheet.getRow(position.row).getCell(position.col);
  cell.value = `[Chart placeholder: ${chart.title || chart.type || 'Chart'} - Charts require manual creation in Excel]`;
  cell.font = { italic: true, color: { argb: "FF808080" } };
}

function applyLayout(worksheet: ExcelJS.Worksheet, layout: SheetLayoutSpec): void {
  if (layout.freeze_panes) {
    const freeze = parseCellReference(layout.freeze_panes);
    worksheet.views = [
      { state: "frozen", xSplit: freeze.col - 1, ySplit: freeze.row - 1 },
    ];
  }

  if (layout.show_gridlines === false) {
    worksheet.views = worksheet.views?.map(v => ({ ...v, showGridLines: false })) || 
      [{ showGridLines: false }];
  }

  if (layout.column_widths) {
    for (const [colLetter, width] of Object.entries(layout.column_widths)) {
      const colNum = parseCellReference(`${colLetter}1`).col;
      const column = worksheet.getColumn(colNum);
      column.width = width;
    }
  }

  if (layout.auto_fit_columns !== false) {
    worksheet.columns?.forEach(column => {
      if (column.width === undefined || column.width === 8.43) {
        let maxLength = 10;
        column.eachCell?.({ includeEmpty: false }, cell => {
          const cellValue = cell.value?.toString() || "";
          maxLength = Math.max(maxLength, cellValue.length + 2);
        });
        column.width = Math.min(maxLength, 50);
      }
    });
  }
}
