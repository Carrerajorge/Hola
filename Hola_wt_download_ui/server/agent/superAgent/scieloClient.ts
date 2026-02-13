/**
 * SciELO ArticleMeta API Client
 * 
 * Free API for searching Latin American and Spanish scientific literature.
 * All content is open access.
 * 
 * API Docs: https://articlemeta.scielo.org/
 */

export interface SciELOArticle {
    scielo_id: string;
    title: string;
    authors: string[];
    year: string;
    journal: string;
    abstract: string;
    keywords: string[];
    doi: string;
    volume?: string;
    issue?: string;
    pages?: string;
    language: string;
    collection: string;
    url: string;
}

export interface SciELOSearchResult {
    articles: SciELOArticle[];
    totalResults: number;
    query: string;
    searchTime: number;
}

// SciELO ArticleMeta API endpoints
const SCIELO_ARTICLEMETA = "https://articlemeta.scielo.org/api/v1";
const SCIELO_SEARCH = "https://search.scielo.org/api/v2/search";

// Rate limiting
const REQUEST_DELAY_MS = 300;

/**
 * Search SciELO for articles
 */
export async function searchSciELO(
    query: string,
    options: {
        maxResults?: number;
        startYear?: number;
        endYear?: number;
        collection?: string; // e.g., "scl" for Brazil, "spa" for Spain, "col" for Colombia
    } = {}
): Promise<SciELOSearchResult> {
    const { maxResults = 25, startYear, endYear, collection } = options;
    const startTime = Date.now();

    console.log(`[SciELO] Searching: "${query}"`);

    try {
        // Use the SciELO search API
        const params = new URLSearchParams({
            q: query,
            count: maxResults.toString(),
            from: "0",
            output: "json",
            lang: "es", // Spanish language results
            sort: "RELEVANCE",
        });

        // Add year filter
        if (startYear && endYear) {
            params.set("filter", `year_cluster:[${startYear} TO ${endYear}]`);
        }

        // Add collection filter
        if (collection) {
            params.set("in", collection);
        }

        const response = await fetch(`${SCIELO_SEARCH}?${params}`, {
            headers: {
                "Accept": "application/json",
            },
        });

        if (!response.ok) {
            // Fallback to ArticleMeta if search API fails
            console.log(`[SciELO] Search API returned ${response.status}, trying ArticleMeta...`);
            return searchSciELOArticleMeta(query, options);
        }

        const data = await response.json();

        const articles: SciELOArticle[] = [];
        const docs = data.documents || data.response?.docs || [];

        for (const doc of docs) {
            const article = parseSciELODocument(doc);
            if (article) {
                articles.push(article);
            }
        }

        const totalResults = data.total || data.response?.numFound || articles.length;

        console.log(`[SciELO] Found ${totalResults} results, returning ${articles.length}`);

        return {
            articles,
            totalResults,
            query,
            searchTime: Date.now() - startTime
        };

    } catch (error: any) {
        console.error(`[SciELO] Search error: ${error.message}`);
        // Try ArticleMeta as fallback
        return searchSciELOArticleMeta(query, options);
    }
}

/**
 * Alternative: Search using ArticleMeta API
 */
async function searchSciELOArticleMeta(
    query: string,
    options: {
        maxResults?: number;
        startYear?: number;
        endYear?: number;
        collection?: string;
    } = {}
): Promise<SciELOSearchResult> {
    const { maxResults = 25, collection = "scl" } = options;
    const startTime = Date.now();

    try {
        // ArticleMeta requires collection parameter
        const params = new URLSearchParams({
            collection: collection,
            limit: maxResults.toString(),
            offset: "0",
        });

        const response = await fetch(`${SCIELO_ARTICLEMETA}/article/?${params}`, {
            headers: {
                "Accept": "application/json",
            },
        });

        if (!response.ok) {
            console.error(`[SciELO ArticleMeta] Failed: ${response.status}`);
            return {
                articles: [],
                totalResults: 0,
                query,
                searchTime: Date.now() - startTime
            };
        }

        const data = await response.json();
        const articles: SciELOArticle[] = [];

        const objects = data.objects || [];
        for (const obj of objects) {
            // Filter by query terms
            const searchText = JSON.stringify(obj).toLowerCase();
            const queryTerms = query.toLowerCase().split(/\s+/);
            const matches = queryTerms.some(term => searchText.includes(term));

            if (matches) {
                const article = parseArticleMetaObject(obj);
                if (article) {
                    articles.push(article);
                }
            }
        }

        return {
            articles: articles.slice(0, maxResults),
            totalResults: data.meta?.total_count || articles.length,
            query,
            searchTime: Date.now() - startTime
        };

    } catch (error: any) {
        console.error(`[SciELO ArticleMeta] Error: ${error.message}`);
        return {
            articles: [],
            totalResults: 0,
            query,
            searchTime: Date.now() - startTime
        };
    }
}

function parseSciELODocument(doc: any): SciELOArticle | null {
    try {
        const pid = doc.id || doc.PID || doc.pid || "";
        const title = doc.title || doc.ti || (Array.isArray(doc.ti) ? doc.ti[0] : "") || "";
        const journal = doc.ta || doc.journal_title || "";
        const year = doc.py || doc.publication_year || doc.da?.substring(0, 4) || "";
        const abstractText = doc.ab || doc.abstract || (Array.isArray(doc.ab) ? doc.ab[0] : "") || "";

        // Authors
        let authors: string[] = [];
        if (doc.au) {
            authors = Array.isArray(doc.au) ? doc.au : [doc.au];
        }

        // Keywords
        let keywords: string[] = [];
        if (doc.kw) {
            keywords = Array.isArray(doc.kw) ? doc.kw : doc.kw.split(";").map((k: string) => k.trim());
        }

        const collection = doc.in || doc.collection || "";
        const doi = doc.doi || "";

        return {
            scielo_id: pid,
            title: typeof title === "string" ? title : String(title),
            authors,
            year: String(year),
            journal: typeof journal === "string" ? journal : String(journal),
            abstract: typeof abstractText === "string" ? abstractText : String(abstractText),
            keywords,
            doi,
            volume: doc.volume || "",
            issue: doc.issue || "",
            pages: doc.pages || "",
            language: doc.la || "es",
            collection,
            url: `https://www.scielo.br/scielo.php?pid=${pid}&script=sci_arttext`
        };
    } catch {
        return null;
    }
}

function parseArticleMetaObject(obj: any): SciELOArticle | null {
    try {
        const pid = obj.code || "";
        const titleData = obj.title || {};
        const title = titleData.es || titleData.en || titleData.pt || Object.values(titleData)[0] || "";

        const abstractData = obj.abstract || {};
        const abstractText = abstractData.es || abstractData.en || abstractData.pt || Object.values(abstractData)[0] || "";

        // Authors
        const authors: string[] = [];
        if (obj.authors) {
            for (const author of obj.authors) {
                const surname = author.surname || "";
                const givenNames = author.given_names || "";
                if (surname) {
                    authors.push(`${surname}, ${givenNames}`.trim());
                }
            }
        }

        return {
            scielo_id: pid,
            title: typeof title === "string" ? title : "",
            authors,
            year: obj.publication_year || "",
            journal: obj.journal?.title || obj.journal_title || "",
            abstract: typeof abstractText === "string" ? abstractText : "",
            keywords: obj.keywords?.es || obj.keywords?.en || [],
            doi: obj.doi || "",
            volume: obj.volume || "",
            issue: obj.issue || "",
            pages: obj.start_page ? `${obj.start_page}-${obj.end_page || ""}` : "",
            language: obj.original_language || "es",
            collection: obj.collection || "",
            url: `https://www.scielo.br/scielo.php?pid=${pid}&script=sci_arttext`
        };
    } catch {
        return null;
    }
}

/**
 * Generate APA 7th Edition citation for SciELO article
 */
export function generateSciELOAPA7Citation(article: SciELOArticle): string {
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

    let journalPart = `*${article.journal}*`;
    if (article.volume) {
        journalPart += `, *${article.volume}*`;
        if (article.issue) {
            journalPart += `(${article.issue})`;
        }
    }
    if (article.pages) {
        journalPart += `, ${article.pages}`;
    }

    let doiPart = "";
    if (article.doi) {
        doiPart = ` https://doi.org/${article.doi}`;
    } else if (article.url) {
        doiPart = ` ${article.url}`;
    }

    return `${authorsStr} ${year}. ${title} ${journalPart}.${doiPart}`.trim();
}

function formatAuthorAPA(author: string): string {
    const parts = author.split(",").map(p => p.trim());
    if (parts.length < 2) return author;

    const lastName = parts[0];
    const firstPart = parts[1];

    const initials = firstPart.split(/\s+/)
        .map(name => name.charAt(0).toUpperCase() + ".")
        .join(" ");

    return `${lastName}, ${initials}`;
}

export function isSciELOConfigured(): boolean {
    // SciELO APIs are free and don't require API key
    return true;
}
