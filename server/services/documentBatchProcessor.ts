import { ObjectStorageService, ObjectNotFoundError } from "../replit_integrations/object_storage/objectStorage";
import { PdfParser } from "../parsers/pdfParser";
import { DocxParser } from "../parsers/docxParser";
import { XlsxParser } from "../parsers/xlsxParser";
import { PptxParser } from "../parsers/pptxParser";
import { TextParser } from "../parsers/textParser";
import type { DetectedFileType, FileParser, ParsedResult } from "../parsers/base";

export interface SimpleAttachment {
  name: string;
  mimeType: string;
  storagePath: string;
}

export interface DocumentChunk {
  docId: string;
  filename: string;
  location: { page?: number; sheet?: string; slide?: number; row?: number; cell?: string };
  content: string;
  offsets: { start: number; end: number };
}

export interface DocumentProcessingStats {
  filename: string;
  bytesRead: number;
  pagesProcessed: number;
  tokensExtracted: number;
  parseTimeMs: number;
  chunkCount: number;
  status: 'success' | 'failed';
  error?: string;
}

export interface BatchProcessingResult {
  attachmentsCount: number;
  processedFiles: number;
  failedFiles: { filename: string; error: string }[];
  chunks: DocumentChunk[];
  stats: DocumentProcessingStats[];
  unifiedContext: string;
  totalTokens: number;
}

interface ExtractedDocument {
  docId: string;
  filename: string;
  docType: string;
  content: string;
  metadata: Record<string, any>;
}

interface ParserConfig {
  parser: FileParser;
  docType: string;
  ext: string;
}

const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;

export class DocumentBatchProcessor {
  private objectStorageService: ObjectStorageService;
  private pdfParser: PdfParser;
  private docxParser: DocxParser;
  private xlsxParser: XlsxParser;
  private pptxParser: PptxParser;
  private textParser: TextParser;
  private mimeTypeMap: Record<string, ParserConfig>;
  private chunkIndex: Map<string, DocumentChunk>;

  constructor() {
    this.objectStorageService = new ObjectStorageService();
    this.pdfParser = new PdfParser();
    this.docxParser = new DocxParser();
    this.xlsxParser = new XlsxParser();
    this.pptxParser = new PptxParser();
    this.textParser = new TextParser();
    this.chunkIndex = new Map();

    this.mimeTypeMap = {
      "application/pdf": { parser: this.pdfParser, docType: "PDF", ext: "pdf" },
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { parser: this.docxParser, docType: "Word", ext: "docx" },
      "application/msword": { parser: this.docxParser, docType: "Word", ext: "doc" },
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { parser: this.xlsxParser, docType: "Excel", ext: "xlsx" },
      "application/vnd.ms-excel": { parser: this.xlsxParser, docType: "Excel", ext: "xls" },
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": { parser: this.pptxParser, docType: "PowerPoint", ext: "pptx" },
      "application/vnd.ms-powerpoint": { parser: this.pptxParser, docType: "PowerPoint", ext: "ppt" },
      "text/plain": { parser: this.textParser, docType: "Text", ext: "txt" },
      "text/markdown": { parser: this.textParser, docType: "Markdown", ext: "md" },
      "text/md": { parser: this.textParser, docType: "Markdown", ext: "md" },
      "text/csv": { parser: this.textParser, docType: "CSV", ext: "csv" },
      "text/html": { parser: this.textParser, docType: "HTML", ext: "html" },
      "application/json": { parser: this.textParser, docType: "JSON", ext: "json" },
    };
  }

  async processBatch(attachments: SimpleAttachment[]): Promise<BatchProcessingResult> {
    console.log(`[DocumentBatchProcessor] Starting batch processing of ${attachments.length} attachments`);
    const startTime = Date.now();

    const result: BatchProcessingResult = {
      attachmentsCount: attachments.length,
      processedFiles: 0,
      failedFiles: [],
      chunks: [],
      stats: [],
      unifiedContext: "",
      totalTokens: 0,
    };

    this.chunkIndex.clear();

    for (let i = 0; i < attachments.length; i++) {
      const attachment = attachments[i];
      const docId = this.generateDocId(attachment.name, i);
      const fileStartTime = Date.now();

      try {
        const buffer = await this.fetchDocument(attachment.storagePath);
        const mimeType = this.detectMime(buffer, attachment.name, attachment.mimeType);
        const parserConfig = this.selectParser(mimeType);

        if (!parserConfig) {
          throw new Error(`Unsupported MIME type: ${mimeType}`);
        }

        const parsed = await this.extractContent(buffer, parserConfig, attachment.name);
        const normalized = this.normalizeContent(parsed.text);
        const chunks = this.chunkDocument(normalized, docId, attachment.name, parserConfig.docType, parsed.metadata);
        
        this.indexChunks(chunks);
        result.chunks.push(...chunks);

        const parseTimeMs = Date.now() - fileStartTime;
        const tokensExtracted = this.estimateTokens(normalized);

        result.stats.push({
          filename: attachment.name,
          bytesRead: buffer.length,
          pagesProcessed: parsed.metadata?.pages || parsed.metadata?.slideCount || parsed.metadata?.sheetCount || 1,
          tokensExtracted,
          parseTimeMs,
          chunkCount: chunks.length,
          status: 'success',
        });

        result.processedFiles++;
        result.totalTokens += tokensExtracted;

        console.log(`[DocumentBatchProcessor] Processed ${attachment.name}: ${chunks.length} chunks, ${tokensExtracted} tokens`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[DocumentBatchProcessor] Failed to process ${attachment.name}:`, errorMessage);

        result.failedFiles.push({
          filename: attachment.name,
          error: errorMessage,
        });

        result.stats.push({
          filename: attachment.name,
          bytesRead: 0,
          pagesProcessed: 0,
          tokensExtracted: 0,
          parseTimeMs: Date.now() - fileStartTime,
          chunkCount: 0,
          status: 'failed',
          error: errorMessage,
        });
      }
    }

    result.unifiedContext = this.buildUnifiedContext(result.chunks);

    const totalTime = Date.now() - startTime;
    console.log(`[DocumentBatchProcessor] Batch complete in ${totalTime}ms: ${result.processedFiles}/${attachments.length} files, ${result.chunks.length} chunks, ${result.totalTokens} tokens`);

    return result;
  }

  private async fetchDocument(storagePath: string): Promise<Buffer> {
    if (!storagePath) {
      throw new Error("No storage path provided");
    }

    try {
      return await this.objectStorageService.getObjectEntityBuffer(storagePath);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        throw new Error(`File not found: ${storagePath}`);
      }
      throw error;
    }
  }

  private detectMime(buffer: Buffer, filename: string, providedMimeType: string): string {
    let mimeType = providedMimeType;

    if (!this.mimeTypeMap[mimeType]) {
      const ext = this.getExtensionFromFileName(filename);
      const inferredMime = this.inferMimeTypeFromExtension(ext);
      if (inferredMime) {
        mimeType = inferredMime;
      }
    }

    if (mimeType?.startsWith('text/') && !this.mimeTypeMap[mimeType]) {
      mimeType = 'text/plain';
    }

    return mimeType;
  }

  private selectParser(mimeType: string): ParserConfig | null {
    return this.mimeTypeMap[mimeType] || null;
  }

  private async extractContent(
    buffer: Buffer,
    parserConfig: ParserConfig,
    filename: string
  ): Promise<ParsedResult> {
    const ext = this.getExtensionFromFileName(filename) || parserConfig.ext;

    const detectedType: DetectedFileType = {
      mimeType: Object.keys(this.mimeTypeMap).find(k => this.mimeTypeMap[k] === parserConfig) || "",
      extension: ext,
      confidence: 1.0,
    };

    return parserConfig.parser.parse(buffer, detectedType);
  }

  private normalizeContent(text: string): string {
    return text
      .replace(/\u0000/g, '')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\u2013/g, '-')
      .replace(/\u2014/g, '--')
      .replace(/\u2026/g, '...')
      .replace(/\u00A0/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .normalize('NFKC')
      .trim();
  }

  private chunkDocument(
    content: string,
    docId: string,
    filename: string,
    docType: string,
    metadata?: Record<string, any>
  ): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const ext = this.getExtensionFromFileName(filename).toLowerCase();

    if (docType === "Excel" && metadata?.sheets) {
      return this.chunkExcelDocument(content, docId, filename, metadata);
    }

    if (docType === "PowerPoint") {
      return this.chunkPowerPointDocument(content, docId, filename, metadata);
    }

    if (ext === "csv") {
      return this.chunkCSVDocument(content, docId, filename);
    }

    const pages = content.split(/(?:=== Page \d+ ===|--- Page \d+ ---)/i);
    
    if (pages.length > 1) {
      return this.chunkPagedDocument(pages, docId, filename);
    }

    return this.chunkTextDocument(content, docId, filename);
  }

  private chunkExcelDocument(
    content: string,
    docId: string,
    filename: string,
    metadata: Record<string, any>
  ): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const sheetSections = content.split(/(?=### Sheet: )/);

    for (const section of sheetSections) {
      const sheetMatch = section.match(/### Sheet: ([^\n]+)/);
      const sheetName = sheetMatch ? sheetMatch[1].trim() : "Sheet1";

      const lines = section.split('\n');
      let currentOffset = 0;

      for (let i = 0; i < lines.length; i += Math.floor(CHUNK_SIZE / 50)) {
        const chunkLines = lines.slice(i, i + Math.floor(CHUNK_SIZE / 50));
        const chunkContent = chunkLines.join('\n').trim();

        if (chunkContent) {
          const rowMatch = chunkLines[0]?.match(/^\|?\s*(\d+)/);
          const row = rowMatch ? parseInt(rowMatch[1], 10) : i + 1;

          chunks.push({
            docId,
            filename,
            location: { sheet: sheetName, row, cell: `A${row}` },
            content: chunkContent,
            offsets: { start: currentOffset, end: currentOffset + chunkContent.length },
          });

          currentOffset += chunkContent.length;
        }
      }
    }

    return chunks.length > 0 ? chunks : this.chunkTextDocument(content, docId, filename);
  }

  private chunkPowerPointDocument(
    content: string,
    docId: string,
    filename: string,
    metadata?: Record<string, any>
  ): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const slideSections = content.split(/(?=## Slide \d+)/);

    for (const section of slideSections) {
      const slideMatch = section.match(/## Slide (\d+)/);
      if (!slideMatch) continue;

      const slideNumber = parseInt(slideMatch[1], 10);
      const slideContent = section.trim();
      const startOffset = content.indexOf(slideContent);

      chunks.push({
        docId,
        filename,
        location: { slide: slideNumber },
        content: slideContent,
        offsets: { start: startOffset, end: startOffset + slideContent.length },
      });
    }

    return chunks.length > 0 ? chunks : this.chunkTextDocument(content, docId, filename);
  }

  private chunkCSVDocument(content: string, docId: string, filename: string): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const lines = content.split('\n');
    const header = lines[0] || '';
    let currentOffset = 0;

    for (let i = 0; i < lines.length; i += Math.floor(CHUNK_SIZE / 100)) {
      const chunkLines = i === 0 
        ? lines.slice(i, i + Math.floor(CHUNK_SIZE / 100))
        : [header, ...lines.slice(i, i + Math.floor(CHUNK_SIZE / 100))];
      
      const chunkContent = chunkLines.join('\n').trim();

      if (chunkContent) {
        chunks.push({
          docId,
          filename,
          location: { row: i + 1 },
          content: chunkContent,
          offsets: { start: currentOffset, end: currentOffset + chunkContent.length },
        });

        currentOffset += chunkContent.length;
      }
    }

    return chunks;
  }

  private chunkPagedDocument(pages: string[], docId: string, filename: string): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    let offset = 0;

    for (let pageNum = 0; pageNum < pages.length; pageNum++) {
      const pageContent = pages[pageNum].trim();
      if (!pageContent) continue;

      if (pageContent.length <= CHUNK_SIZE) {
        chunks.push({
          docId,
          filename,
          location: { page: pageNum + 1 },
          content: pageContent,
          offsets: { start: offset, end: offset + pageContent.length },
        });
        offset += pageContent.length;
      } else {
        const subChunks = this.splitIntoChunks(pageContent, CHUNK_SIZE, CHUNK_OVERLAP);
        for (const subChunk of subChunks) {
          chunks.push({
            docId,
            filename,
            location: { page: pageNum + 1 },
            content: subChunk.content,
            offsets: { start: offset + subChunk.start, end: offset + subChunk.end },
          });
        }
        offset += pageContent.length;
      }
    }

    return chunks;
  }

  private chunkTextDocument(content: string, docId: string, filename: string): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const subChunks = this.splitIntoChunks(content, CHUNK_SIZE, CHUNK_OVERLAP);

    for (let i = 0; i < subChunks.length; i++) {
      const subChunk = subChunks[i];
      chunks.push({
        docId,
        filename,
        location: { page: i + 1 },
        content: subChunk.content,
        offsets: { start: subChunk.start, end: subChunk.end },
      });
    }

    return chunks;
  }

  private splitIntoChunks(
    text: string,
    chunkSize: number,
    overlap: number
  ): Array<{ content: string; start: number; end: number }> {
    const chunks: Array<{ content: string; start: number; end: number }> = [];
    const paragraphs = text.split(/\n\n+/);
    let currentChunk = '';
    let chunkStart = 0;
    let currentPos = 0;

    for (const para of paragraphs) {
      if (currentChunk.length + para.length + 2 > chunkSize && currentChunk) {
        chunks.push({
          content: currentChunk.trim(),
          start: chunkStart,
          end: currentPos,
        });

        const overlapText = currentChunk.slice(-overlap);
        currentChunk = overlapText + '\n\n' + para;
        chunkStart = currentPos - overlap;
      } else {
        if (currentChunk) {
          currentChunk += '\n\n' + para;
        } else {
          currentChunk = para;
          chunkStart = currentPos;
        }
      }
      currentPos += para.length + 2;
    }

    if (currentChunk.trim()) {
      chunks.push({
        content: currentChunk.trim(),
        start: chunkStart,
        end: currentPos,
      });
    }

    return chunks;
  }

  private indexChunks(chunks: DocumentChunk[]): void {
    for (const chunk of chunks) {
      const hash = this.hashContent(chunk.content);
      
      if (!this.chunkIndex.has(hash)) {
        this.chunkIndex.set(hash, chunk);
      }
    }
  }

  private hashContent(content: string): string {
    const normalized = content.toLowerCase().replace(/\s+/g, ' ').trim();
    let hash = 0;
    for (let i = 0; i < Math.min(normalized.length, 500); i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  private buildUnifiedContext(chunks: DocumentChunk[]): string {
    const deduplicated = this.deduplicateChunks(chunks);
    const sorted = this.sortByRelevance(deduplicated);
    
    const parts: string[] = [];
    let currentDoc = '';

    for (const chunk of sorted) {
      if (chunk.filename !== currentDoc) {
        currentDoc = chunk.filename;
        parts.push(`\n=== ${this.formatCitation(chunk)} ===`);
      }

      const locationStr = this.formatLocationShort(chunk);
      if (locationStr) {
        parts.push(`\n[${locationStr}]`);
      }
      parts.push(chunk.content);
    }

    return parts.join('\n').trim();
  }

  private deduplicateChunks(chunks: DocumentChunk[]): DocumentChunk[] {
    const seen = new Set<string>();
    const result: DocumentChunk[] = [];

    for (const chunk of chunks) {
      const hash = this.hashContent(chunk.content);
      if (!seen.has(hash)) {
        seen.add(hash);
        result.push(chunk);
      }
    }

    return result;
  }

  private sortByRelevance(chunks: DocumentChunk[]): DocumentChunk[] {
    return [...chunks].sort((a, b) => {
      if (a.filename !== b.filename) {
        return a.filename.localeCompare(b.filename);
      }

      const aOrder = a.location.page || a.location.slide || a.location.row || 0;
      const bOrder = b.location.page || b.location.slide || b.location.row || 0;

      return aOrder - bOrder;
    });
  }

  private formatCitation(chunk: DocumentChunk): string {
    const ext = this.getExtensionFromFileName(chunk.filename).toLowerCase();
    const loc = chunk.location;

    switch (ext) {
      case 'pdf':
        return `doc:${chunk.filename}${loc.page ? ` p${loc.page}` : ''}`;
      case 'xlsx':
      case 'xls':
        if (loc.sheet && loc.cell) {
          return `doc:${chunk.filename} sheet:${loc.sheet} cell:${loc.cell}`;
        }
        return `doc:${chunk.filename}${loc.sheet ? ` sheet:${loc.sheet}` : ''}`;
      case 'docx':
      case 'doc':
        return `doc:${chunk.filename}${loc.page ? ` p${loc.page}` : ''}`;
      case 'pptx':
      case 'ppt':
        return `doc:${chunk.filename}${loc.slide ? ` slide:${loc.slide}` : ''}`;
      case 'csv':
        return `doc:${chunk.filename}${loc.row ? ` row:${loc.row}` : ''}`;
      default:
        return `doc:${chunk.filename}`;
    }
  }

  private formatLocationShort(chunk: DocumentChunk): string {
    const loc = chunk.location;
    
    if (loc.slide) return `slide:${loc.slide}`;
    if (loc.sheet && loc.cell) return `${loc.sheet}:${loc.cell}`;
    if (loc.sheet && loc.row) return `${loc.sheet}:row${loc.row}`;
    if (loc.row) return `row:${loc.row}`;
    if (loc.page) return `p${loc.page}`;
    
    return '';
  }

  private generateDocId(filename: string, index: number): string {
    const sanitized = filename.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    return `${sanitized}_${index}_${Date.now().toString(36)}`;
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private getExtensionFromFileName(fileName: string): string {
    const parts = fileName.split('.');
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
  }

  private inferMimeTypeFromExtension(ext: string): string | null {
    const extMap: Record<string, string> = {
      'pdf': 'application/pdf',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'doc': 'application/msword',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'xls': 'application/vnd.ms-excel',
      'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'ppt': 'application/vnd.ms-powerpoint',
      'txt': 'text/plain',
      'md': 'text/markdown',
      'markdown': 'text/markdown',
      'csv': 'text/csv',
      'html': 'text/html',
      'htm': 'text/html',
      'json': 'application/json',
    };
    return extMap[ext] || null;
  }
}

export const documentBatchProcessor = new DocumentBatchProcessor();
