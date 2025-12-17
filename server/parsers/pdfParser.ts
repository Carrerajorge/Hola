import * as pdfParse from "pdf-parse";
const pdf = (pdfParse as any).default || pdfParse;
import type { FileParser, ParsedResult, DetectedFileType } from "./base";

export class PdfParser implements FileParser {
  name = "pdf";
  supportedMimeTypes = ["application/pdf"];

  async parse(content: Buffer, type: DetectedFileType): Promise<ParsedResult> {
    try {
      const data = await pdf(content);
      return {
        text: data.text,
        metadata: {
          pages: data.numpages,
          info: data.info,
        },
      };
    } catch (error) {
      console.error("Error parsing PDF:", error);
      throw new Error("Failed to parse PDF");
    }
  }
}
