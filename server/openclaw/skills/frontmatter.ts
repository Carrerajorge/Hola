// server/openclaw/skills/frontmatter.ts
import yaml from 'yaml';

export interface ParsedFrontmatter {
  attributes: Record<string, unknown>;
  body: string;
}

export function parseFrontmatter(content: string): ParsedFrontmatter {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { attributes: {}, body: content };
  try {
    const attributes = yaml.parse(match[1]) ?? {};
    return {
      attributes: typeof attributes === 'object' && attributes !== null ? attributes : {},
      body: match[2],
    };
  } catch {
    return { attributes: {}, body: content };
  }
}
