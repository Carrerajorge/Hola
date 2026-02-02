/**
 * Academic Search Routes
 * Scopus, Google Scholar, and combined academic search
 */

import { Router } from "express";
import { 
  searchScopus, 
  scopusToSearchResults, 
  searchAcademicSources,
  isScopusConfigured,
  getScopusArticleByDoi,
  formatApaCitation
} from "../services/scopusSearch";
import { searchScholar } from "../services/webSearch";

export const academicSearchRouter = Router();

// GET /api/academic/status - Check which sources are available
academicSearchRouter.get("/status", async (req, res) => {
  res.json({
    scopus: {
      configured: isScopusConfigured(),
      name: "Scopus (Elsevier)",
      description: "Base de datos académica con más de 80 millones de registros"
    },
    scholar: {
      configured: true,
      name: "Google Scholar",
      description: "Buscador académico gratuito de Google"
    }
  });
});

// POST /api/academic/search - Search academic sources
academicSearchRouter.post("/search", async (req, res) => {
  try {
    const { 
      query, 
      maxResults = 10, 
      sources = ["scopus", "scholar"],
      yearFrom,
      yearTo,
      sortBy = "relevance"
    } = req.body;

    if (!query) {
      return res.status(400).json({ error: "query is required" });
    }

    const includeScopus = sources.includes("scopus");
    const includeScholar = sources.includes("scholar");

    const results = await searchAcademicSources(query, {
      maxResults,
      includeScopus,
      includeScholar
    });

    res.json({
      query,
      totalResults: results.length,
      sources: {
        scopus: includeScopus && isScopusConfigured(),
        scholar: includeScholar
      },
      results
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/academic/scopus - Search Scopus only
academicSearchRouter.post("/scopus", async (req, res) => {
  try {
    const { query, maxResults = 10, yearFrom, yearTo, sortBy = "relevance" } = req.body;

    if (!query) {
      return res.status(400).json({ error: "query is required" });
    }

    if (!isScopusConfigured()) {
      return res.status(503).json({ 
        error: "Scopus API not configured",
        message: "Configure SCOPUS_API_KEY in environment variables"
      });
    }

    const response = await searchScopus(query, { maxResults, yearFrom, yearTo, sortBy });
    
    res.json({
      query,
      totalResults: response.totalResults,
      articles: response.articles,
      citations: response.articles.map(a => formatApaCitation(a))
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

    const results = await searchScholar(query, maxResults);
    
    res.json({
      query,
      totalResults: results.length,
      results
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/academic/article/:doi - Get article details by DOI
academicSearchRouter.get("/article/:doi(*)", async (req, res) => {
  try {
    const doi = req.params.doi;

    if (!doi) {
      return res.status(400).json({ error: "DOI is required" });
    }

    const article = await getScopusArticleByDoi(doi);

    if (!article) {
      return res.status(404).json({ error: "Article not found" });
    }

    res.json({
      article,
      citation: {
        apa: formatApaCitation(article)
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/academic/cite - Generate citation for an article
academicSearchRouter.post("/cite", async (req, res) => {
  try {
    const { doi, style = "apa" } = req.body;

    if (!doi) {
      return res.status(400).json({ error: "DOI is required" });
    }

    const article = await getScopusArticleByDoi(doi);

    if (!article) {
      return res.status(404).json({ error: "Article not found" });
    }

    // Only APA supported for now
    const citation = formatApaCitation(article);

    res.json({
      doi,
      style,
      citation,
      article: {
        title: article.title,
        authors: article.authors,
        year: article.year,
        journal: article.publicationName
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
