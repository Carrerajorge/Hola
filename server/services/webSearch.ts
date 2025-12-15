import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  authors?: string;
  year?: string;
  citation?: string;
}

interface WebSearchResponse {
  query: string;
  results: SearchResult[];
  contents: { url: string; title: string; content: string }[];
}

export async function searchWeb(query: string, maxResults: number = 5): Promise<WebSearchResponse> {
  const results: SearchResult[] = [];
  
  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    
    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
      }
    });
    
    if (!response.ok) {
      throw new Error(`Search failed with status: ${response.status}`);
    }
    
    const html = await response.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    
    const resultElements = doc.querySelectorAll(".result");
    
    for (const result of Array.from(resultElements).slice(0, maxResults)) {
      const titleEl = result.querySelector(".result__title a");
      const snippetEl = result.querySelector(".result__snippet");
      
      if (titleEl) {
        const href = titleEl.getAttribute("href") || "";
        let url = href;
        
        if (href.includes("uddg=")) {
          const match = href.match(/uddg=([^&]+)/);
          if (match) {
            url = decodeURIComponent(match[1]);
          }
        }
        
        if (url && !url.includes("duckduckgo.com")) {
          results.push({
            title: titleEl.textContent?.trim() || "",
            url: url,
            snippet: snippetEl?.textContent?.trim() || ""
          });
        }
      }
    }
  } catch (error) {
    console.error("Search error:", error);
  }
  
  const contents: { url: string; title: string; content: string }[] = [];
  
  for (const result of results.slice(0, 3)) {
    try {
      const content = await fetchPageContent(result.url);
      if (content) {
        contents.push({
          url: result.url,
          title: content.title || result.title,
          content: content.text.slice(0, 2000)
        });
      }
    } catch (error) {
      console.error(`Failed to fetch ${result.url}:`, error);
    }
  }
  
  return { query, results, contents };
}

async function fetchPageContent(url: string): Promise<{ title: string; text: string } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) return null;
    
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return null;
    
    const html = await response.text();
    const dom = new JSDOM(html, { url });
    
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    
    if (article && article.textContent) {
      return {
        title: article.title || "",
        text: article.textContent.replace(/\s+/g, " ").trim()
      };
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

export async function searchScholar(query: string, maxResults: number = 5): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  
  try {
    const searchUrl = `https://scholar.google.com/scholar?q=${encodeURIComponent(query)}&hl=es`;
    
    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
      }
    });
    
    if (!response.ok) {
      console.error("Scholar search failed:", response.status);
      return results;
    }
    
    const html = await response.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    
    const articles = doc.querySelectorAll(".gs_ri");
    
    for (const article of Array.from(articles).slice(0, maxResults)) {
      const titleEl = article.querySelector(".gs_rt a");
      const snippetEl = article.querySelector(".gs_rs");
      const infoEl = article.querySelector(".gs_a");
      
      if (titleEl) {
        const title = titleEl.textContent?.trim() || "";
        const url = titleEl.getAttribute("href") || "";
        const snippet = snippetEl?.textContent?.trim() || "";
        const info = infoEl?.textContent?.trim() || "";
        
        const authorMatch = info.match(/^([^-]+)/);
        const yearMatch = info.match(/\b(19|20)\d{2}\b/);
        
        const authors = authorMatch ? authorMatch[1].trim() : "";
        const year = yearMatch ? yearMatch[0] : "";
        
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
  const academicTriggers = [
    /cita(s|ción|ciones)?\s+(en\s+)?(apa|mla|chicago|harvard|ieee|vancouver)/i,
    /referencia(s)?\s+bibliogr[áa]fica/i,
    /art[ií]culo(s)?\s+cient[ií]fico/i,
    /investigaci[óo]n\s+(sobre|de|del)/i,
    /estudio(s)?\s+(sobre|de|del|cient[ií]fico)/i,
    /publicaci[óo]n\s+acad[ée]mica/i,
    /paper(s)?\s+(sobre|de|del)/i,
    /tesis\s+(sobre|de|del)/i,
    /revista(s)?\s+cient[ií]fica/i,
    /scholar/i,
    /academic\s+(article|paper|research)/i,
    /scientific\s+(article|paper|study)/i,
    /peer[\s-]?review/i,
    /bibliography/i,
    /citation\s+(in|for|style)/i,
  ];
  
  return academicTriggers.some(regex => regex.test(message));
}

export function needsWebSearch(message: string): boolean {
  const searchTriggers = [
    /qu[eé]\s+es\s+/i,
    /qui[eé]n\s+es\s+/i,
    /cu[aá]ndo\s+/i,
    /d[oó]nde\s+/i,
    /c[oó]mo\s+\w+\s+(funciona|trabaja|opera|works)/i,
    /noticias\s+(sobre|de)/i,
    /[uú]ltimas?\s+noticias/i,
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
    /explain\s+(what|how|why)/i,
    /define\s+/i,
    /meaning\s+of\s+/i,
    /news\s+(about|on|from)/i,
    /\btoday\b/i,
    /\brecent(ly)?\b/i,
    /\bupdate\b/i,
  ];
  
  return searchTriggers.some(regex => regex.test(message));
}
