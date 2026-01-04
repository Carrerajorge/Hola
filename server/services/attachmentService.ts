import { ObjectStorageService, ObjectNotFoundError } from "../replit_integrations/object_storage/objectStorage";
import { PdfParser } from "../parsers/pdfParser";

export interface Attachment {
  type: string;
  name: string;
  mimeType: string;
  storagePath: string;
  fileId?: string;
}

export interface ExtractedContent {
  fileName: string;
  content: string;
  mimeType: string;
}

const objectStorageService = new ObjectStorageService();
const pdfParser = new PdfParser();

export async function extractAttachmentContent(attachment: Attachment): Promise<ExtractedContent | null> {
  try {
    if (!attachment.storagePath) {
      console.log(`[AttachmentService] No storage path for attachment: ${attachment.name}`);
      return null;
    }

    const buffer = await objectStorageService.getObjectEntityBuffer(attachment.storagePath);
    
    if (attachment.mimeType === "application/pdf") {
      console.log(`[AttachmentService] Parsing PDF: ${attachment.name}, size: ${buffer.length} bytes`);
      const result = await pdfParser.parse(buffer, { mimeType: "application/pdf", ext: "pdf" });
      return {
        fileName: attachment.name,
        content: result.text,
        mimeType: attachment.mimeType
      };
    }
    
    if (attachment.mimeType === "text/plain" || attachment.mimeType?.startsWith("text/")) {
      return {
        fileName: attachment.name,
        content: buffer.toString("utf-8"),
        mimeType: attachment.mimeType
      };
    }
    
    console.log(`[AttachmentService] Unsupported mime type: ${attachment.mimeType}`);
    return null;
  } catch (error) {
    console.error(`[AttachmentService] Error extracting content from ${attachment.name}:`, error);
    if (error instanceof ObjectNotFoundError) {
      console.log(`[AttachmentService] File not found: ${attachment.storagePath}`);
    }
    return null;
  }
}

export async function extractAllAttachmentsContent(attachments: Attachment[]): Promise<ExtractedContent[]> {
  const results: ExtractedContent[] = [];
  
  for (const attachment of attachments) {
    const content = await extractAttachmentContent(attachment);
    if (content) {
      results.push(content);
    }
  }
  
  return results;
}

export function formatAttachmentsAsContext(extractedContents: ExtractedContent[]): string {
  if (extractedContents.length === 0) return "";
  
  const parts: string[] = [];
  parts.push("\n\n=== DOCUMENTOS ADJUNTOS ===\n");
  
  for (const content of extractedContents) {
    parts.push(`\n--- Archivo: ${content.fileName} ---\n`);
    parts.push(content.content);
    parts.push("\n--- Fin del archivo ---\n");
  }
  
  return parts.join("");
}
