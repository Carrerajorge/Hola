import type { FileParser, ParsedResult, DetectedFileType } from "./base";

export class PdfParser implements FileParser {
  name = "pdf";
  supportedMimeTypes = ["application/pdf"];
  private readonly TIMEOUT_MS = 60000;

  async parse(content: Buffer, type: DetectedFileType): Promise<ParsedResult> {
    const startTime = Date.now();
    console.log(`[PdfParser] Starting PDF parse, size: ${content.length} bytes`);

    let timeoutId: NodeJS.Timeout | null = null;
    
    try {
      const pdfParseModule = await import("pdf-parse");
      const pdfParse = pdfParseModule.default;
      
      const parsePromise = this.parseWithPageStructure(pdfParse, content);
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

  private async parseWithPageStructure(pdfParse: any, content: Buffer): Promise<ParsedResult> {
    const pageTexts: string[] = [];
    let currentPage = 0;

    const options = {
      pagerender: (pageData: any) => {
        return pageData.getTextContent().then((textContent: any) => {
          currentPage++;
          let pageText = '';
          let lastY: number | null = null;
          
          for (const item of textContent.items) {
            if (item.str) {
              const text = this.normalizeText(item.str);
              if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) {
                pageText += '\n';
              }
              pageText += text;
              lastY = item.transform[5];
            }
          }
          
          pageTexts.push(pageText.trim());
          return pageText;
        });
      }
    };

    const data = await pdfParse(content, options);
    
    const metadata = this.extractMetadata(data);
    const formattedText = this.formatOutput(metadata, pageTexts, data.numpages);

    return {
      text: formattedText,
      metadata: {
        pages: data.numpages,
        title: metadata.title,
        author: metadata.author,
        creationDate: metadata.creationDate,
        producer: metadata.producer,
        info: data.info,
      },
    };
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
    
    return {
      title: info.Title || undefined,
      author: info.Author || undefined,
      creationDate: this.formatPdfDate(info.CreationDate),
      modificationDate: this.formatPdfDate(info.ModDate),
      producer: info.Producer || undefined,
      creator: info.Creator || undefined,
      subject: info.Subject || undefined,
      keywords: info.Keywords || undefined,
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

  private formatOutput(metadata: Record<string, string | undefined>, pageTexts: string[], totalPages: number): string {
    const parts: string[] = [];
    
    parts.push('=== Document Info ===');
    if (metadata.title) parts.push(`Title: ${metadata.title}`);
    if (metadata.author) parts.push(`Author: ${metadata.author}`);
    if (metadata.creationDate) parts.push(`Created: ${metadata.creationDate}`);
    if (metadata.subject) parts.push(`Subject: ${metadata.subject}`);
    parts.push(`Pages: ${totalPages}`);
    parts.push('');

    for (let i = 0; i < pageTexts.length; i++) {
      const pageNum = i + 1;
      const pageContent = pageTexts[i];
      
      if (pageContent && pageContent.trim()) {
        parts.push(`=== Page ${pageNum} ===`);
        parts.push(pageContent);
        parts.push('');
      }
    }

    return parts.join('\n').trim();
  }
}
