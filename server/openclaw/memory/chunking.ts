/**
 * Markdown chunking with line tracking.
 * Ported from upstream OpenClaw v2026.2.24: src/memory/internal.ts
 *
 * Splits markdown content into overlapping chunks suitable for embedding,
 * preserving line number metadata for precise snippet extraction.
 */

import { createHash } from 'crypto';

export interface ChunkResult {
  startLine: number;
  endLine: number;
  text: string;
  hash: string;
}

const DEFAULT_CHUNK_SIZE = 512;     // target chars per chunk
const DEFAULT_CHUNK_OVERLAP = 64;   // overlap chars between consecutive chunks

/**
 * Hash a text string (SHA-256, hex).
 * Used for change detection — only re-embed when hash changes.
 */
export function hashText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Chunk markdown content into overlapping segments with line tracking.
 *
 * Strategy:
 * 1. Split by double newlines (paragraphs) as primary boundaries
 * 2. If a paragraph exceeds chunkSize, split at sentence boundaries
 * 3. Track line numbers through the splitting process
 * 4. Add overlap from previous chunk to maintain context
 */
export function chunkMarkdown(
  content: string,
  options?: { chunkSize?: number; chunkOverlap?: number },
): ChunkResult[] {
  const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const chunkOverlap = options?.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;

  if (!content.trim()) {
    return [];
  }

  const lines = content.split('\n');
  const chunks: ChunkResult[] = [];

  let currentChunkLines: string[] = [];
  let currentStartLine = 0;
  let currentLength = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    currentChunkLines.push(line);
    currentLength += line.length + 1; // +1 for newline

    // Check if we should emit a chunk
    const isLastLine = i === lines.length - 1;
    const isBlankLine = line.trim() === '';
    const exceedsSize = currentLength >= chunkSize;

    if ((exceedsSize && isBlankLine) || isLastLine) {
      if (currentChunkLines.length > 0) {
        const text = currentChunkLines.join('\n').trim();
        if (text.length > 0) {
          chunks.push({
            startLine: currentStartLine,
            endLine: currentStartLine + currentChunkLines.length - 1,
            text,
            hash: hashText(text),
          });
        }

        // Overlap: keep last few lines for context in next chunk
        const overlapLines = computeOverlapLines(currentChunkLines, chunkOverlap);
        currentStartLine = i - overlapLines.length + 1;
        currentChunkLines = [...overlapLines];
        currentLength = currentChunkLines.join('\n').length;
      }
    }
  }

  return chunks;
}

/**
 * Compute overlap lines from the tail of a chunk.
 */
function computeOverlapLines(lines: string[], overlapChars: number): string[] {
  if (overlapChars <= 0) return [];

  const result: string[] = [];
  let chars = 0;

  for (let i = lines.length - 1; i >= 0; i--) {
    chars += lines[i].length + 1;
    result.unshift(lines[i]);
    if (chars >= overlapChars) break;
  }

  return result;
}

/**
 * Given file content and a line range, extract the snippet.
 */
export function extractSnippet(content: string, startLine: number, endLine: number): string {
  const lines = content.split('\n');
  const start = Math.max(0, startLine);
  const end = Math.min(lines.length - 1, endLine);
  return lines.slice(start, end + 1).join('\n');
}
