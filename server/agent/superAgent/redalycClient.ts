/**
 * Redalyc API Client
 * 
 * Free API for searching Latin American open access scientific journals.
 * Requires registration for API token at https://www.redalyc.org/
 * 
 * API Docs: https://zenodo.org/record/7774744
 */

export interface RedalycArticle {
    redalyc_id: string;
    title: string;
    authors: string[];
    year: string;
    journal: string;
    abstract: string;
    keywords: string[];
    doi?: string;
    volume?: string;
    issue?: string;
    pages?: string;
    language: string;
    institution?: string;
    country?: string;
    url: string;
}

export interface RedalycSearchResult {
    articles: RedalycArticle[];
    totalResults: number;
    query: string;
    searchTime: number;
}

// Redalyc API endpoints
const REDALYC_API_BASE = "https://www.redalyc.org/api/search/";
const REDALYC_OAI = "https://www.redalyc.org/exportarcita";

// Rate limiting
const REQUEST_DELAY_MS = 400;

/**
 * Search Redalyc for articles
 * Note: Requires REDALYC_API_TOKEN for full API access
 * Falls back to OAI-PMH/scraping if no token
 */
export async function searchRedalyc(
    query: string,
    options: {
        maxResults?: number;
        startYear?: number;
        endYear?: number;
        country?: string;
    } = {}
): Promise<RedalycSearchResult> {
    const { maxResults = 25, startYear, endYear, country } = options;
    const startTime = Date.now();

    console.log(`[Redalyc] Searching: "${query}"`);

    const token = process.env.REDALYC_API_TOKEN;

    if (token) {
        return searchRedalycWithToken(query, token, options);
    }

    // Fallback: Use web search interface
    return searchRedalycWeb(query, options);
}

/**
 * Search with official API token
 */
async function searchRedalycWithToken(
    query: string,
    token: string,
    options: {
        maxResults?: number;
        startYear?: number;
        endYear?: number;
        country?: string;
    } = {}
): Promise<RedalycSearchResult> {
    const { maxResults = 25, startYear, endYear, country } = options;
    const startTime = Date.now();

    try {
        const params = new URLSearchParams({
            q: query,
            rows: maxResults.toString(),
            format: "json",
        });

        if (startYear && endYear) {
            params.set("filter", `year:[${startYear} TO ${endYear}]`);
        }

        if (country) {
            params.set("country", country);
        }

        const response = await fetch(`${REDALYC_API_BASE}?${params}`, {
            headers: {
                "Authorization": `Bearer ${token}`,
                "Accept": "application/json",
            },
        });

        if (!response.ok) {
            console.error(`[Redalyc] API error: ${response.status}`);
            return searchRedalycWeb(query, { maxResults, startYear, endYear });
        }

        const data = await response.json();
        const articles: RedalycArticle[] = [];

        const docs = data.response?.docs || data.articles || [];

        for (const doc of docs) {
            const article: RedalycArticle = {
                redalyc_id: doc.id || doc.redalyc_id || "",
                title: doc.title || doc.titulo || "",
                authors: parseAuthors(doc.authors || doc.autores),
                year: String(doc.year || doc.anio || ""),
                journal: doc.journal || doc.revista || "",
                abstract: doc.abstract || doc.resumen || "",
                keywords: doc.keywords || doc.palabras_clave || [],
                doi: doc.doi || "",
                volume: String(doc.volume || doc.volumen || ""),
                issue: String(doc.issue || doc.numero || ""),
                pages: doc.pages || doc.paginas || "",
                language: doc.language || doc.idioma || "es",
                institution: doc.institution || doc.institucion || "",
                country: doc.country || doc.pais || "",
                url: doc.url || `https://www.redalyc.org/articulo.oa?id=${doc.id || doc.redalyc_id}`
            };

            articles.push(article);
        }

        return {
            articles,
            totalResults: data.response?.numFound || articles.length,
            query,
            searchTime: Date.now() - startTime
        };

    } catch (error: any) {
        console.error(`[Redalyc] Search error: ${error.message}`);
        return {
            articles: [],
            totalResults: 0,
            query,
            searchTime: Date.now() - startTime
        };
    }
}

/**
 * Fallback: Search via web interface
 */
async function searchRedalycWeb(
    query: string,
    options: {
        maxResults?: number;
        startYear?: number;
        endYear?: number;
    } = {}
): Promise<RedalycSearchResult> {
    const { maxResults = 25 } = options;
    const startTime = Date.now();

    console.log(`[Redalyc] Using web search fallback for: "${query}"`);

    try {
        // Use Redalyc's search page
        const searchUrl = `https://www.redalyc.org/busquedaWeb.oa?q=${encodeURIComponent(query)}&c=1`;

        const response = await fetch(searchUrl, {
            headers: {
                "Accept": "text/html,application/xhtml+xml",
                "User-Agent": "Mozilla/5.0 (compatible; ResearchBot/1.0)",
            },
        });

        if (!response.ok) {
            console.error(`[Redalyc] Web search failed: ${response.status}`);
            return {
                articles: [],
                totalResults: 0,
                query,
                searchTime: Date.now() - startTime
            };
        }

        const html = await response.text();
        const articles = parseRedalycHTML(html, maxResults);

        console.log(`[Redalyc] Parsed ${articles.length} articles from web`);

        return {
            articles,
            totalResults: articles.length,
            query,
            searchTime: Date.now() - startTime
        };

    } catch (error: any) {
        console.error(`[Redalyc] Web search error: ${error.message}`);
        return {
            articles: [],
            totalResults: 0,
            query,
            searchTime: Date.now() - startTime
        };
    }
}

function parseRedalycHTML(html: string, maxResults: number): RedalycArticle[] {
    const articles: RedalycArticle[] = [];

    // Extract article links and data from HTML
    // This is a simplified parser - adjust based on actual HTML structure
    const articleMatches = html.match(/<div class="[^"]*article[^"]*"[\s\S]*?<\/div>/gi) || [];

    for (const match of articleMatches.slice(0, maxResults)) {
        const titleMatch = match.match(/<a[^>]*>([^<]+)<\/a>/i);
        const idMatch = match.match(/id=(\d+)/);

        if (titleMatch && idMatch) {
            articles.push({
                redalyc_id: idMatch[1],
                title: titleMatch[1].trim(),
                authors: [],
                year: "",
                journal: "",
                abstract: "",
                keywords: [],
                language: "es",
                url: `https://www.redalyc.org/articulo.oa?id=${idMatch[1]}`
            });
        }
    }

    return articles;
}

function parseAuthors(authors: any): string[] {
    if (!authors) return [];
    if (Array.isArray(authors)) {
        return authors.map(a => typeof a === "string" ? a : a.name || a.nombre || "");
    }
    if (typeof authors === "string") {
        return authors.split(/[;,]/).map(a => a.trim()).filter(Boolean);
    }
    return [];
}

/**
 * Generate APA 7th Edition citation for Redalyc article
 */
export function generateRedalycAPA7Citation(article: RedalycArticle): string {
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

    let urlPart = "";
    if (article.doi) {
        urlPart = ` https://doi.org/${article.doi}`;
    } else if (article.url) {
        urlPart = ` ${article.url}`;
    }

    return `${authorsStr} ${year}. ${title} ${journalPart}.${urlPart}`.trim();
}

function formatAuthorAPA(author: string): string {
    // Handle "FirstName LastName" format
    const parts = author.split(/\s+/);
    if (parts.length >= 2) {
        const lastName = parts[parts.length - 1];
        const initials = parts.slice(0, -1).map(n => n.charAt(0).toUpperCase() + ".").join(" ");
        return `${lastName}, ${initials}`;
    }
    return author;
}

export function isRedalycConfigured(): boolean {
    // Works without token but with limited functionality
    return true;
}
