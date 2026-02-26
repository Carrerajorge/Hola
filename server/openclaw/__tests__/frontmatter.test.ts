import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from '../skills/frontmatter';

describe('parseFrontmatter', () => {
  it('should parse YAML frontmatter from markdown', () => {
    const content = `---
name: My Skill
description: Does things
emoji: "\uD83D\uDD27"
os: [darwin, linux]
---
# My Skill
Content here`;
    const result = parseFrontmatter(content);
    expect(result.attributes.name).toBe('My Skill');
    expect(result.attributes.emoji).toBe('\uD83D\uDD27');
    expect(result.attributes.os).toEqual(['darwin', 'linux']);
    expect(result.body).toContain('# My Skill');
  });

  it('should return empty attributes for no frontmatter', () => {
    const result = parseFrontmatter('# Just markdown\nNo frontmatter');
    expect(result.attributes).toEqual({});
    expect(result.body).toContain('# Just markdown');
  });

  it('should handle malformed YAML gracefully', () => {
    const content = `---
invalid: [unclosed
---
Body`;
    const result = parseFrontmatter(content);
    expect(result.attributes).toEqual({});
    expect(result.body).toBe(content);
  });
});
