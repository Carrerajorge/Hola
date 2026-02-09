/**
 * Academic Search Routes
 * Unified API for multiple academic databases:
 * - Scopus, SciELO, PubMed, Google Scholar, DuckDuckGo, Web of Science
 */

import { Router } from "express";
import { 
  searchAllSources,
  searchScopus,
  searchScielo,
  searchPubMed,
  searchScholar,
  searchDuckDuckGo,
  searchWOS,
  getSourcesStatus,
  AcademicResult
} from "../services/unifiedAcademicSearch";

export const academicSearchRouter = Router();

// GET /api/academic/status - Check which sources are available
academicSearchRouter.get("/status", async (req, res) => {
  try {
    const sources = getSourcesStatus();
    const available = Object.entries(sources)
      .filter(([_, v]) => v.available)
      .map(([k]) => k);
    
    res.json({
      totalSources: Object.keys(sources).length,
      availableSources: available.length,
      sources
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/academic/search - Search all available sources
academicSearchRouter.post("/search", async (req, res) => {
  try {
    const { 
      query, 
      maxResults = 10, 
      sources,
      yearFrom,
      yearTo,
      language
    } = req.body;

    if (!query) {
      return res.status(400).json({ error: "query is required" });
    }

    console.log(`[Academic] Unified search: "${query}" | sources: ${sources?.join(",") || "all"}`);

    const result = await searchAllSources(query, {
      maxResults,
      sources,
      yearFrom,
      yearTo,
      language
    });

    res.json(result);
  } catch (error: any) {
    console.error("[Academic] Search error:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/academic/scopus - Search Scopus only
academicSearchRouter.post("/scopus", async (req, res) => {
  try {
    const { query, maxResults = 10 } = req.body;

    if (!query) {
      return res.status(400).json({ error: "query is required" });
    }

    const results = await searchScopus(query, { maxResults });
    
    res.json({
      query,
      source: "scopus",
      totalResults: results.length,
      results
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/academic/scielo - Search SciELO only
academicSearchRouter.post("/scielo", async (req, res) => {
  try {
    const { query, maxResults = 10, language = "es" } = req.body;

    if (!query) {
      return res.status(400).json({ error: "query is required" });
    }

    const results = await searchScielo(query, { maxResults, language });
    
    res.json({
      query,
      source: "scielo",
      totalResults: results.length,
      results
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/academic/pubmed - Search PubMed only
academicSearchRouter.post("/pubmed", async (req, res) => {
  try {
    const { query, maxResults = 10 } = req.body;

    if (!query) {
      return res.status(400).json({ error: "query is required" });
    }

    const results = await searchPubMed(query, { maxResults });
    
    res.json({
      query,
      source: "pubmed",
      totalResults: results.length,
      results
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/academic/scholar - Search Google Scholar only
academicSearchRouter.post("/scholar", async (req, res) => {
  try {
    const { query, maxResults = 10 } = req.body;

    if (!query) {
      return res.status(400).json({ error: "query is required" });
    }

    const results = await searchScholar(query, { maxResults });
    
    res.json({
      query,
      source: "scholar",
      totalResults: results.length,
      results
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/academic/duckduckgo - Search DuckDuckGo only
academicSearchRouter.post("/duckduckgo", async (req, res) => {
  try {
    const { query, maxResults = 10 } = req.body;

    if (!query) {
      return res.status(400).json({ error: "query is required" });
    }

    const results = await searchDuckDuckGo(query, { maxResults });
    
    res.json({
      query,
      source: "duckduckgo",
      totalResults: results.length,
      results
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/academic/wos - Search Web of Science only
academicSearchRouter.post("/wos", async (req, res) => {
  try {
    const { query, maxResults = 10 } = req.body;

    if (!query) {
      return res.status(400).json({ error: "query is required" });
    }

    const results = await searchWOS(query, { maxResults });
    
    res.json({
      query,
      source: "wos",
      totalResults: results.length,
      results
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/academic/cite - Generate citation from result
academicSearchRouter.post("/cite", async (req, res) => {
  try {
    const { article, style = "apa" } = req.body;

    if (!article || !article.title) {
      return res.status(400).json({ error: "article with title is required" });
    }

    // APA 7th edition format
    const authors = article.authors || "Unknown";
    const year = article.year || "n.d.";
    const title = article.title || "";
    const journal = article.journal || "";
    const doi = article.doi ? ` https://doi.org/${article.doi}` : "";

    const citation = `${authors} (${year}). ${title}. ${journal}.${doi}`;

    res.json({
      style,
      citation,
      article: {
        title: article.title,
        authors: article.authors,
        year: article.year,
        journal: article.journal,
        doi: article.doi
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/academic/quick/:query - Quick search all sources
academicSearchRouter.get("/quick/:query", async (req, res) => {
  try {
    const query = decodeURIComponent(req.params.query);
    const maxResults = parseInt(req.query.max as string) || 10;

    const result = await searchAllSources(query, { maxResults });
    
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
