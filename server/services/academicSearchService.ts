import { unifiedArticleSearch, UnifiedSearchResult } from "../agent/superAgent/unifiedArticleSearch";
import { llmGateway } from "../lib/llmGateway";
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";

/**
 * Service to orchestrate academic research requests using LLM for query optimization
 * and UnifiedArticleSearch for data retrieval.
 */
export class AcademicSearchService {

    private artifactsDir: string;

    constructor() {
        // Artifacts directory relative to execution context (usually project root)
        this.artifactsDir = path.join(process.cwd(), "artifacts", "research");
        if (!fs.existsSync(this.artifactsDir)) {
            fs.mkdirSync(this.artifactsDir, { recursive: true });
        }
    }

    /**
   * Process a natural language research request
   */
    async processResearchRequest(
        userQuery: string,
        options: { userId?: string; format?: "apa7" | "bibtex" } = {}
    ): Promise<{
        summary: string;
        filePath?: string; // Legacy field (links to Word/Text file)
        files?: { name: string; path: string }[]; // New field for multiple files
        articleCount: number;
        sources: string[];
    }> {
        console.log(`[AcademicSearch] Processing request: "${userQuery}"`);

        // 1. Analyze and Optimize Query using LLM
        const queryParams = await this.optimizeQuery(userQuery);
        console.log(`[AcademicSearch] Optimized params:`, queryParams);

        // 2. Execute Search
        // Use English keywords for international DBs (Scopus, PubMed)
        const searchQuery = queryParams.englishKeywords.join(" OR ");

        console.log(`[AcademicSearch] Executing search ALL sources with query: "${searchQuery}"`);

        const searchResult = await unifiedArticleSearch.searchAllSources(searchQuery, {
            maxResults: queryParams.count || 50,
            startYear: queryParams.yearStart,
            endYear: queryParams.yearEnd,
        });

        // 3. Generate Output Files
        const files: { name: string; path: string }[] = [];

        // 3.1 CITATIONS (Word/Text)
        if (queryParams.outputFormats.includes("word") || queryParams.outputFormats.includes("txt")) {
            const filename = `referencias_${uuidv4().substring(0, 8)}.txt`;
            const filePath = path.join(this.artifactsDir, filename);
            const citationsContent = unifiedArticleSearch.generateAPACitationsList(searchResult.articles);
            fs.writeFileSync(filePath, citationsContent, "utf-8");
            files.push({ name: "Referencias (APA 7)", path: filePath });
        }

        // 3.2 EXCEL
        if (queryParams.outputFormats.includes("excel") || queryParams.outputFormats.includes("xlsx")) {
            const filename = `reporte_articulos_${uuidv4().substring(0, 8)}.xlsx`;
            const filePath = path.join(this.artifactsDir, filename);
            // Ensure generateExcelReport is available and returns buffer
            try {
                const buffer = unifiedArticleSearch.generateExcelReport(searchResult.articles);
                fs.writeFileSync(filePath, buffer);
                files.push({ name: "Tabla de Artículos (Excel)", path: filePath });
            } catch (e) {
                console.error("Error generating Excel:", e);
            }
        }

        // Default fallback if no format detected (generate Word)
        if (files.length === 0 && searchResult.articles.length > 0) {
            const filename = `referencias_${uuidv4().substring(0, 8)}.txt`;
            const filePath = path.join(this.artifactsDir, filename);
            const citationsContent = unifiedArticleSearch.generateAPACitationsList(searchResult.articles);
            fs.writeFileSync(filePath, citationsContent, "utf-8");
            files.push({ name: "Referencias (APA 7)", path: filePath });
        }

        // 4. Generate Summary for Chat
        const summary = this.generateSummary(searchResult, files, queryParams);

        return {
            summary,
            filePath: files[0]?.path, // For legacy compatibility
            files,
            articleCount: searchResult.articles.length,
            sources: Object.keys(searchResult.totalBySource).filter((k) => (searchResult.totalBySource as any)[k] > 0),
        };
    }

    /**
     * Use LLM to extract search parameters from natural language
     */
    private async optimizeQuery(userQuery: string): Promise<{
        englishKeywords: string[];
        spanishKeywords: string[];
        yearStart?: number;
        yearEnd?: number;
        count: number;
        region?: string;
        outputFormats: string[];
    }> {
        try {
            const response = await llmGateway.chat([
                {
                    role: "system",
                    content: `You are a Research Query Optimizer. Extract search parameters from the user's request.
          Return a JSON object with:
          - englishKeywords: Array of 3-5 specific academic keywords in English.
          - spanishKeywords: Array of 3-5 specific academic keywords in Spanish.
          - yearStart: Number (optional).
          - yearEnd: Number (optional).
          - count: Number (desired number of articles, default 50, max 100).
          - region: String (e.g. "LatAm", "Spain", "World"). If user specifies "latinoamerica", "españa", etc.
          - outputFormats: Array of strings ["word", "excel", "txt"]. Default ["word"]. If user mentions "excel", "tabla", "hoja de cálculo", include "excel".
          
          Example: "Find me 50 articles on circular economy in LatAm 2021-2025 output Excel and Word"
          Result: { 
            "englishKeywords": ["circular economy", "supply chain", "sustainability"], 
            "spanishKeywords": ["economía circular", "cadena de suministro"], 
            "yearStart": 2021, 
            "yearEnd": 2025, 
            "count": 50, 
            "region": "LatAm",
            "outputFormats": ["excel", "word"]
          }`
                },
                {
                    role: "user",
                    content: userQuery
                }
            ], {
                userId: "system-optimizer",
                model: "grok-beta",
                maxTokens: 500,
                temperature: 0.1
            });

            const text = response.content.replace(/```json/g, "").replace(/```/g, "").trim();
            return JSON.parse(text);

        } catch (error) {
            console.error("[AcademicSearch] LLM Optimization failed, using fallback", error);
            return {
                englishKeywords: [userQuery],
                spanishKeywords: [userQuery],
                count: 50,
                outputFormats: ["word"]
            };
        }
    }

    private generateSummary(result: UnifiedSearchResult, files: { name: string; path: string }[], params: any): string {
        const total = result.articles.length;
        const sources = Object.entries(result.totalBySource)
            .filter(([_, count]) => count > 0)
            .map(([source, count]) => `${source} (${count})`)
            .join(", ");

        const fileLinks = files.map(f => `[Descargar ${f.name}](${f.path})`).join("\n");

        return `## 📚 Búsqueda Académica Completada

**Tema:** ${params.englishKeywords[0]}
**Resultados:** ${total} artículos encontrados.
**Fuentes:** ${sources || "Ninguna"}
**Archivos Generados:**
${fileLinks}`;
    }
}

export const academicSearchService = new AcademicSearchService();
