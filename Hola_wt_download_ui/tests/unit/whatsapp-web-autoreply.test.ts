import { describe, expect, it } from 'vitest';
import { chunkText, isGroupJid, MemorySseResponse } from '../../server/integrations/whatsappWebAutoReply';

describe('whatsappWebAutoReply utils', () => {
  it('detects group jids', () => {
    expect(isGroupJid('12345@g.us')).toBe(true);
    expect(isGroupJid('12345@s.whatsapp.net')).toBe(false);
  });

  it('chunks long text', () => {
    const text = 'a'.repeat(3005);
    const parts = chunkText(text, 1400);
    expect(parts.length).toBe(3);
    expect(parts[0]).toHaveLength(1400);
    expect(parts[1]).toHaveLength(1400);
    expect(parts[2]).toHaveLength(205);
  });

  it('parses SSE frames', () => {
    const res = new MemorySseResponse();
    res.write('event: chunk\ndata: {"content":"Hola ","sequence":1}\n\n');
    res.write('event: chunk\ndata: {"content":"mundo","sequence":2}\n\n');
    expect(res.chunks.map(c => c.event)).toEqual(['chunk','chunk']);
    const text = res.chunks.filter(c => c.event === 'chunk').map(c => c.data.content).join('');
    expect(text).toBe('Hola mundo');
  });
});
