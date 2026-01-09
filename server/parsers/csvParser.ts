import type { FileParser, ParsedResult, DetectedFileType } from "./base";

export interface CSVRowInfo {
  rowNumber: number;
  columns: string[];
  values: Record<string, string>;
}

export interface CSVParseResult extends ParsedResult {
  rows: CSVRowInfo[];
  headers: string[];
  totalRows: number;
  totalColumns: number;
}

/**
 * Dedicated CSV Parser with row/column citations
 * Generates citations in format: [doc:filename.csv row:N col:M]
 */
export class CsvParser implements FileParser {
  name = "CsvParser";

  supports(fileType: DetectedFileType): boolean {
    const mimeTypes = [
      "text/csv",
      "application/csv",
      "text/comma-separated-values",
    ];
    const extensions = ["csv"];
    
    return (
      mimeTypes.includes(fileType.mimeType.toLowerCase()) ||
      extensions.includes(fileType.extension?.toLowerCase() || "")
    );
  }

  async parse(buffer: Buffer, filename: string): Promise<CSVParseResult> {
    const content = buffer.toString("utf-8");
    const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
    
    if (lines.length === 0) {
      return {
        text: "",
        metadata: {
          format: "csv",
          headers: [],
          totalRows: 0,
          totalColumns: 0,
          filename,
          parser_used: this.name,
        },
        rows: [],
        headers: [],
        totalRows: 0,
        totalColumns: 0,
      };
    }

    // Parse headers from first line
    const headers = this.parseCSVLine(lines[0]);
    const rows: CSVRowInfo[] = [];
    const textParts: string[] = [];

    // Add header info to text
    textParts.push(`=== ${filename} ===`);
    textParts.push(`Columns (${headers.length}): ${headers.join(", ")}`);
    textParts.push("");

    // Parse data rows
    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCSVLine(lines[i]);
      const rowNumber = i; // 1-indexed (excluding header)
      
      const rowInfo: CSVRowInfo = {
        rowNumber,
        columns: headers,
        values: {},
      };

      // Build value map and citation text
      const cellTexts: string[] = [];
      for (let j = 0; j < headers.length; j++) {
        const header = headers[j] || `col${j + 1}`;
        const value = values[j] || "";
        rowInfo.values[header] = value;
        
        if (value.trim()) {
          // Format: [doc:file.csv row:N col:header]
          cellTexts.push(`${header}: "${value}" [doc:${filename} row:${rowNumber} col:${header}]`);
        }
      }

      if (cellTexts.length > 0) {
        textParts.push(`Row ${rowNumber}:`);
        textParts.push(cellTexts.join("; "));
        textParts.push("");
      }

      rows.push(rowInfo);
    }

    const fullText = textParts.join("\n");

    return {
      text: fullText,
      metadata: {
        format: "csv",
        headers,
        totalRows: rows.length,
        totalColumns: headers.length,
        filename,
        parser_used: this.name,
        citationFormat: "[doc:filename.csv row:N col:M]",
      },
      rows,
      headers,
      totalRows: rows.length,
      totalColumns: headers.length,
    };
  }

  /**
   * Parse a single CSV line, handling quoted values
   */
  private parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];
      
      if (char === '"' && !inQuotes) {
        inQuotes = true;
      } else if (char === '"' && inQuotes) {
        if (nextChar === '"') {
          current += '"';
          i++; // Skip escaped quote
        } else {
          inQuotes = false;
        }
      } else if (char === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    
    result.push(current.trim());
    return result;
  }

  /**
   * Get specific cell citation
   */
  getCellCitation(filename: string, row: number, column: string): string {
    return `[doc:${filename} row:${row} col:${column}]`;
  }

  /**
   * Get row citation
   */
  getRowCitation(filename: string, row: number): string {
    return `[doc:${filename} row:${row}]`;
  }
}
