/**
 * Streaming Extractor
 * 
 * Extrae contenido de archivos grandes de forma progresiva,
 * mostrando contenido parcial mientras continúa la extracción.
 */

import { EventEmitter } from "events";

interface StreamChunk {
  content: string;
  htmlContent?: string;
  progress: number;
  done: boolean;
  error?: string;
}

type StreamCallback = (chunk: StreamChunk) => void;

class StreamingExtractor extends EventEmitter {
  private abortControllers: Map<string, AbortController> = new Map();

  /**
   * Extract Word document with streaming
   */
  async extractWordStreaming(
    file: File,
    fileId: string,
    onChunk: StreamCallback
  ): Promise<void> {
    const controller = new AbortController();
    this.abortControllers.set(fileId, controller);

    try {
      const buffer = await file.arrayBuffer();

      if (controller.signal.aborted) {
        throw new Error("Extraction cancelled");
      }

      // Import mammoth
      const mammoth = await import("mammoth");

      // For large documents, we'll stream in chunks
      // Unfortunately mammoth doesn't support streaming, so we simulate it
      onChunk({
        content: "",
        progress: 10,
        done: false,
      });

      const result = await mammoth.convertToHtml({ arrayBuffer: buffer });

      if (controller.signal.aborted) {
        throw new Error("Extraction cancelled");
      }

      // Split HTML into logical chunks (paragraphs, sections)
      const html = result.value;
      const sections = this.splitHtmlIntoSections(html);

      let accumulated = "";
      const totalSections = sections.length;

      for (let i = 0; i < sections.length; i++) {
        if (controller.signal.aborted) {
          throw new Error("Extraction cancelled");
        }

        accumulated += sections[i];

        onChunk({
          content: accumulated.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
          htmlContent: accumulated,
          progress: 10 + ((i + 1) / totalSections) * 85,
          done: false,
        });

        // Small delay to allow UI updates
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      onChunk({
        content: accumulated.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
        htmlContent: accumulated,
        progress: 100,
        done: true,
      });
    } catch (error) {
      onChunk({
        content: "",
        progress: 0,
        done: true,
        error: error instanceof Error ? error.message : "Extraction failed",
      });
    } finally {
      this.abortControllers.delete(fileId);
    }
  }

  /**
   * Extract Excel with streaming (sheet by sheet)
   */
  async extractExcelStreaming(
    file: File,
    fileId: string,
    onChunk: StreamCallback
  ): Promise<void> {
    const controller = new AbortController();
    this.abortControllers.set(fileId, controller);

    try {
      const buffer = await file.arrayBuffer();

      onChunk({
        content: "",
        progress: 10,
        done: false,
      });

      const XLSX = await import("xlsx");
      const workbook = XLSX.read(buffer, { type: "array" });

      let accumulated = "";
      const totalSheets = workbook.SheetNames.length;

      for (let i = 0; i < workbook.SheetNames.length; i++) {
        if (controller.signal.aborted) {
          throw new Error("Extraction cancelled");
        }

        const sheetName = workbook.SheetNames[i];
        const sheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet);

        if (accumulated) {
          accumulated += `\n\n--- Hoja: ${sheetName} ---\n\n`;
        }
        accumulated += csv;

        onChunk({
          content: accumulated,
          progress: 10 + ((i + 1) / totalSheets) * 85,
          done: false,
        });

        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      onChunk({
        content: accumulated,
        progress: 100,
        done: true,
      });
    } catch (error) {
      onChunk({
        content: "",
        progress: 0,
        done: true,
        error: error instanceof Error ? error.message : "Extraction failed",
      });
    } finally {
      this.abortControllers.delete(fileId);
    }
  }

  /**
   * Extract text file with streaming (line by line for large files)
   */
  async extractTextStreaming(
    file: File,
    fileId: string,
    onChunk: StreamCallback
  ): Promise<void> {
    const controller = new AbortController();
    this.abortControllers.set(fileId, controller);

    try {
      // For small files, just read all at once
      if (file.size < 1024 * 1024) {
        const content = await file.text();
        onChunk({
          content,
          progress: 100,
          done: true,
        });
        return;
      }

      // For large files, stream in chunks
      const stream = file.stream();
      const reader = stream.getReader();
      const decoder = new TextDecoder();

      let accumulated = "";
      let bytesRead = 0;

      onChunk({
        content: "",
        progress: 0,
        done: false,
      });

      while (true) {
        if (controller.signal.aborted) {
          reader.cancel();
          throw new Error("Extraction cancelled");
        }

        const { done, value } = await reader.read();

        if (done) break;

        bytesRead += value.length;
        accumulated += decoder.decode(value, { stream: true });

        // Yield content at natural breakpoints (newlines)
        const lastNewline = accumulated.lastIndexOf("\n");
        if (lastNewline > 0) {
          const toYield = accumulated.slice(0, lastNewline);
          accumulated = accumulated.slice(lastNewline + 1);

          onChunk({
            content: toYield,
            progress: (bytesRead / file.size) * 95,
            done: false,
          });
        }
      }

      // Final chunk
      onChunk({
        content: accumulated,
        progress: 100,
        done: true,
      });
    } catch (error) {
      onChunk({
        content: "",
        progress: 0,
        done: true,
        error: error instanceof Error ? error.message : "Extraction failed",
      });
    } finally {
      this.abortControllers.delete(fileId);
    }
  }

  /**
   * Cancel ongoing extraction
   */
  cancel(fileId: string): void {
    const controller = this.abortControllers.get(fileId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(fileId);
    }
  }

  /**
   * Helper to split HTML into logical sections
   */
  private splitHtmlIntoSections(html: string): string[] {
    // Split by major structural elements
    const sections: string[] = [];

    // Try to split by headers first
    const headerSplit = html.split(/(<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>)/gi);

    if (headerSplit.length > 1) {
      let currentSection = "";
      for (const part of headerSplit) {
        currentSection += part;
        // Check if we've accumulated enough content
        if (currentSection.length > 5000) {
          sections.push(currentSection);
          currentSection = "";
        }
      }
      if (currentSection) {
        sections.push(currentSection);
      }
    } else {
      // Fallback: split by paragraphs in chunks
      const paragraphs = html.split(/(<\/p>)/gi);
      let currentSection = "";

      for (const para of paragraphs) {
        currentSection += para;
        if (currentSection.length > 3000) {
          sections.push(currentSection);
          currentSection = "";
        }
      }
      if (currentSection) {
        sections.push(currentSection);
      }
    }

    return sections.length > 0 ? sections : [html];
  }

  /**
   * Main extraction method with automatic format detection
   */
  async extractStreaming(
    file: File,
    fileId: string,
    onChunk: StreamCallback
  ): Promise<void> {
    const ext = file.name.toLowerCase().split(".").pop() || "";
    const type = file.type;

    if (ext === "docx" || ext === "doc" || type.includes("word")) {
      return this.extractWordStreaming(file, fileId, onChunk);
    }

    if (ext === "xlsx" || ext === "xls" || ext === "csv" || type.includes("sheet") || type.includes("excel")) {
      return this.extractExcelStreaming(file, fileId, onChunk);
    }

    return this.extractTextStreaming(file, fileId, onChunk);
  }
}

// Singleton
let extractorInstance: StreamingExtractor | null = null;

export function getStreamingExtractor(): StreamingExtractor {
  if (!extractorInstance) {
    extractorInstance = new StreamingExtractor();
  }
  return extractorInstance;
}

export { StreamingExtractor };
