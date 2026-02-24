import { describe, it, expect } from 'vitest';
import { chunkDocument } from '../memory/chunker';

describe('chunkDocument', () => {
  it('should split document into overlapping chunks', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${i}`);
    const doc = lines.join('\n');
    const chunks = chunkDocument(doc, 'test.md', { chunkSize: 20, chunkOverlap: 5 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].startLine).toBe(0);
    expect(chunks[1].startLine).toBeLessThan(chunks[0].endLine); // overlap
  });

  it('should return single chunk for small document', () => {
    const chunks = chunkDocument('small doc', 'small.md', { chunkSize: 100, chunkOverlap: 10 });
    expect(chunks).toHaveLength(1);
  });

  it('should include path in chunk IDs', () => {
    const chunks = chunkDocument('line1\nline2\nline3', 'file.md', { chunkSize: 100, chunkOverlap: 0 });
    expect(chunks[0].id).toContain('file.md');
  });

  it('should have correct start and end lines', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `Line ${i}`);
    const doc = lines.join('\n');
    const chunks = chunkDocument(doc, 'test.md', { chunkSize: 10, chunkOverlap: 2 });
    expect(chunks[0].startLine).toBe(0);
    expect(chunks[0].endLine).toBe(10);
    // Second chunk should overlap
    expect(chunks[1].startLine).toBe(8);
  });
});
