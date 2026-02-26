/**
 * Hierarchical Chunker — inspired by RAGFlow
 *
 * Walks the section tree produced by deep parsing, applies document-type-
 * specific strategies, enriches metadata with header-chain breadcrumbs,
 * merges tiny chunks, and extracts per-chunk keywords.
 */

import type { ParsedStructure, Section, ExtractedTable } from "../deepParsing/types";
import type { EnhancedChunk } from "./types";
import { getChunkStrategy } from "./templateStrategies";
import { mergeSmallChunks } from "./chunkMerger";

export interface HierarchicalChunkOptions {
    minChunkSize?: number;
    maxChunkSize?: number;
}

export function hierarchicalChunk(
    structure: ParsedStructure,
    options: HierarchicalChunkOptions = {},
): EnhancedChunk[] {
    const { minChunkSize = 100, maxChunkSize = 2000 } = options;
    const strategy = getChunkStrategy(structure.metadata.documentType);

    const rawChunks: EnhancedChunk[] = [];

    // Walk the section tree depth-first
    walkSections(structure.sections, [], rawChunks, structure, strategy.name);

    // Add table chunks
    for (const table of structure.tables) {
        const tableContent = formatTableAsText(table);
        rawChunks.push({
            content: tableContent,
            metadata: {
                headerChain: [],
                pageNumber: table.pageNumber,
                documentType: structure.metadata.documentType,
                chunkStrategy: strategy.name,
                sectionType: "table",
                documentPosition: 0,
                extractedKeywords: table.headers.slice(0, 5),
            },
        });
    }

    // Normalize document positions
    for (let i = 0; i < rawChunks.length; i++) {
        rawChunks[i].metadata.documentPosition = rawChunks.length > 1 ? i / (rawChunks.length - 1) : 0;
    }

    // Merge small chunks
    const merged = mergeSmallChunks(rawChunks, minChunkSize);

    // Extract keywords per chunk
    for (const chunk of merged) {
        chunk.metadata.extractedKeywords = extractKeywords(chunk.content);
    }

    return merged;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function walkSections(
    sections: Section[],
    parentChain: string[],
    chunks: EnhancedChunk[],
    structure: ParsedStructure,
    strategyName: string,
): void {
    for (const section of sections) {
        const chain = section.title ? [...parentChain, section.title] : parentChain;

        // If section has content, create a chunk
        if (section.content && section.content.trim().length > 0) {
            chunks.push({
                content: section.content.trim(),
                metadata: {
                    headerChain: chain,
                    pageNumber: section.pageNumber,
                    documentType: structure.metadata.documentType,
                    chunkStrategy: strategyName,
                    sectionType: section.type,
                    documentPosition: 0, // will be normalized later
                    extractedKeywords: [],
                },
            });
        }

        // Recurse into children
        if (section.children.length > 0) {
            walkSections(section.children, chain, chunks, structure, strategyName);
        }
    }
}

function formatTableAsText(table: ExtractedTable): string {
    const headerLine = table.headers.join(" | ");
    const rowLines = table.rows.map(r => r.join(" | "));
    return `${table.naturalLanguageDescription}\n\n${headerLine}\n${rowLines.join("\n")}`;
}

function extractKeywords(text: string, topN = 5): string[] {
    const words = text
        .toLowerCase()
        .replace(/[^\w\sáéíóúñü]/g, "")
        .split(/\s+/)
        .filter(w => w.length > 3);

    const freq = new Map<string, number>();
    for (const w of words) {
        freq.set(w, (freq.get(w) || 0) + 1);
    }

    return [...freq.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN)
        .map(([word]) => word);
}
