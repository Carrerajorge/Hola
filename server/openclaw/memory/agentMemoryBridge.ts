// server/openclaw/memory/agentMemoryBridge.ts
//
// Bridge between the OpenClaw Memory/RAG module and the agent executor.
// Provides a single function that can be called before LLM calls to
// inject relevant memory context into the conversation history.

import { getOpenClawServices } from '../index';
import type { MemorySearchResult } from '../types';

interface MemoryContext {
  /** A system-message string to prepend to the conversation, or null if no results. */
  systemMessage: string | null;
  /** The raw search results for logging / tracing. */
  results: MemorySearchResult[];
}

/**
 * Search memory for context relevant to the user's message.
 * Returns a formatted system message if results are found,
 * or null if memory is disabled / no relevant results.
 *
 * This function is safe to call even when memory is not enabled —
 * it will simply return null.
 */
export async function getMemoryContext(userMessage: string): Promise<MemoryContext> {
  const services = getOpenClawServices();
  if (!services?.memory) {
    return { systemMessage: null, results: [] };
  }

  try {
    const results = await services.memory.search(userMessage, {
      maxResults: services.config.memory.maxResults,
      minScore: services.config.memory.minScore,
    });

    if (results.length === 0) {
      return { systemMessage: null, results: [] };
    }

    // Build a concise context block
    const contextSnippets = results
      .slice(0, 5) // Limit to top 5 to avoid overwhelming the context window
      .map((r, i) => `[${i + 1}] (${r.path}:${r.startLine}-${r.endLine}, score=${r.score.toFixed(2)})\n${r.snippet}`)
      .join('\n\n');

    const systemMessage = `[Memory Context — ${results.length} relevant fragment(s) found]\n${contextSnippets}`;

    return { systemMessage, results };
  } catch (err: any) {
    // Non-fatal: log and continue without memory context
    console.warn(`[OpenClaw:Memory] Search failed (non-fatal): ${err.message}`);
    return { systemMessage: null, results: [] };
  }
}

/**
 * Inject memory context into a conversation history array.
 * Inserts a system message near the beginning of the conversation
 * if relevant memory fragments are found.
 *
 * @returns The (possibly augmented) conversation history.
 */
export async function injectMemoryContext(
  messages: Array<{ role: string; content: string }>,
  userMessage: string,
): Promise<Array<{ role: string; content: string }>> {
  const { systemMessage } = await getMemoryContext(userMessage);

  if (!systemMessage) {
    return messages;
  }

  // Insert memory context as a system message at position 0
  // (before other system messages, so the executor's own instructions take priority)
  return [
    { role: 'system', content: systemMessage },
    ...messages,
  ];
}
