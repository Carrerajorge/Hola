import officeParser from "officeparser";
import type { FileParser, ParsedResult, DetectedFileType } from "./base";

export class PptxParser implements FileParser {
  name = "pptx";
  supportedMimeTypes = [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-powerpoint",
  ];

  async parse(content: Buffer, type: DetectedFileType): Promise<ParsedResult> {
    try {
      const text = await officeParser.parseOfficeAsync(content);
      if (!text || text.trim().length === 0) {
        throw new Error("No text extracted from PowerPoint");
      }
      return {
        text,
      };
    } catch (error) {
      console.error("Error parsing PowerPoint:", error);
      throw new Error("Failed to parse PowerPoint");
    }
  }
}
