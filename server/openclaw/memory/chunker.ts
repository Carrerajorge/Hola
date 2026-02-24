// server/openclaw/memory/chunker.ts
export interface DocumentChunk {
  id: string;
  path: string;
  content: string;
  startLine: number;
  endLine: number;
}

export function chunkDocument(
  content: string,
  path: string,
  opts: { chunkSize: number; chunkOverlap: number },
): DocumentChunk[] {
  const lines = content.split('\n');
  if (lines.length <= opts.chunkSize) {
    return [{ id: `${path}:0-${lines.length}`, path, content, startLine: 0, endLine: lines.length }];
  }

  const chunks: DocumentChunk[] = [];
  const step = Math.max(1, opts.chunkSize - opts.chunkOverlap);

  for (let start = 0; start < lines.length; start += step) {
    const end = Math.min(start + opts.chunkSize, lines.length);
    const chunkLines = lines.slice(start, end);
    chunks.push({
      id: `${path}:${start}-${end}`,
      path,
      content: chunkLines.join('\n'),
      startLine: start,
      endLine: end,
    });
    if (end >= lines.length) break;
  }

  return chunks;
}
