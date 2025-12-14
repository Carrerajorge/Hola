import type { FileParser, ParsedResult, DetectedFileType } from "./base";

export class TextParser implements FileParser {
  name = "text";
  supportedMimeTypes = [
    "text/plain",
    "text/markdown",
    "text/md",
    "text/csv",
    "text/html",
    "application/json",
  ];

  async parse(content: Buffer, type: DetectedFileType): Promise<ParsedResult> {
    const text = content.toString("utf-8");

    if (type.mimeType === "application/json") {
      try {
        const json = JSON.parse(text);
        return { text: JSON.stringify(json, null, 2) };
      } catch {
        return { text };
      }
    }

    if (type.mimeType === "text/html") {
      const stripped = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      return { text: stripped };
    }

    return { text };
  }
}
