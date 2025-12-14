import * as XLSX from "xlsx";
import type { FileParser, ParsedResult, DetectedFileType } from "./base";

export class XlsxParser implements FileParser {
  name = "xlsx";
  supportedMimeTypes = [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
  ];

  async parse(content: Buffer, type: DetectedFileType): Promise<ParsedResult> {
    try {
      const workbook = XLSX.read(content, { type: "buffer" });
      let text = "";
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        text += `Sheet: ${sheetName}\n`;
        text += XLSX.utils.sheet_to_csv(sheet) + "\n\n";
      }
      return {
        text: text.trim(),
        metadata: {
          sheetNames: workbook.SheetNames,
          sheetCount: workbook.SheetNames.length,
        },
      };
    } catch (error) {
      console.error("Error parsing Excel:", error);
      throw new Error("Failed to parse Excel");
    }
  }
}
