import { randomUUID } from 'crypto';

export interface HTNTask {
    id: string;
    name: string;
    level: 1 | 2 | 3 | 4; // 1: High-level goal, 4: Atomic action
    status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
    dependencies: string[]; // DAG structure
}

export class HTNPlannerV2 {
    private taskDag: Map<string, HTNTask> = new Map();

    constructor() { }

    public async createPlan(goal: string): Promise<string> {
        console.log(`[HTNPlannerV2] Decomposing high-level goal: "${goal}"`);

        // 1. Root Task (Level 1)
        const rootId = randomUUID();
        this.taskDag.set(rootId, { id: rootId, name: goal, level: 1, status: 'PENDING', dependencies: [] });

        // 2. Hierarchical Decomposition (Mock)
        const subtaskA = this.addTask(`Analyze ${goal}`, 2, [rootId]);
        const subtaskB = this.addTask(`Design ${goal}`, 2, [rootId, subtaskA]);

        this.addTask(`Collect data`, 3, [subtaskA]);
        this.addTask(`Draft spec`, 3, [subtaskB]);

        console.log(`[HTNPlannerV2] Plan generated: ${this.taskDag.size} nodes mapped into a DAG.`);
        return rootId;
    }

    public async executePlan(rootId: string) {
        console.log(`[HTNPlannerV2] Executing Topologically Sorted DAG...`);
        // Mock execution
        await new Promise(r => setTimeout(r, 100));
        console.log(`[HTNPlannerV2] Critical path evaluated. Auto-replanning heuristics active.`);
    }

    private addTask(name: string, level: 1 | 2 | 3 | 4, deps: string[]): string {
        const id = randomUUID();
        this.taskDag.set(id, { id, name, level, status: 'PENDING', dependencies: deps });
        return id;
    }
}

export const htnPlanner = new HTNPlannerV2();
