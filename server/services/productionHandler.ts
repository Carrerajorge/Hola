/**
 * Production Handler
 * 
 * Handles document production requests (Word, Excel, PPT, PDF)
 * by intercepting CREATE_* intents and executing the production pipeline.
 */

import type { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import type { IntentResult } from './intentRouter';
import { libraryService } from "./libraryService";
import {
    startProductionPipeline,
    type ProductionEvent,
    type ProductionResult,
    type Artifact,
    type DocumentIntent,
} from '../agent/production';
import { exportAcademicArticlesFromPrompt } from './academicArticlesExport';
import { renderDocument } from "./documentService";
import {
    classifyOutputFormat,
    hasExplicitDocumentArtifactRequest,
    hasExplicitPresentationArtifactRequest,
    hasExplicitSpreadsheetArtifactRequest,
} from "@shared/explicitArtifactRequests";

// ============================================================================
// Types
// ============================================================================

export interface ProductionRequest {
    message: string;
    userId: string;
    chatId: string;
    conversationId?: string | null;
    requestId?: string;
    assistantMessageId?: string | null;
    intentResult: IntentResult;
    locale?: string;
}

export interface ProductionHandlerResult {
    handled: boolean;
    result?: ProductionResult;
    error?: string;
}

// ============================================================================
// Intent Detection
// ============================================================================

const PRODUCTION_INTENTS = [
    'CREATE_DOCUMENT',
    'CREATE_PRESENTATION',
    'CREATE_SPREADSHEET',
] as const;

// Patterns that indicate user wants to SEARCH first, not just create a document
const SEARCH_FIRST_PATTERNS = [
    // "buscame X articulos/papers"
    /buscame\s+\d+\s*(art[ií]culos?|papers?|estudios?|investigacion)/i,
    /buscarme\s+\d+\s*(art[ií]culos?|papers?|estudios?|investigacion)/i,
    /busca\s+\d+\s*(art[ií]culos?|papers?|estudios?)/i,
    /buscar\s+\d+\s*(art[ií]culos?|papers?|estudios?)/i,
    /encontrar\s+\d+\s*(art[ií]culos?|papers?|estudios?)/i,
    /dame\s+\d+\s*(art[ií]culos?|papers?|estudios?|citas?)/i,
    /necesito\s+\d+\s*(art[ií]culos?|papers?|estudios?|referencias?)/i,

    // Singular: "buscarme un artículo/paper/estudio"
    /buscame\s+(un|una)\s+(art[ií]culo|paper|estudio)\b/i,
    /buscarme\s+(un|una)\s+(art[ií]culo|paper|estudio)\b/i,
    /busca\s+(un|una)\s+(art[ií]culo|paper|estudio)\b/i,
    /buscar\s+(un|una)\s+(art[ií]culo|paper|estudio)\b/i,
    /encuentra(?:me)?\s+(un|una)\s+(art[ií]culo|paper|estudio)\b/i,
    /dame\s+(un|una)\s+(art[ií]culo|paper|estudio)\b/i,
    /necesito\s+(un|una)\s+(art[ií]culo|paper|estudio)\b/i,
    
    // "articulos cientificos de/sobre"
    /art[ií]culos?\s+cient[ií]ficos?\s+(de|sobre|en|d)\s*/i,
    /busca.*art[ií]culos?\s+cient[ií]ficos?/i,
    /buscame.*art[ií]culos?\s+cient[ií]ficos?/i,
    
    // Explicit search requests
    /buscar?\s*(art[ií]culos?\s+)?cient[ií]ficos?\s+sobre/i,
    /scholar\s+search/i,
    /google\s+scholar/i,
    /scopus/i,
    /pubmed/i,
    /scielo/i,
];

function requiresSearchFirst(message: string): boolean {
    return SEARCH_FIRST_PATTERNS.some(pattern => pattern.test(message));
}

// Specialized workflow: "buscarme N articulos cientificos ... en excel ... y citas APA en word"
function isAcademicArticlesExportRequest(message: string): boolean {
    const wantsAcademic =
        /\b(art[ií]culos?|paper(?:s)?|estudio(?:s)?|investigaci[óo]n(?:es)?|scopus|scielo|pubmed|wos|web\s*of\s*science)\b/i.test(message);
    const wantsCount =
        /\b(?:buscarme|buscame|dame|necesito|encuentra(?:me)?)\b/i.test(message) && /\b\d{2,3}\b/.test(message);
    const wantsFile =
        /\b(excel|xlsx|word|docx)\b/i.test(message);
    return wantsAcademic && wantsCount && wantsFile;
}

function wantsArtifactOutput(message: string): boolean {
    const outputFormat = classifyOutputFormat(message);
    return (
        outputFormat.action !== "text" ||
        hasExplicitDocumentArtifactRequest(message) ||
        hasExplicitSpreadsheetArtifactRequest(message) ||
        hasExplicitPresentationArtifactRequest(message)
    );
}

function isReservationAutomationRequest(message: string): boolean {
    const normalized = message.toLowerCase();

    const hasReservationVerb = /\b(reserva(?:r|cion|ción)?|reservation|book(?:ing)?)\b/i.test(normalized);
    const hasReservationContext =
        /\b(restaurante|restaurant|mesa|table|cala|covermanager|mesa247|hotel|vuelo|flight)\b/i.test(normalized) ||
        /\b\d{1,2}\s*(personas?|people|guests?|comensales?)\b/i.test(normalized) ||
        /\b(?:a las|at)\s*\d{1,2}(?::\d{2})?\b/i.test(normalized) ||
        /\b(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/i.test(normalized);

    return hasReservationVerb && hasReservationContext;
}

export function isProductionIntent(intentResult: IntentResult | null, message?: string): boolean {
    if (!intentResult) return false;

    // Reservation/booking requests must route to web automation, not to document production.
    if (message && isReservationAutomationRequest(message)) {
        console.log(`[ProductionHandler] Reservation request detected, skipping production mode for: "${message.slice(0, 70)}..."`);
        return false;
    }

    // Previously we skipped production for "search-first" prompts.
    // That breaks the core workflow: "busca N artículos y exporta a Excel / crea PPT".
    // New rule: only skip production if it's search-first AND user is NOT asking for an output artifact.
    if (message && requiresSearchFirst(message) && !wantsArtifactOutput(message)) {
        console.log(`[ProductionHandler] Search-first detected (no artifact requested), skipping production mode for: "${message.slice(0, 50)}..."`);
        return false;
    }

    // Universal guardrail: only switch into binary artifact production when the
    // user explicitly asked for a file/canvas deliverable.
    if (message && !wantsArtifactOutput(message)) {
        console.log(
            `[ProductionHandler] ${intentResult.intent} without explicit artifact output, keeping inline chat mode for: "${message.slice(0, 70)}..."`
        );
        return false;
    }

    return PRODUCTION_INTENTS.includes(intentResult.intent as any);
}

export function getDeliverables(intentResult: IntentResult, message?: string): ('word' | 'excel' | 'ppt' | 'pdf')[] {
    const deliverables: ('word' | 'excel' | 'ppt' | 'pdf')[] = [];

    switch (intentResult.intent) {
        case 'CREATE_DOCUMENT':
            deliverables.push('word');
            if (intentResult.output_format === 'pdf') {
                deliverables.push('pdf');
            }
            break;
        case 'CREATE_PRESENTATION':
            deliverables.push('ppt');
            break;
        case 'CREATE_SPREADSHEET':
            deliverables.push('excel');
            break;
    }

    // Check for compound requests in slots
    const topic = intentResult.slots.topic?.toLowerCase() || '';
    const combined = `${topic} ${message || ''}`.toLowerCase();

    if (combined.includes('excel') || combined.includes('hoja de cálculo') || combined.includes('spreadsheet')) {
        if (!deliverables.includes('excel')) deliverables.push('excel');
    }
    if (combined.includes('presentación') || combined.includes('presentation') || combined.includes('ppt')) {
        if (!deliverables.includes('ppt')) deliverables.push('ppt');
    }
    if (combined.includes('word') || combined.includes('documento') || combined.includes('document') || combined.includes('docx')) {
        if (!deliverables.includes('word')) deliverables.push('word');
    }

    return deliverables;
}

// ============================================================================
// Artifact Storage
// ============================================================================

const ARTIFACTS_DIR = path.join(process.cwd(), 'artifacts');

// Ensure artifacts directory exists
function ensureArtifactsDir(): void {
    if (!fs.existsSync(ARTIFACTS_DIR)) {
        fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
        console.log(`[ProductionHandler] Created artifacts directory: ${ARTIFACTS_DIR}`);
    }
}

async function saveArtifact(
    artifact: Artifact,
    runId: string,
    userId: string,
    chatId: string
): Promise<{ downloadUrl: string; library?: { fileUuid: string; storageUrl: string } }> {
    ensureArtifactsDir();

    // Use a readable filename with timestamp to avoid collisions
    const timestamp = Date.now();
    const safeFilename = artifact.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storedFilename = `${timestamp}_${safeFilename}`;
    const filePath = path.join(ARTIFACTS_DIR, storedFilename);

    // Write buffer to file
    await fs.promises.writeFile(filePath, artifact.buffer);

    // Return download URL - matches the static express endpoint
    const downloadUrl = `/api/artifacts/${storedFilename}`;

    console.log(`[ProductionHandler] Saved artifact: ${artifact.filename} -> ${filePath}`);
    console.log(`[ProductionHandler] Download URL: ${downloadUrl}`);

    // Also save to Library (Object Storage + DB metadata) for the user's Library view.
    // If library write fails, we still return the downloadable artifact URL.
    let library: { fileUuid: string; storageUrl: string } | undefined;
    try {
        const contentType = artifact.mimeType || "application/octet-stream";
        const upload = await libraryService.generateUploadUrl(userId, storedFilename, contentType);

        // Upload raw buffer
        await fetch(upload.uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": contentType },
            body: artifact.buffer,
        });

        const ext = path.extname(storedFilename).replace(/^\./, "");
        const type = artifact.type === "word" ? "document" : artifact.type === "excel" ? "spreadsheet" : artifact.type === "ppt" ? "presentation" : "other";

        const saved = await libraryService.saveFileMetadata(userId, upload.objectPath, {
            name: storedFilename,
            originalName: artifact.filename,
            description: `Generated by production pipeline run ${runId}`,
            type,
            mimeType: contentType,
            extension: ext,
            size: artifact.size,
            metadata: {
                runId,
                chatId,
                source: "productionHandler",
                originalFilename: artifact.filename,
                downloadUrl,
            },
        });

        library = { fileUuid: saved.uuid, storageUrl: saved.storageUrl };
    } catch (e: any) {
        console.warn("[ProductionHandler] Failed to save artifact to Library:", e?.message || e);
    }

    return { downloadUrl, library };
}

// ============================================================================
// SSE Writer
// ============================================================================

function writeSse(res: Response, event: string, data: object): void {
    try {
        const streamMeta = (res as any)?.locals?.streamMeta;
        const payload: Record<string, unknown> = {
            ...(data as Record<string, unknown>),
        };

        if (!payload.conversationId && typeof streamMeta?.conversationId === 'string') {
            payload.conversationId = streamMeta.conversationId;
        }
        if (!payload.requestId && typeof streamMeta?.requestId === 'string') {
            payload.requestId = streamMeta.requestId;
        }

        if (!payload.assistantMessageId) {
            const assistantMessageId =
                streamMeta?.assistantMessageId ||
                (typeof streamMeta?.getAssistantMessageId === 'function'
                    ? streamMeta.getAssistantMessageId()
                    : undefined);
            if (assistantMessageId) {
                payload.assistantMessageId = assistantMessageId;
            }
        }

        const chunk = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
        res.write(chunk);

        if (typeof (res as any).flush === 'function') {
            (res as any).flush();
        } else if (res.socket && typeof res.socket.write === 'function') {
            res.socket.write('');
        }

        if (typeof streamMeta?.onWrite === 'function') {
            try {
                streamMeta.onWrite();
            } catch (observerError) {
                console.warn('[ProductionHandler] streamMeta.onWrite failed:', observerError);
            }
        }
    } catch (err) {
        console.error('[ProductionHandler] SSE write failed:', err);
    }
}

const PRODUCTION_ARTIFACT_FALLBACK_ENABLED =
    process.env.NODE_ENV !== "test" &&
    !/^(0|false|no)$/i.test(String(process.env.ILIAGPT_ENABLE_PRODUCTION_ARTIFACT_FALLBACK || "true"));

function buildFallbackTopic(topic: string | undefined, message: string): string {
    const normalized = String(topic || "").trim();
    if (normalized) return normalized.slice(0, 120);
    return String(message || "Documento generado").trim().slice(0, 120) || "Documento generado";
}

function buildFallbackMarkdown(topic: string, message: string): string {
    const brief = String(message || "").replace(/\s+/g, " ").trim().slice(0, 400);
    return [
        `# ${topic}`,
        "",
        "## Resumen Ejecutivo",
        `Este documento fue generado en modo fallback local para garantizar la entrega del archivo solicitado.`,
        "",
        "## Contexto",
        brief || "No se proporcionaron detalles adicionales en la solicitud.",
        "",
        "## Recomendaciones Iniciales",
        "- Definir objetivos y alcance concretos.",
        "- Priorizar actividades por impacto y costo.",
        "- Establecer indicadores de seguimiento semanales.",
    ].join("\n");
}

function buildFallbackSlides(topic: string, message: string): Array<{ title: string; content: string[] }> {
    const brief = String(message || "").replace(/\s+/g, " ").trim().slice(0, 240);
    return [
        {
            title: topic,
            content: [
                "Objetivo principal",
                "Alcance inicial",
                "Entregable de arranque",
            ],
        },
        {
            title: "Contexto",
            content: [
                brief || "Sin contexto adicional",
                "Marco operativo actual",
                "Supuestos de trabajo",
            ],
        },
        {
            title: "Plan de Acción",
            content: [
                "Prioridades por fases",
                "Riesgos y mitigaciones",
                "Indicadores de seguimiento",
            ],
        },
    ];
}

async function buildFallbackArtifacts(params: {
    topic: string;
    message: string;
    deliverables: string[];
}): Promise<Artifact[]> {
    const { topic, message, deliverables } = params;
    const markdown = buildFallbackMarkdown(topic, message);
    const slides = buildFallbackSlides(topic, message);
    const wordCount = markdown.split(/\s+/).filter(Boolean).length;
    const artifacts: Artifact[] = [];

    for (const deliverable of Array.from(new Set(deliverables))) {
        try {
            if (deliverable === "word") {
                const rendered = await renderDocument({
                    templateId: "report",
                    type: "docx",
                    data: {
                        title: topic,
                        content: markdown,
                        author: "ILIAGPT",
                        date: new Date().toISOString().slice(0, 10),
                    },
                });
                artifacts.push({
                    type: "word",
                    filename: rendered.fileName,
                    buffer: rendered.buffer,
                    mimeType: rendered.mimeType,
                    size: rendered.buffer.length,
                    metadata: { wordCount },
                });
                continue;
            }

            if (deliverable === "ppt") {
                const rendered = await renderDocument({
                    templateId: "presentation",
                    type: "pptx",
                    data: {
                        title: topic,
                        slides,
                        author: "ILIAGPT",
                    },
                });
                artifacts.push({
                    type: "ppt",
                    filename: rendered.fileName,
                    buffer: rendered.buffer,
                    mimeType: rendered.mimeType,
                    size: rendered.buffer.length,
                    metadata: { slideCount: slides.length },
                });
                continue;
            }

            if (deliverable === "excel") {
                const rows = [
                    [topic, "Objetivo", "Establecer base operativa inicial"],
                    [topic, "Accion", "Definir responsables y cronograma"],
                    [topic, "Control", "Medir progreso con KPIs semanales"],
                ];
                const rendered = await renderDocument({
                    templateId: "spreadsheet",
                    type: "xlsx",
                    data: {
                        headers: ["Tema", "Categoria", "Detalle"],
                        rows,
                        sheetName: "Resumen",
                    },
                });
                artifacts.push({
                    type: "excel",
                    filename: rendered.fileName,
                    buffer: rendered.buffer,
                    mimeType: rendered.mimeType,
                    size: rendered.buffer.length,
                    metadata: { sheetCount: 1 },
                });
                continue;
            }

            if (deliverable === "pdf") {
                const rendered = await renderDocument({
                    templateId: "report",
                    type: "pdf",
                    data: {
                        title: topic,
                        content: markdown,
                        author: "ILIAGPT",
                        date: new Date().toISOString().slice(0, 10),
                    },
                });
                artifacts.push({
                    type: "pdf",
                    filename: rendered.fileName,
                    buffer: rendered.buffer,
                    mimeType: rendered.mimeType,
                    size: rendered.buffer.length,
                    metadata: { wordCount },
                });
            }
        } catch (error: any) {
            console.warn(
                `[ProductionHandler] Fallback artifact failed for ${deliverable}:`,
                error?.message || error,
            );
        }
    }

    return artifacts;
}

// ============================================================================
// Production Handler
// ============================================================================

export async function handleProductionRequest(
    req: ProductionRequest,
    res: Response
): Promise<ProductionHandlerResult> {
    const { message, userId, chatId, conversationId, requestId, assistantMessageId, intentResult, locale } = req;

    console.log(`[ProductionHandler] Starting production for intent: ${intentResult.intent}`);
    console.log(`[ProductionHandler] Topic: ${intentResult.slots.topic || message}`);

    const runId = uuidv4();
    const streamConversationId = conversationId || chatId;
    const streamRequestId = requestId || runId;
    const deliverables = getDeliverables(intentResult, message);

    const emit = (event: string, data: Record<string, unknown>): void => {
        writeSse(res, event, {
            conversationId: streamConversationId,
            requestId: streamRequestId,
            ...(assistantMessageId ? { assistantMessageId } : {}),
            ...data,
        });
    };

    console.log(`[ProductionHandler] Deliverables: ${deliverables.join(', ')}`);

    // Set SSE headers (only if not already sent by chatAiRouter's early SSE setup)
    if (!res.headersSent) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("Transfer-Encoding", "chunked");
        res.setHeader("X-Accel-Buffering", "no");
        res.setHeader("X-Production-Mode", "true");
        res.setHeader("X-Run-Id", runId);
        res.flushHeaders();
    }

    // Emit production start
    emit('production_start', {
        runId,
        intent: intentResult.intent,
        topic: intentResult.slots.topic || message,
        deliverables,
        timestamp: Date.now(),
    });

    try {
        // ============================================================================
        // ACADEMIC ARTICLES EXPORT (fast path)
        // ============================================================================
        if (isAcademicArticlesExportRequest(message)) {
            emit('production_event', {
                type: 'stage_start',
                stage: 'research',
                progress: 0,
                message: 'Iniciando busqueda de articulos cientificos (Scopus/OpenAlex/SciELO/Redalyc)...',
                timestamp: Date.now(),
            });

            const exportResult = await exportAcademicArticlesFromPrompt(message);

            emit('production_event', {
                type: 'stage_complete',
                stage: 'research',
                progress: 100,
                message: `Busqueda completada: ${exportResult.stats.totalReturned}/${exportResult.stats.totalRequested} articulos`,
                timestamp: Date.now(),
            });

            const artifacts: Artifact[] = [];

            if (deliverables.includes('excel')) {
                artifacts.push({
                    type: 'excel',
                    filename: `articulos_cientificos_${Date.now()}.xlsx`,
                    buffer: exportResult.excelBuffer,
                    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    size: exportResult.excelBuffer.length,
                    metadata: { sheetCount: 1 },
                });
            }

            if (deliverables.includes('word')) {
                artifacts.push({
                    type: 'word',
                    filename: `referencias_apa7_${Date.now()}.docx`,
                    buffer: exportResult.wordBuffer,
                    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    size: exportResult.wordBuffer.length,
                    metadata: { pageCount: undefined, wordCount: undefined },
                });
            }

            // Save artifacts and generate download URLs
            const artifactsWithUrls: Array<{ type: string; filename: string; downloadUrl: string; size: number }> = [];

            for (const artifact of artifacts) {
                const stored = await saveArtifact(artifact, runId, userId, chatId);
                artifact.downloadUrl = stored.downloadUrl;

                artifactsWithUrls.push({
                    type: artifact.type,
                    filename: artifact.filename,
                    downloadUrl: stored.downloadUrl,
                    size: artifact.size,
                });

                emit('artifact', {
                    type: artifact.type,
                    filename: artifact.filename,
                    downloadUrl: stored.downloadUrl,
                    size: artifact.size,
                    library: stored.library,
                });
            }

            const sourcesLine = Object.entries(exportResult.stats.bySource)
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => `${k} (${v})`)
                .join(', ') || 'n/a';

            const yearsLine = exportResult.plan.yearFrom && exportResult.plan.yearTo
                ? `${exportResult.plan.yearFrom}-${exportResult.plan.yearTo}`
                : 'n/a';

            const regionLine = [
                exportResult.plan.region.latam ? 'Latinoamerica' : null,
                exportResult.plan.region.spain ? 'Espana' : null,
            ].filter(Boolean).join(' + ') || 'n/a';

            const coverage = exportResult.stats.coverage;
            const fmtCoverage = (label: string, c: { present: number; missing: number }) => {
                const total = c.present + c.missing;
                const pct = total ? Math.round((c.present / total) * 100) : 0;
                return `${label} ${c.present}/${total} (${pct}%)`;
            };

            const coverageLine = [
                fmtCoverage('DOI', coverage.doi),
                fmtCoverage('Abstract', coverage.abstract),
                fmtCoverage('Keywords', coverage.keywords),
                fmtCoverage('Journal', coverage.journal),
                fmtCoverage('Language', coverage.language),
                fmtCoverage('Document Type', coverage.documentType),
                fmtCoverage('City', coverage.city),
                fmtCoverage('Country', coverage.country),
            ].join(' | ');

            const notesBlock = exportResult.stats.notes?.length
                ? ['', '**Notas:**', ...exportResult.stats.notes.map(n => `- ${n}`)].join('\n')
                : '';

            const artifactLinks = artifactsWithUrls.map(a => {
                const icon = getArtifactIcon(a.type);
                return `- ${icon} [${a.filename}](${a.downloadUrl}) (${formatSize(a.size)})`;
            }).join('\n');

            const summary = [
                '## 📚 Exportacion Academica Completada',
                '',
                artifactLinks,
                '',
                `**Tema:** ${exportResult.plan.topicQuery || message}`,
                `**Rango de anos:** ${yearsLine}`,
                `**Region:** ${regionLine}`,
                `**Articulos:** ${exportResult.stats.totalReturned}/${exportResult.stats.totalRequested}`,
                `**Fuentes:** ${sourcesLine}`,
                `**Cobertura:** ${coverageLine}`,
                notesBlock,
            ].join('\n');

            emit('production_complete', {
                runId,
                success: true,
                artifactsCount: artifacts.length,
                summary,
                timestamp: Date.now(),
            });

            // Send summary as regular chat content for display
            emit('chunk', {
                content: summary,
                sequenceId: 1,
                runId,
            });

            emit('done', {
                sequenceId: 2,
                runId,
                timestamp: Date.now(),
            });

            res.end();

            return { handled: true };
        }

        const pipelineIntent: DocumentIntent =
            intentResult.intent === 'CREATE_PRESENTATION'
                ? 'presentation'
                : intentResult.intent === 'CREATE_SPREADSHEET'
                    ? 'analysis'
                    : 'report';

        // Execute production pipeline
        let result = await startProductionPipeline(
            message,
            userId,
            chatId,
            (event: ProductionEvent) => {
                // Emit pipeline events as SSE
                emit('production_event', {
                    type: event.type,
                    stage: event.stage,
                    progress: event.progress,
                    message: event.message,
                    timestamp: event.timestamp,
                });
            },
            {
                // If the user explicitly selected a doc tool or intent router classified this as CREATE_*,
                // do not allow the production router to downgrade to CHAT.
                forceProduction: true,
                deliverables,
                intent: pipelineIntent,
                topic: intentResult.slots.topic || message,
            }
        );

        let hasArtifacts = Array.isArray(result.artifacts) && result.artifacts.length > 0;
        let pipelineSucceeded = result.status === 'success' || result.status === 'partial';

        if ((!pipelineSucceeded || !hasArtifacts) && PRODUCTION_ARTIFACT_FALLBACK_ENABLED) {
            const fallbackTopic = buildFallbackTopic(intentResult.slots.topic, message);
            emit('production_event', {
                type: 'stage_start',
                stage: 'render',
                progress: 92,
                message: 'Activando fallback local para generar entregables mínimos...',
                timestamp: Date.now(),
            });

            const fallbackArtifacts = await buildFallbackArtifacts({
                topic: fallbackTopic,
                message,
                deliverables,
            });

            if (fallbackArtifacts.length > 0) {
                result = {
                    ...result,
                    status: 'partial',
                    artifacts: fallbackArtifacts,
                    summary: [
                        result.summary || "## Producción Completada",
                        "",
                        "**Fallback aplicado:** Se generaron entregables locales mínimos para evitar salida vacía.",
                    ].join("\n"),
                };
                hasArtifacts = true;
                pipelineSucceeded = true;
                emit('production_event', {
                    type: 'stage_complete',
                    stage: 'render',
                    progress: 100,
                    message: `Fallback completado: ${fallbackArtifacts.length} entregable(s) generado(s).`,
                    timestamp: Date.now(),
                });
            }
        }

        if (!pipelineSucceeded || !hasArtifacts) {
            const details = [
                `status=${result.status}`,
                `artifacts=${result.artifacts.length}`,
                `qa=${typeof result.qaReport?.overallScore === 'number' ? result.qaReport.overallScore : 'n/a'}`,
            ].join(", ");
            throw new Error(`La producción documental no generó entregables válidos (${details}).`);
        }

        // Save artifacts and generate download URLs
        const artifactsWithUrls: Array<{ type: string; filename: string; downloadUrl: string; size: number }> = [];

        for (const artifact of result.artifacts) {
            const stored = await saveArtifact(artifact, runId, userId, chatId);
            artifact.downloadUrl = stored.downloadUrl;

            artifactsWithUrls.push({
                type: artifact.type,
                filename: artifact.filename,
                downloadUrl: stored.downloadUrl,
                size: artifact.size,
            });

            // Emit artifact event
            emit('artifact', {
                type: artifact.type,
                filename: artifact.filename,
                downloadUrl: stored.downloadUrl,
                size: artifact.size,
                library: stored.library,
            });
        }

        // Emit completion
        emit('production_complete', {
            runId,
            success: true,
            artifactsCount: result.artifacts.length,
            qaScore: result.qaReport?.overallScore,
            summary: result.summary,
            timestamp: Date.now(),
        });

        // Send summary as regular chat content for display
        emit('chunk', {
            content: formatProductionSummary(result, intentResult, artifactsWithUrls),
            sequenceId: 1,
            runId,
        });

        emit('done', {
            sequenceId: 2,
            runId,
            timestamp: Date.now(),
        });

        res.end();

        return {
            handled: true,
            result,
        };

    } catch (error: any) {
        console.error('[ProductionHandler] Pipeline error:', error);

        const rawMessage = error?.message || 'Unknown error';
        const userMessage =
            rawMessage === 'Message does not require production mode'
                ? 'Tu solicitud no requiere producción documental. Si necesitas un archivo, especifica el formato (Word/PDF/Excel/PPT) o selecciona la herramienta correspondiente.'
                : rawMessage.startsWith('La producción documental no generó entregables válidos')
                    ? 'No se pudieron generar archivos en esta corrida. Reintenta indicando formato y alcance (por ejemplo: "crear PPT de 10 diapositivas sobre ...").'
                : rawMessage;

        emit('production_error', {
            runId,
            error: userMessage,
            timestamp: Date.now(),
        });

        // Send error as chat content
        emit('chunk', {
            content: `❌ **Error en la producción documental**\n\n${userMessage}\n\nPor favor, intenta de nuevo o reformula tu solicitud.`,
            sequenceId: 1,
            runId,
        });

        emit('done', {
            sequenceId: 2,
            runId,
            timestamp: Date.now(),
        });

        res.end();

        return {
            handled: true,
            error: error.message,
        };
    }
}

// ============================================================================
// Format Summary
// ============================================================================

function formatProductionSummary(
    result: ProductionResult,
    intentResult: IntentResult,
    artifacts: Array<{ type: string; filename: string; downloadUrl: string; size: number }>
): string {
    const artifactLinks = artifacts.map(a => {
        const icon = getArtifactIcon(a.type);
        return `- ${icon} [${a.filename}](${a.downloadUrl}) (${formatSize(a.size)})`;
    }).join('\n');

    const qaInfo = result.qaReport
        ? `\n\n**Calidad:** ${result.qaReport.overallScore}/100 ✅`
        : '';

    return `## 📄 Documentos Generados

${artifactLinks}
${qaInfo}

---

${result.summary || 'Documentos generados exitosamente.'}

> 💡 *Los archivos están listos para descargar. Haz clic en cada enlace para obtenerlos.*`;
}

function getArtifactIcon(type: string): string {
    switch (type) {
        case 'word': return '📝';
        case 'excel': return '📊';
        case 'ppt': return '📽️';
        case 'pdf': return '📕';
        default: return '📄';
    }
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================================================
// Exports
// ============================================================================

export { PRODUCTION_INTENTS };
