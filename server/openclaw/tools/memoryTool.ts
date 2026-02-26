import { z } from 'zod';
import path from 'path';
import fs from 'fs/promises';
import type { ToolContext, ToolDefinition, ToolResult } from '../../agent/toolRegistry';
import { Logger } from '../../lib/logger';

/**
 * OpenClaw Memory Tool
 *
 * Adapted from upstream openclaw memory-tool.ts.
 * Provides persistent, file-based agent memory that survives across sessions.
 * Agents can save, search, and retrieve knowledge fragments.
 *
 * Memory is stored as individual markdown files in a per-user directory.
 * Supports semantic-ish search via keyword matching (full vector search via RAG tool).
 */

const MAX_MEMORY_SIZE = 100_000; // 100KB per memory file
const MAX_MEMORIES_PER_USER = 500;

function ok(output: unknown): ToolResult {
  return { success: true, output };
}

function fail(code: string, message: string, retryable = false): ToolResult {
  return { success: false, output: null, error: { code, message, retryable } };
}

function getMemoryDir(userId: string): string {
  const base = process.env.OPENCLAW_MEMORY_DIR || '/tmp/openclaw-memory';
  return path.join(base, userId.replace(/[^a-zA-Z0-9_-]/g, '_'));
}

function sanitizeKey(key: string): string {
  return key
    .replace(/[^a-zA-Z0-9_\-./]/g, '_')
    .replace(/\.+/g, '.')
    .replace(/\/+/g, '/')
    .substring(0, 200);
}

export function createMemoryTool(): ToolDefinition {
  return {
    name: 'openclaw_memory',
    description:
      'Save, search, and retrieve persistent agent memory. ' +
      'Actions: save (write a memory), get (read by key), search (keyword search), ' +
      'list (all keys), delete (remove a memory).',
    inputSchema: z.object({
      action: z.enum(['save', 'get', 'search', 'list', 'delete']),
      key: z
        .string()
        .optional()
        .describe('Memory key/name (use / for topics, e.g., "auth/login/flow")'),
      content: z
        .string()
        .optional()
        .describe('Content to save (required for "save")'),
      query: z
        .string()
        .optional()
        .describe('Search query (for "search")'),
      tags: z
        .array(z.string())
        .optional()
        .describe('Optional tags for categorization'),
    }),
    capabilities: ['reads_files'],
    execute: async (input: any, context: ToolContext): Promise<ToolResult> => {
      const { action } = input;
      const memDir = getMemoryDir(context.userId);

      try {
        await fs.mkdir(memDir, { recursive: true });

        switch (action) {
          case 'save': {
            if (!input.key) return fail('MISSING_KEY', 'Key is required for "save"');
            if (!input.content) return fail('MISSING_CONTENT', 'Content is required for "save"');
            if (input.content.length > MAX_MEMORY_SIZE) {
              return fail('TOO_LARGE', `Content exceeds ${MAX_MEMORY_SIZE} chars`);
            }

            const safeKey = sanitizeKey(input.key);
            const filePath = path.join(memDir, `${safeKey}.md`);

            // Ensure subdirectories exist
            await fs.mkdir(path.dirname(filePath), { recursive: true });

            // Build content with metadata header
            const metadata = [
              `---`,
              `key: ${safeKey}`,
              `updated: ${new Date().toISOString()}`,
              input.tags?.length ? `tags: [${input.tags.join(', ')}]` : null,
              `---`,
              '',
            ]
              .filter(v => v !== null)
              .join('\n');

            await fs.writeFile(filePath, metadata + input.content, 'utf-8');
            Logger.info(`[OpenClaw:Memory] Saved memory: ${safeKey} (${input.content.length} chars)`);
            return ok({ key: safeKey, chars: input.content.length });
          }

          case 'get': {
            if (!input.key) return fail('MISSING_KEY', 'Key is required for "get"');
            const safeKey = sanitizeKey(input.key);
            const filePath = path.join(memDir, `${safeKey}.md`);

            try {
              const raw = await fs.readFile(filePath, 'utf-8');
              // Strip metadata header
              const contentStart = raw.indexOf('---', 4);
              const content = contentStart > 0 ? raw.substring(contentStart + 4).trim() : raw;
              return ok({ key: safeKey, content });
            } catch {
              return fail('NOT_FOUND', `Memory not found: ${safeKey}`);
            }
          }

          case 'search': {
            if (!input.query) return fail('MISSING_QUERY', 'Query is required for "search"');
            const query = input.query.toLowerCase();
            const keywords = query.split(/\s+/).filter(Boolean);

            const results: Array<{ key: string; snippet: string; score: number }> = [];

            async function searchDir(dir: string, prefix: string): Promise<void> {
              let entries;
              try {
                entries = await fs.readdir(dir, { withFileTypes: true });
              } catch {
                return;
              }

              for (const entry of entries) {
                if (entry.isDirectory()) {
                  await searchDir(
                    path.join(dir, entry.name),
                    prefix ? `${prefix}/${entry.name}` : entry.name,
                  );
                } else if (entry.name.endsWith('.md')) {
                  const key = prefix
                    ? `${prefix}/${entry.name.replace('.md', '')}`
                    : entry.name.replace('.md', '');
                  try {
                    const raw = await fs.readFile(path.join(dir, entry.name), 'utf-8');
                    const lower = raw.toLowerCase();
                    const score = keywords.reduce(
                      (acc, kw) => acc + (lower.includes(kw) ? 1 : 0),
                      0,
                    );
                    if (score > 0) {
                      // Extract snippet around first match
                      const idx = lower.indexOf(keywords[0]);
                      const start = Math.max(0, idx - 50);
                      const snippet = raw.substring(start, start + 150).trim();
                      results.push({ key, snippet, score });
                    }
                  } catch {
                    /* skip unreadable files */
                  }
                }
              }
            }

            await searchDir(memDir, '');
            results.sort((a, b) => b.score - a.score);

            return ok(results.slice(0, 20));
          }

          case 'list': {
            const keys: string[] = [];

            async function listDir(dir: string, prefix: string): Promise<void> {
              let entries;
              try {
                entries = await fs.readdir(dir, { withFileTypes: true });
              } catch {
                return;
              }

              for (const entry of entries) {
                if (entry.isDirectory()) {
                  await listDir(
                    path.join(dir, entry.name),
                    prefix ? `${prefix}/${entry.name}` : entry.name,
                  );
                } else if (entry.name.endsWith('.md')) {
                  const key = prefix
                    ? `${prefix}/${entry.name.replace('.md', '')}`
                    : entry.name.replace('.md', '');
                  keys.push(key);
                }
              }
            }

            await listDir(memDir, '');
            return ok({ keys, count: keys.length });
          }

          case 'delete': {
            if (!input.key) return fail('MISSING_KEY', 'Key is required for "delete"');
            const safeKey = sanitizeKey(input.key);
            const filePath = path.join(memDir, `${safeKey}.md`);

            try {
              await fs.unlink(filePath);
              return ok({ deleted: safeKey });
            } catch {
              return fail('NOT_FOUND', `Memory not found: ${safeKey}`);
            }
          }

          default:
            return fail('UNKNOWN_ACTION', `Unknown action: ${action}`);
        }
      } catch (error: any) {
        Logger.error(`[OpenClaw:Memory] Error: ${error.message}`);
        return fail('MEMORY_ERROR', error.message || 'Memory operation failed', true);
      }
    },
  };
}
