import * as fs from 'fs';

interface CacheEntry {
  content: string;
  mtimeMs: number;
}

export class FileCache {
  private cache = new Map<string, CacheEntry>();

  read(filePath: string): string | null {
    try {
      const stat = fs.statSync(filePath);
      const cached = this.cache.get(filePath);
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        return cached.content;
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      this.cache.set(filePath, { content, mtimeMs: stat.mtimeMs });
      return content;
    } catch {
      this.cache.delete(filePath);
      return null;
    }
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}
