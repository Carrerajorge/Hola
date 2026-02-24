/**
 * Hierarchical Chunking — public API
 *
 * Re-exports the main chunking function, types, strategies, and merger
 * so consumers only need to import from this barrel module.
 */

export type { EnhancedChunk, ChunkMetadata } from "./types";
export { hierarchicalChunk } from "./hierarchicalChunker";
export type { HierarchicalChunkOptions } from "./hierarchicalChunker";
export { mergeSmallChunks } from "./chunkMerger";
export { getChunkStrategy } from "./templateStrategies";
export type { ChunkStrategy } from "./templateStrategies";
