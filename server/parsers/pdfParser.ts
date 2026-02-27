import type { FileParser, ParsedResult, DetectedFileType } from "./base";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Security limits
const PDF_MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB
const PDF_MAX_EXTRACTED_TEXT = 10 * 1024 * 1024; // 10MB max extracted text
const PDF_MAX_METADATA_VALUE_LENGTH = 1000;
const PDF_OCR_DEFAULT_MAX_PAGES = 2;
const PDF_OCR_DEFAULT_SCALE = 2;
const PDF_OCR_DEFAULT_LANGUAGES = "spa+eng";

/** Sanitize metadata values */
function sanitizeMetadataValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return String(value)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .substring(0, PDF_MAX_METADATA_VALUE_LENGTH) || undefined;
}

export class PdfParser implements FileParser {
  name = "pdf";
  supportedMimeTypes = ["application/pdf"];
  private readonly TIMEOUT_MS = 60000;

  async parse(content: Buffer, type: DetectedFileType): Promise<ParsedResult> {
    const startTime = Date.now();
    console.log(`[PdfParser] Starting PDF parse, size: ${content.length} bytes`);

    // Security: enforce file size limit
    if (content.length > PDF_MAX_FILE_SIZE) {
      throw new Error(`PDF file exceeds maximum size of ${PDF_MAX_FILE_SIZE / (1024 * 1024)}MB`);
    }

    let timeoutId: NodeJS.Timeout | null = null;
    
    try {
      const parsePromise = this.parsePdf(content);
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`PDF parsing timed out after ${this.TIMEOUT_MS}ms`)), this.TIMEOUT_MS);
      });

      const result = await Promise.race([parsePromise, timeoutPromise]);
      
      if (timeoutId) clearTimeout(timeoutId);
      
      const elapsed = Date.now() - startTime;
      console.log(`[PdfParser] Completed in ${elapsed}ms`);
      
      return result;
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);
      const elapsed = Date.now() - startTime;
      console.error(`[PdfParser] Failed after ${elapsed}ms:`, error);
      
      if (error instanceof Error) {
        if (error.message.includes('timed out')) {
          throw new Error(`PDF parsing timed out - file may be too large or complex (${Math.round(content.length / 1024)}KB)`);
        }
        throw new Error(`Failed to parse PDF: ${error.message}`);
      }
      throw new Error("Failed to parse PDF: Unknown error");
    }
  }

  private async parsePdf(content: Buffer): Promise<ParsedResult> {
      const { PDFParse } = require("pdf-parse");
      const parser = new PDFParse({ data: content });
    const data = await parser.getText();

    const totalPages = this.resolvePageCount(data);
    // Security: limit extracted text size
    const rawText = data.text || '';
    let text = this.normalizeText(rawText.length > PDF_MAX_EXTRACTED_TEXT ? rawText.substring(0, PDF_MAX_EXTRACTED_TEXT) : rawText);
    let ocrUsed = false;
    let ocrConfidence: number | undefined;
    let ocrPages = 0;

    if (this.shouldAttemptOcrFallback(text)) {
      const ocrFallback = await this.tryExtractTextFromPdfViaOcr(content);
      if (ocrFallback.text.length > text.length) {
        text = this.normalizeText(
          ocrFallback.text.length > PDF_MAX_EXTRACTED_TEXT
            ? ocrFallback.text.substring(0, PDF_MAX_EXTRACTED_TEXT)
            : ocrFallback.text
        );
        ocrUsed = true;
        ocrConfidence = ocrFallback.averageConfidence;
        ocrPages = ocrFallback.pagesProcessed;
      }
    }

    const metadata = this.extractMetadata(data);
    const formattedText = this.formatOutput(metadata, text, totalPages, ocrUsed, ocrConfidence, ocrPages);

    return {
      text: formattedText,
      metadata: {
        pages: totalPages,
        title: metadata.title,
        author: metadata.author,
        creationDate: metadata.creationDate,
        producer: metadata.producer,
        ocrUsed,
        ocrConfidence,
        ocrPages,
        info: data.info || {},
      },
    };
  }

  private resolvePageCount(data: any): number {
    const fromNumPages = Number(data?.numpages);
    if (Number.isFinite(fromNumPages) && fromNumPages > 0) {
      return fromNumPages;
    }

    const fromTotal = Number(data?.total);
    if (Number.isFinite(fromTotal) && fromTotal > 0) {
      return fromTotal;
    }

    if (Array.isArray(data?.pages)) {
      return data.pages.length;
    }

    return 0;
  }

  private shouldAttemptOcrFallback(text: string): boolean {
    if (String(process.env.PDF_OCR_FALLBACK_ENABLED || "true").toLowerCase() === "false") {
      return false;
    }

    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) return true;

    const words = clean.split(/\s+/).filter((w) => w.length > 1).length;
    const alnumCount = (clean.match(/[A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ]/g) || []).length;
    const alnumRatio = alnumCount / Math.max(clean.length, 1);

    if (clean.length < 120) return true;
    if (words < 25) return true;
    if (alnumRatio < 0.2) return true;
    if (/--\s*\d+\s*of\s*\d+\s*--/i.test(clean)) return true;

    return false;
  }

  private async tryExtractTextFromPdfViaOcr(content: Buffer): Promise<{
    text: string;
    averageConfidence: number;
    pagesProcessed: number;
  }> {
    try {
      const maxPagesEnv = Number(process.env.PDF_OCR_MAX_PAGES || PDF_OCR_DEFAULT_MAX_PAGES);
      const scaleEnv = Number(process.env.PDF_OCR_SCALE || PDF_OCR_DEFAULT_SCALE);
      const maxPages = Number.isFinite(maxPagesEnv) && maxPagesEnv > 0 ? Math.min(Math.floor(maxPagesEnv), 5) : PDF_OCR_DEFAULT_MAX_PAGES;
      const scale = Number.isFinite(scaleEnv) && scaleEnv > 0 ? Math.min(Math.max(scaleEnv, 1), 3) : PDF_OCR_DEFAULT_SCALE;
      const languages = (process.env.PDF_OCR_LANGUAGES || PDF_OCR_DEFAULT_LANGUAGES).trim() || PDF_OCR_DEFAULT_LANGUAGES;

      const { PDFParse } = require("pdf-parse");
      const tesseractMod: any = await import("tesseract.js");
      const Tesseract = tesseractMod.default || tesseractMod;

      const pdf = new PDFParse({ data: content });
      await pdf.load();
      const screenshotResult = await pdf.getScreenshot({ first: 1, last: maxPages, scale });
      const renderedPages = Array.isArray(screenshotResult?.pages) ? screenshotResult.pages : [];
      const pagesToProcess = renderedPages.length;
      const pageTexts: string[] = [];
      let confidenceSum = 0;
      let confidenceCount = 0;

      for (let index = 0; index < renderedPages.length; index++) {
        const pageNum = index + 1;
        const page = renderedPages[index];
        const pngBuffer = Buffer.from(page?.data || []);
        if (pngBuffer.length === 0) {
          continue;
        }
        const ocrResult = await Tesseract.recognize(pngBuffer, languages);
        const rawPageText = this.normalizeText(String(ocrResult?.data?.text || ""));

        if (rawPageText) {
          pageTexts.push(`=== OCR Page ${pageNum} ===\n${rawPageText}`);
        }

        const confidence = Number(ocrResult?.data?.confidence);
        if (Number.isFinite(confidence)) {
          confidenceSum += confidence;
          confidenceCount += 1;
        }
      }

      await pdf.destroy();

      return {
        text: pageTexts.join("\n\n").trim(),
        averageConfidence: confidenceCount > 0 ? confidenceSum / confidenceCount : 0,
        pagesProcessed: pagesToProcess,
      };
    } catch (error) {
      console.warn("[PdfParser] OCR fallback unavailable or failed:", error instanceof Error ? error.message : String(error));
      return {
        text: "",
        averageConfidence: 0,
        pagesProcessed: 0,
      };
    }
  }

  private normalizeText(text: string): string {
    return text
      .replace(/\u0000/g, '')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\u2013/g, '-')
      .replace(/\u2014/g, '--')
      .replace(/\u2026/g, '...')
      .replace(/\u00A0/g, ' ')
      .normalize('NFKC');
  }

  private extractMetadata(data: any): Record<string, string | undefined> {
    const info = data.info || {};
    
    // Security: sanitize all metadata values
    return {
      title: sanitizeMetadataValue(info.Title),
      author: sanitizeMetadataValue(info.Author),
      creationDate: this.formatPdfDate(info.CreationDate),
      modificationDate: this.formatPdfDate(info.ModDate),
      producer: sanitizeMetadataValue(info.Producer),
      creator: sanitizeMetadataValue(info.Creator),
      subject: sanitizeMetadataValue(info.Subject),
      keywords: sanitizeMetadataValue(info.Keywords),
    };
  }

  private formatPdfDate(dateStr: string | undefined): string | undefined {
    if (!dateStr) return undefined;
    
    const match = dateStr.match(/D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/);
    if (match) {
      const [, year, month, day, hour = '00', minute = '00', second = '00'] = match;
      return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
    }
    return dateStr;
  }

  private formatOutput(
    metadata: Record<string, string | undefined>,
    text: string,
    totalPages: number,
    ocrUsed = false,
    ocrConfidence?: number,
    ocrPages?: number
  ): string {
    const parts: string[] = [];
    
    parts.push('=== Document Info ===');
    if (metadata.title) parts.push(`Title: ${metadata.title}`);
    if (metadata.author) parts.push(`Author: ${metadata.author}`);
    if (metadata.creationDate) parts.push(`Created: ${metadata.creationDate}`);
    if (metadata.subject) parts.push(`Subject: ${metadata.subject}`);
    parts.push(`Pages: ${totalPages}`);
    if (ocrUsed) {
      const confidenceLabel = typeof ocrConfidence === "number" ? `${Math.round(ocrConfidence)}%` : "n/a";
      const pagesLabel = typeof ocrPages === "number" && ocrPages > 0 ? ocrPages : totalPages;
      parts.push(`OCR: enabled (${confidenceLabel}, pages ${pagesLabel})`);
    }
    parts.push('');
    parts.push('=== Content ===');
    parts.push(text);

    return parts.join('\n').trim();
  }
}
