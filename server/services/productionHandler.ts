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
import { conversationStateService } from "./conversationStateService";
import { documentIngestion } from "./documentIngestion";
import { RequestBriefSchema, requestUnderstandingAgent, type RequestBrief } from "../agent/requestUnderstanding";
import {
    startProductionPipeline,
    type ProductionEvent,
    type ProductionResult,
    type Artifact,
    type RouterResult,
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
    requestId?: string;
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
): Promise<{ downloadUrl: string; filePath: string; library?: { fileUuid: string; storageUrl: string } }> {
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

    return { downloadUrl, filePath, library };
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
    const requestId = req.requestId || `prod_${runId}`;
    const deliverables = getDeliverables(intentResult);

    console.log(`[ProductionHandler] Deliverables: ${deliverables.join(', ')}`);

    // Ensure chat exists so we can persist messages (critical for memory)
    try {
        const existingChat = await storage.getChat(chatId);
        if (!existingChat) {
            await storage.createChat({
                id: chatId,
                title: "New Chat",
                userId: userId || undefined,
            });
        }
    } catch (e) {
        console.warn('[ProductionHandler] Failed to ensure chat exists (best-effort):', e);
    }

    // Persist the user message + create assistant placeholder so the conversation doesn't lose context.
    let persistedUserMessageId: string | null = null;
    let assistantMessageId: string | null = null;
    try {
        const userMsg = await storage.createChatMessage({
            chatId,
            role: "user",
            content: message,
            status: "done",
            requestId,
        });
        persistedUserMessageId = userMsg.id;

        await conversationStateService.appendMessage(chatId, "user", message, {
            chatMessageId: userMsg.id,
            requestId: `${requestId}:state:user`,
        });

        const assistantMsg = await storage.createChatMessage({
            chatId,
            role: "assistant",
            content: "",
            status: "pending",
            runId,
            userMessageId: userMsg.id,
            requestId: `${requestId}:assistant`,
        });
        assistantMessageId = assistantMsg.id;
    } catch (e) {
        console.warn('[ProductionHandler] Failed to persist messages (best-effort):', e);
    }

    // Set SSE headers (only if not already sent by an upstream handler)
    if (!res.headersSent) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("Transfer-Encoding", "chunked");
        res.setHeader("X-Accel-Buffering", "no");
        res.setHeader("X-Production-Mode", "true");
        res.setHeader("X-Run-Id", runId);
        res.setHeader("X-Request-Id", requestId);
        res.flushHeaders();
    }

    // Emit production start
    writeSse(res, 'production_start', {
        runId,
        requestId,
        intent: intentResult.intent,
        topic: intentResult.slots.topic || message,
        deliverables,
        timestamp: Date.now(),
    });

    try {
        const referencesPreviousDoc = /\b(lo|la)\s+anterior\b/i.test(message) ||
            /\b(documento|doc|archivo|texto)\s+(anterior|previo|previa|de antes)\b/i.test(message);

        const clampText = (text: string, maxChars: number): string => {
            if (!text) return "";
            if (text.length <= maxChars) return text;
            return text.slice(0, maxChars) + `\n\n[... truncated to ${maxChars} chars ...]`;
        };

        // Load the last persisted conversation document when the user references "documento anterior".
        let baseDoc: { fileName: string; extractedText: string } | null = null;
        if (referencesPreviousDoc) {
            try {
                const docs = await storage.getConversationDocuments(chatId);
                const lastWithText = [...docs].reverse().find(d => (d.extractedText || "").trim().length > 0);
                if (lastWithText?.extractedText) {
                    baseDoc = { fileName: lastWithText.fileName, extractedText: lastWithText.extractedText };
                }
            } catch (e) {
                console.warn('[ProductionHandler] Failed to load conversation documents (best-effort):', e);
            }
        }

        let brief: RequestBrief | null = null;
        try {
            if (referencesPreviousDoc && !baseDoc) {
                // Hard blocker: we cannot improve "the previous document" if we don't have any persisted content.
                brief = RequestBriefSchema.parse({
                    intent: { primary_intent: "Mejorar un documento previo", confidence: 0.6 },
                    subtasks: [
                        { title: "Identificar documento base", description: "Identificar el documento a mejorar", priority: "high" },
                        { title: "Aplicar correcciones/mejoras", description: "Reescribir/editar el documento respetando formato y objetivo", priority: "medium" },
                    ],
                    deliverable: {
                        description: "Documento mejorado",
                        format: deliverables.join("+") || "word",
                    },
                    audience: { audience: "usuario", tone: "directo", language: locale || "es" },
                    restrictions: [],
                    data_provided: [],
                    assumptions: [],
                    success_criteria: ["Se aplica la mejora sobre el documento base correcto y el resultado es consistente"],
                    risks: [{ risk: "No se encontró el documento base en el historial de la conversación", severity: "critical" }],
                    ambiguities: ["No está claro a qué documento anterior te refieres"],
                    blocker: {
                        is_blocked: true,
                        question: "¿Podés adjuntar el documento (o pegar el texto) que querés que corrija/mejore?",
                    },
                });
            } else {
                const briefAttachments = baseDoc
                    ? [{ type: "document" as const, name: baseDoc.fileName, extractedText: clampText(baseDoc.extractedText, 15000) }]
                    : [];

                brief = await requestUnderstandingAgent.buildBrief({
                    text: message,
                    attachments: briefAttachments,
                    userId,
                    requestId: `${requestId}:brief`,
                });
            }

            writeSse(res, 'brief', { runId, requestId, brief });
        } catch (e) {
            console.warn('[ProductionHandler] RequestUnderstanding brief failed (best-effort):', e);
        }

        if (brief?.blocker?.is_blocked) {
            const question = (brief.blocker.question || "").trim() || "¿Qué información falta para poder completar el encargo?";

            writeSse(res, 'chunk', {
                content: question,
                sequenceId: 1,
                requestId,
                runId,
            });

            writeSse(res, 'done', {
                sequenceId: 2,
                requestId,
                runId,
                timestamp: Date.now(),
            });

            if (assistantMessageId) {
                try {
                    await storage.updateChatMessageContent(assistantMessageId, question, 'done', { brief });
                    await conversationStateService.appendMessage(chatId, "assistant", question, {
                        chatMessageId: assistantMessageId,
                        requestId: `${requestId}:state:assistant`,
                        metadata: { brief },
                    });
                } catch (e) {
                    console.warn('[ProductionHandler] Failed to finalize blocked assistant message (best-effort):', e);
                }
            }

            res.end();
            return { handled: true, error: question };
        }

        const internalSources = baseDoc
            ? [{
                title: `Base document: ${baseDoc.fileName}`,
                content: clampText(baseDoc.extractedText, 30000),
            }]
            : [];

        const routerResultOverride: RouterResult = {
            mode: 'PRODUCTION',
            confidence: 1.0,
            intent: deliverables.includes('ppt') ? 'presentation' : deliverables.includes('excel') ? 'analysis' : 'report',
            deliverables,
            topic: intentResult.slots.topic || message,
            reasoning: `Forced production via intent=${intentResult.intent}`,
        };

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
                    requestId,
                    runId,
                });
            },
            {
                routerResultOverride,
                forceProduction: true,
                workOrderMetadata: {
                    ...(internalSources.length ? { internalSources } : {}),
                    ...(brief ? { requestBrief: brief } : {}),
                },
            }
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

            // Emit artifact event
            writeSse(res, 'artifact', {
                type: artifact.type,
                filename: artifact.filename,
                downloadUrl: stored.downloadUrl,
                size: artifact.size,
                library: stored.library,
                requestId,
                runId,
            });

            // Persist extracted text so "mejora el documento anterior" works reliably.
            // This also feeds ConversationState RAG indexing.
            let extractedText: string | null = null;
            try {
                extractedText = await documentIngestion.extractContent(artifact.buffer, artifact.mimeType);
            } catch (e) {
                console.warn('[ProductionHandler] Failed to extract artifact text (best-effort):', e);
            }

            try {
                await storage.createConversationDocument({
                    chatId,
                    messageId: assistantMessageId || null,
                    fileName: artifact.filename,
                    storagePath: stored.library?.storageUrl || stored.downloadUrl || stored.filePath,
                    mimeType: artifact.mimeType,
                    fileSize: artifact.size,
                    extractedText: extractedText ? clampText(extractedText, 200000) : null,
                    metadata: {
                        runId,
                        deliverable: artifact.type,
                        downloadUrl: stored.downloadUrl,
                        library: stored.library,
                    },
                });
            } catch (e) {
                console.warn('[ProductionHandler] Failed to persist conversation document (best-effort):', e);
            }

            try {
                await conversationStateService.addArtifact(
                    chatId,
                    artifact.type,
                    artifact.mimeType,
                    stored.library?.storageUrl || stored.downloadUrl,
                    artifact.filename,
                    artifact.size,
                    artifact.buffer,
                    {
                        messageId: assistantMessageId || undefined,
                        extractedText: extractedText ? clampText(extractedText, 200000) : undefined,
                        metadata: { runId, downloadUrl: stored.downloadUrl, library: stored.library },
                    }
                );
            } catch (e) {
                console.warn('[ProductionHandler] Failed to index artifact in conversation state (best-effort):', e);
            }
        }

        // Emit completion
        writeSse(res, 'production_complete', {
            runId,
            requestId,
            success: true,
            artifactsCount: result.artifacts.length,
            qaScore: result.qaReport?.overallScore,
            summary: result.summary,
            timestamp: Date.now(),
        });

        // Send summary as regular chat content for display
        const finalContent = formatProductionSummary(result, intentResult, artifactsWithUrls);
        writeSse(res, 'chunk', {
            content: finalContent,
            sequenceId: 1,
            requestId,
            runId,
        });

        writeSse(res, 'done', {
            sequenceId: 2,
            requestId,
            runId,
            timestamp: Date.now(),
        });

        res.end();

        // Finalize assistant message persistence
        if (assistantMessageId) {
            try {
                const metadata = {
                    runId,
                    brief: (brief as any) || undefined,
                    artifacts: artifactsWithUrls,
                    qaScore: result.qaReport?.overallScore,
                };
                await storage.updateChatMessageContent(assistantMessageId, finalContent, 'done', metadata);
                await conversationStateService.appendMessage(chatId, "assistant", finalContent, {
                    chatMessageId: assistantMessageId,
                    requestId: `${requestId}:state:assistant`,
                    metadata,
                });
            } catch (e) {
                console.warn('[ProductionHandler] Failed to finalize assistant message (best-effort):', e);
            }
        }

        return {
            handled: true,
            result,
        };

    } catch (error: any) {
        console.error('[ProductionHandler] Pipeline error:', error);

        writeSse(res, 'production_error', {
            runId,
            requestId,
            error: error.message,
            timestamp: Date.now(),
        });

        // Send error as chat content
        const errorContent = `❌ **Error en la producción documental**\n\n${error.message}\n\nPor favor, intenta de nuevo o reformula tu solicitud.`;
        writeSse(res, 'chunk', {
            content: errorContent,
            sequenceId: 1,
            requestId,
            runId,
        });

        writeSse(res, 'done', {
            sequenceId: 2,
            requestId,
            runId,
            timestamp: Date.now(),
        });

        res.end();

        if (assistantMessageId) {
            try {
                await storage.updateChatMessageContent(assistantMessageId, errorContent, 'failed');
                await conversationStateService.appendMessage(chatId, "assistant", errorContent, {
                    chatMessageId: assistantMessageId,
                    requestId: `${requestId}:state:assistant`,
                    metadata: { error: error.message },
                });
            } catch (e) {
                console.warn('[ProductionHandler] Failed to persist error assistant message (best-effort):', e);
            }
        }

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
