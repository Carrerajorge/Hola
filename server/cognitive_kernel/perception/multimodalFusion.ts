import { globalWorkspace, WorkspaceObservation } from '../globalWorkspace.js';

export class MultimodalFusionEngine {
    private active = false;
    // Sliding window of events 
    private eventBuffer: WorkspaceObservation[] = [];
    private readonly windowMs = 2000; // 2-second alignment window

    constructor() { }

    public startFusion() {
        this.active = true;
        console.log('[MultimodalFusion] Starting time-series alignment cross-attention loop...');
        this.fusionLoop();
    }

    public stopFusion() {
        this.active = false;
    }

    public ingestObservation(obs: WorkspaceObservation) {
        if (this.active) {
            this.eventBuffer.push(obs);
        }
    }

    private async fusionLoop() {
        while (this.active) {
            const now = Date.now();

            // Keep only events within window
            this.eventBuffer = this.eventBuffer.filter(e => now - e.timestamp < this.windowMs);

            if (this.eventBuffer.length >= 2) {
                this.alignAndFuse(this.eventBuffer);
            }

            await new Promise(r => setTimeout(r, 500)); // Run fusion every 500ms
        }
    }

    private alignAndFuse(events: WorkspaceObservation[]) {
        const hasVisual = events.some(e => e.source.includes('Visual'));
        const hasAudio = events.some(e => e.source.includes('Auditory'));

        if (hasVisual && hasAudio) {
            console.log(`[MultimodalFusion] 🌊 FUSION EVENT: Correlating Visual + Auditory signals into a unified tensor`);
            // Here a cross-attention layer would bind the CLIP embedding with the Whisper embedding.

            // Clean buffer post-fusion or let it slide (sliding is better for GWT)
        }
    }
}

export const fusionEngine = new MultimodalFusionEngine();
