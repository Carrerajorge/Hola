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
import { storage } from "../storage";
import { normalizeDocument } from "./structuredDocumentNormalizer";
import { ingestSemanticDocumentToChunks } from "../pipeline/ingestion2026/documentIngestion2026";
import type { IngestedChunk } from "../pipeline/ingestion2026/ingestionTypes";
import {
    startProductionPipeline,
    type ProductionEvent,
    type ProductionResult,
    type Artifact,
} from '../agent/production';

// ============================================================================
// Types
// ============================================================================

export interface ProductionRequest {
    message: string;
    userId: string;
    chatId: string;
    intentResult: IntentResult;
    locale?: string;
    // When true, bypass task router "CHAT vs PRODUCTION" gating. Used by explicit docTool selection.
    forceProduction?: boolean;
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

function wantsArtifactOutput(message: string): boolean {
    const lower = message.toLowerCase();
    // If user mentions any concrete output format/action, we should allow production pipeline.
    return (
        /\b(excel|xlsx|hoja\s+de\s+c[aá]lculo|spreadsheet)\b/i.test(message) ||
        /\b(pptx?|powerpoint|presentaci[oó]n|diapositivas|slides?)\b/i.test(message) ||
        /\b(word|docx|documento)\b/i.test(message) ||
        /\bpdf\b/i.test(message) ||
        /\b(exporta|exportar|genera|generar|crea|crear|haz|hacer|construye|prepara)\b/i.test(message) &&
        /(excel|xlsx|ppt|pptx|powerpoint|word|docx|pdf)/i.test(message)
    );
}

export function isProductionIntent(intentResult: IntentResult | null, message?: string): boolean {
    if (!intentResult) return false;

    // Previously we skipped production for "search-first" prompts.
    // That breaks the core workflow: "busca N artículos y exporta a Excel / crea PPT".
    // New rule: only skip production if it's search-first AND user is NOT asking for an output artifact.
    if (message && requiresSearchFirst(message) && !wantsArtifactOutput(message)) {
        console.log(`[ProductionHandler] Search-first detected (no artifact requested), skipping production mode for: "${message.slice(0, 50)}..."`);
        return false;
    }

    return PRODUCTION_INTENTS.includes(intentResult.intent as any);
}

export function getDeliverables(intentResult: IntentResult): ('word' | 'excel' | 'ppt' | 'pdf')[] {
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
    if (topic.includes('excel') || topic.includes('hoja de cálculo') || topic.includes('spreadsheet')) {
        if (!deliverables.includes('excel')) deliverables.push('excel');
    }
    if (topic.includes('presentación') || topic.includes('presentation') || topic.includes('ppt')) {
        if (!deliverables.includes('ppt')) deliverables.push('ppt');
    }
    if (topic.includes('word') || topic.includes('documento') || topic.includes('document')) {
        if (!deliverables.includes('word')) deliverables.push('word');
    }

    return deliverables;
}

// ============================================================================
// Artifact Storage
// ============================================================================

const ARTIFACTS_DIR = path.join(process.cwd(), 'artifacts');

function buildExtractedTextFromChunks(chunks: IngestedChunk[], maxChars = 120_000): string {
    const parts: string[] = [];
    for (const c of chunks) {
        if (c.kind !== "document") continue;
        const body = (c.rawContent || c.content || "").trim();
        if (!body) continue;
        parts.push(body);
        if (parts.length >= 180) break;
    }
    const joined = parts.join("\n\n---\n\n").trim();
    if (!joined) return "";
    return joined.length > maxChars ? joined.slice(0, maxChars) : joined;
}

async function persistArtifactTextToConversationDocuments(args: {
    artifact: Artifact;
    chatId: string;
    runId: string;
    downloadUrl: string;
    library?: { fileUuid: string; storageUrl: string };
}): Promise<void> {
    const { artifact, chatId, runId, downloadUrl, library } = args;

    if (!chatId) return;

    // Only persist text-extractable artifacts for now.
    if (artifact.type !== "word") return;
    const fileName = artifact.filename || `document_${runId}.docx`;
    const mimeType = artifact.mimeType || "application/octet-stream";

    try {
        const docModel = await normalizeDocument(artifact.buffer, fileName);
        const { chunks, summary } = ingestSemanticDocumentToChunks({ model: docModel, mimeType });
        const extractedText = buildExtractedTextFromChunks(chunks);
        if (!extractedText) return;

        await storage.createConversationDocument({
            chatId,
            messageId: null,
            fileName,
            storagePath: null,
            mimeType,
            fileSize: artifact.size,
            extractedText,
            metadata: {
                source: "productionHandler",
                runId,
                artifactType: artifact.type,
                artifactFilename: artifact.filename,
                downloadUrl,
                libraryFileUuid: library?.fileUuid,
                libraryStorageUrl: library?.storageUrl,
                ingestionVersion: "ingestion2026",
                chunkCount: chunks.length,
                pageCount: summary.pageCount,
                sheetCount: summary.sheetCount,
            },
        });
    } catch (e: any) {
        console.warn("[ProductionHandler] Failed to persist artifact text to conversation_documents:", e?.message || e);
    }
}

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
        const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        res.write(chunk);
        if (typeof (res as any).flush === 'function') {
            (res as any).flush();
        }
    } catch (err) {
        console.error('[ProductionHandler] SSE write failed:', err);
    }
}

// ============================================================================
// Production Handler
// ============================================================================

export async function handleProductionRequest(
    req: ProductionRequest,
    res: Response
): Promise<ProductionHandlerResult> {
    const { message, userId, chatId, intentResult, locale } = req;

    console.log(`[ProductionHandler] Starting production for intent: ${intentResult.intent}`);
    console.log(`[ProductionHandler] Topic: ${intentResult.slots.topic || message}`);

    const runId = uuidv4();
    const deliverables = getDeliverables(intentResult);

    console.log(`[ProductionHandler] Deliverables: ${deliverables.join(', ')}`);

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("X-Production-Mode", "true");
    res.setHeader("X-Run-Id", runId);
    res.flushHeaders();

    // Emit production start
    writeSse(res, 'production_start', {
        runId,
        intent: intentResult.intent,
        topic: intentResult.slots.topic || message,
        deliverables,
        timestamp: Date.now(),
    });

    try {
        // Execute production pipeline
        const result = await startProductionPipeline(
            message,
            userId,
            chatId,
            (event: ProductionEvent) => {
                // Emit pipeline events as SSE
                writeSse(res, 'production_event', {
                    type: event.type,
                    stage: event.stage,
                    progress: event.progress,
                    message: event.message,
                    timestamp: event.timestamp,
                });
            },
            { forceProduction: !!req.forceProduction }
        );

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

            // Persist an extracted-text snapshot for cross-turn "improve the previous document" flows.
            // This runs out-of-band so it doesn't slow down SSE delivery.
            setImmediate(() => {
                void persistArtifactTextToConversationDocuments({
                    artifact,
                    chatId,
                    runId,
                    downloadUrl: stored.downloadUrl,
                    library: stored.library,
                });
            });

            // Emit artifact event
            writeSse(res, 'artifact', {
                type: artifact.type,
                filename: artifact.filename,
                downloadUrl: stored.downloadUrl,
                size: artifact.size,
                library: stored.library,
            });
        }

        // Emit completion
        writeSse(res, 'production_complete', {
            runId,
            success: true,
            artifactsCount: result.artifacts.length,
            qaScore: result.qaReport?.overallScore,
            summary: result.summary,
            timestamp: Date.now(),
        });

        // Send summary as regular chat content for display
        writeSse(res, 'chunk', {
            content: formatProductionSummary(result, intentResult, artifactsWithUrls),
            sequenceId: 1,
            requestId: runId,
            runId,
        });

        writeSse(res, 'done', {
            sequenceId: 2,
            requestId: runId,
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

        writeSse(res, 'production_error', {
            runId,
            error: error.message,
            timestamp: Date.now(),
        });

        // Send error as chat content
        writeSse(res, 'chunk', {
            content: `❌ **Error en la producción documental**\n\n${error.message}\n\nPor favor, intenta de nuevo o reformula tu solicitud.`,
            sequenceId: 1,
            requestId: runId,
            runId,
        });

        writeSse(res, 'done', {
            sequenceId: 2,
            requestId: runId,
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
