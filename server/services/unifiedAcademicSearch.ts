/**
 * Optimized Unified Academic Search Service v2.0
 * 
 * OPTIMIZATIONS:
 * - Redis caching (5 min TTL)
 * - Parallel searches with timeout
 * - Smart query enhancement
 * - Better deduplication (Levenshtein)
 * - Quality scoring and ranking
 * - Connection pooling
 */

import { JSDOM } from "jsdom";
import { createClient, RedisClientType } from "redis";

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
  citation?: string;
  score?: number; // Quality score 0-100
}

export interface SearchOptions {
  maxResults?: number;
  yearFrom?: number;
  yearTo?: number;
  language?: string;
  timeout?: number;
  useCache?: boolean;
}

// ============================================
// REDIS CACHE
// ============================================

let redisClient: RedisClientType | null = null;
const CACHE_TTL = 300; // 5 minutes

async function getRedis(): Promise<RedisClientType | null> {
  if (!process.env.REDIS_URL) return null;
  
  if (!redisClient) {
    try {
      redisClient = createClient({ url: process.env.REDIS_URL });
      redisClient.on("error", (err) => console.error("[Redis] Error:", err));
      await redisClient.connect();
      console.log("[AcademicSearch] Redis cache connected");
    } catch (error) {
      console.warn("[AcademicSearch] Redis not available, using no cache");
      return null;
    }
  }
  return redisClient;
}

async function getCached(key: string): Promise<AcademicResult[] | null> {
  try {
    const redis = await getRedis();
    if (!redis) return null;
    const data = await redis.get(`academic:${key}`);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

async function setCache(key: string, data: AcademicResult[]): Promise<void> {
  try {
    const redis = await getRedis();
    if (!redis) return;
    await redis.setEx(`academic:${key}`, CACHE_TTL, JSON.stringify(data));
  } catch {}
}

// ============================================
// HELPERS
// ============================================

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  "Cache-Control": "no-cache"
};

// Fast fetch with timeout
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = 8000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

// Levenshtein distance for deduplication
function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];
  const aLen = Math.min(a.length, 50);
  const bLen = Math.min(b.length, 50);
  
  for (let i = 0; i <= bLen; i++) matrix[i] = [i];
  for (let j = 0; j <= aLen; j++) matrix[0][j] = j;
  
  for (let i = 1; i <= bLen; i++) {
    for (let j = 1; j <= aLen; j++) {
      matrix[i][j] = b.charAt(i - 1) === a.charAt(j - 1)
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return matrix[bLen][aLen];
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a.toLowerCase(), b.toLowerCase()) / maxLen;
}

// Quality scoring
function scoreResult(result: AcademicResult, query: string): number {
  let score = 50; // Base score
  
  // Title relevance (0-30 points)
  const titleLower = result.title.toLowerCase();
  const queryTerms = query.toLowerCase().split(/\s+/);
  const matchedTerms = queryTerms.filter(t => titleLower.includes(t)).length;
  score += Math.min(30, (matchedTerms / queryTerms.length) * 30);
  
  // Recency (0-15 points)
  const year = parseInt(result.year) || 0;
  const currentYear = new Date().getFullYear();
  if (year >= currentYear - 1) score += 15;
  else if (year >= currentYear - 3) score += 10;
  else if (year >= currentYear - 5) score += 5;
  
  // Citations (0-20 points)
  const citations = result.citations || 0;
  if (citations > 100) score += 20;
  else if (citations > 50) score += 15;
  else if (citations > 20) score += 10;
  else if (citations > 5) score += 5;
  
  // Source reliability (0-10 points)
  const sourceScores: Record<string, number> = {
    scopus: 10, pubmed: 10, wos: 10,
    scholar: 7, scielo: 8, duckduckgo: 3
  };
  score += sourceScores[result.source] || 0;
  
  // Has DOI (5 points)
  if (result.doi) score += 5;
  
  // Has abstract (3 points)
  if (result.abstract && result.abstract.length > 50) score += 3;
  
  return Math.min(100, Math.round(score));
}

function formatAPA(result: Partial<AcademicResult>): string {
  const authors = result.authors || "Unknown";
  const year = result.year || "n.d.";
  const title = result.title || "";
  const journal = result.journal || "";
  const doi = result.doi ? ` https://doi.org/${result.doi}` : "";
  return `${authors} (${year}). ${title}. ${journal}.${doi}`;
}

// Enhance query for better results
function enhanceQuery(query: string, source: string): string {
  const base = query.trim();
  
  switch (source) {
    case "pubmed":
      // Add MeSH terms for medical queries
      return base;
    case "duckduckgo":
      // Add academic sites
      return `${base} site:scholar.google.com OR site:researchgate.net OR site:academia.edu OR filetype:pdf`;
    default:
      return base;
  }
}

// ============================================
// SCOPUS (Elsevier)
// ============================================

const SCOPUS_API_KEY = process.env.SCOPUS_API_KEY || "";

export async function searchScopus(query: string, options: SearchOptions = {}): Promise<AcademicResult[]> {
  const { maxResults = 10, timeout = 8000 } = options;
  const cacheKey = `scopus:${query}:${maxResults}`;
  
  // Check cache
  const cached = await getCached(cacheKey);
  if (cached) return cached;
  
  if (!SCOPUS_API_KEY) return [];

  try {
    const params = new URLSearchParams({
      query: query,
      count: Math.min(maxResults, 25).toString(),
      sort: "-citedby-count", // Sort by citations
      field: "dc:title,dc:creator,prism:publicationName,prism:coverDate,prism:doi,citedby-count,dc:description"
    });

    const response = await fetchWithTimeout(
      `https://api.elsevier.com/content/search/scopus?${params}`,
      {
        headers: {
          "X-ELS-APIKey": SCOPUS_API_KEY,
          "Accept": "application/json"
        }
      },
      timeout
    );

    if (!response.ok) return [];

    const data = await response.json();
    const entries = data["search-results"]?.entry || [];

    const results = entries.filter((e: any) => e["dc:title"]).map((entry: any) => {
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
      result.score = scoreResult(result, query);
      return result;
    });

    await setCache(cacheKey, results);
    return results;
  } catch (error) {
    console.error("[Scopus] Error:", error);
    return [];
  }
}

// ============================================
// SCIELO (Latin America - Free)
// ============================================

export async function searchScielo(query: string, options: SearchOptions = {}): Promise<AcademicResult[]> {
  const { maxResults = 10, timeout = 8000 } = options;
  const cacheKey = `scielo:${query}:${maxResults}`;
  
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  try {
    const searchUrl = `https://search.scielo.org/?q=${encodeURIComponent(query)}&lang=es&count=${maxResults}&output=site&sort=CITED_DESC`;
    const response = await fetchWithTimeout(searchUrl, { headers: HEADERS }, timeout);
    
    if (!response.ok) return [];
    
    const html = await response.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    const results: AcademicResult[] = [];

    const articles = doc.querySelectorAll(".results .item, .item-list .item");
    
    for (const article of Array.from(articles).slice(0, maxResults)) {
      const titleEl = article.querySelector(".title a, h2 a, a.link");
      const authorsEl = article.querySelector(".authors, .author, .metadata");
      const journalEl = article.querySelector(".journal, .source");
      const yearMatch = article.textContent?.match(/\b(19|20)\d{2}\b/);
      
      if (titleEl) {
        const result: AcademicResult = {
          title: titleEl.textContent?.trim() || "",
          authors: authorsEl?.textContent?.trim().split("\n")[0] || "",
          year: yearMatch?.[0] || "",
          journal: journalEl?.textContent?.trim() || "SciELO",
          url: titleEl.getAttribute("href") || "",
          source: "scielo"
        };
        result.citation = formatAPA(result);
        result.score = scoreResult(result, query);
        results.push(result);
      }
    }

    await setCache(cacheKey, results);
    return results;
  } catch (error) {
    console.error("[SciELO] Error:", error);
    return [];
  }
}

// ============================================
// PUBMED (NIH - Free)
// ============================================

export async function searchPubMed(query: string, options: SearchOptions = {}): Promise<AcademicResult[]> {
  const { maxResults = 10, timeout = 8000 } = options;
  const cacheKey = `pubmed:${query}:${maxResults}`;
  
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  try {
    // Search for IDs (sorted by relevance)
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${maxResults}&retmode=json&sort=relevance`;
    const searchRes = await fetchWithTimeout(searchUrl, {}, timeout);
    
    if (!searchRes.ok) return [];
    
    const searchData = await searchRes.json();
    const ids = searchData.esearchresult?.idlist || [];
    
    if (ids.length === 0) return [];

    // Fetch details
    const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(",")}&retmode=json`;
    const fetchRes = await fetchWithTimeout(fetchUrl, {}, timeout);
    
    if (!fetchRes.ok) return [];
    
    const fetchData = await fetchRes.json();
    const articles = fetchData.result || {};
    const results: AcademicResult[] = [];

    for (const id of ids) {
      const article = articles[id];
      if (!article || article.error) continue;

      const authors = article.authors?.map((a: any) => a.name).join(", ") || "";
      
      const result: AcademicResult = {
        title: article.title || "",
        authors,
        year: article.pubdate?.match(/\d{4}/)?.[0] || "",
        journal: article.source || article.fulljournalname || "",
        doi: article.elocationid?.replace("doi: ", "").replace("pii: ", "") || "",
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        source: "pubmed"
      };
      result.citation = formatAPA(result);
      result.score = scoreResult(result, query);
      results.push(result);
    }

    await setCache(cacheKey, results);
    return results;
  } catch (error) {
    console.error("[PubMed] Error:", error);
    return [];
  }
}

// ============================================
// GOOGLE SCHOLAR (Free)
// ============================================

export async function searchScholar(query: string, options: SearchOptions = {}): Promise<AcademicResult[]> {
  const { maxResults = 10, timeout = 8000 } = options;
  const cacheKey = `scholar:${query}:${maxResults}`;
  
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  try {
    const searchUrl = `https://scholar.google.com/scholar?q=${encodeURIComponent(query)}&hl=es&num=${Math.min(maxResults, 20)}`;
    const response = await fetchWithTimeout(searchUrl, { headers: HEADERS }, timeout);

    if (!response.ok) return [];

    const html = await response.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    const results: AcademicResult[] = [];

    for (const article of Array.from(doc.querySelectorAll(".gs_ri")).slice(0, maxResults)) {
      const titleEl = article.querySelector(".gs_rt a");
      const snippetEl = article.querySelector(".gs_rs");
      const infoEl = article.querySelector(".gs_a");
      const citedEl = article.querySelector(".gs_fl a");
      
      if (titleEl) {
        const info = infoEl?.textContent?.trim() || "";
        const authors = info.match(/^([^-]+)/)?.[1]?.trim() || "";
        const year = info.match(/\b(19|20)\d{2}\b/)?.[0] || "";
        const citedMatch = citedEl?.textContent?.match(/Cited by (\d+)/i);
        
        const result: AcademicResult = {
          title: titleEl.textContent?.trim() || "",
          authors,
          year,
          url: titleEl.getAttribute("href") || "",
          abstract: snippetEl?.textContent?.trim() || "",
          citations: citedMatch ? parseInt(citedMatch[1]) : undefined,
          source: "scholar"
        };
        result.citation = formatAPA(result);
        result.score = scoreResult(result, query);
        results.push(result);
      }
    }

    await setCache(cacheKey, results);
    return results;
  } catch (error) {
    console.error("[Scholar] Error:", error);
    return [];
  }
}

// ============================================
// DUCKDUCKGO (Free, No limits)
// ============================================

export async function searchDuckDuckGo(query: string, options: SearchOptions = {}): Promise<AcademicResult[]> {
  const { maxResults = 10, timeout = 8000 } = options;
  const cacheKey = `ddg:${query}:${maxResults}`;
  
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  try {
    const ddg = await import("duck-duck-scrape");
    const academicQuery = enhanceQuery(query, "duckduckgo");
    
    const searchResults = await ddg.search(academicQuery, {
      safeSearch: ddg.SafeSearchType.OFF
    });

    const results: AcademicResult[] = [];
    
    for (const r of (searchResults.results || []).slice(0, maxResults)) {
      const yearMatch = (r.title + " " + r.description)?.match(/\b(19|20)\d{2}\b/);
      
      const result: AcademicResult = {
        title: r.title || "",
        authors: "",
        year: yearMatch?.[0] || "",
        url: r.url || "",
        abstract: r.description || "",
        source: "duckduckgo"
      };
      result.citation = formatAPA(result);
      result.score = scoreResult(result, query);
      results.push(result);
    }

    await setCache(cacheKey, results);
    return results;
  } catch (error) {
    console.error("[DuckDuckGo] Error:", error);
    return [];
  }
}

// ============================================
// WEB OF SCIENCE (requires API key)
// ============================================

const WOS_API_KEY = process.env.WOS_API_KEY || "";

export async function searchWOS(query: string, options: SearchOptions = {}): Promise<AcademicResult[]> {
  if (!WOS_API_KEY) return [];
  
  const { maxResults = 10, timeout = 10000 } = options;
  const cacheKey = `wos:${query}:${maxResults}`;
  
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetchWithTimeout(
      "https://wos-api.clarivate.com/api/wos",
      {
        method: "POST",
        headers: {
          "X-ApiKey": WOS_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ query, limit: maxResults })
      },
      timeout
    );

    if (!response.ok) return [];

    const data = await response.json();
    const records = data.Data?.Records?.records?.REC || [];

    const results = records.map((rec: any) => {
      const result: AcademicResult = {
        title: rec.static_data?.summary?.titles?.title?.[0]?.content || "",
        authors: rec.static_data?.summary?.names?.name?.map((n: any) => n.display_name).join(", ") || "",
        year: rec.static_data?.summary?.pub_info?.pubyear || "",
        journal: rec.static_data?.summary?.titles?.title?.find((t: any) => t.type === "source")?.content || "",
        doi: rec.dynamic_data?.cluster_related?.identifiers?.identifier?.find((i: any) => i.type === "doi")?.value || "",
        url: "",
        citations: rec.dynamic_data?.citation_related?.tc_list?.silo_tc?.local_count || 0,
        source: "wos" as const
      };
      if (result.doi) result.url = `https://doi.org/${result.doi}`;
      result.citation = formatAPA(result);
      result.score = scoreResult(result, query);
      return result;
    });

    await setCache(cacheKey, results);
    return results;
  } catch (error) {
    console.error("[WOS] Error:", error);
    return [];
  }
}

// ============================================
// UNIFIED PARALLEL SEARCH
// ============================================

export interface UnifiedSearchOptions extends SearchOptions {
  sources?: Array<"scopus" | "scielo" | "pubmed" | "scholar" | "duckduckgo" | "wos">;
}

export async function searchAllSources(query: string, options: UnifiedSearchOptions = {}): Promise<{
  query: string;
  totalResults: number;
  sources: Record<string, boolean>;
  results: AcademicResult[];
  timing: number;
}> {
  const startTime = Date.now();
  const { 
    maxResults = 15, 
    sources = ["scopus", "scielo", "pubmed", "scholar", "duckduckgo"],
    timeout = 10000
  } = options;
  
  const perSource = Math.ceil(maxResults / sources.length) + 2; // Get extra for dedup
  const enabledSources: Record<string, boolean> = {};
  const searchFunctions: Array<() => Promise<AcademicResult[]>> = [];

  // Build parallel search array
  if (sources.includes("scopus") && SCOPUS_API_KEY) {
    enabledSources.scopus = true;
    searchFunctions.push(() => searchScopus(query, { maxResults: perSource, timeout }));
  }
  
  if (sources.includes("scielo")) {
    enabledSources.scielo = true;
    searchFunctions.push(() => searchScielo(query, { maxResults: perSource, timeout }));
  }
  
  if (sources.includes("pubmed")) {
    enabledSources.pubmed = true;
    searchFunctions.push(() => searchPubMed(query, { maxResults: perSource, timeout }));
  }
  
  if (sources.includes("scholar")) {
    enabledSources.scholar = true;
    searchFunctions.push(() => searchScholar(query, { maxResults: perSource, timeout }));
  }
  
  if (sources.includes("duckduckgo")) {
    enabledSources.duckduckgo = true;
    searchFunctions.push(() => searchDuckDuckGo(query, { maxResults: perSource, timeout }));
  }
  
  if (sources.includes("wos") && WOS_API_KEY) {
    enabledSources.wos = true;
    searchFunctions.push(() => searchWOS(query, { maxResults: perSource, timeout }));
  }

  // Execute all searches in parallel
  const allResults = await Promise.allSettled(searchFunctions.map(fn => fn()));
  
  // Collect results
  const results: AcademicResult[] = [];
  
  for (const result of allResults) {
    if (result.status === "fulfilled") {
      results.push(...result.value);
    }
  }

  // Smart deduplication using title similarity
  const uniqueResults: AcademicResult[] = [];
  
  for (const result of results) {
    const isDuplicate = uniqueResults.some(existing => 
      similarity(existing.title, result.title) > 0.8
    );
    
    if (!isDuplicate) {
      uniqueResults.push(result);
    }
  }

  // Sort by score (quality), then citations, then year
  uniqueResults.sort((a, b) => {
    // First by score
    const scoreDiff = (b.score || 0) - (a.score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    
    // Then by citations
    const citeDiff = (b.citations || 0) - (a.citations || 0);
    if (citeDiff !== 0) return citeDiff;
    
    // Then by year
    return parseInt(b.year || "0") - parseInt(a.year || "0");
  });

  const timing = Date.now() - startTime;
  console.log(`[AcademicSearch] "${query}" → ${uniqueResults.length} results in ${timing}ms`);

  return {
    query,
    totalResults: uniqueResults.length,
    sources: enabledSources,
    results: uniqueResults.slice(0, maxResults),
    timing
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
