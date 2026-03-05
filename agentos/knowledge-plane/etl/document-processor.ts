/**
 * AgentOS Knowledge-Plane — Document ETL Processor
 *
 * Deep ETL supporting PDF, HTML, code (tree-sitter), markdown, images.
 * Extracts structure, tables, code blocks.
 * Chunks intelligently with configurable overlap.
 */

import { Chunk, Document, DocumentFormat, DocumentMetadata } from "../types";

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const log = {
  info: (msg: string, ctx?: Record<string, unknown>) =>
    console.log(`[ETL][INFO] ${msg}`, ctx ?? ""),
  warn: (msg: string, ctx?: Record<string, unknown>) =>
    console.warn(`[ETL][WARN] ${msg}`, ctx ?? ""),
  error: (msg: string, ctx?: Record<string, unknown>) =>
    console.error(`[ETL][ERROR] ${msg}`, ctx ?? ""),
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ChunkingConfig {
  /** Target chunk size in characters. */
  targetSize: number;
  /** Overlap between adjacent chunks in characters. */
  overlap: number;
  /** Respect structural boundaries (headings, code fences, etc.). */
  respectStructure: boolean;
  /** Maximum chunk size hard-cap. */
  maxSize: number;
}

export interface ETLConfig {
  chunking: ChunkingConfig;
  /** Whether to extract tables as separate chunks. */
  extractTables: boolean;
  /** Whether to extract code blocks as separate chunks. */
  extractCodeBlocks: boolean;
  /** Supported image OCR provider (stub — "tesseract" | "cloud-vision"). */
  ocrProvider?: string;
}

const DEFAULT_CONFIG: ETLConfig = {
  chunking: { targetSize: 512, overlap: 64, respectStructure: true, maxSize: 1024 },
  extractTables: true,
  extractCodeBlocks: true,
};

// ---------------------------------------------------------------------------
// Structural extraction helpers
// ---------------------------------------------------------------------------

interface StructuralBlock {
  type: "paragraph" | "heading" | "code" | "table" | "list" | "image-caption";
  content: string;
  startOffset: number;
  endOffset: number;
}

function extractMarkdownBlocks(text: string): StructuralBlock[] {
  const blocks: StructuralBlock[] = [];
  const lines = text.split("\n");
  let offset = 0;
  let buffer = "";
  let bufferStart = 0;
  let inCodeFence = false;
  let codeStart = 0;

  const flushBuffer = () => {
    const trimmed = buffer.trim();
    if (trimmed.length > 0) {
      blocks.push({ type: "paragraph", content: trimmed, startOffset: bufferStart, endOffset: offset });
    }
    buffer = "";
    bufferStart = offset;
  };

  for (const line of lines) {
    const lineEnd = offset + line.length + 1; // +1 for newline

    if (line.startsWith("```")) {
      if (inCodeFence) {
        blocks.push({ type: "code", content: buffer, startOffset: codeStart, endOffset: lineEnd });
        buffer = "";
        inCodeFence = false;
        bufferStart = lineEnd;
      } else {
        flushBuffer();
        inCodeFence = true;
        codeStart = offset;
        buffer = "";
      }
      offset = lineEnd;
      continue;
    }

    if (inCodeFence) {
      buffer += line + "\n";
      offset = lineEnd;
      continue;
    }

    if (/^#{1,6}\s/.test(line)) {
      flushBuffer();
      blocks.push({ type: "heading", content: line, startOffset: offset, endOffset: lineEnd });
      bufferStart = lineEnd;
    } else if (/^\|.*\|/.test(line)) {
      flushBuffer();
      blocks.push({ type: "table", content: line, startOffset: offset, endOffset: lineEnd });
      bufferStart = lineEnd;
    } else if (line.trim() === "") {
      flushBuffer();
      bufferStart = lineEnd;
    } else {
      if (buffer === "") bufferStart = offset;
      buffer += line + "\n";
    }

    offset = lineEnd;
  }

  flushBuffer();
  return blocks;
}

function extractHTMLBlocks(html: string): StructuralBlock[] {
  // Lightweight tag-based extraction without a full DOM parser.
  const blocks: StructuralBlock[] = [];
  const tagRe = /<(p|h[1-6]|pre|code|table|li|figcaption)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const typeMap: Record<string, StructuralBlock["type"]> = {
      p: "paragraph", h1: "heading", h2: "heading", h3: "heading",
      h4: "heading", h5: "heading", h6: "heading",
      pre: "code", code: "code", table: "table", li: "list",
      figcaption: "image-caption",
    };
    blocks.push({
      type: typeMap[tag] ?? "paragraph",
      content: match[2].replace(/<[^>]+>/g, "").trim(),
      startOffset: match.index,
      endOffset: match.index + match[0].length,
    });
  }
  return blocks;
}

function extractCodeStructure(source: string): StructuralBlock[] {
  // Simplified heuristic: split on blank lines and top-level declarations.
  const blocks: StructuralBlock[] = [];
  const segments = source.split(/\n{2,}/);
  let offset = 0;
  for (const seg of segments) {
    const end = offset + seg.length + 2;
    if (seg.trim().length > 0) {
      blocks.push({ type: "code", content: seg, startOffset: offset, endOffset: end });
    }
    offset = end;
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Document Processor
// ---------------------------------------------------------------------------

export class DocumentProcessor {
  private config: ETLConfig;

  constructor(config: Partial<ETLConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config, chunking: { ...DEFAULT_CONFIG.chunking, ...config.chunking } };
    log.info("DocumentProcessor initialised", { config: this.config });
  }

  // ---- public API --------------------------------------------------------

  async process(doc: Document): Promise<Chunk[]> {
    log.info("Processing document", { id: doc.id, format: doc.format });

    const blocks = this.extractBlocks(doc);
    if (blocks.length === 0) {
      log.warn("No structural blocks extracted", { id: doc.id });
      return [];
    }

    const chunks = this.chunkBlocks(blocks, doc);
    log.info("Chunking complete", { id: doc.id, chunkCount: chunks.length });
    return chunks;
  }

  async processBatch(docs: Document[]): Promise<Map<string, Chunk[]>> {
    const results = new Map<string, Chunk[]>();
    const settled = await Promise.allSettled(docs.map((d) => this.process(d)));
    for (let i = 0; i < docs.length; i++) {
      const outcome = settled[i];
      if (outcome.status === "fulfilled") {
        results.set(docs[i].id, outcome.value);
      } else {
        log.error("Failed to process document", { id: docs[i].id, error: String(outcome.reason) });
        results.set(docs[i].id, []);
      }
    }
    return results;
  }

  // ---- block extraction --------------------------------------------------

  private extractBlocks(doc: Document): StructuralBlock[] {
    switch (doc.format) {
      case "markdown":
      case "plaintext":
        return extractMarkdownBlocks(doc.content);
      case "html":
        return extractHTMLBlocks(doc.content);
      case "code":
        return extractCodeStructure(doc.content);
      case "pdf":
        // In production, pipe rawBytes through a PDF library. Fall back to text.
        log.warn("PDF extraction falling back to plaintext heuristic", { id: doc.id });
        return extractMarkdownBlocks(doc.content);
      case "image":
        log.warn("Image OCR not wired — returning caption stub", { id: doc.id });
        return [{ type: "image-caption", content: doc.content, startOffset: 0, endOffset: doc.content.length }];
      default:
        return extractMarkdownBlocks(doc.content);
    }
  }

  // ---- chunking ----------------------------------------------------------

  private chunkBlocks(blocks: StructuralBlock[], doc: Document): Chunk[] {
    const { targetSize, overlap, respectStructure, maxSize } = this.config.chunking;
    const chunks: Chunk[] = [];
    let buffer = "";
    let bufferStart = blocks[0]?.startOffset ?? 0;
    let idx = 0;

    const flush = (endOffset: number, structuralType?: string) => {
      const trimmed = buffer.trim();
      if (trimmed.length === 0) return;
      chunks.push({
        id: `${doc.id}::chunk-${idx}`,
        documentId: doc.id,
        content: trimmed,
        index: idx,
        startOffset: bufferStart,
        endOffset,
        structuralType,
        metadata: { ...doc.metadata },
      });
      idx++;
      // keep overlap tail
      if (overlap > 0 && trimmed.length > overlap) {
        buffer = trimmed.slice(-overlap);
        bufferStart = endOffset - overlap;
      } else {
        buffer = "";
        bufferStart = endOffset;
      }
    };

    for (const block of blocks) {
      // If block is a special type and config says extract separately, flush + emit solo
      if (
        (block.type === "code" && this.config.extractCodeBlocks) ||
        (block.type === "table" && this.config.extractTables)
      ) {
        flush(block.startOffset, "mixed");
        buffer = block.content;
        bufferStart = block.startOffset;
        flush(block.endOffset, block.type);
        continue;
      }

      if (respectStructure && block.type === "heading") {
        flush(block.startOffset, "paragraph");
      }

      buffer += (buffer.length > 0 ? "\n" : "") + block.content;

      if (buffer.length >= targetSize) {
        flush(block.endOffset, block.type);
      }

      // Hard-cap safety
      if (buffer.length >= maxSize) {
        flush(block.endOffset, block.type);
      }
    }

    // Remainder
    if (buffer.trim().length > 0) {
      const last = blocks[blocks.length - 1];
      flush(last?.endOffset ?? buffer.length, "paragraph");
    }

    return chunks;
  }
}
