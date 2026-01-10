import { z } from "zod";
import { searchWeb, searchScholar } from "../../services/webSearch";
import { validateOrThrow } from "../validation";
import { canonicalizeUrl } from "./canonicalizeUrl";
import { WebSearchRequestSchema, WebSearchResultSchema, type WebSearchRequest, type WebSearchResult } from "./types";

export interface ISearchAdapter {
  search(query: string, maxResults: number): Promise<WebSearchResult[]>;
  searchScholar?(query: string, maxResults: number): Promise<WebSearchResult[]>;
}

export class DuckDuckGoSearchAdapter implements ISearchAdapter {
  private readonly defaultMaxResults: number;
  
  constructor(defaultMaxResults: number = 10) {
    this.defaultMaxResults = defaultMaxResults;
  }
  
  async search(query: string, maxResults?: number): Promise<WebSearchResult[]> {
    const request: WebSearchRequest = validateOrThrow(
      WebSearchRequestSchema,
      { query, maxResults: maxResults ?? this.defaultMaxResults },
      "SearchAdapter.search"
    );
    
    try {
      const response = await searchWeb(request.query, request.maxResults);
      
      const results: WebSearchResult[] = [];
      
      for (const result of response.results) {
        try {
          const canonicalUrl = canonicalizeUrl(result.url);
          
          const webSearchResult: WebSearchResult = {
            url: result.url,
            canonicalUrl,
            title: result.title || "",
            snippet: result.snippet || "",
            authors: result.authors,
            year: result.year,
            citation: result.citation,
          };
          
          const validated = WebSearchResultSchema.safeParse(webSearchResult);
          if (validated.success) {
            results.push(validated.data);
          } else {
            console.warn(`[SearchAdapter] Invalid result from search:`, validated.error.message);
          }
        } catch (error) {
          console.warn(`[SearchAdapter] Failed to process search result:`, error);
        }
      }
      
      return results;
    } catch (error) {
      console.error(`[SearchAdapter] Search failed for query "${query}":`, error);
      throw new Error(`Search failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
  
  async searchScholar(query: string, maxResults?: number): Promise<WebSearchResult[]> {
    const request: WebSearchRequest = validateOrThrow(
      WebSearchRequestSchema,
      { query, maxResults: maxResults ?? this.defaultMaxResults, includeScholar: true },
      "SearchAdapter.searchScholar"
    );
    
    try {
      const response = await searchScholar(request.query, request.maxResults);
      
      const results: WebSearchResult[] = [];
      
      for (const result of response.results) {
        try {
          const canonicalUrl = canonicalizeUrl(result.url);
          
          const webSearchResult: WebSearchResult = {
            url: result.url,
            canonicalUrl,
            title: result.title || "",
            snippet: result.snippet || "",
            authors: result.authors,
            year: result.year,
            citation: result.citation,
          };
          
          const validated = WebSearchResultSchema.safeParse(webSearchResult);
          if (validated.success) {
            results.push(validated.data);
          }
        } catch (error) {
          console.warn(`[SearchAdapter] Failed to process scholar result:`, error);
        }
      }
      
      return results;
    } catch (error) {
      console.error(`[SearchAdapter] Scholar search failed for query "${query}":`, error);
      throw new Error(`Scholar search failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
}

export const searchAdapter = new DuckDuckGoSearchAdapter();
