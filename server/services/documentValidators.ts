import {
  excelSpecSchema,
  docSpecSchema,
  type ExcelSpec,
  type DocSpec,
} from "../../shared/documentSpecs";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Parse a cell reference like "A1" into column and row indices
 * @param ref Cell reference string (e.g., "A1", "B2", "AA10")
 * @returns { col: number, row: number } or null if invalid
 */
export function parseCellReference(ref: string): { col: number; row: number } | null {
  const match = ref.match(/^([A-Z]+)(\d+)$/i);
  if (!match) return null;

  const colStr = match[1].toUpperCase();
  const rowStr = match[2];

  // Convert column letters to 0-based index (A=0, B=1, ..., Z=25, AA=26, etc.)
  let col = 0;
  for (let i = 0; i < colStr.length; i++) {
    col = col * 26 + (colStr.charCodeAt(i) - 64);
  }
  col -= 1; // Convert to 0-based

  const row = parseInt(rowStr, 10);
  if (row < 1) return null;

  return { col, row };
}

/**
 * Validate an Excel specification against the schema and additional business rules
 */
export function validateExcelSpec(spec: unknown): ValidationResult {
  const errors: string[] = [];

  // Validate against Zod schema
  const parseResult = excelSpecSchema.safeParse(spec);
  if (!parseResult.success) {
    for (const issue of parseResult.error.issues) {
      errors.push(`${issue.path.join(".")}: ${issue.message}`);
    }
    return { valid: false, errors };
  }

  const validSpec = parseResult.data as ExcelSpec;

  // Check sheet names are unique
  const sheetNames = new Set<string>();
  for (const sheet of validSpec.sheets) {
    if (sheetNames.has(sheet.name)) {
      errors.push(`Duplicate sheet name: "${sheet.name}"`);
    }
    sheetNames.add(sheet.name);

    // Validate tables in each sheet
    for (let tableIdx = 0; tableIdx < sheet.tables.length; tableIdx++) {
      const table = sheet.tables[tableIdx];

      // Validate anchor cell reference
      const anchorParsed = parseCellReference(table.anchor);
      if (!anchorParsed) {
        errors.push(
          `Sheet "${sheet.name}", table ${tableIdx + 1}: Invalid anchor cell reference "${table.anchor}"`
        );
      }

      // Check all rows have same length as headers
      const headerLength = table.headers.length;
      for (let rowIdx = 0; rowIdx < table.rows.length; rowIdx++) {
        const row = table.rows[rowIdx];
        if (row.length !== headerLength) {
          errors.push(
            `Sheet "${sheet.name}", table ${tableIdx + 1}, row ${rowIdx + 1}: Row has ${row.length} cells but headers have ${headerLength} columns`
          );
        }
      }
    }

    // Validate chart ranges (validate all cell references)
    for (let chartIdx = 0; chartIdx < sheet.charts.length; chartIdx++) {
      const chart = sheet.charts[chartIdx];

      // Validate position
      const positionParsed = parseCellReference(chart.position);
      if (!positionParsed) {
        errors.push(
          `Sheet "${sheet.name}", chart ${chartIdx + 1}: Invalid position "${chart.position}"`
        );
      }

      // Validate categories_range (can be a range like "A2:A10" or single cell)
      if (!chart.categories_range || chart.categories_range.trim() === "") {
        errors.push(
          `Sheet "${sheet.name}", chart ${chartIdx + 1}: categories_range is required`
        );
      } else {
        const rangeParts = chart.categories_range.split(":");
        for (const part of rangeParts) {
          if (!parseCellReference(part.trim())) {
            errors.push(
              `Sheet "${sheet.name}", chart ${chartIdx + 1}: Invalid categories_range "${chart.categories_range}"`
            );
            break;
          }
        }
      }

      // Validate values_range (can be a range like "B2:B10" or single cell)
      if (!chart.values_range || chart.values_range.trim() === "") {
        errors.push(
          `Sheet "${sheet.name}", chart ${chartIdx + 1}: values_range is required`
        );
      } else {
        const rangeParts = chart.values_range.split(":");
        for (const part of rangeParts) {
          if (!parseCellReference(part.trim())) {
            errors.push(
              `Sheet "${sheet.name}", chart ${chartIdx + 1}: Invalid values_range "${chart.values_range}"`
            );
            break;
          }
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a Word document specification against the schema and additional business rules
 */
export function validateDocSpec(spec: unknown): ValidationResult {
  const errors: string[] = [];

  // Validate against Zod schema
  const parseResult = docSpecSchema.safeParse(spec);
  if (!parseResult.success) {
    for (const issue of parseResult.error.issues) {
      errors.push(`${issue.path.join(".")}: ${issue.message}`);
    }
    return { valid: false, errors };
  }

  const validSpec = parseResult.data as DocSpec;

  // Validate each block
  for (let blockIdx = 0; blockIdx < validSpec.blocks.length; blockIdx++) {
    const block = validSpec.blocks[blockIdx];

    if (block.type === "heading") {
      // Check heading levels are 1-6 (already enforced by schema, but double-check)
      if (block.level < 1 || block.level > 6) {
        errors.push(
          `Block ${blockIdx + 1}: Heading level must be between 1 and 6, got ${block.level}`
        );
      }
    }

    if (block.type === "table") {
      // Check all rows have same length as columns
      const columnCount = block.columns.length;
      for (let rowIdx = 0; rowIdx < block.rows.length; rowIdx++) {
        const row = block.rows[rowIdx];
        if (row.length !== columnCount) {
          errors.push(
            `Block ${blockIdx + 1} (table), row ${rowIdx + 1}: Row has ${row.length} cells but table has ${columnCount} columns`
          );
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate that a buffer is a valid XLSX file (ZIP format with PK signature)
 */
export function validateExcelFile(buffer: Buffer): ValidationResult {
  const errors: string[] = [];

  if (buffer.length < 4) {
    errors.push("File is too small to be a valid XLSX file");
    return { valid: false, errors };
  }

  // Check for ZIP/PK signature (0x50, 0x4B, 0x03, 0x04)
  if (
    buffer[0] !== 0x50 ||
    buffer[1] !== 0x4b ||
    buffer[2] !== 0x03 ||
    buffer[3] !== 0x04
  ) {
    errors.push("File does not have valid XLSX signature (expected ZIP/PK header)");
    return { valid: false, errors };
  }

  return { valid: true, errors: [] };
}

/**
 * Validate that a buffer is a valid DOCX file (ZIP format with PK signature)
 */
export function validateDocxFile(buffer: Buffer): ValidationResult {
  const errors: string[] = [];

  if (buffer.length < 4) {
    errors.push("File is too small to be a valid DOCX file");
    return { valid: false, errors };
  }

  // Check for ZIP/PK signature (0x50, 0x4B, 0x03, 0x04)
  if (
    buffer[0] !== 0x50 ||
    buffer[1] !== 0x4b ||
    buffer[2] !== 0x03 ||
    buffer[3] !== 0x04
  ) {
    errors.push("File does not have valid DOCX signature (expected ZIP/PK header)");
    return { valid: false, errors };
  }

  return { valid: true, errors: [] };
}
