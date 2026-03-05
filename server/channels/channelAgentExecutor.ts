import fs from 'fs/promises';
import path from 'path';
import type { Response } from 'express';
import { createUnifiedRun, executeUnifiedChat } from '../agent/unifiedChatHandler';
import { storage } from '../storage';
import { MemorySseResponse } from '../integrations/whatsappWebAutoReply';
import { processInboundMedia } from './mediaProcessor';
import type { WhatsAppMediaAttachment } from '../integrations/whatsappWeb';
import { MultimodalResponseSender, type SendTarget, type AgentOutput } from './multimodalResponseSender';
import { generateWordDocument } from '../services/documentGeneration';

export interface ChannelExecutionRequest {
    userId: string;
    chatId: string;
    chatTitle?: string;
    inboundText: string;
    media?: WhatsAppMediaAttachment;
    sender: MultimodalResponseSender;
    sendTarget: SendTarget;
    customPrompt?: string;
    accessLevel?: 'owner' | 'trusted' | 'unknown';
}

const AUTO_REPLY_TIMEOUT_MS = 120_000;
const GENERATED_ARTIFACTS_DIR = path.join(process.cwd(), 'generated_artifacts');
const RESOLVABLE_ARTIFACT_DIRS = [
    GENERATED_ARTIFACTS_DIR,
    path.join(process.cwd(), 'artifacts'),
];

type ArtifactLike = {
    type?: string;
    url?: string;
    name?: string;
    data?: unknown;
    mimeType?: string;
};

const MIME_BY_EXT: Record<string, string> = {
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
};

const EXT_BY_MIME: Record<string, string> = {
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'application/pdf': '.pdf',
    'text/plain': '.txt',
    'text/csv': '.csv',
    'application/json': '.json',
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
};

const WORD_DOCUMENT_REQUEST_RE = /\b(word|docx|documento|document)\b/i;
const DOCUMENT_CREATE_ACTION_RE = /\b(crea\w*|genera\w*|env[ií]a\w*|manda\w*|haz|generate|create|send|make)\b/i;

function sanitizeFileName(name: string, fallback = 'artifact.bin'): string {
    const normalized = String(name || '')
        .normalize('NFKC')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
    return normalized || fallback;
}

function inferGeneratedFileType(fileName: string): Exclude<AgentOutput['generatedFiles'], undefined>[0]['type'] {
    const ext = path.extname(fileName).toLowerCase();
    if (ext === '.pdf' || ext === '.docx' || ext === '.txt' || ext === '.md') return 'document';
    if (ext === '.xlsx' || ext === '.csv') return 'spreadsheet';
    if (ext === '.pptx') return 'presentation';
    if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.webp') return 'image';
    if (ext === '.mp3' || ext === '.ogg' || ext === '.wav') return 'audio';
    if (ext === '.mp4' || ext === '.mov' || ext === '.webm') return 'video';
    return 'other';
}

function inferMimeType(fileName: string, fallback?: string): string {
    const ext = path.extname(fileName).toLowerCase();
    return fallback || MIME_BY_EXT[ext] || 'application/octet-stream';
}

function isProbableBase64(value: string): boolean {
    if (!value || value.length < 12) return false;
    const compact = value.replace(/\s+/g, '');
    if (compact.length % 4 !== 0) return false;
    return /^[A-Za-z0-9+/=]+$/.test(compact);
}

function decodeArtifactData(data: unknown): { buffer: Buffer; mimeType?: string; fileName?: string } | null {
    if (!data) return null;

    if (Buffer.isBuffer(data)) {
        return { buffer: data };
    }

    if (typeof data === 'string') {
        const dataUrl = data.match(/^data:([^;]+);base64,(.+)$/i);
        if (dataUrl) {
            return {
                buffer: Buffer.from(dataUrl[2], 'base64'),
                mimeType: dataUrl[1].toLowerCase(),
            };
        }
        if (isProbableBase64(data)) {
            return { buffer: Buffer.from(data, 'base64') };
        }
        return null;
    }

    if (typeof data !== 'object') return null;
    const record = data as Record<string, unknown>;
    const base64 = typeof record.base64 === 'string' ? record.base64
        : typeof record.data === 'string' ? record.data
            : null;
    if (!base64) return null;

    const fromDataUrl = base64.match(/^data:([^;]+);base64,(.+)$/i);
    if (fromDataUrl) {
        return {
            buffer: Buffer.from(fromDataUrl[2], 'base64'),
            mimeType: fromDataUrl[1].toLowerCase(),
            fileName: typeof record.filename === 'string' ? record.filename : undefined,
        };
    }

    if (!isProbableBase64(base64)) return null;
    return {
        buffer: Buffer.from(base64, 'base64'),
        mimeType: typeof record.mimeType === 'string' ? record.mimeType.toLowerCase() : undefined,
        fileName: typeof record.filename === 'string' ? record.filename : undefined,
    };
}

async function findExistingArtifactPath(artifact: ArtifactLike): Promise<string | null> {
    const fileNameFromName = sanitizeFileName(artifact.name || '');
    if (fileNameFromName) {
        for (const baseDir of RESOLVABLE_ARTIFACT_DIRS) {
            const candidate = path.join(baseDir, fileNameFromName);
            try {
                const stat = await fs.stat(candidate);
                if (stat.isFile()) return candidate;
            } catch {
                continue;
            }
        }
    }

    if (typeof artifact.url === 'string') {
        const fromUrl = artifact.url.match(/\/api\/artifacts\/([^/?#]+)/i)?.[1];
        if (fromUrl) {
            const decodedName = sanitizeFileName(decodeURIComponent(fromUrl));
            for (const baseDir of RESOLVABLE_ARTIFACT_DIRS) {
                const candidate = path.join(baseDir, decodedName);
                try {
                    const stat = await fs.stat(candidate);
                    if (stat.isFile()) return candidate;
                } catch {
                    continue;
                }
            }
        }
    }

    return null;
}

async function ensureGeneratedArtifactsDir(): Promise<void> {
    await fs.mkdir(GENERATED_ARTIFACTS_DIR, { recursive: true });
}

async function materializeArtifactToFile(artifact: ArtifactLike, runId: string): Promise<Exclude<AgentOutput['generatedFiles'], undefined>[0] | null> {
    const decoded = decodeArtifactData(artifact.data);
    const requestedName = sanitizeFileName(
        artifact.name || decoded?.fileName || `artifact_${Date.now()}`,
        `artifact_${Date.now()}.bin`,
    );
    const requestedMime = typeof artifact.mimeType === 'string' ? artifact.mimeType.toLowerCase() : decoded?.mimeType;

    if (decoded?.buffer?.length) {
        await ensureGeneratedArtifactsDir();
        let finalName = requestedName;
        const ext = path.extname(finalName).toLowerCase();
        if (!ext && requestedMime && EXT_BY_MIME[requestedMime]) {
            finalName = `${finalName}${EXT_BY_MIME[requestedMime]}`;
        }

        const uniqueName = sanitizeFileName(`${runId}_${Date.now()}_${finalName}`, `artifact_${Date.now()}.bin`);
        const outputPath = path.join(GENERATED_ARTIFACTS_DIR, uniqueName);
        await fs.writeFile(outputPath, decoded.buffer);

        return {
            name: uniqueName,
            path: outputPath,
            type: inferGeneratedFileType(uniqueName),
            mimetype: inferMimeType(uniqueName, requestedMime),
        };
    }

    const existingPath = await findExistingArtifactPath(artifact);
    if (!existingPath) return null;
    const existingName = sanitizeFileName(path.basename(existingPath), requestedName);
    return {
        name: existingName,
        path: existingPath,
        type: inferGeneratedFileType(existingName),
        mimetype: inferMimeType(existingName, requestedMime),
    };
}

function compactWords(text: string): string[] {
    return String(text || '')
        .normalize('NFKC')
        .replace(/[\r\n]+/g, ' ')
        .replace(/[^\p{L}\p{N}\s_-]/gu, ' ')
        .split(/\s+/)
        .map((part) => part.trim())
        .filter(Boolean);
}

function buildAutoWordTitle(chatTitle: string | undefined, inboundText: string): string {
    const fromChat = compactWords(chatTitle || '').slice(0, 6).join(' ');
    if (fromChat) return fromChat;
    const fromPrompt = compactWords(inboundText).slice(0, 8).join(' ');
    if (fromPrompt) return fromPrompt;
    return 'Documento IliaGPT';
}

function shouldAutoGenerateWordDocument(inboundText: string): boolean {
    const normalized = String(inboundText || '').normalize('NFKC');
    return WORD_DOCUMENT_REQUEST_RE.test(normalized) && DOCUMENT_CREATE_ACTION_RE.test(normalized);
}

async function maybeCreateRequestedWordDocument(input: {
    inboundText: string;
    chatTitle?: string;
    runId: string;
    content: string;
}): Promise<Exclude<AgentOutput['generatedFiles'], undefined>[0] | null> {
    if (!shouldAutoGenerateWordDocument(input.inboundText)) return null;
    if (!input.content || !input.content.trim()) return null;

    const title = buildAutoWordTitle(input.chatTitle, input.inboundText);
    const safeTitle = sanitizeFileName(title, 'Documento_IliaGPT').replace(/\.[^.]+$/, '');
    const fileName = sanitizeFileName(`${input.runId}_${safeTitle}.docx`, `${input.runId}_documento.docx`);

    await ensureGeneratedArtifactsDir();
    const buffer = await generateWordDocument(title, input.content);
    const filePath = path.join(GENERATED_ARTIFACTS_DIR, fileName);
    await fs.writeFile(filePath, buffer);

    return {
        name: fileName,
        path: filePath,
        type: 'document',
        mimetype: MIME_BY_EXT['.docx'],
    };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
        timer.unref?.();
        promise.then(
            (v) => { clearTimeout(timer); resolve(v); },
            (e) => { clearTimeout(timer); reject(e); },
        );
    });
}

export async function executeChannelAgent(req: ChannelExecutionRequest): Promise<void> {
    const { userId, chatId, chatTitle, inboundText, media, sender, sendTarget, customPrompt, accessLevel = 'owner' } = req;

    // 1. Procesar media entrante y agregarlo al contexto conversacional actual
    const { messages: mediaContextMsgs } = await processInboundMedia(media, inboundText);

    // 2. Cargar historial
    const history = await storage.getChatMessages(chatId).then((msgs) => msgs.slice(-20));
    const messages: Array<{ role: string; content: any }> = history
        .filter((m: any) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map((m: any) => ({ role: m.role, content: m.content }));

    if (customPrompt) {
        messages.unshift({ role: 'system', content: customPrompt });
    }

    // Agregar los nuevos mensajes procesados por vision/audio/docs al final
    messages.push(...mediaContextMsgs);

    // 3. Crear entorno de ejecución Agentic
    const unifiedContext = await createUnifiedRun({
        messages,
        chatId,
        userId,
        messageId: `channel_msg_${Date.now()}`,
        accessLevel,
        // TODO: Aca en el futuro podemos forzar latencyMode: 'deep' si detectamos intención pesada
    });

    const memRes = new MemorySseResponse();

    console.log(`[ChannelAgentExecutor] Executing agent loop for run ${unifiedContext.runId}...`);

    // 4. Ejecutar con Timeout
    await withTimeout(
        executeUnifiedChat(unifiedContext, {
            messages,
            chatId,
            userId,
            messageId: `channel_msg_${Date.now()}`,
        }, memRes as any as Response),
        AUTO_REPLY_TIMEOUT_MS,
        'Auto-reply AI'
    );

    console.log(`[ChannelAgentExecutor] AI finished. Parsing events...`);

    // 5. Parsear la respuesta y los artefactos del stream SSE interceptado en memRes
    const assistantText = memRes.chunks
        .filter((c: any) => c.event === 'chunk' && typeof c.data?.content === 'string')
        .map((c: any) => c.data.content)
        .join('')
        .trim();

    const confirmationEvent = memRes.chunks.find((c: any) => c.event === 'confirmation');
    const browserSteps = memRes.chunks.filter((c: any) => c.event === 'browser_report');

    let finalText = assistantText;
    if (!finalText && confirmationEvent) {
        finalText = 'Listo. Responda CONFIRM o CANCEL para continuar.';
    } else if (!finalText && browserSteps.length > 0) {
        finalText = `He completado ${browserSteps.length} acciones en el navegador para cumplir tu solicitud.`;
    } else if (!finalText) {
        finalText = 'Listo.';
    }

    // 6. Persistir el output del agente en la base de datos local
    await storage.createChatMessage({
        chatId,
        role: 'assistant',
        content: finalText,
        status: 'done',
        requestId: `ch_out_${unifiedContext.runId}`,
        metadata: { channel: sendTarget.channel, to: sendTarget.recipientId },
    } as any);
    await storage.updateChat(chatId, { lastMessageAt: new Date() } as any);

    // 7. Preparar la salida para el Multimodal Sender
    const output: AgentOutput = {
        text: finalText,
        generatedFiles: [],
    };

    // 8. Interceptar archivos generados (documentos, pptx, excel, etc)
    const artifactEvents = memRes.chunks.filter((c: any) => c.event === 'artifacts' && c.data?.artifacts);
    const fileKeySet = new Set<string>();
    for (const evt of artifactEvents) {
        const artifacts: ArtifactLike[] = evt.data.artifacts || [];
        for (const artifact of artifacts) {
            const generatedFile = await materializeArtifactToFile(artifact, unifiedContext.runId);
            if (!generatedFile) continue;
            const dedupeKey = `${generatedFile.path}|${generatedFile.name}`;
            if (fileKeySet.has(dedupeKey)) continue;
            fileKeySet.add(dedupeKey);
            output.generatedFiles!.push(generatedFile);
        }
    }

    if ((output.generatedFiles?.length || 0) === 0) {
        try {
            const autoDoc = await maybeCreateRequestedWordDocument({
                inboundText,
                chatTitle,
                runId: unifiedContext.runId,
                content: finalText,
            });
            if (autoDoc) {
                output.generatedFiles!.push(autoDoc);
                output.text = `${output.text}\n\nAdjunto el documento Word solicitado.`;
            }
        } catch (error) {
            console.warn('[ChannelAgentExecutor] Failed to auto-generate DOCX fallback:', (error as Error)?.message || error);
        }
    }

    // Extraer un screenshot si el browser tool fue usado
    const lastBrowserStep = browserSteps[browserSteps.length - 1];
    if (lastBrowserStep && lastBrowserStep.data?.screenshot) { // asumiendo base64 en data.screenshot
        const base64Data = lastBrowserStep.data.screenshot.replace(/^data:image\/\w+;base64,/, "");
        output.screenshot = Buffer.from(base64Data, 'base64');
        output.screenshotCaption = lastBrowserStep.data?.reasoning || 'Último estado del navegador';
    }

    // 9. Enviar respuesta real mediante canal correspondiente (WhatsApp, Telegram, etc)
    console.log(`[ChannelAgentExecutor] Dispatching to MultimodalSender (${output.text.length} chars, ${output.generatedFiles?.length} files)`);
    await sender.send(sendTarget, output);
}

export const __channelAgentExecutorInternals = {
    shouldAutoGenerateWordDocument,
    buildAutoWordTitle,
    decodeArtifactData,
    inferGeneratedFileType,
};
