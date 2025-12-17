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
        
        worksheet.eachRow({ includeEmpty: false }, (row) => {
          const values: string[] = [];
          row.eachCell({ includeEmpty: true }, (cell) => {
            let cellValue = '';
            if (cell.value === null || cell.value === undefined) {
              cellValue = '';
            } else if (typeof cell.value === 'object') {
              if ('text' in cell.value) {
                cellValue = cell.value.text;
              } else if ('result' in cell.value) {
                cellValue = String(cell.value.result ?? '');
              } else if ('richText' in cell.value) {
                cellValue = cell.value.richText.map((rt: any) => rt.text).join('');
              } else {
                cellValue = cell.text ?? String(cell.value);
              }
            } else {
              cellValue = String(cell.value);
            }
            
            if (cellValue.includes(',') || cellValue.includes('\n') || cellValue.includes('"')) {
              cellValue = '"' + cellValue.replace(/"/g, '""') + '"';
            }
            values.push(cellValue);
          });
          text += values.join(',') + "\n";
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
