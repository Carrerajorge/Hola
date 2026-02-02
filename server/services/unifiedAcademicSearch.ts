/**
 * Unified Academic Search Service
 * Integrates multiple academic databases:
 * - Scopus (Elsevier) - requires API key
 * - SciELO - free, Latin American research
 * - PubMed (NIH) - free, medical/life sciences
 * - Google Scholar - free
 * - DuckDuckGo - free, general web
 */

import { JSDOM } from "jsdom";

// ============================================
// TYPES
// ============================================

export interface AcademicResult {
  title: string;
  authors: string;
  year: string;
  journal?: string;
  doi?: string;
  url: string;
  abstract?: string;
  citations?: number;
  source: "scopus" | "scielo" | "pubmed" | "scholar" | "duckduckgo" | "wos";
  citation?: string; // APA format
}

export interface SearchOptions {
  maxResults?: number;
  yearFrom?: number;
  yearTo?: number;
  language?: string;
}

// ============================================
// HELPERS
// ============================================

const getHeaders = () => ({
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
});

function formatAPA(result: Partial<AcademicResult>): string {
  const authors = result.authors || "Unknown";
  const year = result.year || "n.d.";
  const title = result.title || "";
  const journal = result.journal || "";
  const doi = result.doi ? ` https://doi.org/${result.doi}` : "";
  
  return `${authors} (${year}). ${title}. ${journal}.${doi}`;
}

// ============================================
// SCOPUS (requires SCOPUS_API_KEY)
// ============================================

const SCOPUS_API_KEY = process.env.SCOPUS_API_KEY || "";

export async function searchScopus(query: string, options: SearchOptions = {}): Promise<AcademicResult[]> {
  const { maxResults = 10 } = options;
  
  if (!SCOPUS_API_KEY) {
    console.warn("[AcademicSearch] Scopus API key not configured");
    return [];
  }

  try {
    const params = new URLSearchParams({
      query: query,
      count: maxResults.toString(),
      field: "dc:title,dc:creator,prism:publicationName,prism:coverDate,prism:doi,citedby-count,dc:description"
    });

    const response = await fetch(`https://api.elsevier.com/content/search/scopus?${params}`, {
      headers: {
        "X-ELS-APIKey": SCOPUS_API_KEY,
        "Accept": "application/json"
      }
    });

    if (!response.ok) return [];

    const data = await response.json();
    const entries = data["search-results"]?.entry || [];

    return entries.filter((e: any) => e["dc:title"]).map((entry: any) => {
      const result: AcademicResult = {
        title: entry["dc:title"] || "",
        authors: entry["dc:creator"] || "Unknown",
        year: entry["prism:coverDate"]?.split("-")[0] || "",
        journal: entry["prism:publicationName"] || "",
        doi: entry["prism:doi"] || "",
        url: entry["prism:doi"] ? `https://doi.org/${entry["prism:doi"]}` : "",
        abstract: entry["dc:description"] || "",
        citations: parseInt(entry["citedby-count"] || "0"),
        source: "scopus"
      };
      result.citation = formatAPA(result);
      return result;
    });
  } catch (error) {
    console.error("[AcademicSearch] Scopus error:", error);
    return [];
  }
}

// ============================================
// SCIELO (free - Latin American research)
// ============================================

export async function searchScielo(query: string, options: SearchOptions = {}): Promise<AcademicResult[]> {
  const { maxResults = 10, language = "es" } = options;
  const results: AcademicResult[] = [];

  try {
    // SciELO search API
    const searchUrl = `https://search.scielo.org/?q=${encodeURIComponent(query)}&lang=${language}&count=${maxResults}&output=json`;
    
    const response = await fetch(searchUrl, { headers: getHeaders() });
    
    if (!response.ok) {
      // Fallback: scrape HTML
      return await scrapeScielo(query, maxResults);
    }

    const data = await response.json();
    
    for (const doc of (data.documents || []).slice(0, maxResults)) {
      results.push({
        title: doc.title || "",
        authors: Array.isArray(doc.authors) ? doc.authors.join(", ") : (doc.authors || ""),
        year: doc.year || doc.publication_date?.split("-")[0] || "",
        journal: doc.journal || "",
        doi: doc.doi || "",
        url: doc.url || doc.fulltext_url || "",
        abstract: doc.abstract || "",
        source: "scielo",
        citation: ""
      });
    }
  } catch (error) {
    console.error("[AcademicSearch] SciELO API error, trying scrape:", error);
    return await scrapeScielo(query, maxResults);
  }

  return results.map(r => ({ ...r, citation: formatAPA(r) }));
}

async function scrapeScielo(query: string, maxResults: number): Promise<AcademicResult[]> {
  const results: AcademicResult[] = [];
  
  try {
    const searchUrl = `https://search.scielo.org/?q=${encodeURIComponent(query)}&lang=es`;
    const response = await fetch(searchUrl, { headers: getHeaders() });
    
    if (!response.ok) return [];
    
    const html = await response.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const articles = doc.querySelectorAll(".results .item");
    
    for (const article of Array.from(articles).slice(0, maxResults)) {
      const titleEl = article.querySelector(".title a, h2 a");
      const authorsEl = article.querySelector(".authors, .author");
      const journalEl = article.querySelector(".journal, .source");
      const yearMatch = article.textContent?.match(/\b(19|20)\d{2}\b/);
      
      if (titleEl) {
        const result: AcademicResult = {
          title: titleEl.textContent?.trim() || "",
          authors: authorsEl?.textContent?.trim() || "",
          year: yearMatch?.[0] || "",
          journal: journalEl?.textContent?.trim() || "",
          url: titleEl.getAttribute("href") || "",
          source: "scielo"
        };
        result.citation = formatAPA(result);
        results.push(result);
      }
    }
  } catch (error) {
    console.error("[AcademicSearch] SciELO scrape error:", error);
  }

  return results;
}

// ============================================
// PUBMED (free - NIH medical database)
// ============================================

export async function searchPubMed(query: string, options: SearchOptions = {}): Promise<AcademicResult[]> {
  const { maxResults = 10 } = options;
  const results: AcademicResult[] = [];

  try {
    // Step 1: Search for IDs
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${maxResults}&retmode=json`;
    const searchRes = await fetch(searchUrl);
    
    if (!searchRes.ok) return [];
    
    const searchData = await searchRes.json();
    const ids = searchData.esearchresult?.idlist || [];
    
    if (ids.length === 0) return [];

    // Step 2: Fetch details
    const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(",")}&retmode=json`;
    const fetchRes = await fetch(fetchUrl);
    
    if (!fetchRes.ok) return [];
    
    const fetchData = await fetchRes.json();
    const articles = fetchData.result || {};

    for (const id of ids) {
      const article = articles[id];
      if (!article || article.error) continue;

      const authors = article.authors?.map((a: any) => a.name).join(", ") || "";
      const year = article.pubdate?.split(" ")[0] || "";

      const result: AcademicResult = {
        title: article.title || "",
        authors,
        year,
        journal: article.source || article.fulljournalname || "",
        doi: article.elocationid?.replace("doi: ", "") || "",
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        source: "pubmed"
      };
      result.citation = formatAPA(result);
      results.push(result);
    }
  } catch (error) {
    console.error("[AcademicSearch] PubMed error:", error);
  }

  return results;
}

// ============================================
// GOOGLE SCHOLAR (free - scraping)
// ============================================

export async function searchScholar(query: string, options: SearchOptions = {}): Promise<AcademicResult[]> {
  const { maxResults = 10 } = options;
  const results: AcademicResult[] = [];

  try {
    const searchUrl = `https://scholar.google.com/scholar?q=${encodeURIComponent(query)}&hl=es`;
    const response = await fetch(searchUrl, { headers: getHeaders() });

    if (!response.ok) return [];

    const html = await response.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    for (const article of Array.from(doc.querySelectorAll(".gs_ri")).slice(0, maxResults)) {
      const titleEl = article.querySelector(".gs_rt a");
      const snippetEl = article.querySelector(".gs_rs");
      const infoEl = article.querySelector(".gs_a");

      if (titleEl) {
        const info = infoEl?.textContent?.trim() || "";
        const authors = info.match(/^([^-]+)/)?.[1]?.trim() || "";
        const year = info.match(/\b(19|20)\d{2}\b/)?.[0] || "";

        const result: AcademicResult = {
          title: titleEl.textContent?.trim() || "",
          authors,
          year,
          url: titleEl.getAttribute("href") || "",
          abstract: snippetEl?.textContent?.trim() || "",
          source: "scholar"
        };
        result.citation = formatAPA(result);
        results.push(result);
      }
    }
  } catch (error) {
    console.error("[AcademicSearch] Scholar error:", error);
  }

  return results;
}

// ============================================
// DUCKDUCKGO (free - using duck-duck-scrape)
// ============================================

export async function searchDuckDuckGo(query: string, options: SearchOptions = {}): Promise<AcademicResult[]> {
  const { maxResults = 10 } = options;
  const results: AcademicResult[] = [];

  try {
    // Dynamic import for duck-duck-scrape
    const ddg = await import("duck-duck-scrape");
    
    // Add academic terms to improve results
    const academicQuery = `${query} site:scholar.google.com OR site:researchgate.net OR site:academia.edu OR site:scielo.org OR filetype:pdf`;
    
    const searchResults = await ddg.search(academicQuery, {
      safeSearch: ddg.SafeSearchType.OFF
    });

    for (const result of (searchResults.results || []).slice(0, maxResults)) {
      const r: AcademicResult = {
        title: result.title || "",
        authors: "",
        year: "",
        url: result.url || "",
        abstract: result.description || "",
        source: "duckduckgo"
      };
      
      // Try to extract year from title or description
      const yearMatch = (result.title + " " + result.description)?.match(/\b(19|20)\d{2}\b/);
      if (yearMatch) r.year = yearMatch[0];
      
      r.citation = formatAPA(r);
      results.push(r);
    }
  } catch (error) {
    console.error("[AcademicSearch] DuckDuckGo error:", error);
  }

  return results;
}

// ============================================
// WEB OF SCIENCE (requires API key)
// ============================================

const WOS_API_KEY = process.env.WOS_API_KEY || "";

export async function searchWOS(query: string, options: SearchOptions = {}): Promise<AcademicResult[]> {
  const { maxResults = 10 } = options;
  
  if (!WOS_API_KEY) {
    console.warn("[AcademicSearch] WOS API key not configured");
    return [];
  }

  try {
    // WOS Starter API endpoint
    const response = await fetch("https://wos-api.clarivate.com/api/wos", {
      method: "POST",
      headers: {
        "X-ApiKey": WOS_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query: query,
        limit: maxResults
      })
    });

    if (!response.ok) {
      console.error("[AcademicSearch] WOS API error:", response.status);
      return [];
    }

    const data = await response.json();
    const records = data.Data?.Records?.records?.REC || [];

    return records.map((rec: any) => {
      const result: AcademicResult = {
        title: rec.static_data?.summary?.titles?.title?.[0]?.content || "",
        authors: rec.static_data?.summary?.names?.name?.map((n: any) => n.display_name).join(", ") || "",
        year: rec.static_data?.summary?.pub_info?.pubyear || "",
        journal: rec.static_data?.summary?.titles?.title?.find((t: any) => t.type === "source")?.content || "",
        doi: rec.dynamic_data?.cluster_related?.identifiers?.identifier?.find((i: any) => i.type === "doi")?.value || "",
        url: rec.dynamic_data?.cluster_related?.identifiers?.identifier?.find((i: any) => i.type === "doi")?.value 
          ? `https://doi.org/${rec.dynamic_data?.cluster_related?.identifiers?.identifier?.find((i: any) => i.type === "doi")?.value}`
          : "",
        citations: rec.dynamic_data?.citation_related?.tc_list?.silo_tc?.local_count || 0,
        source: "wos"
      };
      result.citation = formatAPA(result);
      return result;
    });
  } catch (error) {
    console.error("[AcademicSearch] WOS error:", error);
    return [];
  }
}

// ============================================
// UNIFIED SEARCH (all sources)
// ============================================

export interface UnifiedSearchOptions extends SearchOptions {
  sources?: Array<"scopus" | "scielo" | "pubmed" | "scholar" | "duckduckgo" | "wos">;
}

export async function searchAllSources(query: string, options: UnifiedSearchOptions = {}): Promise<{
  query: string;
  totalResults: number;
  sources: Record<string, boolean>;
  results: AcademicResult[];
}> {
  const { 
    maxResults = 10, 
    sources = ["scopus", "scielo", "pubmed", "scholar", "duckduckgo"] 
  } = options;
  
  const perSource = Math.ceil(maxResults / sources.length);
  const promises: Promise<AcademicResult[]>[] = [];
  const enabledSources: Record<string, boolean> = {};

  if (sources.includes("scopus")) {
    enabledSources.scopus = !!SCOPUS_API_KEY;
    if (SCOPUS_API_KEY) promises.push(searchScopus(query, { maxResults: perSource }));
  }
  
  if (sources.includes("scielo")) {
    enabledSources.scielo = true;
    promises.push(searchScielo(query, { maxResults: perSource }));
  }
  
  if (sources.includes("pubmed")) {
    enabledSources.pubmed = true;
    promises.push(searchPubMed(query, { maxResults: perSource }));
  }
  
  if (sources.includes("scholar")) {
    enabledSources.scholar = true;
    promises.push(searchScholar(query, { maxResults: perSource }));
  }
  
  if (sources.includes("duckduckgo")) {
    enabledSources.duckduckgo = true;
    promises.push(searchDuckDuckGo(query, { maxResults: perSource }));
  }
  
  if (sources.includes("wos")) {
    enabledSources.wos = !!WOS_API_KEY;
    if (WOS_API_KEY) promises.push(searchWOS(query, { maxResults: perSource }));
  }

  const allResults = await Promise.allSettled(promises);
  const results: AcademicResult[] = [];
  const seen = new Set<string>();

  for (const result of allResults) {
    if (result.status === "fulfilled") {
      for (const r of result.value) {
        // Deduplicate by title similarity
        const key = r.title.toLowerCase().substring(0, 50);
        if (!seen.has(key)) {
          seen.add(key);
          results.push(r);
        }
      }
    }
  }

  // Sort by citations (if available), then by year
  results.sort((a, b) => {
    if (a.citations && b.citations) return b.citations - a.citations;
    if (a.year && b.year) return parseInt(b.year) - parseInt(a.year);
    return 0;
  });

  return {
    query,
    totalResults: results.length,
    sources: enabledSources,
    results: results.slice(0, maxResults)
  };
}

// ============================================
// SOURCE STATUS
// ============================================

export function getSourcesStatus(): Record<string, { available: boolean; name: string; description: string; requiresKey: boolean }> {
  return {
    scopus: {
      available: !!SCOPUS_API_KEY,
      name: "Scopus (Elsevier)",
      description: "Base de datos académica con +80M de registros científicos",
      requiresKey: true
    },
    scielo: {
      available: true,
      name: "SciELO",
      description: "Biblioteca científica latinoamericana - Acceso abierto",
      requiresKey: false
    },
    pubmed: {
      available: true,
      name: "PubMed (NIH)",
      description: "Base de datos biomédica del NIH - Acceso abierto",
      requiresKey: false
    },
    scholar: {
      available: true,
      name: "Google Scholar",
      description: "Buscador académico de Google - Gratuito",
      requiresKey: false
    },
    duckduckgo: {
      available: true,
      name: "DuckDuckGo",
      description: "Buscador web privado - 100% gratuito sin límites",
      requiresKey: false
    },
    wos: {
      available: !!WOS_API_KEY,
      name: "Web of Science",
      description: "Base de datos de Clarivate Analytics",
      requiresKey: true
    }
  };
}
