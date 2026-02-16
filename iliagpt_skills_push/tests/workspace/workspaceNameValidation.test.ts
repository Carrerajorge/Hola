import { describe, expect, it } from 'vitest';
import { isValidWorkspaceName, normalizeWorkspaceName } from '../../server/services/workspaceValidation';

describe('workspaceValidation', () => {
  it('normalizes whitespace', () => {
    expect(normalizeWorkspaceName('  Hola   Mundo  ')).toBe('Hola Mundo');
  });

  const allowedSamples = [
    'Acme',
    'Mi Empresa',
    'Empresa-123',
    "Luis' Workspace",
    'R&D (Latam)',
    'Team_One',
    'A B',
  ];

  for (const s of allowedSamples) {
    it(`accepts: ${s}`, () => {
      expect(isValidWorkspaceName(s)).toBe(true);
    });
  }

  const forbidden = ['<script>', '💥', 'a\n', 'a\t', ''];
  for (const s of forbidden) {
    it(`rejects forbidden: ${JSON.stringify(s)}`, () => {
      expect(isValidWorkspaceName(s)).toBe(false);
    });
  }

  // 120 rigorous length tests
  for (let len = 0; len <= 120; len++) {
    const s = 'A'.repeat(len);
    const expected = len >= 2 && len <= 60;
    it(`length ${len}`, () => {
      expect(isValidWorkspaceName(s)).toBe(expected);
    });
  }
});
