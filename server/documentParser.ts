import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");
const officeParser = require("officeparser");

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
      const workbook = XLSX.read(content, { type: "buffer" });
      let text = "";
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        text += `Sheet: ${sheetName}\n`;
        text += XLSX.utils.sheet_to_csv(sheet) + "\n\n";
      }
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
