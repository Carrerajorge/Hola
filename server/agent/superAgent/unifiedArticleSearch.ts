/**
 * Unified Scientific Article Search
 * 
 * Combines Scopus, PubMed, SciELO, and Redalyc for comprehensive
 * scientific literature search with APA 7th Edition citation generation.
 */

import { searchScopus, ScopusArticle, isScopusConfigured } from "./scopusClient";
import { searchPubMed, PubMedArticle, generatePubMedAPA7Citation, isPubMedConfigured } from "./pubmedClient";
import { searchSciELO, SciELOArticle, generateSciELOAPA7Citation, isSciELOConfigured } from "./scieloClient";
import { searchRedalyc, RedalycArticle, generateRedalycAPA7Citation, isRedalycConfigured } from "./redalycClient";
import { searchOpenAlex, type AcademicCandidate } from "./openAlexClient";
import * as XLSX from "xlsx";

// =============================================================================
// Types
// =============================================================================

export interface UnifiedArticle {
    id: string;
    source: "scopus" | "openalex" | "pubmed" | "scielo" | "redalyc";
    title: string;
    authors: string[];
    year: string;
    journal: string;
    abstract: string;
    keywords: string[];
    doi?: string;
    url: string;
    volume?: string;
    issue?: string;
    pages?: string;
    language: string;
    documentType?: string;
    city?: string;
    country?: string;
    citationCount?: number;
    apaCitation: string;
}

export interface UnifiedSearchResult {
    articles: UnifiedArticle[];
    totalBySource: {
        scopus: number;
        openalex: number;
        pubmed: number;
        scielo: number;
        redalyc: number;
    };
    query: string;
    searchTime: number;
    errors: string[];
}

export interface SearchOptions {
    maxResults?: number;
    maxPerSource?: number;
    startYear?: number;
    endYear?: number;
    sources?: ("scopus" | "openalex" | "pubmed" | "scielo" | "redalyc")[];
    language?: string;
    // Scopus-only: filter by affiliation country (e.g. ["Spain","Mexico"]).
    // Note: SciELO/Redalyc are already LatAm-focused; PubMed doesn't reliably expose affiliation country at search time.
    affilCountries?: string[];
}

// =============================================================================
// Helper Functions
// =============================================================================

function normalizeTitle(title: string): string {
    return title
        .toLowerCase()
        .replace(/[^\w\s]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 100);
}

// =============================================================================
// Main Search Function
// =============================================================================

/**
 * Search all configured sources for scientific articles
 */
export async function searchAllSources(
    query: string,
    options: SearchOptions = {}
): Promise<UnifiedSearchResult> {
    const {
        maxResults = 100,
        maxPerSource = 30,
        startYear,
        endYear,
        sources = ["scopus", "pubmed", "scielo", "redalyc"],
        language,
        affilCountries
    } = options;

    const startTime = Date.now();
    const errors: string[] = [];

    // Use the query as provided (the caller should handle translation if needed)
    // For Scopus/PubMed we prefer English, for SciELO/Redalyc we prefer Spanish/Portuguese
    const englishQuery = query; // Assuming caller passed English or mixed
    const spanishQuery = query; // Assuming caller passed Spanish or mixed

    console.log(`[UnifiedSearch] Starting search for: "${query}"`);

    const results: {
        scopus: UnifiedArticle[];
        openalex: UnifiedArticle[];
        pubmed: UnifiedArticle[];
        scielo: UnifiedArticle[];
        redalyc: UnifiedArticle[];
    } = {
        scopus: [],
        openalex: [],
        pubmed: [],
        scielo: [],
        redalyc: []
    };

    // Run searches in parallel
    const searchPromises: Promise<void>[] = [];

    // Scopus (requires API key)
    if (sources.includes("scopus") && isScopusConfigured()) {
        searchPromises.push(
            (async () => {
                try {
                    const scopusResult = await searchScopus(englishQuery, {
                        maxResults: maxPerSource,
                        startYear,
                        endYear,
                        affilCountries
                    });
                    results.scopus = scopusResult.articles.map(a => convertScopusToUnified(a));
                    console.log(`[UnifiedSearch] Scopus: ${results.scopus.length} articles`);
                } catch (error: any) {
                    errors.push(`Scopus: ${error.message}`);
                    console.error(`[UnifiedSearch] Scopus error: ${error.message}`);
                }
            })()
        );
    }

    // OpenAlex (free)
    if (sources.includes("openalex")) {
        searchPromises.push(
            (async () => {
                try {
                    const openAlexCandidates = await searchOpenAlex(englishQuery, {
                        maxResults: Math.min(200, maxPerSource),
                        yearStart: startYear,
                        yearEnd: endYear,
                    });
                    results.openalex = openAlexCandidates.map(c => convertOpenAlexToUnified(c));
                    console.log(`[UnifiedSearch] OpenAlex: ${results.openalex.length} articles`);
                } catch (error: any) {
                    errors.push(`OpenAlex: ${error.message}`);
                    console.error(`[UnifiedSearch] OpenAlex error: ${error.message}`);
                }
            })()
        );
    }

    // PubMed (free) - Run last or parallel but with ability to fill gaps
    if (sources.includes("pubmed") && isPubMedConfigured()) {
        searchPromises.push(
            (async () => {
                try {
                    // If we need 100 total, and mostly rely on PubMed, ask for more
                    const pubmedMax = Math.max(maxPerSource, maxResults - results.scopus.length - results.scielo.length - results.redalyc.length + 20);

                    const pubmedResult = await searchPubMed(englishQuery, {
                        maxResults: pubmedMax,
                        startYear,
                        endYear
                    });
                    results.pubmed = pubmedResult.articles.map(a => convertPubMedToUnified(a));
                    console.log(`[UnifiedSearch] PubMed: ${results.pubmed.length} articles`);
                } catch (error: any) {
                    errors.push(`PubMed: ${error.message}`);
                    console.error(`[UnifiedSearch] PubMed error: ${error.message}`);
                }
            })()
        );
    }

    // SciELO (free - Spanish/Portuguese)
    if (sources.includes("scielo") && isSciELOConfigured()) {
        searchPromises.push(
            (async () => {
                try {
                    const scieloResult = await searchSciELO(spanishQuery, {
                        maxResults: maxPerSource,
                        startYear,
                        endYear
                    });
                    results.scielo = scieloResult.articles.map(a => convertSciELOToUnified(a));
                    console.log(`[UnifiedSearch] SciELO: ${results.scielo.length} articles`);
                } catch (error: any) {
                    errors.push(`SciELO: ${error.message}`);
                    console.error(`[UnifiedSearch] SciELO error: ${error.message}`);
                }
            })()
        );
    }

    // Redalyc (free - Spanish)
    if (sources.includes("redalyc") && isRedalycConfigured()) {
        searchPromises.push(
            (async () => {
                try {
                    const redalycResult = await searchRedalyc(spanishQuery, {
                        maxResults: maxPerSource,
                        startYear,
                        endYear
                    });
                    results.redalyc = redalycResult.articles.map(a => convertRedalycToUnified(a));
                    console.log(`[UnifiedSearch] Redalyc: ${results.redalyc.length} articles`);
                } catch (error: any) {
                    errors.push(`Redalyc: ${error.message}`);
                    console.error(`[UnifiedSearch] Redalyc error: ${error.message}`);
                }
            })()
        );
    }

    await Promise.all(searchPromises);

    // Combine and deduplicate by DOI/title
    const allArticles = [
        ...results.scopus,
        ...results.openalex,
        ...results.pubmed,
        ...results.scielo,
        ...results.redalyc
    ];

    const deduplicated = deduplicateArticles(allArticles);
    const finalArticles = deduplicated.slice(0, maxResults);

    console.log(`[UnifiedSearch] Total: ${allArticles.length}, Deduplicated: ${deduplicated.length}, Returning: ${finalArticles.length}`);

    return {
        articles: finalArticles,
        totalBySource: {
            scopus: results.scopus.length,
            openalex: results.openalex.length,
            pubmed: results.pubmed.length,
            scielo: results.scielo.length,
            redalyc: results.redalyc.length
        },
        query,
        searchTime: Date.now() - startTime,
        errors
    };
}

// =============================================================================
// Converters
// =============================================================================

function convertScopusToUnified(article: ScopusArticle): UnifiedArticle {
    return {
        id: `scopus_${article.scopusId || article.eid}`,
        source: "scopus",
        title: article.title,
        authors: article.authors,
        year: article.year,
        journal: article.journal,
        abstract: article.abstract,
        keywords: article.keywords,
        doi: article.doi,
        url: article.url,
        language: article.language,
        documentType: article.subtypeDescription || "Article",
        country: article.affiliationCountry, // Scopus provides this
        city: article.affiliationCity,       // Scopus provides this
        citationCount: article.citationCount,
        apaCitation: generateScopusAPA7Citation(article)
    };
}

function convertPubMedToUnified(article: PubMedArticle): UnifiedArticle {
    return {
        id: `pubmed_${article.pmid}`,
        source: "pubmed",
        title: article.title,
        authors: article.authors,
        year: article.year,
        journal: article.journal,
        abstract: article.abstract,
        keywords: article.keywords,
        doi: article.doi,
        url: article.url,
        volume: article.volume,
        pages: article.pages,
        language: article.language,
        documentType: "Article", // Default for PubMed
        country: "n.d.",        // Hard to extract from summary
        city: "n.d.",
        apaCitation: generatePubMedAPA7Citation(article)
    };
}

function convertOpenAlexToUnified(candidate: AcademicCandidate): UnifiedArticle {
    const year = candidate.year && candidate.year > 0 ? String(candidate.year) : "n.d.";
    const doi = (candidate.doi || "").trim();

    return {
        id: `openalex_${candidate.sourceId}`,
        source: "openalex",
        title: candidate.title || "n.d.",
        authors: candidate.authors || [],
        year,
        journal: candidate.journal || "n.d.",
        abstract: candidate.abstract || "",
        keywords: candidate.keywords || [],
        doi: doi || undefined,
        url: candidate.doiUrl || candidate.landingUrl || "",
        language: candidate.language || "en",
        documentType: candidate.documentType || "Article",
        country: candidate.country || "Unknown",
        city: candidate.city || "Unknown",
        citationCount: candidate.citationCount || 0,
        apaCitation: generateOpenAlexAPA7Citation(candidate),
    };
}

function convertSciELOToUnified(article: SciELOArticle): UnifiedArticle {
    const country = scieloCollectionToCountry(article.collection);
    return {
        id: `scielo_${article.scielo_id}`,
        source: "scielo",
        title: article.title,
        authors: article.authors,
        year: article.year,
        journal: article.journal,
        abstract: article.abstract,
        keywords: article.keywords,
        doi: article.doi,
        url: article.url,
        volume: article.volume,
        pages: article.pages,
        language: article.language,
        documentType: "Article",
        country, // Derived from SciELO collection when possible
        city: "n.d.",
        apaCitation: generateSciELOAPA7Citation(article)
    };
}

function convertRedalycToUnified(article: RedalycArticle): UnifiedArticle {
    return {
        id: `redalyc_${article.redalyc_id}`,
        source: "redalyc",
        title: article.title,
        authors: article.authors,
        year: article.year,
        journal: article.journal,
        abstract: article.abstract,
        keywords: article.keywords,
        doi: article.doi,
        url: article.url,
        volume: article.volume,
        pages: article.pages,
        language: article.language,
        documentType: "Article",
        country: "LatAm", // Redalyc is LatAm focused
        city: "n.d.",
        apaCitation: generateRedalycAPA7Citation(article)
    };
}

function generateScopusAPA7Citation(article: ScopusArticle): string {
    // Authors
    let authorsStr = "";
    if (article.authors.length === 0) {
        authorsStr = "";
    } else if (article.authors.length === 1) {
        authorsStr = formatAuthorAPA(article.authors[0]);
    } else if (article.authors.length === 2) {
        authorsStr = `${formatAuthorAPA(article.authors[0])} & ${formatAuthorAPA(article.authors[1])}`;
    } else if (article.authors.length <= 20) {
        const allAuthors = article.authors.map(formatAuthorAPA);
        authorsStr = allAuthors.slice(0, -1).join(", ") + ", & " + allAuthors[allAuthors.length - 1];
    } else {
        const first19 = article.authors.slice(0, 19).map(formatAuthorAPA);
        authorsStr = first19.join(", ") + ", ... " + formatAuthorAPA(article.authors[article.authors.length - 1]);
    }

    const year = article.year ? `(${article.year})` : "(n.d.)";
    const title = article.title.endsWith(".") ? article.title : article.title + ".";
    const journalPart = `*${article.journal}*`;

    let doiPart = "";
    if (article.doi) {
        doiPart = ` https://doi.org/${article.doi}`;
    }

    return `${authorsStr} ${year}. ${title} ${journalPart}.${doiPart}`.trim();
}

function generateOpenAlexAPA7Citation(candidate: AcademicCandidate): string {
    const authors = (candidate.authors || []).filter(Boolean);

    let authorsStr = "";
    if (authors.length === 0) {
        authorsStr = "";
    } else if (authors.length === 1) {
        authorsStr = formatAuthorAPA(authors[0]);
    } else if (authors.length === 2) {
        authorsStr = `${formatAuthorAPA(authors[0])} & ${formatAuthorAPA(authors[1])}`;
    } else if (authors.length <= 20) {
        const allAuthors = authors.map(formatAuthorAPA);
        authorsStr = allAuthors.slice(0, -1).join(", ") + ", & " + allAuthors[allAuthors.length - 1];
    } else {
        const first19 = authors.slice(0, 19).map(formatAuthorAPA);
        authorsStr = first19.join(", ") + ", ... " + formatAuthorAPA(authors[authors.length - 1]);
    }

    const year = candidate.year ? `(${candidate.year})` : "(n.d.)";
    const title = candidate.title?.endsWith(".") ? candidate.title : `${candidate.title}.`;
    const journalPart = candidate.journal ? `*${candidate.journal}*` : "";

    const doi = (candidate.doi || "").trim();
    const doiPart = doi ? ` https://doi.org/${doi}` : "";

    return `${authorsStr} ${year}. ${title} ${journalPart}.${doiPart}`.trim();
}

function formatAuthorAPA(author: string): string {
    const parts = author.split(",").map(p => p.trim());
    if (parts.length >= 2) {
        const lastName = parts[0];
        const firstPart = parts[1];
        const initials = firstPart.split(/\s+/)
            .map(name => name.charAt(0).toUpperCase() + ".")
            .join(" ");
        return `${lastName}, ${initials}`;
    }

    // Handle "FirstName LastName" format
    const spaceParts = author.split(/\s+/);
    if (spaceParts.length >= 2) {
        const lastName = spaceParts[spaceParts.length - 1];
        const initials = spaceParts.slice(0, -1).map(n => n.charAt(0).toUpperCase() + ".").join(" ");
        return `${lastName}, ${initials}`;
    }

    return author;
}

// =============================================================================
// Deduplication
// =============================================================================

function deduplicateArticles(articles: UnifiedArticle[]): UnifiedArticle[] {
    const seen = new Map<string, UnifiedArticle>();

    for (const article of articles) {
        // Create dedup key based on DOI or normalized title
        const doiKey = article.doi ? `doi:${article.doi.toLowerCase()}` : null;
        const titleKey = `title:${normalizeTitle(article.title)}`;

        const key = doiKey || titleKey;

        if (!seen.has(key)) {
            seen.set(key, article);
        } else {
            // Keep the one with more info (longer abstract, more citations)
            const existing = seen.get(key)!;
            if (article.abstract.length > existing.abstract.length ||
                (article.citationCount || 0) > (existing.citationCount || 0)) {
                seen.set(key, article);
            }
        }
    }

    return Array.from(seen.values());
}



// =============================================================================
// Word Document Generation
// =============================================================================

/**
 * Generate APA citations list as text (for Word export)
 */
export function generateAPACitationsList(articles: UnifiedArticle[]): string {
    const lines: string[] = [
        "Referencias Bibliográficas (APA 7ma Edición)",
        "",
        `Total de artículos: ${articles.length}`,
        ""
    ];

    // Group by source
    const bySource: Record<string, UnifiedArticle[]> = {
        scopus: [],
        openalex: [],
        pubmed: [],
        scielo: [],
        redalyc: []
    };

    for (const article of articles) {
        bySource[article.source].push(article);
    }

    // Sort all articles alphabetically by first author
    const sortedArticles = [...articles].sort((a, b) => {
        const authorA = a.authors[0] || "";
        const authorB = b.authors[0] || "";
        return authorA.localeCompare(authorB);
    });

    lines.push("================================================================================");
    lines.push("");

    for (let i = 0; i < sortedArticles.length; i++) {
        const article = sortedArticles[i];
        lines.push(`${i + 1}. [${article.source.toUpperCase()}]`);
        lines.push(article.apaCitation);
        lines.push("");
    }

    lines.push("================================================================================");
    lines.push("");
    lines.push("Distribución por fuente:");
    lines.push(`  - Scopus: ${bySource.scopus.length} artículos`);
    lines.push(`  - OpenAlex: ${bySource.openalex.length} artículos`);
    lines.push(`  - PubMed: ${bySource.pubmed.length} artículos`);
    lines.push(`  - SciELO: ${bySource.scielo.length} artículos`);
    lines.push(`  - Redalyc: ${bySource.redalyc.length} artículos`);

    return lines.join("\n");
}

/**
 * Generate Excel report buffer
 */
export function generateExcelReport(articles: UnifiedArticle[]): Buffer {
    // Columns: Authors Title Year Journal Abstract Keywords Language Document Type DOI City of publication Country of study Scopus
    const sorted = [...articles].sort((a, b) => {
        const aKey = (a.authors[0] || "").toLowerCase();
        const bKey = (b.authors[0] || "").toLowerCase();
        if (aKey !== bKey) return aKey.localeCompare(bKey);
        const at = (a.title || "").toLowerCase();
        const bt = (b.title || "").toLowerCase();
        if (at !== bt) return at.localeCompare(bt);
        return (b.year || "").localeCompare(a.year || "");
    });

    const headers = [
        "Authors",
        "Title",
        "Year",
        "Journal",
        "Abstract",
        "Keywords",
        "Language",
        "Document Type",
        "DOI",
        "City of publication",
        "Country of study",
        "Scopus",
    ];

    const rows = [
        headers,
        ...sorted.map(a => ([
            a.authors?.join(", ") || "n.d.",
            a.title || "n.d.",
            a.year || "n.d.",
            a.journal || "n.d.",
            a.abstract || "n.d.",
            (a.keywords || []).join(", ") || "n.d.",
            normalizeLanguageLabel(a.language) || "n.d.",
            a.documentType || "Article",
            a.doi || "",
            a.city || "n.d.",
            a.country || "n.d.",
            a.source === "scopus" ? "Yes" : "No",
        ])),
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Articles");

    return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

function scieloCollectionToCountry(collection: string): string {
    const c = (collection || "").trim().toLowerCase();
    if (!c) return "n.d.";

    const map: Record<string, string> = {
        // Common SciELO collections (3-letter codes in `in` / `collection`)
        // NOTE: Some deployments use `scl` for Brazil.
        arg: "Argentina",
        bol: "Bolivia",
        bra: "Brazil",
        chl: "Chile",
        col: "Colombia",
        cri: "Costa Rica",
        cub: "Cuba",
        ecu: "Ecuador",
        mex: "Mexico",
        nic: "Nicaragua",
        pan: "Panama",
        per: "Peru",
        pry: "Paraguay",
        ury: "Uruguay",
        ven: "Venezuela",
        spa: "Spain",
        esp: "Spain",
        prt: "Portugal",
        scl: "Brazil",
        // Non-LatAm (still present in SciELO network)
        zaf: "South Africa",
        sza: "South Africa",
    };

    return map[c] || "LatAm";
}

function normalizeLanguageLabel(lang: string | undefined): string | undefined {
    const l = (lang || "").trim();
    if (!l) return undefined;
    const lower = l.toLowerCase();

    const map: Record<string, string> = {
        es: "Spanish",
        spa: "Spanish",
        spanish: "Spanish",
        español: "Spanish",
        espanol: "Spanish",
        pt: "Portuguese",
        por: "Portuguese",
        portuguese: "Portuguese",
        português: "Portuguese",
        portugues: "Portuguese",
        en: "English",
        eng: "English",
        english: "English",
        fr: "French",
        fra: "French",
        french: "French",
    };

    return map[lower] || l;
}

// =============================================================================
// Export
// =============================================================================

export const unifiedArticleSearch = {
    searchAllSources,
    generateAPACitationsList,
    generateExcelReport,
    isScopusConfigured,
    isOpenAlexConfigured: () => true,
    isPubMedConfigured,
    isSciELOConfigured,
    isRedalycConfigured
};

export default unifiedArticleSearch;
