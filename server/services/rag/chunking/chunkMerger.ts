/**
 * Chunk Merger — merges small adjacent chunks on the same page
 *
 * After initial hierarchical splitting, some sections produce very small
 * chunks.  This module merges those that fall below a configurable
 * threshold with their immediately following sibling, as long as they
 * share the same page number.
 */

import type { EnhancedChunk } from "./types";

/**
 * Merge chunks that are smaller than minChunkSize with their adjacent same-page chunks.
 */
export function mergeSmallChunks(chunks: EnhancedChunk[], minChunkSize: number): EnhancedChunk[] {
    if (chunks.length <= 1) return chunks;

    const result: EnhancedChunk[] = [];
    let pending: EnhancedChunk | null = null;

    for (const chunk of chunks) {
        if (!pending) {
            pending = chunk;
            continue;
        }

        if (pending.content.length < minChunkSize && pending.metadata.pageNumber === chunk.metadata.pageNumber) {
            // Merge pending into current
            pending = {
                content: pending.content + "\n\n" + chunk.content,
                metadata: {
                    ...chunk.metadata,
                    headerChain: pending.metadata.headerChain.length > 0 ? pending.metadata.headerChain : chunk.metadata.headerChain,
                    extractedKeywords: [...pending.metadata.extractedKeywords, ...chunk.metadata.extractedKeywords],
                },
            };
        } else {
            result.push(pending);
            pending = chunk;
        }
    }

    if (pending) result.push(pending);
    return result;
}
