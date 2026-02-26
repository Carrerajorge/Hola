import { z } from 'zod';
import type { ToolContext, ToolDefinition, ToolResult } from '../../agent/toolRegistry';
import { Logger } from '../../lib/logger';

/**
 * OpenClaw Browser Tool
 *
 * Provides browser automation capabilities to agents via the existing
 * browser-worker infrastructure. Supports navigation, screenshot,
 * content extraction, and click automation.
 */

function ok(output: unknown): ToolResult {
  return { success: true, output };
}

function fail(code: string, message: string, retryable = false): ToolResult {
  return { success: false, output: null, error: { code, message, retryable } };
}

export function createBrowserNavigateTool(): ToolDefinition {
  return {
    name: 'openclaw_browser_navigate',
    description:
      'Navigate to a URL and extract page content. Returns the page title, text content, ' +
      'and metadata. Useful for web research, scraping, and content extraction.',
    inputSchema: z.object({
      url: z.string().url().describe('The URL to navigate to'),
      extractMode: z.enum(['text', 'html', 'markdown']).default('text')
        .describe('Content extraction mode'),
      waitMs: z.number().int().min(0).max(10000).default(2000)
        .describe('Milliseconds to wait after page load for dynamic content'),
      timeout: z.number().int().min(1000).max(30000).default(15000)
        .describe('Navigation timeout in milliseconds'),
    }),
    capabilities: ['accesses_external_api', 'long_running'],
    execute: async (input: any, _context: ToolContext): Promise<ToolResult> => {
      try {
        const { browserWorker } = await import('../../agent/browser-worker');

        if (!browserWorker) {
          return fail('BROWSER_UNAVAILABLE', 'Browser worker not initialized', true);
        }

        const result = await browserWorker.navigateAndExtract({
          url: input.url,
          extractMode: input.extractMode,
          waitMs: input.waitMs,
          timeout: input.timeout,
        });

        return ok({
          url: input.url,
          title: result.title || '',
          content: (result.content || '').slice(0, 50_000), // Cap at 50K chars
          statusCode: result.statusCode,
          extractMode: input.extractMode,
        });
      } catch (error: any) {
        // Fallback to fetch-based extraction if browser worker is unavailable
        try {
          const resp = await fetch(input.url, {
            signal: AbortSignal.timeout(input.timeout || 15_000),
            headers: { 'User-Agent': 'IliaGPT-OpenClaw/1.0' },
          });

          const html = await resp.text();
          const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
          const title = titleMatch ? titleMatch[1].trim() : '';

          // Basic HTML → text
          const text = html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 50_000);

          return ok({
            url: input.url,
            title,
            content: text,
            statusCode: resp.status,
            extractMode: 'text',
            fallback: true,
          });
        } catch (fetchError: any) {
          return fail('NAVIGATE_ERROR', error.message || 'Navigation failed', true);
        }
      }
    },
  };
}

export function createBrowserScreenshotTool(): ToolDefinition {
  return {
    name: 'openclaw_browser_screenshot',
    description:
      'Take a screenshot of a web page. Returns the screenshot as a base64-encoded PNG. ' +
      'Useful for visual verification and capture of page state.',
    inputSchema: z.object({
      url: z.string().url().describe('URL to screenshot'),
      fullPage: z.boolean().default(false).describe('Capture full scrollable page'),
      width: z.number().int().min(320).max(3840).default(1280).describe('Viewport width'),
      height: z.number().int().min(200).max(2160).default(800).describe('Viewport height'),
    }),
    capabilities: ['accesses_external_api', 'long_running'],
    execute: async (input: any, _context: ToolContext): Promise<ToolResult> => {
      try {
        const { browserWorker } = await import('../../agent/browser-worker');

        if (!browserWorker) {
          return fail('BROWSER_UNAVAILABLE', 'Browser worker not initialized', true);
        }

        const screenshot = await browserWorker.screenshot({
          url: input.url,
          fullPage: input.fullPage,
          viewport: { width: input.width, height: input.height },
        });

        return ok({
          url: input.url,
          format: 'png',
          base64Length: screenshot.base64?.length || 0,
          base64: screenshot.base64,
          fullPage: input.fullPage,
        });
      } catch (error: any) {
        return fail('SCREENSHOT_ERROR', error.message || 'Screenshot failed', true);
      }
    },
  };
}

export function createBrowserClickTool(): ToolDefinition {
  return {
    name: 'openclaw_browser_click',
    description:
      'Click an element on a web page by CSS selector. Navigates to the URL first if needed. ' +
      'Returns the page state after clicking.',
    inputSchema: z.object({
      url: z.string().url().describe('URL of the page'),
      selector: z.string().min(1).describe('CSS selector of the element to click'),
      waitAfterMs: z.number().int().min(0).max(10000).default(2000)
        .describe('Milliseconds to wait after click for page update'),
    }),
    capabilities: ['accesses_external_api', 'long_running', 'high_risk'],
    execute: async (input: any, _context: ToolContext): Promise<ToolResult> => {
      try {
        const { browserWorker } = await import('../../agent/browser-worker');

        if (!browserWorker) {
          return fail('BROWSER_UNAVAILABLE', 'Browser worker not initialized', true);
        }

        const result = await browserWorker.clickElement({
          url: input.url,
          selector: input.selector,
          waitAfterMs: input.waitAfterMs,
        });

        return ok({
          url: input.url,
          selector: input.selector,
          clicked: result.clicked,
          newUrl: result.currentUrl,
          title: result.title,
        });
      } catch (error: any) {
        return fail('CLICK_ERROR', error.message || 'Click failed', true);
      }
    },
  };
}

export function createBrowserTools(): ToolDefinition[] {
  return [
    createBrowserNavigateTool(),
    createBrowserScreenshotTool(),
    createBrowserClickTool(),
  ];
}
