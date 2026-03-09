import { globalWorkspace, WorkspaceObservation } from '../globalWorkspace.js';
import { globalGraphEngine } from '../knowledgeGraphInit.js';

export class TemporalWorldModel {
    private isRunning = false;
    private eventHistory: WorkspaceObservation[] = [];

    constructor() { }

    public startModeling() {
        this.isRunning = true;
        console.log('[TemporalWorldModel] Initializing temporal property graph...');
    }

    public stopModeling() {
        this.isRunning = false;
    }

    // Ingest from Global Workspace Attention Mechanism
    public ingestSalientEvent(event: WorkspaceObservation) {
        if (!this.isRunning) return;

        this.eventHistory.push(event);
        console.log(`[TemporalWorldModel] Ingested salient event from ${event.source} into temporal graph.`);

        // Abstractly: Write vertex + time edge to Graph DB
        if (globalGraphEngine.isReady()) {
            // e.g. neo4j / rocksdb write: (Event)-[OCCURRED_AT]->(TimeNode)
        }
    }

    public queryState(timeWindowMs: number): WorkspaceObservation[] {
        const cutoff = Date.now() - timeWindowMs;
        return this.eventHistory.filter(e => e.timestamp >= cutoff);
    }
}

export const worldModelEngine = new TemporalWorldModel();
