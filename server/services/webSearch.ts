import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
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

export function needsWebSearch(message: string): boolean {
  const searchTriggers = [
    /qué es\s+\w+/i,
    /quién es\s+\w+/i,
    /cuándo\s+/i,
    /dónde\s+/i,
    /cómo\s+\w+\s+(funciona|trabaja|opera)/i,
    /noticias\s+(sobre|de)/i,
    /últimas?\s+noticias/i,
    /precio\s+(de|del|actual)/i,
    /busca\s+(en\s+)?(internet|web|online)/i,
    /buscar\s+/i,
    /investiga\s+/i,
    /información\s+(sobre|de|del|acerca)/i,
    /actualidad\s+(de|sobre)/i,
    /hoy\s+/i,
    /actual(es|mente)?/i,
    /2024|2025/i,
    /\b(clima|tiempo|weather)\s+(en|de|para)/i,
    /resultados?\s+(de|del)/i,
    /estadísticas?\s+(de|del|sobre)/i,
    /cotización|stock|accion(es)?/i,
  ];
  
  return searchTriggers.some(regex => regex.test(message));
}
