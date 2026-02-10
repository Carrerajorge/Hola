import { describe, it, expect } from 'vitest';
import {
  OPENCLAW_1000,
  getOpenClaw1000CapabilityById,
  getOpenClaw1000CapabilitiesByCategory,
  getOpenClaw1000Stats,
} from '../../server/capabilities/generated/openClaw1000Capabilities.generated';
import {
  OPENCLAW_1000_EMAITI_MATRIX,
  getOpenClaw1000EmaitiEntry,
} from '../../server/capabilities/generated/openClaw1000EmaitiMatrix.generated';
import {
  listOpenClaw1000Capabilities,
  getOpenClaw1000Capability,
  getOpenClaw1000QuickStats,
  verifyOpenClaw1000Capability,
  verifyOpenClaw1000Batch,
  generateOpenClaw1000Report,
} from '../../server/services/openClaw1000Service';

describe('OpenClaw1000 generated mapping', () => {
  it('contains exactly 1000 capabilities', () => {
    expect(OPENCLAW_1000.length).toBe(1000);
  });

  it('contains exactly 1000 EMAITI entries', () => {
    expect(OPENCLAW_1000_EMAITI_MATRIX.length).toBe(1000);
  });

  it('ensures each capability has 20 EMAITI checks', () => {
    for (const entry of OPENCLAW_1000_EMAITI_MATRIX) {
      expect(entry.checks.length).toBe(20);
      expect(entry.checks.every((c) => c.required)).toBe(true);
      expect(entry.checks.every((c) => c.implemented)).toBe(true);
    }
  });

  it('ensures IDs 1..1000 are present and unique', () => {
    const ids = OPENCLAW_1000.map((c) => c.id).sort((a, b) => a - b);
    expect(ids[0]).toBe(1);
    expect(ids[ids.length - 1]).toBe(1000);

    const unique = new Set(ids);
    expect(unique.size).toBe(1000);
  });

  it('resolves helper lookups for boundary capabilities', () => {
    const first = getOpenClaw1000CapabilityById(1);
    const last = getOpenClaw1000CapabilityById(1000);
    expect(first?.id).toBe(1);
    expect(last?.id).toBe(1000);

    const matrixFirst = getOpenClaw1000EmaitiEntry(1);
    const matrixLast = getOpenClaw1000EmaitiEntry(1000);
    expect(matrixFirst?.checks.length).toBe(20);
    expect(matrixLast?.checks.length).toBe(20);
  });

  it('reports stats with full implementation coverage', () => {
    const stats = getOpenClaw1000Stats();
    expect(stats.total).toBe(1000);
    expect(stats.implemented).toBe(1000);
    expect(stats.stub).toBe(0);
    expect(stats.missing).toBe(0);
  });

  it('category filters return non-empty sets', () => {
    const categories = [...new Set(OPENCLAW_1000.map((c) => c.category))];
    for (const category of categories) {
      const byCategory = getOpenClaw1000CapabilitiesByCategory(category as any);
      expect(byCategory.length).toBeGreaterThan(0);
    }
  });
});

describe('OpenClaw1000 service', () => {
  it('listOpenClaw1000Capabilities supports category + status filters', () => {
    const all = listOpenClaw1000Capabilities();
    expect(all.length).toBe(1000);

    const academic = listOpenClaw1000Capabilities({ category: 'academic_research' });
    expect(academic.length).toBeGreaterThan(0);

    const implemented = listOpenClaw1000Capabilities({ status: 'implemented' });
    expect(implemented.length).toBe(1000);
  });

  it('getOpenClaw1000Capability returns item by id', () => {
    const cap = getOpenClaw1000Capability(500);
    expect(cap?.id).toBe(500);
  });

  it('getOpenClaw1000QuickStats returns 20k EMAITI checks total', () => {
    const stats = getOpenClaw1000QuickStats();
    expect(stats.total).toBe(1000);
    expect(stats.emaitiEntries).toBe(1000);
    expect(stats.emaitiChecksTotal).toBe(20000);
    expect(stats.coveragePercent).toBe(100);
  });

  it('verifyOpenClaw1000Capability passes for valid capability', async () => {
    const result = await verifyOpenClaw1000Capability(1);
    expect(result.verifyStatus).toBe('PASS');
    expect(result.checks.total).toBe(20);
    expect(result.checks.failed).toBe(0);
  });

  it('verifyOpenClaw1000Capability returns ERROR for unknown capability', async () => {
    const result = await verifyOpenClaw1000Capability(99999);
    expect(result.verifyStatus).toBe('ERROR');
  });

  it('verifyOpenClaw1000Batch verifies id subset', async () => {
    const results = await verifyOpenClaw1000Batch({ ids: [1, 2, 3, 4, 5] });
    expect(results.length).toBe(5);
    expect(results.every((r) => r.verifyStatus === 'PASS')).toBe(true);
  });

  it('verifyOpenClaw1000Batch verifies category subset', async () => {
    const results = await verifyOpenClaw1000Batch({ category: 'academic_research' });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.category === 'academic_research')).toBe(true);
  });

  it('generateOpenClaw1000Report returns consistent totals', async () => {
    const report = await generateOpenClaw1000Report();
    expect(report.summary.total).toBe(1000);
    expect(report.summary.passed).toBe(1000);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.emaitiChecksTotal).toBe(20000);
    expect(report.summary.coveragePercent).toBe(100);
    expect(report.summary.overallStatus).toBe('PASS');
  });
});
