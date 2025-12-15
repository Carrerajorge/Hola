import { ToolDefinition, ExecutionContext, ToolResult } from "../types";
import { browserSessionManager } from "../../browser";
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
      sessionId = await browserSessionManager.createSession(
        `Search: ${query}`,
        { timeout: 30000 },
        undefined
      );
      
      browserSessionManager.startScreenshotStreaming(sessionId, 1500);
      
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
        progress: 30,
        detail: { browserSessionId: sessionId, query }
      });

      const navResult = await browserSessionManager.navigate(sessionId, searchUrl);
      
      if (!navResult.success) {
        return {
          success: false,
          error: navResult.error || "Failed to load search results"
        };
      }

      const pageState = await browserSessionManager.getPageState(sessionId);
      
      const results: { title: string; url: string; snippet: string }[] = [];
      
      if (pageState?.links) {
        for (const link of pageState.links) {
          if (link.href && !link.href.includes("duckduckgo") && !link.href.includes("google.com") && !link.href.includes("bing.com")) {
            if (results.length >= maxResults) break;
            results.push({
              title: link.text || link.href,
              url: link.href,
              snippet: ""
            });
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
        browserSessionManager.stopScreenshotStreaming(sessionId);
        // Delay closing to allow frontend to receive final screenshot
        setTimeout(async () => {
          await browserSessionManager.closeSession(sessionId!).catch(() => {});
        }, 5000);
      }
    }
  }
};
