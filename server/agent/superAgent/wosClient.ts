import { translateToEnglish } from "./scopusClient";

export interface WosArticle {
  id: string;
  title: string;
  authors: string[];
  year: number;
  journal: string;
  abstract: string;
  keywords: string[];
  doi: string;
  citationCount: number;
  affiliations: string[];
  wosUrl: string;
  documentType: string;
  language: string;
}

export interface WosSearchResult {
  articles: WosArticle[];
  totalResults: number;
  query: string;
  searchTime: number;
}

const WOS_API_BASE = "https://api.clarivate.com/apis/wos-starter/v1";

export async function searchWos(
  query: string,
  options: {
    maxResults?: number;
    startYear?: number;
    endYear?: number;
    documentType?: string;
  } = {}
): Promise<WosSearchResult> {
  const apiKey = process.env.WOS_API_KEY;
  if (!apiKey) {
    throw new Error("WOS_API_KEY not configured");
  }

  const { maxResults = 25, startYear, endYear, documentType } = options;
  const startTime = Date.now();

  const translatedQuery = translateToEnglish(query);
  console.log(`[WoS] Original query: "${query}"`);
  console.log(`[WoS] Translated query: "${translatedQuery}"`);

  let searchQuery = translatedQuery;
  
  const params = new URLSearchParams({
    q: searchQuery,
    limit: String(Math.min(maxResults, 50)),
    page: "1",
    sortField: "TC",
    sortOrder: "desc",
  });

  if (startYear && endYear) {
    params.set("publishTimeSpan", `${startYear}-01-01+${endYear}-12-31`);
  }

  if (documentType) {
    params.set("docType", documentType);
  }

  try {
    const response = await fetch(`${WOS_API_BASE}/documents?${params}`, {
      headers: {
        "X-ApiKey": apiKey,
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[WoS] API error: ${response.status} - ${errorText}`);
      throw new Error(`WoS API error: ${response.status}`);
    }

    const data = await response.json();
    const searchTime = Date.now() - startTime;

    const articles: WosArticle[] = (data.hits || []).map((hit: any, index: number) => {
      const source = hit.source || {};
      
      return {
        id: hit.uid || `wos-${index}`,
        title: source.title?.[0] || hit.title || "No title",
        authors: extractAuthors(source),
        year: parseInt(source.publishYear) || new Date().getFullYear(),
        journal: source.sourceTitle?.[0] || source.publisherName || "Unknown Journal",
        abstract: source.abstract?.[0] || "",
        keywords: source.keywords || source.keywordsPlus || [],
        doi: source.doi?.[0] || extractDoi(source.identifiers),
        citationCount: source.citedByCount || hit.citedByCount || 0,
        affiliations: extractAffiliations(source),
        wosUrl: `https://www.webofscience.com/wos/woscc/full-record/${hit.uid}`,
        documentType: source.docType?.[0] || "Article",
        language: source.languages?.[0] || "English",
      };
    });

    console.log(`[WoS] Found ${articles.length} articles from ${data.metadata?.total || 0} total in ${searchTime}ms`);

    return {
      articles,
      totalResults: data.metadata?.total || articles.length,
      query: translatedQuery,
      searchTime,
    };
  } catch (error) {
    console.error("[WoS] Search error:", error);
    throw error;
  }
}

function extractAuthors(source: any): string[] {
  if (source.author && Array.isArray(source.author)) {
    return source.author.map((a: any) => {
      if (typeof a === "string") return a;
      return a.displayName || a.lastName || "Unknown Author";
    });
  }
  if (source.names?.authors) {
    return source.names.authors.map((a: any) => a.displayName || a.wosStandard || "Unknown");
  }
  return [];
}

function extractDoi(identifiers: any): string {
  if (!identifiers) return "";
  if (Array.isArray(identifiers)) {
    const doiId = identifiers.find((id: any) => id.type === "doi");
    return doiId?.value || "";
  }
  return identifiers.doi || "";
}

function extractAffiliations(source: any): string[] {
  if (source.affiliations && Array.isArray(source.affiliations)) {
    return source.affiliations.map((aff: any) => {
      if (typeof aff === "string") return aff;
      return aff.organizationName || aff.name || "";
    }).filter(Boolean);
  }
  return [];
}

export function formatWosForExcel(articles: WosArticle[]): any[] {
  return articles.map((article, index) => ({
    "#": index + 1,
    "Authors": article.authors.join("; "),
    "Title": article.title,
    "Year": article.year,
    "Journal": article.journal,
    "Abstract": article.abstract.substring(0, 500) + (article.abstract.length > 500 ? "..." : ""),
    "Keywords": article.keywords.join("; "),
    "Language": article.language,
    "Document Type": article.documentType,
    "DOI": article.doi,
    "Citations": article.citationCount,
    "Affiliations": article.affiliations.join("; "),
    "WoS URL": article.wosUrl,
    "Source": "Web of Science",
  }));
}
