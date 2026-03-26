// server/agent/orchestrator/__tests__/e2e-academic.test.ts
// ---------------------------------------------------------------------------
// E2E: SuperPlanner executing academic research tasks using Scopus,
// unified academic search, and academic export tools.
//
// Scopus API, unified search, and export pipeline are MOCKED.
// Tests verify that the executor correctly routes to academic tools
// and propagates results through the dependency chain.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { orchestrate } from "../executor";

// ---------------------------------------------------------------------------
// Mock: Gemini client — returns structured plans for academic tasks
// ---------------------------------------------------------------------------

let geminiCallCount = 0;

// Plan for a simple Scopus search task
const SCOPUS_SEARCH_PLAN = {
  subtasks: [
    {
      id: "step_1",
      description: "Search Scopus for articles about circular economy in supply chains",
      toolHint: "scopus_search",
      args: {
        query: "circular economy supply chain",
        maxResults: 10,
        yearFrom: 2021,
        yearTo: 2025,
      },
      dependencies: [],
      priority: "critical",
      estimatedComplexity: "simple",
    },
    {
      id: "step_2",
      description: "Synthesize findings into a summary",
      toolHint: "synthesize",
      args: { task: "Summarize Scopus search results" },
      dependencies: ["step_1"],
      priority: "high",
      estimatedComplexity: "simple",
    },
  ],
  reasoning: "Simple Scopus search followed by synthesis of findings.",
};

// Plan for unified academic search with citation formatting
const ACADEMIC_SEARCH_PLAN = {
  subtasks: [
    {
      id: "step_1",
      description: "Search multiple academic databases for articles",
      toolHint: "academic_search",
      args: {
        query: "economía circular cadena de suministro exportadora",
        maxResults: 50,
        yearFrom: 2021,
        yearTo: 2025,
        sources: ["scopus", "openalex", "scielo", "redalyc"],
        affilCountries: ["Mexico", "Spain", "Colombia", "Peru", "Chile"],
      },
      dependencies: [],
      priority: "critical",
      estimatedComplexity: "medium",
    },
    {
      id: "step_2",
      description: "Format APA 7th edition citations from search results",
      toolHint: "format_citations",
      args: {},
      dependencies: ["step_1"],
      priority: "high",
      estimatedComplexity: "simple",
    },
    {
      id: "step_3",
      description: "Synthesize delivery summary with article statistics",
      toolHint: "synthesize",
      args: { task: "Assemble final report with article stats and citation list" },
      dependencies: ["step_1", "step_2"],
      priority: "critical",
      estimatedComplexity: "simple",
    },
  ],
  reasoning:
    "Unified search across Scopus + OpenAlex + SciELO + Redalyc, " +
    "then format APA citations and deliver summary.",
};

// Plan for full academic export pipeline
const ACADEMIC_EXPORT_PLAN = {
  subtasks: [
    {
      id: "step_1",
      description: "Run full academic export pipeline (search → Excel + Word)",
      toolHint: "academic_export",
      args: {
        prompt:
          "buscar 50 articulos cientificos de latinoamerica y españa sobre economía circular en la cadena de suministro del 2021 al 2025",
        excelPath: "articulos.xlsx",
        wordPath: "citas_apa7.docx",
      },
      dependencies: [],
      priority: "critical",
      estimatedComplexity: "complex",
    },
    {
      id: "step_2",
      description: "Synthesize delivery summary",
      toolHint: "synthesize",
      args: { task: "Report delivery: list files and article statistics" },
      dependencies: ["step_1"],
      priority: "high",
      estimatedComplexity: "simple",
    },
  ],
  reasoning: "Use academic_export for full pipeline, then synthesize delivery summary.",
};

// Mock Scopus search results
const MOCK_SCOPUS_ARTICLES = [
  {
    title: "Circular economy practices in Latin American supply chains",
    authors: "García, R.; López, M.",
    publicationName: "Journal of Cleaner Production",
    year: "2023",
    doi: "10.1016/j.jclepro.2023.001",
    citedByCount: 15,
    abstract: "This study examines circular economy implementation in Latin American export supply chains.",
    url: "https://doi.org/10.1016/j.jclepro.2023.001",
    scopusId: "SCOPUS_ID:85001",
  },
  {
    title: "Supply chain sustainability through circular economy: A Spanish perspective",
    authors: "Martínez, A.; Fernández, B.",
    publicationName: "Resources, Conservation and Recycling",
    year: "2022",
    doi: "10.1016/j.resconrec.2022.002",
    citedByCount: 22,
    abstract: "Analysis of circular economy integration in Spanish export companies.",
    url: "https://doi.org/10.1016/j.resconrec.2022.002",
    scopusId: "SCOPUS_ID:85002",
  },
];

// Mock unified article results
const MOCK_UNIFIED_ARTICLES = [
  {
    id: "scopus-1",
    source: "scopus" as const,
    title: "Circular economy in LATAM supply chains",
    authors: ["García, R.", "López, M."],
    year: "2023",
    journal: "Journal of Cleaner Production",
    abstract: "Examines CE implementation in Latin American export supply chains.",
    keywords: ["circular economy", "supply chain", "Latin America"],
    doi: "10.1016/j.jclepro.2023.001",
    url: "https://doi.org/10.1016/j.jclepro.2023.001",
    language: "English",
    documentType: "Article",
    country: "Mexico",
    apaCitation:
      "García, R. & López, M. (2023). Circular economy in LATAM supply chains. Journal of Cleaner Production.",
  },
  {
    id: "openalex-1",
    source: "openalex" as const,
    title: "Economía circular y cadenas de suministro en España",
    authors: ["Martínez, A.", "Fernández, B."],
    year: "2022",
    journal: "Resources, Conservation and Recycling",
    abstract: "Análisis de la economía circular en empresas exportadoras españolas.",
    keywords: ["economía circular", "cadena de suministro", "España"],
    doi: "10.1016/j.resconrec.2022.002",
    url: "https://doi.org/10.1016/j.resconrec.2022.002",
    language: "Spanish",
    documentType: "Article",
    country: "Spain",
    apaCitation:
      "Martínez, A. & Fernández, B. (2022). Economía circular y cadenas de suministro en España. Resources, Conservation and Recycling.",
  },
];

vi.mock("../../../lib/gemini", () => ({
  getGeminiClient: vi.fn(() => ({
    models: {
      generateContent: vi.fn().mockImplementation(async (params: any) => {
        geminiCallCount++;
        const text =
          typeof params.contents?.[0]?.parts?.[0]?.text === "string"
            ? params.contents[0].parts[0].text
            : "";

        // Planner: choose plan based on goal keywords
        if (params.config?.systemInstruction?.includes?.("SuperPlanner")) {
          if (text.includes("academic_export") || text.includes("Excel")) {
            return { text: JSON.stringify(ACADEMIC_EXPORT_PLAN) };
          }
          if (text.includes("unified") || text.includes("multiple databases")) {
            return { text: JSON.stringify(ACADEMIC_SEARCH_PLAN) };
          }
          return { text: JSON.stringify(SCOPUS_SEARCH_PLAN) };
        }

        // Synthesize fallback
        return {
          text: JSON.stringify({
            result: `Synthesized response for: ${text.slice(0, 100)}`,
          }),
        };
      }),
    },
  })),
  GEMINI_MODELS: { FLASH: "gemini-2.5-flash", PRO: "gemini-2.5-pro" },
}));

// Mock Scopus search service
vi.mock("../../../services/scopusSearch", () => ({
  searchScopus: vi.fn().mockImplementation(async (query: string, options: any) => ({
    query,
    totalResults: 245,
    articles: MOCK_SCOPUS_ARTICLES,
  })),
  isScopusConfigured: vi.fn().mockReturnValue(true),
  formatApaCitation: vi.fn().mockReturnValue("Mock APA citation"),
  scopusToSearchResults: vi.fn().mockReturnValue([]),
  searchAcademicSources: vi.fn().mockResolvedValue([]),
  getScopusArticleByDoi: vi.fn().mockResolvedValue(null),
}));

// Mock unified article search
vi.mock("../../superAgent/unifiedArticleSearch", () => ({
  searchAllSources: vi.fn().mockImplementation(async (query: string, options: any) => ({
    articles: MOCK_UNIFIED_ARTICLES,
    totalBySource: {
      scopus: 1,
      wos: 0,
      openalex: 1,
      duckduckgo: 0,
      pubmed: 0,
      scielo: 0,
      redalyc: 0,
    },
    query,
    searchTime: 1500,
    errors: [],
  })),
  generateAPACitationsList: vi.fn().mockImplementation((articles: any[]) => {
    const lines = [
      "Referencias Bibliográficas (APA 7ma Edición)",
      "",
      `Total de artículos: ${articles.length}`,
      "",
    ];
    for (const a of articles) {
      lines.push(a.apaCitation || `${(a.authors || []).join(", ")} (${a.year}). ${a.title}.`);
    }
    return lines.join("\n");
  }),
  generateExcelReport: vi.fn().mockReturnValue(Buffer.from("mock-excel")),
  default: {
    searchAllSources: vi.fn(),
    generateAPACitationsList: vi.fn(),
    generateExcelReport: vi.fn(),
    isScopusConfigured: vi.fn().mockReturnValue(true),
    isWosConfigured: vi.fn().mockReturnValue(false),
    isOpenAlexConfigured: () => true,
    isDuckDuckGoConfigured: () => true,
    isPubMedConfigured: vi.fn().mockReturnValue(false),
    isSciELOConfigured: vi.fn().mockReturnValue(true),
    isRedalycConfigured: vi.fn().mockReturnValue(true),
  },
}));

// Mock academic export pipeline
vi.mock("../../../services/academicArticlesExport", () => ({
  exportAcademicArticlesFromPrompt: vi.fn().mockImplementation(async (prompt: string) => ({
    plan: {
      topicQuery: "economía circular cadena de suministro",
      requestedCount: 50,
      yearFrom: 2021,
      yearTo: 2025,
      region: { latam: true, spain: true },
      sources: ["scopus", "openalex", "scielo", "redalyc"],
    },
    articles: MOCK_UNIFIED_ARTICLES,
    rejectedArticles: [],
    excelBuffer: Buffer.from("mock-excel-content"),
    wordBuffer: Buffer.from("mock-word-content"),
    stats: {
      totalReturned: 2,
      totalRequested: 50,
      bySource: { scopus: 1, openalex: 1 },
      coverage: {
        doi: { present: 2, missing: 0 },
        abstract: { present: 2, missing: 0 },
        keywords: { present: 2, missing: 0 },
        journal: { present: 2, missing: 0 },
        city: { present: 0, missing: 2 },
        country: { present: 2, missing: 0 },
        language: { present: 2, missing: 0 },
        documentType: { present: 2, missing: 0 },
      },
      quality: {
        audited: 2,
        accepted: 2,
        rejected: 0,
        returned: 2,
        avgScore: 92,
        avgAcceptedScore: 92,
        avgRejectedScore: 0,
        highConfidenceAccepted: 2,
        rejectedByReason: {},
      },
      notes: [],
    },
  })),
  planAcademicArticlesExport: vi.fn(),
}));

// Mock agentTools, toolRegistry, selfExpand, webSearch
vi.mock("../../../config/agentTools", () => ({
  AGENT_TOOLS: [
    { name: "web_search" },
    { name: "scopus_search" },
    { name: "academic_search" },
    { name: "academic_export" },
    { name: "format_citations" },
    { name: "synthesize" },
  ],
}));

vi.mock("../../registry/toolRegistry", () => ({
  toolRegistry: {
    getAll: () => new Map(),
    execute: vi.fn().mockResolvedValue({
      success: false,
      error: { code: "NOT_FOUND_ERROR" },
    }),
  },
}));

vi.mock("../../selfExpand/capabilityExpander", () => ({
  expandAndExecute: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../../services/webSearch", () => ({
  searchWeb: vi.fn().mockResolvedValue({ results: [] }),
  fetchUrl: vi.fn().mockResolvedValue({ text: "" }),
}));

// Mock fs/promises for planner's fused module discovery
vi.mock("fs/promises", async () => {
  const actual = await vi.importActual<typeof import("fs/promises")>("fs/promises");
  return {
    ...actual,
    readdir: vi.fn().mockImplementation(async (dirPath: string, opts?: any) => {
      if (typeof dirPath === "string" && dirPath.includes("selfExpand/fused")) {
        return [];
      }
      return actual.readdir(dirPath, opts);
    }),
    readFile: actual.readFile,
    mkdir: actual.mkdir,
    rm: actual.rm,
    writeFile: actual.writeFile,
    stat: actual.stat,
  };
});

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("E2E: SuperPlanner Academic Research Tools", () => {
  let runId: string;

  beforeEach(() => {
    geminiCallCount = 0;
    runId = `e2e-academic-${Date.now()}`;
  });

  afterEach(async () => {
    const workspaceDir = `/tmp/orchestrator-${runId}`;
    try {
      const realFs = await vi.importActual<typeof import("fs/promises")>("fs/promises");
      await realFs.rm(workspaceDir, { recursive: true, force: true });
    } catch { /* already cleaned */ }
  });

  it("routes scopus_search to the Scopus service and returns articles", async () => {
    const result = await orchestrate(
      "Search Scopus for articles about circular economy in supply chains from 2021 to 2025",
      { runId, timeout: 15_000 },
    );

    expect(["completed", "partial"]).toContain(result.status);
    expect(result.stats.totalSubtasks).toBe(2);
    expect(result.stats.completed).toBeGreaterThanOrEqual(1);

    // Step 1 should have Scopus results
    const scopusResult = result.results["step_1"];
    expect(scopusResult).toBeTruthy();
    expect(scopusResult.articles).toBeDefined();
    expect(scopusResult.articles.length).toBe(2);
    expect(scopusResult.totalResults).toBe(245);
    expect(scopusResult.articles[0].title).toContain("Circular economy");
  }, 15_000);

  it("routes academic_search to unified multi-source search", async () => {
    const result = await orchestrate(
      "Search unified multiple databases for articles about economía circular",
      { runId, timeout: 15_000 },
    );

    expect(["completed", "partial"]).toContain(result.status);

    // Find the academic_search result
    const searchResult = Object.values(result.results).find(
      (r: any) => r && r.totalBySource,
    );
    expect(searchResult).toBeTruthy();
    expect((searchResult as any).articles.length).toBe(2);
    expect((searchResult as any).totalBySource.scopus).toBe(1);
    expect((searchResult as any).totalBySource.openalex).toBe(1);
  }, 15_000);

  it("routes format_citations and reads articles from dependency results", async () => {
    const result = await orchestrate(
      "Search unified multiple databases for articles about economía circular",
      { runId, timeout: 15_000 },
    );

    expect(["completed", "partial"]).toContain(result.status);

    // Step 2 (format_citations) should have formatted citations
    const citationsResult = result.results["step_2"];
    if (citationsResult) {
      expect(citationsResult.citations).toBeDefined();
      expect(citationsResult.citations).toContain("APA 7ma Edición");
      expect(citationsResult.articleCount).toBe(2);
    }
  }, 15_000);

  it("routes academic_export to the full export pipeline", async () => {
    const result = await orchestrate(
      "Create academic_export: buscar 50 articulos de economía circular en latinoamerica del 2021 al 2025 y generar Excel y Word",
      { runId, timeout: 15_000 },
    );

    expect(["completed", "partial"]).toContain(result.status);

    // Step 1 should have export results
    const exportResult = result.results["step_1"];
    expect(exportResult).toBeTruthy();
    expect(exportResult.articlesCount).toBe(2);
    expect(exportResult.excelPath).toBe("articulos.xlsx");
    expect(exportResult.wordPath).toBe("citas_apa7.docx");
    expect(exportResult.plan.region.latam).toBe(true);
    expect(exportResult.plan.region.spain).toBe(true);
    expect(exportResult.stats.bySource.scopus).toBe(1);
    expect(exportResult.stats.bySource.openalex).toBe(1);

    // Articles should have summary data
    expect(exportResult.articles.length).toBe(2);
    expect(exportResult.articles[0].source).toBe("scopus");
    expect(exportResult.articles[1].source).toBe("openalex");
  }, 15_000);

  it("SSE events include academic-specific event types", async () => {
    const sseEvents: Array<{ event: string; data: any }> = [];
    const mockRes = {
      write: vi.fn().mockImplementation((chunk: string) => {
        const lines = chunk.split("\n");
        let event = "";
        let data = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) event = line.slice(7);
          if (line.startsWith("data: ")) data = line.slice(6);
        }
        if (event && data) {
          try {
            sseEvents.push({ event, data: JSON.parse(data) });
          } catch { /* ignore parse errors */ }
        }
      }),
    };

    await orchestrate(
      "Search Scopus for articles about circular economy in supply chains from 2021 to 2025",
      { runId, sseRes: mockRes, timeout: 15_000 },
    );

    const eventTypes = [...new Set(sseEvents.map((e) => e.event))];
    expect(eventTypes.length).toBeGreaterThan(0);

    // Should have Scopus-specific SSE event
    const hasScopusEvent = sseEvents.some((e) => e.event === "scopus_search");
    expect(hasScopusEvent).toBe(true);

    // Verify the Scopus event data
    const scopusEvent = sseEvents.find((e) => e.event === "scopus_search");
    expect(scopusEvent?.data.totalResults).toBe(245);
    expect(scopusEvent?.data.returned).toBe(2);
  }, 15_000);

  it("handles unconfigured Scopus gracefully", async () => {
    // Override the mock for this test
    const { isScopusConfigured } = await import("../../../services/scopusSearch");
    (isScopusConfigured as any).mockReturnValueOnce(false);

    const result = await orchestrate(
      "Search Scopus for articles about circular economy",
      { runId, timeout: 15_000 },
    );

    // Should still complete (fallback to synthesize for the Scopus step)
    expect(["completed", "partial"]).toContain(result.status);

    // The Scopus step result should indicate not configured
    const scopusResult = result.results["step_1"];
    if (scopusResult && scopusResult.error) {
      expect(scopusResult.error).toContain("not configured");
    }
  }, 15_000);
});
