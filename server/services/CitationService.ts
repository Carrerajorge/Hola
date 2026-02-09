import { Logger } from "../lib/logger";

interface SourceMetadata {
    title?: string;
    author?: string;
    year?: string | number;
    url?: string;
    publisher?: string;
    pageNumber?: string | number;
    [key: string]: any;
}

interface Source {
    id: string;
    metadata: SourceMetadata;
}

export class CitationService {
    private static logger = Logger;

    /**
     * Formats a single source citation in APA 7th style (in-text or reference list entry)
     * This logic focuses on the reference list format.
     */
    static formatCitation(source: Source): string {
        const { title, author, year, url, publisher } = source.metadata;

        const authorText = author ? `${author}.` : "Unknown Author.";
        const yearText = year ? `(${year}).` : "(n.d.).";
        const titleText = title ? `*${title}*.` : "Untitled.";
        const publisherText = publisher ? `${publisher}.` : "";
        const urlText = url ? url : "";

        // Join with spaces, ensuring no double spaces if parts are missing
        let citation = [authorText, yearText, titleText, publisherText, urlText]
            .filter(part => part && part.trim() !== "")
            .join(" ");

        return citation;
    }

    /**
     * Generates a bibliography for a list of sources.
     */
    static formatBibliography(sources: Source[]): string {
        if (!sources || sources.length === 0) return "";

        const uniqueSources = new Map<string, Source>();
        sources.forEach(s => {
            // Deduplicate by URL or Title if ID is missing or duplicated
            const key = s.metadata.url || s.metadata.title || s.id;
            if (!uniqueSources.has(key)) {
                uniqueSources.set(key, s);
            }
        });

        return Array.from(uniqueSources.values())
            .map(s => this.formatCitation(s))
            .sort() // Alphabetical order
            .join("\n\n");
    }

    /**
     * Helper to extract valid year from various string formats
     */
    static normalizeYear(dateStr: string): string | undefined {
        if (!dateStr) return undefined;
        const match = dateStr.match(/\b(19|20)\d{2}\b/);
        return match ? match[0] : undefined;
    }
}
