import { sttService } from '../services/voiceAudioService';
import type { WhatsAppMediaAttachment } from '../integrations/whatsappWeb';

export interface ProcessedMedia {
    messages: Array<{ role: string; content: string | object[] }>;
    extractedText?: string;
    analyzedDescription?: string;
    transcription?: string;
}

export async function processInboundMedia(
    media: WhatsAppMediaAttachment | undefined,
    text: string
): Promise<ProcessedMedia> {
    const messages: Array<{ role: string; content: any }> = [];

    if (!media) {
        messages.push({ role: 'user', content: text });
        return { messages };
    }

    switch (media.type) {
        case 'image': {
            const b64 = media.buffer.toString('base64');
            const promptText = resolveMediaPrompt(text, 'Analiza esta imagen y dime qué ves.');
            messages.push({
                role: 'user',
                content: [
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:${media.mimetype};base64,${b64}`,
                            detail: 'high',
                        },
                    },
                    {
                        type: 'text',
                        text: promptText,
                    },
                ],
            });
            break;
        }

        case 'audio': {
            const transcription = await sttService.transcribe(media.localPath, {
                provider: 'whisper_api',
                language: 'es',
            });

            const audioContext = transcription.success
                ? `[Mensaje de voz transcrito]:\n"${transcription.text}"`
                : `[Mensaje de voz recibido, no se pudo transcribir]`;
            const promptText = resolveMediaPrompt(text, '');

            messages.push({
                role: 'user',
                content: `${audioContext}\n\n${promptText}`.trim(),
            });

            return { messages, transcription: transcription.success ? transcription.text : undefined };
        }

        case 'video': {
            const frames = await extractKeyFrames(media.localPath, 3);
            const frameAnalyses: string[] = [];

            for (const frame of frames) {
                const analysis = await analyzeImageWithVLM(frame, 'Describe lo que ves en este frame de video');
                frameAnalyses.push(analysis);
            }

            const promptText = resolveMediaPrompt(text, 'Analiza este video.');
            messages.push({
                role: 'user',
                content: `[Video recibido - análisis de frames]:\n${frameAnalyses.map((a, i) => `Frame ${i + 1}: ${a}`).join('\n')}\n\n${promptText}`,
            });
            break;
        }

        case 'document': {
            const docText = await extractDocumentText(media.localPath, media.mimetype);
            const promptText = resolveMediaPrompt(text, 'Analiza este documento.');

            messages.push({
                role: 'user',
                content: `[Documento recibido: "${media.fileName}" (${media.mimetype})]:\n\n${docText.slice(0, 15000)}\n\n${promptText}`,
            });

            return { messages, extractedText: docText };
        }

        case 'sticker': {
            const b64 = media.buffer.toString('base64');
            const promptText = resolveMediaPrompt(text, '¿Qué sticker es este?');
            messages.push({
                role: 'user',
                content: [
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:${media.mimetype};base64,${b64}`,
                        },
                    },
                    {
                        type: 'text',
                        text: promptText,
                    },
                ],
            });
            break;
        }
    }

    return { messages };
}

function resolveMediaPrompt(rawText: string, fallback: string): string {
    const cleaned = String(rawText ?? '').trim();
    if (!cleaned) return fallback;

    const normalized = cleaned
        .normalize('NFKC')
        .replace(/[\[\]()]/g, '')
        .toLowerCase();

    // Ignore boilerplate placeholders injected by channel normalizers.
    if (
        normalized.includes('imagen recibida') ||
        normalized.includes('audio recibido') ||
        normalized.includes('mensaje de voz recibido') ||
        normalized.includes('transcripción no disponible') ||
        normalized.includes('transcripcion no disponible') ||
        normalized.includes('documento recibido')
    ) {
        return fallback;
    }

    return cleaned;
}


// --- Helpers ---

async function extractKeyFrames(videoPath: string, count: number): Promise<Buffer[]> {
    const { execSync } = await import('child_process');
    const tmpDir = await import('os').then(os => os.tmpdir());
    const frames: Buffer[] = [];

    for (let i = 0; i < count; i++) {
        const outputPath = `${tmpDir}/frame_${Date.now()}_${i}.jpg`;
        try {
            const duration = execSync(
                `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`
            ).toString().trim();
            const ts = (parseFloat(duration) / (count + 1)) * (i + 1);

            execSync(`ffmpeg -y -ss ${ts} -i "${videoPath}" -vframes 1 -q:v 2 "${outputPath}" 2>/dev/null`);
            const buffer = await import('fs/promises').then(f => f.readFile(outputPath));
            frames.push(buffer);
            await import('fs/promises').then(f => f.unlink(outputPath).catch(() => { }));
        } catch {
            // Si falla ignora
        }
    }

    return frames;
}

async function extractDocumentText(filePath: string, mimetype: string): Promise<string> {
    if (mimetype.includes('pdf')) {
        const pdfParseModule = await import('pdf-parse');
        const pdfParse = (pdfParseModule as any).default || pdfParseModule;
        const buffer = await import('fs/promises').then(f => f.readFile(filePath));
        const result = await pdfParse(buffer);
        return result.text;
    }

    if (mimetype.includes('wordprocessingml') || mimetype.includes('docx')) {
        const mammoth = await import('mammoth');
        const result = await mammoth.extractRawText({ path: filePath });
        return result.value;
    }

    if (mimetype.includes('spreadsheetml') || mimetype.includes('xlsx')) {
        const XLSX = await import('xlsx');
        const wb = XLSX.readFile(filePath);
        return wb.SheetNames.map(name => {
            const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
            return `[Hoja: ${name}]\n${csv}`;
        }).join('\n\n');
    }

    // Fallback: lectura directa
    return import('fs/promises').then(f => f.readFile(filePath, 'utf-8'));
}

async function analyzeImageWithVLM(imageBuffer: Buffer, prompt: string): Promise<string> {
    const { llmGateway } = await import('../lib/llmGateway');
    const response = await llmGateway.chat([
        {
            role: 'user',
            content: [
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}` } },
                { type: 'text', text: prompt },
            ]
        }
    ], {
        model: 'gemini-2.0-flash',
        maxTokens: 500,
    });
    return response.content || '';
}
