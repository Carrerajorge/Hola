import fs from 'fs/promises';
import path from 'path';
import { WhatsAppWebManager } from '../integrations/whatsappWeb';
import { ttsService } from '../services/voiceAudioService';
import { telegramSendMessage, telegramSendPhoto, telegramSendVoice, telegramSendVideo, telegramSendDocument } from './telegram/telegramApi';

export interface AgentOutput {
    text: string;
    generatedFiles?: Array<{
        path: string;
        name: string;
        type: 'document' | 'image' | 'audio' | 'video' | 'spreadsheet' | 'presentation' | 'other';
        mimetype: string;
    }>;
    screenshot?: Buffer;
    screenshotCaption?: string;
}

export interface SendTarget {
    channel: 'whatsapp_web' | 'whatsapp_cloud' | 'telegram' | 'messenger' | 'wechat';
    userId: string;
    recipientId: string;  // JID para WhatsApp, chat_id para Telegram, etc.
}

export class MultimodalResponseSender {
    constructor(
        private whatsappManager: WhatsAppWebManager,
    ) { }

    private async delay(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private chunkText(text: string, maxLength: number): string[] {
        const chunks: string[] = [];
        let currentChunk = '';
        const paragraphs = text.split('\n\n');

        for (const paragraph of paragraphs) {
            if (currentChunk.length + paragraph.length > maxLength) {
                if (currentChunk) chunks.push(currentChunk.trim());
                currentChunk = paragraph;
            } else {
                currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
            }
        }
        if (currentChunk) chunks.push(currentChunk.trim());
        return chunks;
    }

    async send(target: SendTarget, output: AgentOutput): Promise<void> {
        switch (target.channel) {
            case 'whatsapp_web':
                await this.sendViaWhatsApp(target, output);
                break;
            case 'telegram':
                await this.sendViaTelegram(target, output);
                break;
            case 'messenger':
                await this.sendViaMessenger(target, output);
                break;
            case 'wechat':
                await this.sendViaWeChat(target, output);
                break;
        }
    }

    private async sendViaWhatsApp(target: SendTarget, output: AgentOutput): Promise<void> {
        const { userId, recipientId } = target;

        // 1. Enviar texto principal (chunked si es largo)
        if (output.text) {
            const chunks = this.chunkText(output.text, 4000);
            for (const chunk of chunks) {
                await this.whatsappManager.sendText(userId, recipientId, chunk);
                await this.delay(300); // evitar rate limit
            }
        }

        // 2. Enviar screenshot si hay
        if (output.screenshot) {
            await this.whatsappManager.sendImage(
                userId,
                recipientId,
                output.screenshot,
                'image/png',
                output.screenshotCaption || '📸 Screenshot del desktop'
            );
            await this.delay(300);
        }

        // 3. Enviar archivos generados
        if (output.generatedFiles?.length) {
            for (const file of output.generatedFiles) {
                try {
                    const buffer = await fs.readFile(file.path);

                    if (file.type === 'image') {
                        await this.whatsappManager.sendImage(
                            userId, recipientId, buffer, file.mimetype, file.name
                        );
                    } else if (file.type === 'audio') {
                        await this.whatsappManager.sendAudioNote(
                            userId, recipientId, buffer, file.mimetype
                        );
                    } else if (file.type === 'video') {
                        await this.whatsappManager.sendVideo(
                            userId, recipientId, buffer, file.mimetype, file.name
                        );
                    } else {
                        // document, spreadsheet, presentation, other
                        await this.whatsappManager.sendDocument(
                            userId, recipientId, buffer, file.name, file.mimetype
                        );
                    }
                    await this.delay(500);
                } catch (err: any) {
                    console.error(`[MultimodalSender] Failed to send file ${file.path}:`, err?.message);
                }
            }
        }

        // 4. Opcionalmente generar nota de voz para respuestas largas (Desactivado por defecto excepto si hay flag/condicion, pero según spec se genera si text > 3000)
        if (output.text && output.text.length > 3000) {
            try {
                const tts = await ttsService.synthesize(output.text.slice(0, 2000), {
                    provider: 'openai', // O elevenlabs si está configurado
                    format: 'opus',
                });
                if (tts.success && tts.audioPath) {
                    const audioBuffer = await fs.readFile(tts.audioPath);
                    await this.whatsappManager.sendAudioNote(
                        userId, recipientId, audioBuffer, 'audio/ogg; codecs=opus'
                    );
                }
            } catch (err) {
                console.warn('[MultimodalSender] TTS failed, skipping voice note:', err);
            }
        }
    }

    private async sendViaTelegram(target: SendTarget, output: AgentOutput): Promise<void> {
        const { recipientId } = target;

        // 1. Enviar texto principal
        if (output.text) {
            await telegramSendMessage(recipientId, output.text);
            await this.delay(300);
        }

        // 2. Enviar screenshot
        if (output.screenshot) {
            await telegramSendPhoto(recipientId, output.screenshot, 'screenshot.png', 'image/png', output.screenshotCaption || '📸 Screenshot del desktop');
            await this.delay(300);
        }

        // 3. Enviar archivos generados
        if (output.generatedFiles?.length) {
            for (const file of output.generatedFiles) {
                try {
                    const buffer = await fs.readFile(file.path);

                    if (file.type === 'image') {
                        await telegramSendPhoto(recipientId, buffer, file.name, file.mimetype);
                    } else if (file.type === 'audio') {
                        await telegramSendVoice(recipientId, buffer, file.name, file.mimetype);
                    } else if (file.type === 'video') {
                        await telegramSendVideo(recipientId, buffer, file.name, file.mimetype);
                    } else {
                        await telegramSendDocument(recipientId, buffer, file.name, file.mimetype);
                    }
                    await this.delay(500);
                } catch (err: any) {
                    console.error(`[MultimodalSender] Failed to send file to Telegram ${file.path}:`, err?.message);
                }
            }
        }

        // 4. TTS opcional
        if (output.text && output.text.length > 3000) {
            try {
                const tts = await ttsService.synthesize(output.text.slice(0, 2000), {
                    provider: 'openai',
                    format: 'opus',
                });
                if (tts.success && tts.audioPath) {
                    const audioBuffer = await fs.readFile(tts.audioPath);
                    await telegramSendVoice(recipientId, audioBuffer, 'voice.ogg', 'audio/ogg');
                }
            } catch (err) {
                console.warn('[MultimodalSender] TTS failed for Telegram:', err);
            }
        }
    }

    private async sendViaMessenger(target: SendTarget, output: AgentOutput): Promise<void> {
        console.log('[MultimodalSender] Messenger not fully implemented yet');
    }

    private async sendViaWeChat(target: SendTarget, output: AgentOutput): Promise<void> {
        console.log('[MultimodalSender] WeChat not fully implemented yet');
    }
}
