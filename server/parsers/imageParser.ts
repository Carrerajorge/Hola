import Tesseract from "tesseract.js";
import type { FileParser, ParsedResult, DetectedFileType } from "./base";

export class ImageParser implements FileParser {
  name = "image";
  supportedMimeTypes = [
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/gif",
    "image/bmp",
    "image/webp",
    "image/tiff",
  ];

  async parse(content: Buffer, type: DetectedFileType): Promise<ParsedResult> {
    try {
      const result = await Tesseract.recognize(content, "spa+eng", {
        logger: () => {},
      });
      
      const text = result.data.text.trim();
      
      if (!text || text.length === 0) {
        return {
          text: "",
          warnings: ["No se detectó texto en la imagen"],
        };
      }

      return {
        text,
        metadata: {
          confidence: result.data.confidence,
        },
      };
    } catch (error) {
      console.error("Error parsing image with OCR:", error);
      throw new Error("Failed to extract text from image");
    }
  }
}
