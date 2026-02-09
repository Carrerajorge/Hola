/**
 * PubMed/NCBI E-utilities Client
 * 
 * Free API for searching biomedical literature.
 * Uses E-utilities: ESearch and EFetch
 * 
 * API Docs: https://www.ncbi.nlm.nih.gov/books/NBK25500/
 */

export interface PubMedArticle {
    pmid: string;
    title: string;
    authors: string[];
    year: string;
    journal: string;
    abstract: string;
    keywords: string[];
    doi: string;
    pmcid?: string;
    volume?: string;
    issue?: string;
    pages?: string;
    language: string;
    url: string;
}

export interface PubMedSearchResult {
    articles: PubMedArticle[];
    totalResults: number;
    query: string;
    searchTime: number;
}

const PUBMED_ESEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const PUBMED_EFETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";

// Rate limiting: NCBI requires email and allows 3 requests/second without API key
// With API key: 10 requests/second
const REQUEST_DELAY_MS = 350;

/**
 * Search PubMed for articles
 */
export async function searchPubMed(
    query: string,
    options: {
        maxResults?: number;
        startYear?: number;
        endYear?: number;
    } = {}
): Promise<PubMedSearchResult> {
    const { maxResults = 25, startYear, endYear } = options;
    const startTime = Date.now();

    // Build search query with date filters
    let searchQuery = query;
    if (startYear && endYear) {
        searchQuery += ` AND ${startYear}:${endYear}[dp]`;
    }

    console.log(`[PubMed] Searching: "${searchQuery}"`);

    try {
        // Step 1: ESearch to get PMIDs
        const searchParams = new URLSearchParams({
            db: "pubmed",
            term: searchQuery,
            retmax: maxResults.toString(),
            retmode: "json",
            sort: "relevance",
            email: process.env.PUBMED_EMAIL || "user@example.com",
        });

        if (process.env.PUBMED_API_KEY) {
            searchParams.set("api_key", process.env.PUBMED_API_KEY);
        }

        const searchResponse = await fetch(`${PUBMED_ESEARCH}?${searchParams}`);

        if (!searchResponse.ok) {
            throw new Error(`PubMed ESearch failed: ${searchResponse.status}`);
        }

        const searchData = await searchResponse.json();
        const esearchresult = searchData.esearchresult;

        if (!esearchresult || !esearchresult.idlist || esearchresult.idlist.length === 0) {
            console.log(`[PubMed] No results found`);
            return {
                articles: [],
                totalResults: 0,
                query: searchQuery,
                searchTime: Date.now() - startTime
            };
        }

        const pmids = esearchresult.idlist;
        const totalResults = parseInt(esearchresult.count || "0", 10);

        console.log(`[PubMed] Found ${totalResults} results, fetching ${pmids.length} articles`);

        await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));

        // Step 2: EFetch to get article details
        const fetchParams = new URLSearchParams({
            db: "pubmed",
            id: pmids.join(","),
            rettype: "xml",
            retmode: "xml",
            email: process.env.PUBMED_EMAIL || "user@example.com",
        });

        if (process.env.PUBMED_API_KEY) {
            fetchParams.set("api_key", process.env.PUBMED_API_KEY);
        }

        const fetchResponse = await fetch(`${PUBMED_EFETCH}?${fetchParams}`);

        if (!fetchResponse.ok) {
            throw new Error(`PubMed EFetch failed: ${fetchResponse.status}`);
        }

        const xmlText = await fetchResponse.text();
        const articles = parsePubMedXML(xmlText);

        console.log(`[PubMed] Parsed ${articles.length} articles`);

        return {
            articles,
            totalResults,
            query: searchQuery,
            searchTime: Date.now() - startTime
        };

    } catch (error: any) {
        console.error(`[PubMed] Search error: ${error.message}`);
        return {
            articles: [],
            totalResults: 0,
            query: searchQuery,
            searchTime: Date.now() - startTime
        };
    }
}

/**
 * Parse PubMed XML response
 */
function parsePubMedXML(xml: string): PubMedArticle[] {
    const articles: PubMedArticle[] = [];

    // Simple regex-based XML parsing (for reliability without dependencies)
    const articleMatches = xml.match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g) || [];

    for (const articleXml of articleMatches) {
        try {
            const pmid = extractXmlValue(articleXml, "PMID") || "";
            const title = extractXmlValue(articleXml, "ArticleTitle") || "";
            const abstractText = extractXmlValue(articleXml, "AbstractText") || "";
            const journal = extractXmlValue(articleXml, "Title") || extractXmlValue(articleXml, "ISOAbbreviation") || "";
            const year = extractXmlValue(articleXml, "Year") || extractXmlValue(articleXml, "PubDate>Year") || "";
            const volume = extractXmlValue(articleXml, "Volume") || "";
            const issue = extractXmlValue(articleXml, "Issue") || "";
            const pages = extractXmlValue(articleXml, "MedlinePgn") || "";
            const language = extractXmlValue(articleXml, "Language") || "eng";

            // Extract DOI
            const doiMatch = articleXml.match(/<ArticleId IdType="doi">([^<]+)<\/ArticleId>/);
            const doi = doiMatch ? doiMatch[1] : "";

            // Extract PMCID
            const pmcMatch = articleXml.match(/<ArticleId IdType="pmc">([^<]+)<\/ArticleId>/);
            const pmcid = pmcMatch ? pmcMatch[1] : undefined;

            // Extract authors
            const authors = extractAuthors(articleXml);

            // Extract keywords
            const keywords = extractKeywords(articleXml);

            const article: PubMedArticle = {
                pmid,
                title: cleanHtmlEntities(title),
                authors,
                year,
                journal: cleanHtmlEntities(journal),
                abstract: cleanHtmlEntities(abstractText),
                keywords,
                doi,
                pmcid,
                volume,
                issue,
                pages,
                language: language === "eng" ? "English" : language,
                url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`
            };

            articles.push(article);

        } catch (error) {
            console.error(`[PubMed] Error parsing article XML`);
        }
    }

    return articles;
}

function extractXmlValue(xml: string, tag: string): string | null {
    const regex = new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag.split(">")[0]}>`, "i");
    const match = xml.match(regex);
    return match ? match[1].trim() : null;
}

function extractAuthors(xml: string): string[] {
    const authors: string[] = [];
    const authorMatches = xml.match(/<Author[^>]*>[\s\S]*?<\/Author>/g) || [];

    for (const authorXml of authorMatches) {
        const lastName = extractXmlValue(authorXml, "LastName") || "";
        const foreName = extractXmlValue(authorXml, "ForeName") ||
            extractXmlValue(authorXml, "Initials") || "";

        if (lastName) {
            authors.push(`${lastName}, ${foreName}`.trim());
        }
    }

    return authors;
}

function extractKeywords(xml: string): string[] {
    const keywords: string[] = [];
    const keywordMatches = xml.match(/<Keyword[^>]*>([^<]+)<\/Keyword>/g) || [];

    for (const match of keywordMatches) {
        const keyword = match.replace(/<[^>]+>/g, "").trim();
        if (keyword) {
            keywords.push(keyword);
        }
    }

    return keywords;
}

function cleanHtmlEntities(text: string): string {
    return text
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/<[^>]+>/g, "") // Remove any remaining HTML tags
        .trim();
}

/**
 * Generate APA 7th Edition citation for PubMed article
 */
export function generatePubMedAPA7Citation(article: PubMedArticle): string {
    // Authors (Last, F. M.)
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

    // Year
    const year = article.year ? `(${article.year})` : "(n.d.)";

    // Title
    const title = article.title.endsWith(".") ? article.title : article.title + ".";

    // Journal (italicized in markdown)
    let journalPart = `*${article.journal}*`;

    // Volume and issue
    if (article.volume) {
        journalPart += `, *${article.volume}*`;
        if (article.issue) {
            journalPart += `(${article.issue})`;
        }
    }

    // Pages
    if (article.pages) {
        journalPart += `, ${article.pages}`;
    }

    // DOI
    let doiPart = "";
    if (article.doi) {
        doiPart = ` https://doi.org/${article.doi}`;
    }

    return `${authorsStr} ${year}. ${title} ${journalPart}.${doiPart}`.trim();
}

function formatAuthorAPA(author: string): string {
    // Input format: "LastName, FirstName" or "LastName, F. M."
    const parts = author.split(",").map(p => p.trim());
    if (parts.length < 2) return author;

    const lastName = parts[0];
    const firstPart = parts[1];

    // Extract initials
    const initials = firstPart.split(/\s+/)
        .map(name => name.charAt(0).toUpperCase() + ".")
        .join(" ");

    return `${lastName}, ${initials}`;
}

export function isPubMedConfigured(): boolean {
    // PubMed E-utilities work without API key, just slower
    return true;
}
