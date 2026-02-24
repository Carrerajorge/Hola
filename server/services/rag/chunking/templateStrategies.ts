/**
 * Template Strategies — document-type-specific chunking strategies
 *
 * Maps each DocumentType to a named chunking strategy that determines
 * how the hierarchical chunker splits sections.
 */

import type { DocumentType } from "../deepParsing/types";

export interface ChunkStrategy {
    name: string;
    description: string;
}

const STRATEGIES: Record<DocumentType, ChunkStrategy> = {
    paper: { name: "academic-sections", description: "Each named section (Abstract, Methods, etc.) is a chunk" },
    legal: { name: "article-clause", description: "Each article/clause is a chunk" },
    manual: { name: "step-procedure", description: "Each step/procedure is a chunk" },
    table: { name: "table-context", description: "Each table + surrounding context is a chunk" },
    generic: { name: "size-based", description: "Size-based chunking with sentence overlap" },
};

export function getChunkStrategy(documentType: DocumentType): ChunkStrategy {
    return STRATEGIES[documentType] || STRATEGIES.generic;
}
