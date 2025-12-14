import mammoth from "mammoth";
import type { FileParser, ParsedResult, DetectedFileType } from "./base";

export class DocxParser implements FileParser {
  name = "docx";
  supportedMimeTypes = [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];

  async parse(content: Buffer, type: DetectedFileType): Promise<ParsedResult> {
    try {
      const result = await mammoth.extractRawText({ buffer: content });
      return {
        text: result.value,
        warnings: result.messages.map((m) => m.message),
      };
    } catch (error) {
      console.error("Error parsing DOCX:", error);
      throw new Error("Failed to parse DOCX");
    }
  }
}
