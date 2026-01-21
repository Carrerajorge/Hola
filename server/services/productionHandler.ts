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

export function isProductionIntent(intentResult: IntentResult | null): boolean {
    if (!intentResult) return false;
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

async function saveArtifact(artifact: Artifact, runId: string): Promise<string> {
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

    return downloadUrl;
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
            }
        );

        // Save artifacts and generate download URLs
        const artifactsWithUrls: Array<{ type: string; filename: string; downloadUrl: string; size: number }> = [];

        for (const artifact of result.artifacts) {
            const downloadUrl = await saveArtifact(artifact, runId);
            artifact.downloadUrl = downloadUrl;

            artifactsWithUrls.push({
                type: artifact.type,
                filename: artifact.filename,
                downloadUrl,
                size: artifact.size,
            });

            // Emit artifact event
            writeSse(res, 'artifact', {
                type: artifact.type,
                filename: artifact.filename,
                downloadUrl,
                size: artifact.size,
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
