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

const WOS_API_BASE = "https://wos-api.clarivate.com/api/wos";

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

  let searchQuery = `TS=(${translatedQuery})`;
  
  if (startYear && endYear) {
    searchQuery += ` AND PY=(${startYear}-${endYear})`;
  }

  const params = new URLSearchParams({
    databaseId: "WOS",
    usrQuery: searchQuery,
    count: String(Math.min(maxResults, 100)),
    firstRecord: "1",
  });

  console.log(`[WoS] Search URL: ${WOS_API_BASE}?${params}`);

  try {
    const response = await fetch(`${WOS_API_BASE}?${params}`, {
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
    
    console.log(`[WoS] Response structure:`, JSON.stringify(data).substring(0, 500));

    const records = data.Data?.Records?.records?.REC || [];
    const queryResult = data.QueryResult || {};
    
    const articles: WosArticle[] = records.map((rec: any, index: number) => {
      const staticData = rec.static_data || {};
      const summary = staticData.summary || {};
      const fullRecordMeta = staticData.fullrecord_metadata || {};
      const dynamicData = rec.dynamic_data || {};
      
      const titles = summary.titles?.title || [];
      const title = titles.find((t: any) => t.type === "item")?.content || 
                    titles[0]?.content || "No title";
      
      const pubInfo = summary.pub_info || {};
      const year = pubInfo.pubyear || pubInfo.sortdate?.substring(0, 4) || new Date().getFullYear();
      
      const sourceTitle = summary.titles?.title?.find((t: any) => t.type === "source")?.content || "";
      
      const names = summary.names?.name || [];
      const authors = names
        .filter((n: any) => n.role === "author")
        .map((n: any) => n.full_name || n.display_name || `${n.last_name}, ${n.first_name}`)
        .filter(Boolean);
      
      const abstracts = fullRecordMeta.abstracts?.abstract?.abstract_text?.p || [];
      const abstract = Array.isArray(abstracts) ? abstracts.join(" ") : (abstracts || "");
      
      const keywords = fullRecordMeta.keywords?.keyword?.map((k: any) => k.content || k) || [];
      
      const identifiers = dynamicData.cluster_related?.identifiers?.identifier || [];
      const doi = identifiers.find((id: any) => id.type === "doi")?.value || 
                  identifiers.find((id: any) => id.type === "xref_doi")?.value || "";
      
      const citationCount = dynamicData.citation_related?.tc_list?.silo_tc?.local_count || 0;
      
      const addresses = fullRecordMeta.addresses?.address_name || [];
      const affiliations = addresses.map((addr: any) => 
        addr.address_spec?.full_address || addr.address_spec?.organizations?.organization?.[0]?.content || ""
      ).filter(Boolean);
      
      const uid = rec.UID || `wos-${index}`;
      
      return {
        id: uid,
        title,
        authors,
        year: parseInt(String(year), 10),
        journal: sourceTitle,
        abstract,
        keywords,
        doi,
        citationCount: parseInt(String(citationCount), 10) || 0,
        affiliations,
        wosUrl: `https://www.webofscience.com/wos/woscc/full-record/${uid}`,
        documentType: pubInfo.pubtype || "Article",
        language: fullRecordMeta.languages?.language?.content || "English",
      };
    });

    const totalResults = queryResult.RecordsFound || records.length;
    console.log(`[WoS] Found ${articles.length} articles from ${totalResults} total in ${searchTime}ms`);

    return {
      articles,
      totalResults,
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
