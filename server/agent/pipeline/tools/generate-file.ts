import { ToolDefinition, ExecutionContext, ToolResult, Artifact } from "../types";
import { ObjectStorageService } from "../../../objectStorage";
import crypto from "crypto";

const objectStorage = new ObjectStorageService();

export const generateFileTool: ToolDefinition = {
  id: "generate_file",
  name: "Generate File",
  description: "Generate a file with specified content and format (text, markdown, JSON, CSV, HTML)",
  category: "file",
  capabilities: ["generate", "create", "file", "document", "export", "save"],
  inputSchema: {
    content: { type: "string", description: "The content to write to the file", required: true },
    filename: { type: "string", description: "The filename to use", required: true },
    format: { 
      type: "string", 
      description: "The file format",
      enum: ["text", "markdown", "json", "csv", "html"],
      default: "text"
    },
    upload: { type: "boolean", description: "Whether to upload to storage", default: true }
  },
  outputSchema: {
    filename: { type: "string", description: "The generated filename" },
    storagePath: { type: "string", description: "The storage path if uploaded" },
    size: { type: "number", description: "The file size in bytes" }
  },
  
  async execute(context: ExecutionContext, params: Record<string, any>): Promise<ToolResult> {
    const { content, filename, format = "text", upload = true } = params;
    
    if (!content) {
      return {
        success: false,
        error: "No content provided"
      };
    }

    try {
      const mimeTypes: Record<string, string> = {
        text: "text/plain",
        markdown: "text/markdown",
        json: "application/json",
        csv: "text/csv",
        html: "text/html"
      };

      const extensions: Record<string, string> = {
        text: ".txt",
        markdown: ".md",
        json: ".json",
        csv: ".csv",
        html: ".html"
      };

      const mimeType = mimeTypes[format] || "text/plain";
      const extension = extensions[format] || ".txt";
      const finalFilename = filename.includes(".") ? filename : `${filename}${extension}`;
      
      let processedContent = content;
      if (format === "json" && typeof content === "object") {
        processedContent = JSON.stringify(content, null, 2);
      }

      const contentBuffer = Buffer.from(processedContent, "utf-8");
      const size = contentBuffer.length;

      const artifacts: Artifact[] = [];
      let storagePath: string | undefined;

      if (upload) {
        try {
          const { uploadURL, storagePath: path } = await objectStorage.getObjectEntityUploadURLWithPath();
          await fetch(uploadURL, {
            method: "PUT",
            headers: { "Content-Type": mimeType },
            body: contentBuffer
          });
          storagePath = path;
        } catch (e) {
          console.error("Failed to upload file:", e);
        }
      }

      artifacts.push({
        id: crypto.randomUUID(),
        type: format === "json" ? "json" : format === "markdown" ? "markdown" : format === "html" ? "html" : "text",
        name: finalFilename,
        content: processedContent.slice(0, 100000),
        storagePath,
        mimeType,
        size,
        metadata: { format }
      });

      return {
        success: true,
        data: {
          filename: finalFilename,
          storagePath,
          size,
          mimeType
        },
        artifacts,
        metadata: {
          filename: finalFilename,
          format,
          size
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }
};
