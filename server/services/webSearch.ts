import { JSDOM } from "jsdom"; import { Readability } from "@mozilla/readability"; import { HTTP_HEADERS, TIMEOUTS, LIMITS } from "../lib/constants";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  authors?: string;
  year?: string;
  citation?: string;
  imageUrl?: string;
  siteName?: string;
  publishedDate?: string;
  canonicalUrl?: string;
}

export interface WebSearchResponse {
  query: string;
  results: SearchResult[];
  contents: { url: string; title: string; content: string; imageUrl?: string; siteName?: string; publishedDate?: string }[];
}

const ACADEMIC_PATTERNS = [
  // Citation requests
  /dame.*cita/i,
  /cita.*(apa|mla|chicago|harvard|ieee|vancouver)/i,
  /formato\s*(apa|mla|chicago|harvard|ieee|vancouver)/i,
  /apa\s*7/i,
  /normas?\s*apa/i,
  /estilo\s*(apa|mla)/i,
  /referencia.*bibliogr[áa]fica/i,
  
  // Scientific articles - Spanish
  /art[ií]culo.*cient[ií]fico/i,
  /art[ií]culos?\s+cient[ií]ficos?/i,
  /investigaci[óo]n\s+(sobre|de|del)/i,
  /estudio.*cient[ií]fico/i,
  /publicaci[óo]n\s+acad[ée]mica/i,
  /paper\s+(sobre|de|del)/i,
  /tesis\s+(sobre|de|del)/i,
  /revista.*cient[ií]fica/i,
  
  // "buscame X articulos cientificos"
  /buscame\s+\d+\s+art[ií]culos?/i,
  /buscarme\s+\d+\s+art[ií]culos?/i,
  /busca\s+\d+\s+art[ií]culos?/i,
  /dame\s+\d+\s+art[ií]culos?/i,
  /necesito\s+\d+\s+art[ií]culos?/i,
  /encontrar\s+\d+\s+art[ií]culos?/i,
  
  // "articulos de/sobre"
  /art[ií]culos?\s+(de|sobre|del)\s+/i,
  /busca.*art[ií]culo.*cient[ií]fico/i,
  /buscame.*art[ií]culo/i,
  
  // Academic sources
  /scholar/i,
  /scopus/i,
  /scielo/i,
  /pubmed/i,
  /web\s*of\s*science/i,
  
  // English patterns
  /academic\s+(article|paper|research)/i,
  /scientific\s+(article|paper|study)/i,
  /peer[\s-]?review/i,
  /bibliography/i,
  /citation\s+(in|for|style)/i,
  /research\s+paper/i,
  
  // Additional Spanish patterns
  /necesito.*cita/i,
  /quiero.*cita/i,
  /papers?\s+acad[ée]micos?/i,
  /estudios?\s+acad[ée]micos?/i,
];

const WEB_SEARCH_PATTERNS = [
  /qu[eé]\s+es\s+/i,
  /qui[eé]n\s+es\s+/i,
  /cu[aá]ndo\s+/i,
  /d[oó]nde\s+/i,
  /c[oó]mo\s+\w+\s+(funciona|trabaja|opera|works)/i,
  /dame\s+\d*\s*(noticias|artículos?)/i,
  /noticias\s+(sobre|de)/i,
  /[uú]ltimas?\s+noticias/i,
  /quisiera\s+(que\s+)?(me\s+)?ayud(es|a)\s+a\s+buscar/i,
  /ayúdame\s+a\s+buscar/i,
  /buscar\s+\d*\s*artículos?/i,
  /encuentra(me)?\s+\d*\s*(artículos?|información)/i,
  /investiga\s+(sobre|acerca)/i,
  /información\s+(sobre|de|del|acerca)/i,
  /precio\s+(de|del|actual)/i,
  /busca\s+(en\s+)?(internet|web|online)?/i,
  /buscar\s+/i,
  /investiga\s+/i,
  /informaci[oó]n\s+(sobre|de|del|acerca)/i,
  /actualidad\s+(de|sobre)/i,
  /\bhoy\b/i,
  /actual(es|mente)?/i,
  /202[4-9]|203[0-9]/i,
  /\b(clima|tiempo|weather)\s+(en|de|para|in|for)/i,
  /resultados?\s+(de|del)/i,
  /estad[ií]sticas?\s+(de|del|sobre)/i,
  /cotizaci[oó]n|stock|accion(es)?/i,
  /what\s+is\s+/i,
  /who\s+is\s+/i,
  /when\s+(did|does|is|was|will)/i,
  /where\s+(is|are|can|do)/i,
  /how\s+(to|does|do|can|is)/i,
  /latest\s+(news|update|info)/i,
  /current\s+(price|status|situation)/i,
  /search\s+(for|about|the)/i,
  /find\s+(out|info|about|me)/i,
  /look\s+up\s+/i,
  /tell\s+me\s+about\s+/i,
  /news\s+(about|on|from)/i,
  /\btoday\b/i,
  /\brecent(ly)?\b/i,
];

function getHeaders() {
  return {
    "User-Agent": HTTP_HEADERS.USER_AGENT,
    "Accept": HTTP_HEADERS.ACCEPT_HTML,
    "Accept-Language": HTTP_HEADERS.ACCEPT_LANGUAGE
  };
}

interface PageMetadata {
  title: string;
  text: string;
  imageUrl?: string;
  canonicalUrl?: string;
  siteName?: string;
  publishedDate?: string;
}

const LAZY_IMAGE_ATTRIBUTES = [
  "data-src",
  "data-lazy-src",
  "data-original",
  "data-url",
];

const SRCSET_ATTRIBUTES = [
  "data-srcset",
  "data-lazy-srcset",
  "srcset",
];

function resolveAbsoluteUrl(rawUrl: string | null | undefined, baseUrl: string): string | undefined {
  if (!rawUrl) return undefined;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) {
    return undefined;
  }

  try {
    return trimmed.startsWith("http") ? trimmed : new URL(trimmed, baseUrl).href;
  } catch {
    return undefined;
  }
}

function pickBestSrcsetUrl(srcset: string | null | undefined, baseUrl: string): string | undefined {
  if (!srcset) return undefined;

  const candidates = srcset
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [rawUrl, descriptor] = entry.split(/\s+/, 2);
      const width = descriptor?.endsWith("w") ? Number.parseInt(descriptor, 10) : 0;
      return {
        url: resolveAbsoluteUrl(rawUrl, baseUrl),
        width: Number.isFinite(width) ? width : 0,
      };
    })
    .filter((candidate): candidate is { url: string; width: number } => Boolean(candidate.url))
    .sort((a, b) => b.width - a.width);

  return candidates[0]?.url;
}

function scoreImageCandidate(img: HTMLImageElement, url: string): number {
  const width = Number.parseInt(img.getAttribute("width") || "0", 10) || 0;
  const height = Number.parseInt(img.getAttribute("height") || "0", 10) || 0;
  const alt = (img.getAttribute("alt") || "").toLowerCase();
  const className = (img.getAttribute("class") || "").toLowerCase();
  const lowerUrl = url.toLowerCase();

  let score = 0;

  if (width >= 300) score += 2;
  if (height >= 180) score += 2;
  if (width * height >= 60_000) score += 2;
  if (alt.length >= 10) score += 1;

  if (/(logo|icon|avatar|favicon|flag|sprite)/.test(className)) score -= 4;
  if (/(logo|icon|avatar|favicon|flag|sprite|pdf\.gif|1x1|spacer)/.test(lowerUrl)) score -= 4;
  if (width > 0 && width < 80) score -= 3;
  if (height > 0 && height < 80) score -= 3;

  return score;
}

function extractPreviewImageUrl(doc: Document, baseUrl: string): string | undefined {
  const metadataCandidates = [
    doc.querySelector('meta[property="og:image"]')?.getAttribute("content"),
    doc.querySelector('meta[name="twitter:image"]')?.getAttribute("content"),
    doc.querySelector('meta[itemprop="image"]')?.getAttribute("content"),
    doc.querySelector('link[rel="image_src"]')?.getAttribute("href"),
  ];

  for (const candidate of metadataCandidates) {
    const resolved = resolveAbsoluteUrl(candidate, baseUrl);
    if (resolved) return resolved;
  }

  let bestImage: { url: string; score: number } | null = null;
  for (const img of Array.from(doc.querySelectorAll("img")).slice(0, 24)) {
    const directCandidate =
      LAZY_IMAGE_ATTRIBUTES.map((attr) => img.getAttribute(attr)).find(Boolean) ||
      pickBestSrcsetUrl(
        SRCSET_ATTRIBUTES.map((attr) => img.getAttribute(attr)).find(Boolean),
        baseUrl
      ) ||
      img.getAttribute("src");

    const resolvedUrl = resolveAbsoluteUrl(directCandidate, baseUrl);
    if (!resolvedUrl) continue;

    const score = scoreImageCandidate(img, resolvedUrl);
    if (!bestImage || score > bestImage.score) {
      bestImage = { url: resolvedUrl, score };
    }
  }

  return bestImage?.url;
}

export function extractPreviewImageUrlFromHtml(html: string, url: string): string | undefined {
  const dom = new JSDOM(html, { url });
  return extractPreviewImageUrl(dom.window.document, url);
}

// Export as fetchUrl for compatibility with agentExecutor
export async function fetchUrl(url: string, options?: { extractText?: boolean; maxLength?: number }): Promise<PageMetadata | null> {
  return fetchPageContent(url);
}

export async function fetchPageContent(url: string): Promise<PageMetadata | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUTS.PAGE_FETCH);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: getHeaders()
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return null;

    const html = await response.text();
    const dom = new JSDOM(html, { url });
    const doc = dom.window.document;

    const imageUrl = extractPreviewImageUrl(doc, url);

    // Extract canonical URL and normalize to absolute
    const canonicalEl = doc.querySelector('link[rel="canonical"]');
    const rawCanonical = canonicalEl?.getAttribute("href");
    let canonicalUrl = url;
    if (rawCanonical) {
      try {
        canonicalUrl = rawCanonical.startsWith("http") ? rawCanonical : new URL(rawCanonical, url).href;
      } catch {
        canonicalUrl = url;
      }
    }

    // Extract site name
    const siteName = doc.querySelector('meta[property="og:site_name"]')?.getAttribute("content") ||
      doc.querySelector('meta[name="application-name"]')?.getAttribute("content");

    // Extract published date
    const publishedDate = doc.querySelector('meta[property="article:published_time"]')?.getAttribute("content") ||
      doc.querySelector('meta[name="date"]')?.getAttribute("content") ||
      doc.querySelector('time[datetime]')?.getAttribute("datetime");

    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (article?.textContent) {
      return {
        title: article.title || "",
        text: article.textContent.replace(/\s+/g, " ").trim(),
        imageUrl,
        canonicalUrl,
        siteName: siteName || undefined,
        publishedDate: publishedDate || undefined
      };
    }

    return {
      title: doc.querySelector("title")?.textContent || "",
      text: "",
      imageUrl,
      canonicalUrl: canonicalUrl || undefined,
      siteName: siteName || undefined,
      publishedDate: publishedDate || undefined
    };
  } catch {
    return null;
  }
}

// Quick metadata extraction without full page content (for speed)
export async function fetchPageMetadata(url: string): Promise<Omit<PageMetadata, "text"> | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000); // 2s timeout for metadata only

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        ...getHeaders(),
        "Range": "bytes=0-50000" // Only fetch first 50KB for metadata
      }
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const html = await response.text();
    const dom = new JSDOM(html, { url });
    const doc = dom.window.document;

    const imageUrl = extractPreviewImageUrl(doc, url);

    // Normalize canonical URL to absolute
    const rawCanonical = doc.querySelector('link[rel="canonical"]')?.getAttribute("href");
    let canonicalUrl = url;
    if (rawCanonical) {
      try {
        canonicalUrl = rawCanonical.startsWith("http") ? rawCanonical : new URL(rawCanonical, url).href;
      } catch {
        canonicalUrl = url;
      }
    }

    const siteName = doc.querySelector('meta[property="og:site_name"]')?.getAttribute("content");
    const publishedDate = doc.querySelector('meta[property="article:published_time"]')?.getAttribute("content");
    const title = doc.querySelector('meta[property="og:title"]')?.getAttribute("content") ||
      doc.querySelector("title")?.textContent || "";

    return { title, imageUrl, canonicalUrl: canonicalUrl || undefined, siteName: siteName || undefined, publishedDate: publishedDate || undefined };
  } catch {
    return null;
  }
}

function sanitizeWebQuery(raw: string): string {
  if (!raw || typeof raw !== "string") return "";
  let q = raw;
  q = q.replace(/<[^>]*>/g, "");
  // eslint-disable-next-line no-control-regex 
  q = q.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  q = q.normalize("NFC");
  q = q.replace(/\s+/g, " ").trim();
  if (q.length > 500) q = q.substring(0, 500).trim();
  return q;
}

export async function searchWeb(query: string, maxResults: number = LIMITS.MAX_SEARCH_RESULTS): Promise<WebSearchResponse> {
  const sanitized = sanitizeWebQuery(query);
  if (!sanitized) return { query, results: [], contents: [] };
  const results: SearchResult[] = [];
  const isPeruCompanyQuery = /\b(?:empresa|empresas|ruc|raz[oó]n\s+social|per[uú]|compan(?:y|ies)|business)\b/i.test(
    sanitized
  );
  const domainCounts = new Map<string, number>();
  const seenUrls = new Set<string>();
  const MAX_PER_DOMAIN = 5; // Allow up to 5 results per domain for more coverage

  // Helper to extract domain from URL
  const extractDomain = (url: string): string => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url.split("/")[2]?.replace(/^www\./, "") || "";
    }
  };

  const pushResult = (candidate: SearchResult): void => {
    if (!candidate.url || results.length >= maxResults) return;
    if (candidate.url.includes("duckduckgo.com") || seenUrls.has(candidate.url)) return;

    const domain = extractDomain(candidate.url);
    const count = domainCounts.get(domain) || 0;
    if (count >= MAX_PER_DOMAIN) return;

    domainCounts.set(domain, count + 1);
    seenUrls.add(candidate.url);
    results.push(candidate);
  };

  // Parse results from a DuckDuckGo HTML page
  const parseDDGPage = (html: string): void => {
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    for (const result of Array.from(doc.querySelectorAll(".result"))) {
      if (results.length >= maxResults) break;

      const titleEl = result.querySelector(".result__title a");
      const snippetEl = result.querySelector(".result__snippet");

      if (titleEl) {
        const href = titleEl.getAttribute("href") || "";
        let url = href;

        if (href.includes("uddg=")) {
          const match = href.match(/uddg=([^&]+)/);
          if (match) url = decodeURIComponent(match[1]);
        }

        pushResult({
          title: titleEl.textContent?.trim() || "",
          url,
          snippet: snippetEl?.textContent?.trim() || ""
        });
      }
    }
  };

  const parseUniversidadPeruDirectory = (html: string): void => {
    const dom = new JSDOM(html, { url: "https://www.universidadperu.com/empresas/" });
    const doc = dom.window.document;
    const tokens = sanitized
      .toLowerCase()
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3)
      .slice(0, 6);
    let relaxedAdds = 0;

    for (const anchor of Array.from(doc.querySelectorAll("a[href*=\"/empresas/\"]"))) {
      if (results.length >= maxResults) break;
      const href = anchor.getAttribute("href") || "";
      if (!href) continue;

      let url = "";
      try {
        url = new URL(href, "https://www.universidadperu.com").href;
      } catch {
        continue;
      }

      const normalized = url.toLowerCase();
      if (normalized.endsWith("/empresas/") || normalized.endsWith("/empresas")) continue;

      const title = anchor.textContent?.replace(/\s+/g, " ").trim() || "";
      if (!title) continue;

      const contextText = (anchor.closest("article, li, tr, div")?.textContent || title)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 220);
      const searchableText = `${title} ${contextText}`.toLowerCase();
      const hasTokenMatch = tokens.length === 0 || tokens.some((token) => searchableText.includes(token));
      if (!hasTokenMatch) {
        if (!isPeruCompanyQuery || relaxedAdds >= 8) continue;
        relaxedAdds += 1;
      }

      pushResult({
        title,
        url,
        snippet: contextText || "Perfil empresarial en UniversidadPeru.",
      });
    }
  };

  // Fetch a single DuckDuckGo search page with timeout
  const fetchDDGPage = async (pageUrl: string, timeoutMs: number = 4000): Promise<string | null> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(pageUrl, {
        headers: getHeaders(),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) return null;
      return await response.text();
    } catch {
      clearTimeout(timeout);
      return null;
    }
  };

  try {
    // Page 1: Initial search
    const baseUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(sanitized)}`;
    const page1Html = await fetchDDGPage(baseUrl);
    if (page1Html) {
      parseDDGPage(page1Html);
    }

    // Targeted source enrichment for Peruvian company profiles.
    // This helps queries about companies in Peru consistently include universidadperu.com data.
    const universidadPeruQuery = `site:universidadperu.com/empresas ${sanitized}`;
    const universidadPeruHtml = await fetchDDGPage(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(universidadPeruQuery)}`,
      3500
    );
    if (universidadPeruHtml) {
      parseDDGPage(universidadPeruHtml);
    }

    // Direct fallback scraper for UniversidadPeru company directory.
    // Ensures domain coverage even when DuckDuckGo ranking is sparse.
    const hasUniversidadPeruResult = results.some((r) => r.url.includes("universidadperu.com/empresas/"));
    if ((isPeruCompanyQuery || !hasUniversidadPeruResult) && results.length < maxResults) {
      const universidadPeruDirectoryHtml = await fetchDDGPage(
        "https://www.universidadperu.com/empresas/",
        3500
      );
      if (universidadPeruDirectoryHtml) {
        parseUniversidadPeruDirectory(universidadPeruDirectoryHtml);
      }
    }

    // Pages 2+ : DuckDuckGo HTML paginates via POST with form data (s=offset, dc=offset+1)
    // Each page returns ~25-30 results. Fetch more pages concurrently if we need more results.
    const resultsAfterPage1 = results.length;
    if (results.length < maxResults) {
      const pagesToFetch: number[] = [];
      const resultsPerPage = 30;
      for (let offset = resultsPerPage; offset < maxResults * 2; offset += resultsPerPage) {
        pagesToFetch.push(offset);
        if (pagesToFetch.length >= 3) break; // Max 3 extra pages (total ~120 raw results)
      }

      const extraPages = await Promise.allSettled(
        pagesToFetch.map(async (offset) => {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);
          try {
            const formBody = `q=${encodeURIComponent(sanitized)}&s=${offset}&dc=${offset + 1}&o=json&api=d.js`;
            const response = await fetch("https://html.duckduckgo.com/html/", {
              method: "POST",
              headers: {
                ...getHeaders(),
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: formBody,
              signal: controller.signal,
            });
            clearTimeout(timeout);
            if (!response.ok) return null;
            return await response.text();
          } catch {
            clearTimeout(timeout);
            return null;
          }
        })
      );

      for (const pageResult of extraPages) {
        if (results.length >= maxResults) break;
        if (pageResult.status === "fulfilled" && pageResult.value) {
          parseDDGPage(pageResult.value);
        }
      }
    }
    console.log(`[WebSearch] Pagination complete: page1=${resultsAfterPage1}, total=${results.length}/${maxResults}`);
  } catch (error) {
    console.error("Search error:", error);
  }

  console.log(`[WebSearch] Total unique results: ${results.length}, unique domains: ${domainCounts.size}`);

  const contents: { url: string; title: string; content: string; imageUrl?: string; siteName?: string; publishedDate?: string }[] = [];

  // Create metadata map to enrich results (include canonicalUrl)
  const metadataMap = new Map<string, { imageUrl?: string; siteName?: string; publishedDate?: string; canonicalUrl?: string }>();

  // Fetch FULL page content for top 5 results (for LLM context), metadata-only for the rest
  const FULL_CONTENT_COUNT = 5;
  const FULL_CONTENT_MAX_CHARS = 1500; // Enough text per source for meaningful LLM context
  const TOTAL_FETCH_TIMEOUT = 10000; // Allow more time for 50+ results

  // Phase 1: Fetch full content for top results (these give the LLM real information)
  const fullContentPromises = results.slice(0, FULL_CONTENT_COUNT).map(async (result) => {
    try {
      const page = await fetchPageContent(result.url);
      if (page) {
        metadataMap.set(result.url, {
          imageUrl: page.imageUrl,
          siteName: page.siteName,
          publishedDate: page.publishedDate,
          canonicalUrl: page.canonicalUrl
        });
        contents.push({
          url: result.url,
          title: page.title || result.title,
          content: (page.text || result.snippet || "").slice(0, FULL_CONTENT_MAX_CHARS),
          imageUrl: page.imageUrl,
          siteName: page.siteName,
          publishedDate: page.publishedDate
        });
      }
    } catch {
      // intentionally ignored (best-effort)
    }
  });

  // Phase 2: Fetch metadata-only for remaining results (fast, for UI enrichment)
  const metadataPromises = results.slice(FULL_CONTENT_COUNT, LIMITS.MAX_CONTENT_FETCH).map(async (result) => {
    try {
      const metadata = await fetchPageMetadata(result.url);
      if (metadata) {
        metadataMap.set(result.url, {
          imageUrl: metadata.imageUrl,
          siteName: metadata.siteName,
          publishedDate: metadata.publishedDate,
          canonicalUrl: metadata.canonicalUrl
        });
        contents.push({
          url: result.url,
          title: metadata.title || result.title,
          content: result.snippet?.slice(0, LIMITS.MAX_CONTENT_LENGTH) || "",
          imageUrl: metadata.imageUrl,
          siteName: metadata.siteName,
          publishedDate: metadata.publishedDate
        });
      }
    } catch { 
      // intentionally ignored (best-effort)
    }
  });

  // Race all fetches against timeout
  await Promise.race([
    Promise.allSettled([...fullContentPromises, ...metadataPromises]),
    new Promise<void>(resolve => setTimeout(resolve, TOTAL_FETCH_TIMEOUT))
  ]);

  // Enrich results with metadata from fetched pages
  const enrichedResults = results.map(r => {
    const metadata = metadataMap.get(r.url);
    if (metadata) {
      return {
        ...r,
        imageUrl: metadata.imageUrl,
        siteName: metadata.siteName,
        publishedDate: metadata.publishedDate,
        canonicalUrl: metadata.canonicalUrl
      };
    }
    return r;
  });

  console.log(`[WebSearch] Query: "${query}" - Found ${results.length} unique sources, fetched ${contents.length} pages, ${Array.from(metadataMap.values()).filter(m => m.imageUrl).length} with images`);

  return { query, results: enrichedResults, contents };
}

export async function searchScholar(query: string, maxResults: number = LIMITS.MAX_SEARCH_RESULTS): Promise<SearchResult[]> {
  const sanitized = sanitizeWebQuery(query);
  if (!sanitized) return [];
  const results: SearchResult[] = [];

  try {
    const searchUrl = `https://scholar.google.com/scholar?q=${encodeURIComponent(sanitized)}&hl=es`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const response = await fetch(searchUrl, { headers: getHeaders(), signal: controller.signal });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error("Scholar search failed:", response.status);
      return results;
    }

    const html = await response.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    for (const article of Array.from(doc.querySelectorAll(".gs_ri")).slice(0, maxResults)) {
      const titleEl = article.querySelector(".gs_rt a");
      const snippetEl = article.querySelector(".gs_rs");
      const infoEl = article.querySelector(".gs_a");

      if (titleEl) {
        const title = titleEl.textContent?.trim() || "";
        const url = titleEl.getAttribute("href") || "";
        const snippet = snippetEl?.textContent?.trim() || "";
        const info = infoEl?.textContent?.trim() || "";

        const authors = info.match(/^([^-]+)/)?.[1]?.trim() || "";
        const year = info.match(/\b(19|20)\d{2}\b/)?.[0] || "";

        if (title && (url || snippet)) {
          results.push({
            title,
            url,
            snippet,
            authors,
            year,
            citation: `${authors} (${year}). ${title}. Recuperado de ${url}`
          });
        }
      }
    }
  } catch (error) {
    console.error("Scholar search error:", error);
  }

  return results;
}

export function needsAcademicSearch(message: string): boolean {
  return ACADEMIC_PATTERNS.some(pattern => pattern.test(message));
}

export function needsWebSearch(message: string): boolean {
  return WEB_SEARCH_PATTERNS.some(pattern => pattern.test(message));
}
