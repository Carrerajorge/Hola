import { describe, it, expect } from 'vitest';
import { extractKeywords, buildFtsQuery } from '../memory/queryExpansion';

describe('extractKeywords', () => {
  it('should extract meaningful keywords from English text', () => {
    const kws = extractKeywords('how to create a database migration');
    expect(kws).toContain('create');
    expect(kws).toContain('database');
    expect(kws).toContain('migration');
    expect(kws).not.toContain('how');
    expect(kws).not.toContain('to');
    expect(kws).not.toContain('a');
  });

  it('should handle Spanish stop words', () => {
    const kws = extractKeywords('como crear una migracion de base de datos');
    expect(kws).toContain('crear');
    expect(kws).toContain('migracion');
    expect(kws).not.toContain('como');
    expect(kws).not.toContain('una');
    expect(kws).not.toContain('de');
  });

  it('should return empty for stop-words-only input', () => {
    const kws = extractKeywords('the a an is are');
    expect(kws).toHaveLength(0);
  });

  it('should deduplicate keywords', () => {
    const kws = extractKeywords('test test test unique');
    expect(kws.filter(k => k === 'test')).toHaveLength(1);
  });
});

describe('buildFtsQuery', () => {
  it('should build AND query from tokens', () => {
    expect(buildFtsQuery('database migration')).toBe('"database" AND "migration"');
  });

  it('should return null for empty input', () => {
    expect(buildFtsQuery('')).toBeNull();
  });
});
