import { Response } from "express";
import { unifiedArticleSearch } from "../agent/superAgent/unifiedArticleSearch";
import { llmGateway } from "../lib/llmGateway";
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";

const DEFAULT_ACADEMIC_COUNT = 50;
const MAX_ACADEMIC_COUNT = 500;

function defaultAcademicYearRange(now: Date = new Date()): { yearStart: number; yearEnd: number } {
    const currentYear = now.getFullYear();
    return {
        yearStart: currentYear - 3,
        yearEnd: currentYear,
    };
}

function normalizeAcademicQueryParams(input: {
    englishKeywords?: string[];
    spanishKeywords?: string[];
    yearStart?: number;
    yearEnd?: number;
    count?: number;
    region?: string;
    outputFormats?: string[];
}) {
    const defaults = defaultAcademicYearRange();
    const count = Math.max(1, Math.min(MAX_ACADEMIC_COUNT, Number(input.count) || DEFAULT_ACADEMIC_COUNT));
    const yearStart = Number.isFinite(input.yearStart as number) ? Number(input.yearStart) : defaults.yearStart;
    const yearEnd = Number.isFinite(input.yearEnd as number) ? Number(input.yearEnd) : defaults.yearEnd;
    const normalizedEnglish = (input.englishKeywords || []).map((v) => String(v || "").trim()).filter(Boolean);
    const normalizedSpanish = (input.spanishKeywords || []).map((v) => String(v || "").trim()).filter(Boolean);
    const outputFormats = Array.from(new Set((input.outputFormats || ["word", "excel"]).map((v) => String(v || "").trim()).filter(Boolean)));

    return {
        englishKeywords: normalizedEnglish.length > 0 ? normalizedEnglish : ["academic research"],
        spanishKeywords: normalizedSpanish.length > 0 ? normalizedSpanish : ["investigacion academica"],
        yearStart: Math.min(yearStart, yearEnd),
        yearEnd: Math.max(yearStart, yearEnd),
        count,
        region: input.region,
        outputFormats: outputFormats.length > 0 ? outputFormats : ["word", "excel"],
    };
}

/**
 * SSE-enabled academic search service that emits real-time progress events
 */
export class AcademicSearchServiceSSE {
    private artifactsDir: string;

    constructor() {
        this.artifactsDir = path.join(process.cwd(), "artifacts", "research");
        if (!fs.existsSync(this.artifactsDir)) {
            fs.mkdirSync(this.artifactsDir, { recursive: true });
        }
    }

    /**
     * Process research request with SSE event streaming
     */
    async processResearchRequestWithSSE(
        userQuery: string,
        res: Response,
        runId: string,
        options: { userId?: string } = {}
    ): Promise<void> {
        const target = DEFAULT_ACADEMIC_COUNT;

        try {
            // Emit run_started
            this.emitEvent(res, "run_started", {
                run_id: runId,
                message: "Iniciando búsqueda académica",
                target,
            });

            // 1. Optimize query with LLM
            const queryParams = await this.optimizeQuery(userQuery);
            console.log(`[AcademicSearchSSE] Optimized params:`, queryParams);

            // Emit plan created
            this.emitEvent(res, "plan_created", {
                run_id: runId,
                message: "Plan de búsqueda creado",
                evidence: {
                    target: queryParams.count,
                    year_start: queryParams.yearStart,
                    year_end: queryParams.yearEnd,
                    regions: queryParams.region ? [queryParams.region] : [],
                    providers: ["Scopus", "PubMed", "SciELO", "Redalyc"]
                },
            });

            // 2. Execute search with progress tracking
            const searchQuery = queryParams.englishKeywords.join(" OR ");

            // Emit search start
            this.emitEvent(res, "search_progress", {
                run_id: runId,
                provider: "OpenAlex",
                message: "Iniciando búsqueda en bases de datos",
                metrics: {
                    queries_current: 1,
                    queries_total: 3,
                    candidates_found: 0
                }
            });

            const searchResult = await unifiedArticleSearch.searchAllSources(searchQuery, {
                maxResults: queryParams.count,
                startYear: queryParams.yearStart,
                endYear: queryParams.yearEnd,
            });

            // Emit candidates found
            this.emitEvent(res, "search_progress", {
                run_id: runId,
                message: `${searchResult.articles.length} candidatos encontrados`,
                metrics: {
                    candidates_found: searchResult.articles.length,
                    queries_current: 3,
                    queries_total: 3
                }
            });

            // Emit accepted progress
            this.emitEvent(res, "accepted_progress", {
                run_id: runId,
                message: `${searchResult.articles.length} artículos aceptados`,
                metrics: {
                    articles_accepted: searchResult.articles.length
                }
            });

            // 3. Generate files
            const files: { name: string; path: string }[] = [];

            // Word/Text
            if (queryParams.outputFormats.includes("word") || queryParams.outputFormats.includes("txt")) {
                const filename = `referencias_${uuidv4().substring(0, 8)}.txt`;
                const filePath = path.join(this.artifactsDir, filename);

                this.emitEvent(res, "artifact_generating", {
                    run_id: runId,
                    artifact_type: "txt",
                    filename,
                    message: `Generando ${filename}`
                });

                const citationsContent = unifiedArticleSearch.generateAPACitationsList(searchResult.articles);
                fs.writeFileSync(filePath, citationsContent, "utf-8");
                files.push({ name: "Referencias (APA 7)", path: filePath });

                this.emitEvent(res, "artifact", {
                    run_id: runId,
                    id: uuidv4(),
                    type: "txt",
                    name: filename,
                    url: `/api/artifacts/download/${encodeURIComponent(path.basename(filePath))}`,
                    generating: false
                });
            }

            // Excel
            if (queryParams.outputFormats.includes("excel") || queryParams.outputFormats.includes("xlsx")) {
                const filename = `reporte_articulos_${uuidv4().substring(0, 8)}.xlsx`;
                const filePath = path.join(this.artifactsDir, filename);

                this.emitEvent(res, "artifact_generating", {
                    run_id: runId,
                    artifact_type: "xlsx",
                    filename,
                    message: `Generando Excel con ${searchResult.articles.length} artículos`
                });

                try {
                    const buffer = unifiedArticleSearch.generateExcelReport(searchResult.articles);
                    fs.writeFileSync(filePath, buffer);
                    files.push({ name: "Tabla de Artículos (Excel)", path: filePath });

                    this.emitEvent(res, "artifact", {
                        run_id: runId,
                        id: uuidv4(),
                        type: "xlsx",
                        name: filename,
                        url: `/api/artifacts/download/${encodeURIComponent(path.basename(filePath))}`,
                        generating: false
                    });
                } catch (e) {
                    console.error("Error generating Excel:", e);
                }
            }

            // Default fallback
            if (files.length === 0 && searchResult.articles.length > 0) {
                const filename = `referencias_${uuidv4().substring(0, 8)}.txt`;
                const filePath = path.join(this.artifactsDir, filename);
                const citationsContent = unifiedArticleSearch.generateAPACitationsList(searchResult.articles);
                fs.writeFileSync(filePath, citationsContent, "utf-8");
                files.push({ name: "Referencias (APA 7)", path: filePath });

                this.emitEvent(res, "artifact", {
                    run_id: runId,
                    id: uuidv4(),
                    type: "txt",
                    name: filename,
                    url: `/api/artifacts/download/${encodeURIComponent(path.basename(filePath))}`,
                    generating: false
                });
            }

            // Emit completion
            const sources = Object.keys(searchResult.totalBySource).filter(
                (k) => (searchResult.totalBySource as any)[k] > 0
            );

            this.emitEvent(res, "run_completed", {
                run_id: runId,
                message: "Búsqueda completada",
                evidence: {
                    articles_found: searchResult.articles.length,
                    sources,
                    final_url: files[0]?.path
                },
                metrics: {
                    articles_accepted: searchResult.articles.length,
                    reject_count: 0
                }
            });

            res.write(`data: [DONE]\n\n`);

        } catch (error: any) {
            console.error("[AcademicSearchSSE] Error:", error);
            this.emitEvent(res, "run_failed", {
                run_id: runId,
                error: error.message || "Error durante la búsqueda académica"
            });
            res.write(`data: [DONE]\n\n`);
        }
    }

    private emitEvent(res: Response, eventType: string, data: any) {
        const payload = {
            ...data,
            event_type: eventType,
            seq: Date.now(), // Simple sequence number
            timestamp: new Date().toISOString()
        };
        res.write(`event: ${eventType}\n`);
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }

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
          - yearStart: Number (optional, default to the last 3 years if omitted).
          - yearEnd: Number (optional, default to the current year if omitted).
          - count: Number (desired number of articles, default 50, max 500).
          - region: String (e.g. "LatAm", "Spain", "World"). If user specifies "latinoamerica", "españa", etc.
          - outputFormats: Array of strings ["word", "excel", "txt"]. Default ["word","excel"]. If user mentions "excel", "tabla", "hoja de cálculo", include "excel".`
                },
                { role: "user", content: userQuery }
            ], {
                userId: "system-optimizer",
                model: "grok-beta",
                maxTokens: 500,
                temperature: 0.1
            });

            const text = response.content.replace(/```json/g, "").replace(/```/g, "").trim();
            return normalizeAcademicQueryParams(JSON.parse(text));

        } catch (error) {
            console.error("[AcademicSearchSSE] LLM Optimization failed, using fallback", error);
            return normalizeAcademicQueryParams({
                englishKeywords: [userQuery],
                spanishKeywords: [userQuery],
                count: DEFAULT_ACADEMIC_COUNT,
                outputFormats: ["word", "excel"]
            });
        }
    }
}

export const academicSearchServiceSSE = new AcademicSearchServiceSSE();
