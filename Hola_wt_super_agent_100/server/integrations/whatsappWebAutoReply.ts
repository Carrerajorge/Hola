import type { Response } from 'express';

export function isGroupJid(jid: string): boolean {
  return /@g\.us$/i.test(jid);
}

export function chunkText(text: string, maxLen = 1400): string[] {
  const cleaned = String(text || '').trim();
  if (!cleaned) return [];
  const parts: string[] = [];
  for (let i = 0; i < cleaned.length; i += maxLen) parts.push(cleaned.slice(i, i + maxLen));
  return parts;
}

// Minimal in-memory Response-like collector for SSE output.
export class MemorySseResponse {
  public chunks: Array<{ event: string; data: any }> = [];
  private buffer = '';

  setHeader(..._args: any[]) { /* noop */ }
  flushHeaders() { /* noop */ }
  write(chunk: any) {
    this.buffer += String(chunk);
    while (true) {
      const idx = this.buffer.indexOf('\n\n');
      if (idx === -1) break;
      const frame = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);

      const lines = frame.split('\n');
      const eventLine = lines.find(l => l.startsWith('event:'));
      const dataLine = lines.find(l => l.startsWith('data:'));
      const event = eventLine ? eventLine.slice('event:'.length).trim() : 'message';
      let data: any = {};
      if (dataLine) {
        const raw = dataLine.slice('data:'.length).trim();
        try { data = JSON.parse(raw); } catch { data = { raw }; }
      }
      this.chunks.push({ event, data });
    }
    return true;
  }
  end() { /* noop */ }
}

export type MemorySseResponseAsResponse = MemorySseResponse & Pick<Response, 'setHeader' | 'flushHeaders' | 'write' | 'end'>;
