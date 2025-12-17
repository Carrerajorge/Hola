import ExcelJS from "exceljs";
import type { FileParser, ParsedResult, DetectedFileType } from "./base";

export class XlsxParser implements FileParser {
  name = "xlsx";
  supportedMimeTypes = [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
  ];

  async parse(content: Buffer, type: DetectedFileType): Promise<ParsedResult> {
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(content);
      
      let text = "";
      const sheetNames: string[] = [];
      
      workbook.eachSheet((worksheet) => {
        const sheetName = worksheet.name;
        sheetNames.push(sheetName);
        text += `Sheet: ${sheetName}\n`;
        
        worksheet.eachRow((row) => {
          const values = row.values as any[];
          const csvRow = values.slice(1).map(val => {
            if (val === null || val === undefined) return '';
            if (typeof val === 'object' && 'text' in val) return val.text;
            return String(val);
          }).join(',');
          text += csvRow + "\n";
        });
        
        text += "\n";
      });
      
      return {
        text: text.trim(),
        metadata: {
          sheetNames,
          sheetCount: sheetNames.length,
        },
      };
    } catch (error) {
      console.error("Error parsing Excel:", error);
      throw new Error("Failed to parse Excel");
    }
  }
}
