import { SourceSignal } from "./contracts";

export interface ScopusArticle {
  scopusId: string;
  title: string;
  authors: string[];
  year: string;
  journal: string;
  abstract: string;
  keywords: string[];
  doi: string;
  citationCount: number;
  documentType: string;
  language: string;
  affiliations: string[];
  url: string;
}

export interface ScopusSearchResult {
  articles: ScopusArticle[];
  totalResults: number;
  query: string;
  searchTime: number;
}

const SCOPUS_API_BASE = "https://api.elsevier.com/content/search/scopus";
const SCOPUS_ABSTRACT_BASE = "https://api.elsevier.com/content/abstract/scopus_id";

const SPANISH_TO_ENGLISH: Record<string, string> = {
  "acero": "steel",
  "reciclado": "recycled",
  "concreto": "concrete",
  "hormigón": "concrete",
  "hormigon": "concrete",
  "resistencia": "strength",
  "construcción": "construction",
  "construccion": "construction",
  "sostenible": "sustainable",
  "sustentable": "sustainable",
  "materiales": "materials",
  "cemento": "cement",
  "estructuras": "structures",
  "edificaciones": "buildings",
  "ingeniería": "engineering",
  "ingenieria": "engineering",
  "civil": "civil",
  "ambiental": "environmental",
  "impacto": "impact",
  "carbono": "carbon",
  "emisiones": "emissions",
  "propiedades": "properties",
  "mecánicas": "mechanical",
  "mecanicas": "mechanical",
  "fibras": "fibers",
  "refuerzo": "reinforcement",
  "uso": "use",
  "influencia": "influence",
};

export function translateToEnglish(query: string): string {
  let translated = query.toLowerCase();
  
  translated = translated
    .replace(/\s+del\s+\d{4}\s+(al|hasta)\s+\d{4}/gi, "")
    .replace(/\s+\d{4}-\d{4}/g, "")
    .replace(/\s+en\s+/g, " ");
  
  for (const [spanish, english] of Object.entries(SPANISH_TO_ENGLISH)) {
    const regex = new RegExp(`\\b${spanish}\\b`, "gi");
    translated = translated.replace(regex, english);
  }
  
  const yearMatch = query.match(/(\d{4})[- ]+(al|hasta|to)[- ]+(\d{4})/i) || 
                    query.match(/(\d{4})-(\d{4})/);
  
  return translated.trim();
}

export async function searchScopus(
  query: string,
  options: {
    maxResults?: number;
    startYear?: number;
    endYear?: number;
    documentType?: string;
  } = {}
): Promise<ScopusSearchResult> {
  const apiKey = process.env.SCOPUS_API_KEY;
  if (!apiKey) {
    throw new Error("SCOPUS_API_KEY not configured");
  }

  const { maxResults = 25, startYear, endYear, documentType } = options;
  const startTime = Date.now();

  const translatedQuery = translateToEnglish(query);
  console.log(`[Scopus] Original query: "${query}"`);
  console.log(`[Scopus] Translated query: "${translatedQuery}"`);
  
  let searchQuery = translatedQuery;
  if (startYear && endYear) {
    searchQuery += ` AND PUBYEAR > ${startYear - 1} AND PUBYEAR < ${endYear + 1}`;
  }
  if (documentType) {
    searchQuery += ` AND DOCTYPE(${documentType})`;
  }

  const params = new URLSearchParams({
    query: searchQuery,
    count: Math.min(maxResults, 25).toString(),
    start: "0",
    sort: "-citedby-count",
    field: "dc:title,dc:creator,prism:coverDate,prism:publicationName,dc:description,authkeywords,prism:doi,citedby-count,subtypeDescription,dc:identifier,affiliation",
  });

  const articles: ScopusArticle[] = [];
  let totalResults = 0;
  let start = 0;

  while (articles.length < maxResults) {
    params.set("start", start.toString());
    
    try {
      const response = await fetch(`${SCOPUS_API_BASE}?${params}`, {
        headers: {
          "X-ELS-APIKey": apiKey,
          "Accept": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Scopus] API error: ${response.status} - ${errorText}`);
        break;
      }

      const data = await response.json();
      const searchResults = data["search-results"];
      
      if (!searchResults || !searchResults.entry) {
        break;
      }

      totalResults = parseInt(searchResults["opensearch:totalResults"] || "0", 10);
      
      for (const entry of searchResults.entry) {
        if (entry.error) continue;
        
        const article: ScopusArticle = {
          scopusId: entry["dc:identifier"]?.replace("SCOPUS_ID:", "") || "",
          title: entry["dc:title"] || "",
          authors: extractAuthors(entry),
          year: extractYear(entry["prism:coverDate"]),
          journal: entry["prism:publicationName"] || "",
          abstract: entry["dc:description"] || "",
          keywords: extractKeywords(entry["authkeywords"]),
          doi: entry["prism:doi"] || "",
          citationCount: parseInt(entry["citedby-count"] || "0", 10),
          documentType: entry["subtypeDescription"] || "Article",
          language: "English",
          affiliations: extractAffiliations(entry.affiliation),
          url: entry.link?.find((l: any) => l["@ref"] === "scopus")?.["@href"] || 
               `https://www.scopus.com/record/display.uri?eid=${entry["eid"]}`,
        };
        
        articles.push(article);
        
        if (articles.length >= maxResults) break;
      }

      if (searchResults.entry.length < 25 || articles.length >= maxResults) {
        break;
      }

      start += 25;
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
    } catch (error: any) {
      console.error(`[Scopus] Search error: ${error.message}`);
      break;
    }
  }

  return {
    articles,
    totalResults,
    query: searchQuery,
    searchTime: Date.now() - startTime,
  };
}

export async function fetchAbstract(scopusId: string): Promise<string> {
  const apiKey = process.env.SCOPUS_API_KEY;
  if (!apiKey) return "";

  try {
    const response = await fetch(`${SCOPUS_ABSTRACT_BASE}/${scopusId}`, {
      headers: {
        "X-ELS-APIKey": apiKey,
        "Accept": "application/json",
      },
    });

    if (!response.ok) return "";

    const data = await response.json();
    return data["abstracts-retrieval-response"]?.coredata?.["dc:description"] || "";
  } catch {
    return "";
  }
}

export function scopusArticlesToSourceSignals(articles: ScopusArticle[]): SourceSignal[] {
  return articles.map((article, index) => ({
    id: `scopus_${article.scopusId || index}`,
    url: article.url,
    title: article.title,
    snippet: article.abstract.substring(0, 300),
    domain: "scopus.com",
    score: Math.min(1, 0.5 + (article.citationCount / 100)),
    fetched: true,
    content: article.abstract,
    claims: [],
    scopusData: article,
  }));
}

function extractAuthors(entry: any): string[] {
  if (entry["dc:creator"]) {
    return [entry["dc:creator"]];
  }
  if (entry.author && Array.isArray(entry.author)) {
    return entry.author.map((a: any) => a.authname || a["given-name"] + " " + a.surname).filter(Boolean);
  }
  return [];
}

function extractYear(coverDate: string | undefined): string {
  if (!coverDate) return "";
  const match = coverDate.match(/(\d{4})/);
  return match ? match[1] : "";
}

function extractKeywords(authkeywords: string | undefined): string[] {
  if (!authkeywords) return [];
  return authkeywords.split("|").map(k => k.trim()).filter(Boolean);
}

function extractAffiliations(affiliations: any): string[] {
  if (!affiliations) return [];
  if (!Array.isArray(affiliations)) affiliations = [affiliations];
  return affiliations.map((a: any) => a.affilname || "").filter(Boolean);
}

export function isScopusConfigured(): boolean {
  return !!process.env.SCOPUS_API_KEY;
}
