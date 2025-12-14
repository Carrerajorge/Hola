import { ToolDefinition, ExecutionContext, ToolResult } from "../types";
import { browserWorker } from "../../browser-worker";
import { extractWithReadability } from "../../extractor";

export const searchWebTool: ToolDefinition = {
  id: "search_web",
  name: "Search Web",
  description: "Search the web using a search engine and return results",
  category: "web",
  capabilities: ["search", "find", "lookup", "query", "google", "web search"],
  inputSchema: {
    query: { type: "string", description: "The search query", required: true },
    engine: { 
      type: "string", 
      description: "Search engine to use",
      enum: ["google", "duckduckgo", "bing"],
      default: "duckduckgo"
    },
    maxResults: { type: "number", description: "Maximum results to return", default: 5 }
  },
  outputSchema: {
    results: { type: "array", description: "Search results with title, url, snippet" },
    query: { type: "string", description: "The executed query" }
  },
  timeout: 60000,
  
  async execute(context: ExecutionContext, params: Record<string, any>): Promise<ToolResult> {
    const { query, engine = "duckduckgo", maxResults = 5 } = params;
    
    if (!query) {
      return {
        success: false,
        error: "No search query provided"
      };
    }

    let sessionId: string | null = null;
    
    try {
      sessionId = await browserWorker.createSession();
      
      const searchUrls: Record<string, string> = {
        google: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
        duckduckgo: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
        bing: `https://www.bing.com/search?q=${encodeURIComponent(query)}`
      };
      
      const searchUrl = searchUrls[engine] || searchUrls.duckduckgo;
      
      context.onProgress({
        runId: context.runId,
        stepId: `search_${context.stepIndex}`,
        status: "progress",
        message: `Searching for: ${query}`,
        progress: 30
      });

      const result = await browserWorker.navigate(sessionId, searchUrl, false);
      
      if (!result.success || !result.html) {
        return {
          success: false,
          error: result.error || "Failed to load search results"
        };
      }

      const results: { title: string; url: string; snippet: string }[] = [];
      
      if (engine === "duckduckgo") {
        const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
        const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([^<]*)<\/a>/gi;
        
        let match;
        const titles: string[] = [];
        const urls: string[] = [];
        const snippets: string[] = [];
        
        while ((match = linkRegex.exec(result.html)) !== null && titles.length < maxResults) {
          urls.push(match[1]);
          titles.push(match[2].replace(/<[^>]*>/g, "").trim());
        }
        
        while ((match = snippetRegex.exec(result.html)) !== null && snippets.length < maxResults) {
          snippets.push(match[1].replace(/<[^>]*>/g, "").trim());
        }
        
        for (let i = 0; i < Math.min(titles.length, maxResults); i++) {
          results.push({
            title: titles[i] || "",
            url: urls[i] || "",
            snippet: snippets[i] || ""
          });
        }
      } else {
        const extracted = extractWithReadability(result.html, searchUrl);
        if (extracted) {
          const links = extracted.links.slice(0, maxResults);
          for (const link of links) {
            if (link.href && !link.href.includes(engine)) {
              results.push({
                title: link.text || link.href,
                url: link.href,
                snippet: ""
              });
            }
          }
        }
      }

      return {
        success: true,
        data: {
          query,
          engine,
          results: results.slice(0, maxResults),
          totalFound: results.length
        },
        metadata: {
          query,
          engine,
          resultsCount: results.length
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    } finally {
      if (sessionId) {
        await browserWorker.destroySession(sessionId).catch(() => {});
      }
    }
  }
};
