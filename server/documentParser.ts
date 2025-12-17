import mammoth from "mammoth";
import ExcelJS from "exceljs";
import * as pdfParse from "pdf-parse";
import officeParser from "officeparser";

const pdf = (pdfParse as any).default || pdfParse;

export async function extractText(content: Buffer, mimeType: string): Promise<string> {
  if (mimeType === "text/plain") {
    return content.toString("utf-8");
  }
  
  if (mimeType === "text/markdown" || mimeType === "text/md") {
    return content.toString("utf-8");
  }

  if (mimeType === "application/json") {
    try {
      const json = JSON.parse(content.toString("utf-8"));
      return JSON.stringify(json, null, 2);
    } catch {
      return content.toString("utf-8");
    }
  }

  if (mimeType === "text/csv") {
    return content.toString("utf-8");
  }

  if (mimeType === "text/html") {
    const html = content.toString("utf-8");
    return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }

  if (mimeType === "application/pdf") {
    try {
      const data = await pdf(content);
      return data.text;
    } catch (error) {
      console.error("Error parsing PDF:", error);
      throw new Error("Failed to parse PDF");
    }
  }

  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    try {
      const result = await mammoth.extractRawText({ buffer: content });
      return result.value;
    } catch (error) {
      console.error("Error parsing DOCX:", error);
      throw new Error("Failed to parse DOCX");
    }
  }

  if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      mimeType === "application/vnd.ms-excel") {
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(content);
      
      let text = "";
      workbook.eachSheet((worksheet) => {
        const sheetName = worksheet.name;
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
      
      return text.trim();
    } catch (error) {
      console.error("Error parsing Excel:", error);
      throw new Error("Failed to parse Excel");
    }
  }

  if (mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
      mimeType === "application/vnd.ms-powerpoint") {
    try {
      const text = await officeParser.parseOfficeAsync(content);
      if (!text || text.trim().length === 0) {
        throw new Error("No text extracted from PowerPoint");
      }
      return text;
    } catch (error) {
      console.error("Error parsing PowerPoint:", error);
      throw new Error("Failed to parse PowerPoint");
    }
  }

  return content.toString("utf-8");
}
