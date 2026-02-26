import { describe, it, expect, vi } from 'vitest';
import { createBrowserTools, createBrowserNavigateTool } from '../tools/browserTool';

// Mock browser worker to THROW (not null) so the catch block triggers fetch fallback
vi.mock('../../agent/browser-worker', () => ({
  browserWorker: {
    navigateAndExtract: vi.fn().mockRejectedValue(new Error('Browser not available')),
    screenshot: vi.fn().mockRejectedValue(new Error('Browser not available')),
    clickElement: vi.fn().mockRejectedValue(new Error('Browser not available')),
  },
}));

describe('OpenClaw Browser Tools', () => {
  it('creates 3 browser tools', () => {
    const tools = createBrowserTools();
    expect(tools).toHaveLength(3);
    expect(tools.map(t => t.name)).toEqual([
      'openclaw_browser_navigate',
      'openclaw_browser_screenshot',
      'openclaw_browser_click',
    ]);
  });

  describe('navigate tool', () => {
    const tool = createBrowserNavigateTool();
    const ctx = { userId: 'u1', chatId: 'c1', runId: 'r1' };

    it('has correct name and description', () => {
      expect(tool.name).toBe('openclaw_browser_navigate');
      expect(tool.description).toContain('Navigate to a URL');
    });

    it('falls back to fetch when browser worker throws', async () => {
      // Mock global fetch for the fallback path
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve('<html><head><title>Test Page</title></head><body>Hello World</body></html>'),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await tool.execute(
        { url: 'https://example.com', extractMode: 'text', waitMs: 0, timeout: 5000 },
        ctx,
      );

      expect(result.success).toBe(true);
      expect((result.output as any).title).toBe('Test Page');
      expect((result.output as any).content).toContain('Hello World');
      expect((result.output as any).fallback).toBe(true);

      vi.unstubAllGlobals();
    });
  });
});
