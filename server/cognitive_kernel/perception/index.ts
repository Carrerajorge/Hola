export * from './visualEngine.js';
export * from './auditoryEngine.js';
export * from './fsIndexer.js';
export * from './systemicTelemetry.js';
export * from './multimodalFusion.js';
export * from './accessibilityEngine.js';
export * from './temporalWorldModel.js';

import { visualEngine } from './visualEngine.js';
import { auditoryEngine } from './auditoryEngine.js';
import { fsIndexerEngine } from './fsIndexer.js';
import { telemetryEngine } from './systemicTelemetry.js';
import { fusionEngine } from './multimodalFusion.js';
import { accessibilityEngine } from './accessibilityEngine.js';
import { worldModelEngine } from './temporalWorldModel.js';

export class PerceptionCoordinator {
    public async bootAll() {
        console.log('[PerceptionCoordinator] Igniting all Omniscient Perception Engines...');
        visualEngine.startCapture();
        auditoryEngine.startListening();
        fsIndexerEngine.startWatching();
        telemetryEngine.startTelemetry();
        fusionEngine.startFusion();
        console.log('[PerceptionCoordinator] Perception layer online.');
    }

    public async shutdownAll() {
        visualEngine.stopCapture();
        auditoryEngine.stopListening();
        fsIndexerEngine.stopWatching();
        telemetryEngine.stopTelemetry();
        fusionEngine.stopFusion();
        console.log('[PerceptionCoordinator] Perception layer offline.');
    }
}

export const globalPerception = new PerceptionCoordinator();
