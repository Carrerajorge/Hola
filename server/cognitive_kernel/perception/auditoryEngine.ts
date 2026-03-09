import { globalWorkspace } from '../globalWorkspace.js';
import { globalModelManager } from '../modelWarmup.js';

export class AuditoryPerceptionEngine {
    private isListening = false;
    private noiseGateThreshold = -45; // dBFS

    constructor() { }

    public startListening() {
        this.isListening = true;
        console.log(`[AuditoryPerception] Opening CoreAudio tap. Noise gate: ${this.noiseGateThreshold} dB.`);
        this.listenLoop();
    }

    public stopListening() {
        this.isListening = false;
    }

    private async listenLoop() {
        // Mock continuous audio stream processing
        while (this.isListening) {
            const audioChunk = await this.readAudioBuffer();
            const dbLevel = this.calculateDecibels(audioChunk);

            if (dbLevel > this.noiseGateThreshold) {
                // Voice Activity Detection (VAD) triggered
                if (globalModelManager.isLoaded('Whisper-large-v3')) {
                    const transcript = await this.transcribe(audioChunk);
                    if (transcript.trim().length > 0) {
                        globalWorkspace.publish({
                            source: 'AuditoryPerceptionEngine',
                            type: 'perception',
                            payload: { event: 'SPEECH_DETECTED', text: transcript },
                            confidence: 0.9,
                            timestamp: Date.now()
                        });
                    }
                }
            }
            await new Promise(r => setTimeout(r, 100)); // 100ms chunks
        }
    }

    private async readAudioBuffer(): Promise<Float32Array> {
        return new Float32Array(4410); // 100ms at 44.1kHz
    }

    private calculateDecibels(buffer: Float32Array): number {
        // Mock occasional speech
        return Math.random() > 0.95 ? -30 : -60;
    }

    private async transcribe(buffer: Float32Array): Promise<string> {
        return "User is talking about coding architectures.";
    }
}

export const auditoryEngine = new AuditoryPerceptionEngine();
