import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { HTTP_HEADERS, TIMEOUTS, LIMITS } from "../lib/constants";

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
  /dame.*cita/i,
  /cita.*(apa|mla|chicago|harvard|ieee|vancouver)/i,
  /formato\s*(apa|mla|chicago|harvard|ieee|vancouver)/i,
  /apa\s*7/i,
  /normas?\s*apa/i,
  /estilo\s*(apa|mla)/i,
  /referencia.*bibliogr[áa]fica/i,
  /art[ií]culo.*cient[ií]fico/i,
  /investigaci[óo]n\s+(sobre|de|del)/i,
  /estudio.*cient[ií]fico/i,
  /publicaci[óo]n\s+acad[ée]mica/i,
  /paper\s+(sobre|de|del)/i,
  /tesis\s+(sobre|de|del)/i,
  /revista.*cient[ií]fica/i,
  /scholar/i,
  /academic\s+(article|paper|research)/i,
  /scientific\s+(article|paper|study)/i,
  /peer[\s-]?review/i,
  /bibliography/i,
  /citation\s+(in|for|style)/i,
  /busca.*art[ií]culo.*cient[ií]fico/i,
  /necesito.*cita/i,
  /quiero.*cita/i,
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

    // Extract og:image, twitter:image, or first large image
    let imageUrl: string | undefined;
    const ogImage = doc.querySelector('meta[property="og:image"]')?.getAttribute("content");
    const twitterImage = doc.querySelector('meta[name="twitter:image"]')?.getAttribute("content");
    if (ogImage) {
      imageUrl = ogImage.startsWith("http") ? ogImage : new URL(ogImage, url).href;
    } else if (twitterImage) {
      imageUrl = twitterImage.startsWith("http") ? twitterImage : new URL(twitterImage, url).href;
    }

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

    // Extract og:image
    let imageUrl: string | undefined;
    const ogImage = doc.querySelector('meta[property="og:image"]')?.getAttribute("content");
    const twitterImage = doc.querySelector('meta[name="twitter:image"]')?.getAttribute("content");
    if (ogImage) {
      imageUrl = ogImage.startsWith("http") ? ogImage : new URL(ogImage, url).href;
    } else if (twitterImage) {
      imageUrl = twitterImage.startsWith("http") ? twitterImage : new URL(twitterImage, url).href;
    }

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

export async function searchWeb(query: string, maxResults: number = LIMITS.MAX_SEARCH_RESULTS): Promise<WebSearchResponse> {
  const results: SearchResult[] = [];
  const seenDomains = new Set<string>();

  // Helper to extract domain from URL
  const extractDomain = (url: string): string => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url.split("/")[2]?.replace(/^www\./, "") || "";
    }
  };

  try {
    // Request more results than needed to ensure diversity after deduplication
    const requestCount = Math.min(maxResults * 2, 30);
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(searchUrl, { headers: getHeaders() });

    if (!response.ok) {
      throw new Error(`Search failed: ${response.status}`);
    }

    const html = await response.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    for (const result of Array.from(doc.querySelectorAll(".result")).slice(0, requestCount)) {
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

        if (url && !url.includes("duckduckgo.com")) {
          const domain = extractDomain(url);

          // Skip duplicate domains to ensure source diversity
          if (seenDomains.has(domain)) continue;
          seenDomains.add(domain);

          results.push({
            title: titleEl.textContent?.trim() || "",
            url,
            snippet: snippetEl?.textContent?.trim() || ""
          });
        }
      }
    }
  } catch (error) {
    console.error("Search error:", error);
  }

  const contents: { url: string; title: string; content: string; imageUrl?: string; siteName?: string; publishedDate?: string }[] = [];

  // ULTRA-FAST: Only fetch metadata (no full page content) with 2s total timeout
  const TOTAL_FETCH_TIMEOUT = 2000;

  // Create metadata map to enrich results (include canonicalUrl)
  const metadataMap = new Map<string, { imageUrl?: string; siteName?: string; publishedDate?: string; canonicalUrl?: string }>();

  // Only fetch metadata (fast) not full content (slow) for top results
  const metadataPromises = results.slice(0, LIMITS.MAX_CONTENT_FETCH).map(async (result) => {
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
          content: result.snippet?.slice(0, TIMEOUTS.MAX_CONTENT_LENGTH) || "",
          imageUrl: metadata.imageUrl,
          siteName: metadata.siteName,
          publishedDate: metadata.publishedDate
        });
      }
    } catch { }
  });

  // Race against aggressive timeout
  await Promise.race([
    Promise.allSettled(metadataPromises),
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
  const results: SearchResult[] = [];

  try {
    const searchUrl = `https://scholar.google.com/scholar?q=${encodeURIComponent(query)}&hl=es`;
    const response = await fetch(searchUrl, { headers: getHeaders() });

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
