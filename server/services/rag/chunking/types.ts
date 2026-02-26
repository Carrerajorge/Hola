/**
 * Hierarchical Chunking Types
 *
 * Separated into their own file to avoid circular imports between
 * index.ts (which re-exports chunkMerger) and chunkMerger.ts
 * (which needs EnhancedChunk).
 */

import type { DocumentType } from "../deepParsing/types";

export interface ChunkMetadata {
    headerChain: string[];
    pageNumber: number;
    documentType: DocumentType;
    chunkStrategy: string;
    sectionType: string;
    documentPosition: number; // 0-1 normalized position in document
    extractedKeywords: string[];
}

export interface EnhancedChunk {
    content: string;
    metadata: ChunkMetadata;
}
