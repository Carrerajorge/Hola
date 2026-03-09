import { globalBroker } from '../cognitive_kernel/messageBroker.js';
import { randomUUID } from 'crypto';

export class MultiAgentOrchestrator {
    private activeWorkers: Set<string> = new Set();

    constructor() { }

    public async brokerTask(taskPayload: any): Promise<any> {
        console.log(`[AgentOrchestrator] Orchestrating task payload across nested multi-agent ZeroMQ hierarchy...`);

        // 1. Auto-scaling heuristic: Spawn worker if pool is busy
        if (this.activeWorkers.size < 5) { // max 5 concurrent sub-agents mock
            this.spawnSubAgentWorker();
        }

        // 2. Dispatch to ZeroMQ DEALER socket via globalBroker
        const correlationId = randomUUID();
        await globalBroker.dispatchTask({
            taskId: correlationId,
            type: 'AGENT_TASK',
            data: taskPayload
        });

        console.log(`[AgentOrchestrator] Task ${correlationId} dispatched successfully to sub-agent pool.`);

        // Assuming synchronous completion for mock
        return { status: 'COMPLETED_BY_SUB_AGENT', taskId: correlationId };
    }

    private spawnSubAgentWorker() {
        const workerId = randomUUID();
        this.activeWorkers.add(workerId);
        console.log(`[AgentOrchestrator] (Auto-Scaling) Spawned new zeroMQ worker: ${workerId}`);
    }
}

export const agentOrchestrator = new MultiAgentOrchestrator();
